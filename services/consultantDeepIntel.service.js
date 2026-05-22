import pool from "../config/database.js";

function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function getDefaultCycle() {
  return Number(process.env.FEC_DEFAULT_CYCLE || 2026);
}

function money(value) {
  const amount = num(value);
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function riskBand(score) {
  const value = num(score);
  if (value >= 80) return "High Exposure";
  if (value >= 60) return "Watch Closely";
  if (value >= 40) return "Strategic Asset";
  return "Emerging Signal";
}

function buildNarrative({ consultant, summary, relationships, states, committees, categories, overlaps }) {
  const name = consultant?.name || consultant?.firm_name || "This consultant";
  const influence = num(consultant?.influence_score);
  const exposure = num(consultant?.exposure_score);
  const totalAmount = num(summary?.total_amount);
  const relationshipCount = num(summary?.relationship_count);
  const stateCount = states.length;
  const committeeCount = committees.length;
  const categoryCount = categories.length;
  const crossParty = Boolean(summary?.has_cross_party_overlap);

  const lead = `${name} is mapped to ${relationshipCount} candidate relationship${relationshipCount === 1 ? "" : "s"} with ${money(totalAmount)} in FEC-linked disbursement activity.`;

  const footprint = stateCount
    ? `The footprint spans ${stateCount} state${stateCount === 1 ? "" : "s"}, led by ${states.slice(0, 3).map((row) => row.state).join(", ")}.`
    : "No state-level footprint has been established yet.";

  const committeeText = committeeCount
    ? `${committeeCount} committee connection${committeeCount === 1 ? "" : "s"} are visible in the current cycle.`
    : "No committee concentration has been detected yet.";

  const categoryText = categoryCount
    ? `Service concentration is strongest in ${categories.slice(0, 3).map((row) => row.category).join(", ")}.`
    : "Service category intelligence is still developing.";

  const riskText = crossParty || exposure >= 60 || overlaps.length
    ? "Review recommended: cross-party, multi-candidate, or high-exposure relationship patterns may require analyst validation."
    : "No immediate exposure pattern is flagged, but the network should continue to be monitored as imports expand.";

  const scoreText = `Influence score is ${influence}; exposure score is ${exposure}; current risk band is ${consultant?.risk_label || riskBand((influence + exposure) / 2)}.`;

  return [lead, footprint, committeeText, categoryText, scoreText, riskText].join(" ");
}

export async function ensureConsultantDeepIntelSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_deep_intel_notes (
      id SERIAL PRIMARY KEY,
      consultant_id INTEGER REFERENCES consultants(id) ON DELETE CASCADE,
      cycle INTEGER,
      note_type TEXT DEFAULT 'system',
      title TEXT,
      body TEXT,
      source_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_consultant_deep_intel_notes_consultant
    ON consultant_deep_intel_notes(consultant_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_consultant_deep_intel_notes_cycle
    ON consultant_deep_intel_notes(cycle)
  `);
}

export async function getConsultantDeepProfile(consultantId, options = {}) {
  await ensureConsultantDeepIntelSchema();

  const id = Number(consultantId);
  const cycle = num(options.cycle, getDefaultCycle());

  if (!Number.isFinite(id) || id <= 0) {
    const error = new Error("Invalid consultant id");
    error.statusCode = 400;
    throw error;
  }

  const consultantResult = await pool.query(
    `
      SELECT
        *,
        COALESCE(contact_status, 'missing') AS contact_status,
        COALESCE(contact_confidence, 0) AS contact_confidence
      FROM consultants
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  const consultant = consultantResult.rows[0];

  if (!consultant) return null;

  const [
    relationshipsResult,
    stateHeatmapResult,
    committeeResult,
    categoryResult,
    partyResult,
    officeResult,
    snapshotsResult,
    overlapsResult,
    latestNotesResult,
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          r.*,
          c.full_name AS candidate_full_name,
          c.name AS candidate_record_name,
          c.fec_candidate_id,
          c.website AS candidate_website,
          c.contact_email AS candidate_contact_email,
          c.press_email AS candidate_press_email,
          c.phone AS candidate_phone
        FROM consultant_candidate_relationships r
        LEFT JOIN candidates c ON c.id = r.candidate_id
        WHERE r.consultant_id = $1
          AND r.cycle = $2
        ORDER BY r.total_amount DESC, r.transaction_count DESC
      `,
      [id, cycle]
    ),

    pool.query(
      `
        SELECT
          COALESCE(candidate_state, 'Unknown') AS state,
          COUNT(DISTINCT candidate_id)::int AS candidate_count,
          COUNT(DISTINCT committee_id)::int AS committee_count,
          COALESCE(SUM(total_amount), 0)::numeric AS total_amount,
          COALESCE(SUM(transaction_count), 0)::int AS transaction_count,
          MAX(last_disbursement_date) AS last_activity
        FROM consultant_candidate_relationships
        WHERE consultant_id = $1
          AND cycle = $2
        GROUP BY COALESCE(candidate_state, 'Unknown')
        ORDER BY total_amount DESC, candidate_count DESC
      `,
      [id, cycle]
    ),

    pool.query(
      `
        SELECT
          COALESCE(committee_id, 'Unknown') AS committee_id,
          COALESCE(committee_name, 'Unknown Committee') AS committee_name,
          COUNT(DISTINCT candidate_id)::int AS candidate_count,
          COALESCE(SUM(total_amount), 0)::numeric AS total_amount,
          COALESCE(SUM(transaction_count), 0)::int AS transaction_count,
          MAX(last_disbursement_date) AS last_activity
        FROM consultant_candidate_relationships
        WHERE consultant_id = $1
          AND cycle = $2
        GROUP BY COALESCE(committee_id, 'Unknown'), COALESCE(committee_name, 'Unknown Committee')
        ORDER BY total_amount DESC, candidate_count DESC
        LIMIT 25
      `,
      [id, cycle]
    ),

    pool.query(
      `
        SELECT
          COALESCE(category, 'Political Consulting') AS category,
          COUNT(DISTINCT candidate_id)::int AS candidate_count,
          COALESCE(SUM(total_amount), 0)::numeric AS total_amount,
          COALESCE(SUM(transaction_count), 0)::int AS transaction_count
        FROM consultant_candidate_relationships
        WHERE consultant_id = $1
          AND cycle = $2
        GROUP BY COALESCE(category, 'Political Consulting')
        ORDER BY total_amount DESC, candidate_count DESC
      `,
      [id, cycle]
    ),

    pool.query(
      `
        SELECT
          COALESCE(candidate_party, 'Unknown') AS party,
          COUNT(DISTINCT candidate_id)::int AS candidate_count,
          COALESCE(SUM(total_amount), 0)::numeric AS total_amount
        FROM consultant_candidate_relationships
        WHERE consultant_id = $1
          AND cycle = $2
        GROUP BY COALESCE(candidate_party, 'Unknown')
        ORDER BY total_amount DESC, candidate_count DESC
      `,
      [id, cycle]
    ),

    pool.query(
      `
        SELECT
          COALESCE(candidate_office, 'Unknown') AS office,
          COUNT(DISTINCT candidate_id)::int AS candidate_count,
          COALESCE(SUM(total_amount), 0)::numeric AS total_amount
        FROM consultant_candidate_relationships
        WHERE consultant_id = $1
          AND cycle = $2
        GROUP BY COALESCE(candidate_office, 'Unknown')
        ORDER BY total_amount DESC, candidate_count DESC
      `,
      [id, cycle]
    ),

    pool.query(
      `
        SELECT *
        FROM consultant_risk_snapshots
        WHERE consultant_id = $1
          AND cycle = $2
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [id, cycle]
    ),

    pool.query(
      `
        WITH target_candidates AS (
          SELECT DISTINCT candidate_id
          FROM consultant_candidate_relationships
          WHERE consultant_id = $1
            AND cycle = $2
        )
        SELECT
          other.consultant_id,
          c.name AS consultant_name,
          c.category,
          c.influence_score,
          c.exposure_score,
          COUNT(DISTINCT other.candidate_id)::int AS shared_candidate_count,
          COALESCE(SUM(other.total_amount), 0)::numeric AS shared_amount,
          ARRAY_AGG(DISTINCT other.candidate_state) FILTER (WHERE other.candidate_state IS NOT NULL) AS states,
          ARRAY_AGG(DISTINCT other.candidate_party) FILTER (WHERE other.candidate_party IS NOT NULL) AS parties
        FROM consultant_candidate_relationships other
        JOIN target_candidates tc ON tc.candidate_id = other.candidate_id
        JOIN consultants c ON c.id = other.consultant_id
        WHERE other.consultant_id <> $1
          AND other.cycle = $2
        GROUP BY other.consultant_id, c.name, c.category, c.influence_score, c.exposure_score
        ORDER BY shared_candidate_count DESC, shared_amount DESC
        LIMIT 25
      `,
      [id, cycle]
    ),

    pool.query(
      `
        SELECT *
        FROM consultant_deep_intel_notes
        WHERE consultant_id = $1
          AND cycle = $2
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [id, cycle]
    ),
  ]);

  const relationships = relationshipsResult.rows;
  const states = stateHeatmapResult.rows;
  const committees = committeeResult.rows;
  const categories = categoryResult.rows;
  const parties = partyResult.rows;
  const offices = officeResult.rows;
  const snapshots = snapshotsResult.rows;
  const overlaps = overlapsResult.rows;

  const totalAmount = relationships.reduce((sum, row) => sum + num(row.total_amount), 0);
  const totalTransactions = relationships.reduce((sum, row) => sum + num(row.transaction_count), 0);
  const uniqueCandidates = new Set(relationships.map((row) => row.candidate_id).filter(Boolean));
  const uniqueCommittees = new Set(relationships.map((row) => row.committee_id).filter(Boolean));
  const partySet = new Set(relationships.map((row) => clean(row.candidate_party)).filter(Boolean));
  const stateSet = new Set(relationships.map((row) => clean(row.candidate_state)).filter(Boolean));

  const summary = {
    relationship_count: relationships.length,
    candidate_count: uniqueCandidates.size,
    committee_count: uniqueCommittees.size,
    state_count: stateSet.size,
    party_count: partySet.size,
    category_count: categories.length,
    total_amount: totalAmount,
    transaction_count: totalTransactions,
    states: [...stateSet],
    parties: [...partySet],
    has_cross_party_overlap: partySet.size > 1,
    top_state: states[0]?.state || null,
    top_category: categories[0]?.category || null,
    top_committee: committees[0]?.committee_name || null,
  };

  const narrative = buildNarrative({
    consultant,
    summary,
    relationships,
    states,
    committees,
    categories,
    overlaps,
  });

  const riskFlags = [
    summary.has_cross_party_overlap
      ? {
          level: "High",
          label: "Cross-party overlap",
          detail: "This consultant has mapped relationships across more than one party label.",
        }
      : null,
    num(consultant.exposure_score) >= 60
      ? {
          level: "Watch",
          label: "Elevated exposure score",
          detail: `Exposure score is ${consultant.exposure_score}. Review shared relationships and candidate clusters.`,
        }
      : null,
    overlaps.length >= 5
      ? {
          level: "Watch",
          label: "Dense shared-consultant network",
          detail: `${overlaps.length} other consultants share candidate relationships with this consultant.`,
        }
      : null,
    summary.state_count >= 5
      ? {
          level: "Info",
          label: "Multi-state footprint",
          detail: `Activity spans ${summary.state_count} states in the current cycle.`,
        }
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    cycle,
    consultant,
    summary,
    narrative,
    risk_flags: riskFlags,
    relationships,
    state_heatmap: states,
    committee_relationships: committees,
    service_mix: categories,
    party_mix: parties,
    office_mix: offices,
    influence_timeline: snapshots,
    shared_network: overlaps,
    notes: latestNotesResult.rows,
  };
}
