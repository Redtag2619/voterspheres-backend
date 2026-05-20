import pool from "../config/database.js";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function nullable(value) {
  const next = clean(value);
  return next || null;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeState(value) {
  return clean(value).toUpperCase();
}

function normalizeName(value) {
  return clean(value)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function normalizeVendorName(value) {
  const name = normalizeName(value)
    .replace(/\bLLC\b\.?/gi, "LLC")
    .replace(/\bINC\b\.?/gi, "Inc")
    .replace(/\bCORP\b\.?/gi, "Corp")
    .replace(/\bCO\b\.?/gi, "Co")
    .replace(/\bLTD\b\.?/gi, "Ltd");

  return name || "Unknown Consultant";
}

function getFecConfig() {
  return {
    apiKey: process.env.FEC_API_KEY || "",
    baseUrl: process.env.FEC_API_BASE_URL || "https://api.open.fec.gov/v1",
    defaultCycle: Number(process.env.FEC_DEFAULT_CYCLE || 2026),
    perPage: Math.min(Math.max(Number(process.env.FEC_CONSULTANT_IMPORT_PER_PAGE || 100), 1), 100),
    maxPages: Math.min(Math.max(Number(process.env.FEC_CONSULTANT_IMPORT_MAX_PAGES || 3), 1), 25),
  };
}

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function fecGet(path, params = {}) {
  const { apiKey, baseUrl } = getFecConfig();

  if (!apiKey) {
    throw createHttpError("Missing FEC_API_KEY", 500);
  }

  const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
  url.searchParams.set("api_key", apiKey);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "VoterSpheres/1.0",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw createHttpError(
      `FEC API request failed (${response.status}): ${text || response.statusText}`,
      502
    );
  }

  return response.json();
}

const CONSULTANT_KEYWORDS = [
  "consult",
  "consulting",
  "strategy",
  "strategic",
  "media",
  "digital",
  "advertising",
  "ad buy",
  "placement",
  "fundraising",
  "finance",
  "compliance",
  "treasurer",
  "accounting",
  "poll",
  "polling",
  "research",
  "mail",
  "direct mail",
  "printing",
  "field",
  "canvass",
  "canvassing",
  "data",
  "analytics",
  "communications",
  "public relations",
  "production",
  "texting",
  "sms",
  "voter contact",
  "phone bank",
];

const EXCLUDED_PAYEE_KEYWORDS = [
  "usps",
  "united states postal",
  "google",
  "facebook",
  "meta platforms",
  "actblue",
  "winred",
  "paypal",
  "stripe",
  "bank",
  "irs",
  "tax",
  "rent",
  "hotel",
  "airlines",
  "delta air",
  "american airlines",
  "southwest",
  "uber",
  "lyft",
  "staples",
  "office depot",
  "amazon",
  "fedex",
  "ups",
];

function classifyConsultant(row = {}) {
  const purpose = clean(row.disbursement_purpose_category || row.purpose || row.disbursement_description || row.memo_text);
  const text = `${row.recipient_name || ""} ${purpose}`.toLowerCase();

  if (EXCLUDED_PAYEE_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return {
      isConsultant: false,
      category: "Excluded Vendor",
      confidence: 0.05,
      reason: "excluded_keyword",
    };
  }

  let score = 0;
  const matched = [];

  for (const keyword of CONSULTANT_KEYWORDS) {
    if (text.includes(keyword)) {
      score += keyword.length >= 8 ? 0.12 : 0.08;
      matched.push(keyword);
    }
  }

  if (clean(row.recipient_name)) score += 0.15;
  if (num(row.disbursement_amount) >= 1000) score += 0.12;
  if (num(row.disbursement_amount) >= 10000) score += 0.12;
  if (clean(row.disbursement_description)) score += 0.1;

  let category = "Political Consulting";
  if (text.includes("media") || text.includes("advertising") || text.includes("ad buy")) category = "Media + Advertising";
  else if (text.includes("digital") || text.includes("texting") || text.includes("sms")) category = "Digital";
  else if (text.includes("fundraising") || text.includes("finance")) category = "Fundraising";
  else if (text.includes("compliance") || text.includes("treasurer") || text.includes("accounting")) category = "Compliance + Finance";
  else if (text.includes("poll") || text.includes("research")) category = "Polling + Research";
  else if (text.includes("mail") || text.includes("printing")) category = "Direct Mail";
  else if (text.includes("field") || text.includes("canvass") || text.includes("voter contact")) category = "Field Operations";
  else if (text.includes("strategy") || text.includes("strategic")) category = "Strategy";

  const confidence = Math.min(0.98, Number(score.toFixed(2)));

  return {
    isConsultant: confidence >= 0.25,
    category,
    confidence,
    reason: matched.length ? `matched:${matched.slice(0, 6).join(",")}` : "low_signal",
  };
}

function candidateName(candidate = {}) {
  return clean(candidate.full_name || candidate.name || candidate.candidate_name || "Candidate");
}

function candidateParty(candidate = {}) {
  return clean(candidate.party || candidate.party_full || candidate.party_affiliation || "");
}

function getDisbursementAmount(row = {}) {
  return num(row.disbursement_amount || row.amount || row.expenditure_amount || 0);
}

function getDisbursementDate(row = {}) {
  return row.disbursement_date || row.expenditure_date || row.transaction_date || null;
}

function getRecipientState(row = {}) {
  return normalizeState(row.recipient_state || row.payee_state || row.state || "");
}

export async function ensureConsultantImportSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultants (
      id SERIAL PRIMARY KEY,
      name TEXT,
      firm_name TEXT,
      category TEXT,
      state TEXT,
      website TEXT,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'active',
      services TEXT,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      source_updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE consultants
      ADD COLUMN IF NOT EXISTS name TEXT,
      ADD COLUMN IF NOT EXISTS firm_name TEXT,
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS state TEXT,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS services TEXT,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS fec_vendor_name TEXT,
      ADD COLUMN IF NOT EXISTS total_fec_disbursements NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS clients_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_fec_activity TIMESTAMP,
      ADD COLUMN IF NOT EXISTS influence_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS battleground_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS overlap_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS exposure_score NUMERIC DEFAULT 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_candidate_relationships (
      id SERIAL PRIMARY KEY,
      consultant_id INTEGER REFERENCES consultants(id) ON DELETE CASCADE,
      candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
      committee_id TEXT,
      committee_name TEXT,
      candidate_name TEXT,
      candidate_state TEXT,
      candidate_office TEXT,
      candidate_party TEXT,
      cycle INTEGER,
      category TEXT,
      purpose TEXT,
      total_amount NUMERIC DEFAULT 0,
      transaction_count INTEGER DEFAULT 0,
      first_disbursement_date DATE,
      last_disbursement_date DATE,
      confidence NUMERIC DEFAULT 0,
      source TEXT DEFAULT 'fec_schedule_b',
      source_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (consultant_id, candidate_id, committee_id, cycle, category)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_import_runs (
      id SERIAL PRIMARY KEY,
      cycle INTEGER,
      candidate_limit INTEGER,
      candidate_offset INTEGER DEFAULT 0,
      max_pages INTEGER,
      dry_run BOOLEAN DEFAULT false,
      candidates_checked INTEGER DEFAULT 0,
      committees_checked INTEGER DEFAULT 0,
      disbursements_checked INTEGER DEFAULT 0,
      consultants_imported INTEGER DEFAULT 0,
      relationships_imported INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      failures JSONB DEFAULT '[]'::jsonb,
      source TEXT DEFAULT 'fec_schedule_b',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_name ON consultants(name)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_state ON consultants(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_category ON consultants(category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultant_relationship_candidate ON consultant_candidate_relationships(candidate_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultant_relationship_consultant ON consultant_candidate_relationships(consultant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultant_relationship_cycle ON consultant_candidate_relationships(cycle)`);
}

async function fetchCandidateBatch(options = {}) {
  const limit = Math.min(Math.max(num(options.candidateLimit || options.limit, 25), 1), 500);
  const offset = Math.max(num(options.offset, 0), 0);
  const cycle = num(options.cycle, getFecConfig().defaultCycle);
  const params = [limit, offset, cycle];
  const where = [`c.fec_candidate_id IS NOT NULL`, `(c.election_year IS NULL OR c.election_year = $3)`];

  if (options.state) {
    params.push(normalizeState(options.state));
    where.push(`UPPER(COALESCE(c.state, c.state_code, '')) = $${params.length}`);
  }

  if (options.office) {
    params.push(`%${clean(options.office)}%`);
    where.push(`COALESCE(c.office, '') ILIKE $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        c.id,
        c.fec_candidate_id,
        COALESCE(c.full_name, c.name) AS full_name,
        c.name,
        c.state,
        c.state_code,
        c.office,
        c.party,
        c.election_year
      FROM candidates c
      WHERE ${where.join(" AND ")}
      ORDER BY c.id ASC
      LIMIT $1 OFFSET $2
    `,
    params
  );

  return result.rows;
}

async function fetchCommitteesForCandidate(fecCandidateId, cycle) {
  const attempts = [
    {
      path: `/candidate/${encodeURIComponent(fecCandidateId)}/committees/`,
      params: { cycle, per_page: 100 },
    },
    {
      path: "/committees/",
      params: { candidate_id: fecCandidateId, cycle, per_page: 100 },
    },
  ];

  for (const attempt of attempts) {
    try {
      const payload = await fecGet(attempt.path, attempt.params);
      const rows = Array.isArray(payload?.results) ? payload.results : [];
      if (rows.length) return rows;
    } catch {
      // Try next endpoint shape.
    }
  }

  return [];
}

async function fetchScheduleBForCommittee(committeeId, cycle, options = {}) {
  const { perPage, maxPages: envMaxPages } = getFecConfig();
  const maxPages = Math.min(Math.max(num(options.maxPages, envMaxPages), 1), 25);
  const rows = [];

  let lastIndex = null;
  let lastDisbursementDate = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const params = {
      committee_id: committeeId,
      two_year_transaction_period: cycle,
      per_page: perPage,
      sort: "-disbursement_date",
      sort_hide_null: "false",
    };

    if (lastIndex) params.last_index = lastIndex;
    if (lastDisbursementDate) params.last_disbursement_date = lastDisbursementDate;

    const payload = await fecGet("/schedules/schedule_b/", params);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    rows.push(...results);

    const pagination = payload?.pagination || {};
    const lastIndexes = pagination?.last_indexes || {};
    lastIndex = lastIndexes?.last_index || null;
    lastDisbursementDate = lastIndexes?.last_disbursement_date || null;

    if (!results.length) break;
    if (!lastIndex && !lastDisbursementDate) break;
  }

  return rows;
}

async function upsertConsultantFromDisbursement(row, classification) {
  const vendorName = normalizeVendorName(row.recipient_name || row.payee_name || row.name);
  const state = getRecipientState(row);

  const result = await pool.query(
    `
      INSERT INTO consultants (
        name,
        firm_name,
        fec_vendor_name,
        category,
        state,
        status,
        services,
        notes,
        source,
        source_updated_at,
        total_fec_disbursements,
        last_fec_activity,
        created_at,
        updated_at
      )
      VALUES ($1,$1,$2,$3,$4,'active',$5,$6,'fec_schedule_b',NOW(),$7,$8,NOW(),NOW())
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [
      vendorName,
      vendorName,
      classification.category,
      state || null,
      classification.category,
      classification.reason,
      getDisbursementAmount(row),
      getDisbursementDate(row),
    ]
  );

  if (result.rows[0]) return result.rows[0];

  const existing = await pool.query(
    `
      SELECT *
      FROM consultants
      WHERE LOWER(COALESCE(fec_vendor_name, name, firm_name, '')) = LOWER($1)
      ORDER BY id ASC
      LIMIT 1
    `,
    [vendorName]
  );

  if (existing.rows[0]) {
    await pool.query(
      `
        UPDATE consultants
        SET
          category = COALESCE(category, $2),
          state = COALESCE(state, $3),
          services = COALESCE(services, $4),
          source = 'fec_schedule_b',
          source_updated_at = NOW(),
          total_fec_disbursements = COALESCE(total_fec_disbursements, 0) + $5,
          last_fec_activity = GREATEST(COALESCE(last_fec_activity, $6::timestamp), $6::timestamp),
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        existing.rows[0].id,
        classification.category,
        state || null,
        classification.category,
        getDisbursementAmount(row),
        getDisbursementDate(row) || new Date().toISOString(),
      ]
    );

    return existing.rows[0];
  }

  const fallback = await pool.query(
    `
      INSERT INTO consultants (
        name,
        firm_name,
        fec_vendor_name,
        category,
        state,
        status,
        services,
        source,
        source_updated_at,
        total_fec_disbursements,
        last_fec_activity,
        created_at,
        updated_at
      )
      VALUES ($1,$1,$1,$2,$3,'active',$2,'fec_schedule_b',NOW(),$4,$5,NOW(),NOW())
      RETURNING *
    `,
    [
      vendorName,
      classification.category,
      state || null,
      getDisbursementAmount(row),
      getDisbursementDate(row),
    ]
  );

  return fallback.rows[0];
}

async function upsertRelationship({ consultant, candidate, committee, disbursement, classification, cycle }) {
  const amount = getDisbursementAmount(disbursement);
  const date = getDisbursementDate(disbursement);

  const committeeId = clean(committee.committee_id || disbursement.committee_id);
  const committeeName = clean(committee.name || committee.committee_name || disbursement.committee_name);
  const purpose = clean(disbursement.disbursement_description || disbursement.memo_text || disbursement.disbursement_purpose_category);

  const result = await pool.query(
    `
      INSERT INTO consultant_candidate_relationships (
        consultant_id,
        candidate_id,
        committee_id,
        committee_name,
        candidate_name,
        candidate_state,
        candidate_office,
        candidate_party,
        cycle,
        category,
        purpose,
        total_amount,
        transaction_count,
        first_disbursement_date,
        last_disbursement_date,
        confidence,
        source_payload,
        updated_at,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$13,$14,$15,NOW(),NOW()
      )
      ON CONFLICT (consultant_id, candidate_id, committee_id, cycle, category)
      DO UPDATE SET
        total_amount = consultant_candidate_relationships.total_amount + EXCLUDED.total_amount,
        transaction_count = consultant_candidate_relationships.transaction_count + 1,
        first_disbursement_date = LEAST(consultant_candidate_relationships.first_disbursement_date, EXCLUDED.first_disbursement_date),
        last_disbursement_date = GREATEST(consultant_candidate_relationships.last_disbursement_date, EXCLUDED.last_disbursement_date),
        confidence = GREATEST(consultant_candidate_relationships.confidence, EXCLUDED.confidence),
        purpose = COALESCE(consultant_candidate_relationships.purpose, EXCLUDED.purpose),
        source_payload = EXCLUDED.source_payload,
        updated_at = NOW()
      RETURNING *
    `,
    [
      consultant.id,
      candidate.id,
      committeeId || null,
      committeeName || null,
      candidateName(candidate),
      normalizeState(candidate.state || candidate.state_code) || null,
      clean(candidate.office) || null,
      candidateParty(candidate) || null,
      cycle,
      classification.category,
      purpose || null,
      amount,
      date || null,
      classification.confidence,
      JSON.stringify({
        disbursement_id: disbursement.disbursement_id || null,
        image_number: disbursement.image_number || null,
        recipient_name: disbursement.recipient_name || null,
        amount,
        date,
        purpose,
      }),
    ]
  );

  return result.rows[0] || null;
}

async function refreshConsultantScores(cycle) {
  await pool.query(
    `
      WITH stats AS (
        SELECT
          consultant_id,
          SUM(total_amount) AS total_amount,
          COUNT(DISTINCT candidate_id) AS clients_count,
          COUNT(DISTINCT candidate_state) AS state_count,
          COUNT(DISTINCT category) AS category_count,
          MAX(last_disbursement_date) AS last_activity
        FROM consultant_candidate_relationships
        WHERE cycle = $1
        GROUP BY consultant_id
      )
      UPDATE consultants c
      SET
        total_fec_disbursements = COALESCE(stats.total_amount, 0),
        clients_count = COALESCE(stats.clients_count, 0),
        last_fec_activity = stats.last_activity,
        influence_score = LEAST(
          100,
          ROUND(
            20
            + LEAST(35, LN(GREATEST(stats.total_amount, 1)) * 3)
            + LEAST(25, stats.clients_count * 4)
            + LEAST(10, stats.state_count * 2)
            + LEAST(10, stats.category_count * 2)
          )
        ),
        battleground_score = LEAST(
          100,
          ROUND(
            LEAST(50, stats.clients_count * 5)
            + LEAST(50, LN(GREATEST(stats.total_amount, 1)) * 4)
          )
        ),
        overlap_score = LEAST(100, ROUND(LEAST(100, stats.clients_count * 12))),
        exposure_score = LEAST(100, ROUND(LEAST(100, stats.state_count * 12 + stats.clients_count * 4))),
        updated_at = NOW()
      FROM stats
      WHERE c.id = stats.consultant_id
    `,
    [cycle]
  );
}

export async function importConsultantsFromFec(options = {}) {
  await ensureConsultantImportSchema();

  const cycle = num(options.cycle, getFecConfig().defaultCycle);
  const candidateLimit = Math.min(Math.max(num(options.candidateLimit || options.limit, 25), 1), 500);
  const offset = Math.max(num(options.offset, 0), 0);
  const maxPages = Math.min(Math.max(num(options.maxPages, getFecConfig().maxPages), 1), 25);
  const dryRun = Boolean(options.dryRun);

  const candidates = await fetchCandidateBatch({
    cycle,
    candidateLimit,
    offset,
    state: options.state,
    office: options.office,
  });

  let committeesChecked = 0;
  let disbursementsChecked = 0;
  let consultantsImported = 0;
  let relationshipsImported = 0;
  let skipped = 0;
  const failures = [];
  const preview = [];

  for (const candidate of candidates) {
    try {
      const committees = await fetchCommitteesForCandidate(candidate.fec_candidate_id, cycle);
      committeesChecked += committees.length;

      for (const committee of committees) {
        const committeeId = clean(committee.committee_id);
        if (!committeeId) continue;

        const disbursements = await fetchScheduleBForCommittee(committeeId, cycle, { maxPages });
        disbursementsChecked += disbursements.length;

        for (const disbursement of disbursements) {
          const classification = classifyConsultant(disbursement);

          if (!classification.isConsultant) {
            skipped += 1;
            continue;
          }

          const item = {
            candidate_id: candidate.id,
            candidate_name: candidateName(candidate),
            consultant_name: normalizeVendorName(disbursement.recipient_name),
            amount: getDisbursementAmount(disbursement),
            category: classification.category,
            confidence: classification.confidence,
            committee_id: committeeId,
          };

          if (dryRun) {
            preview.push(item);
            consultantsImported += 1;
            relationshipsImported += 1;
            continue;
          }

          const consultant = await upsertConsultantFromDisbursement(disbursement, classification);
          await upsertRelationship({ consultant, candidate, committee, disbursement, classification, cycle });
          consultantsImported += 1;
          relationshipsImported += 1;
        }
      }
    } catch (error) {
      failures.push({
        candidate_id: candidate.id,
        fec_candidate_id: candidate.fec_candidate_id,
        error: error?.message || "Unknown import error",
      });
    }
  }

  if (!dryRun) {
    await refreshConsultantScores(cycle);
  }

  await pool.query(
    `
      INSERT INTO consultant_import_runs (
        cycle,
        candidate_limit,
        candidate_offset,
        max_pages,
        dry_run,
        candidates_checked,
        committees_checked,
        disbursements_checked,
        consultants_imported,
        relationships_imported,
        skipped_count,
        failures,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    `,
    [
      cycle,
      candidateLimit,
      offset,
      maxPages,
      dryRun,
      candidates.length,
      committeesChecked,
      disbursementsChecked,
      consultantsImported,
      relationshipsImported,
      skipped,
      JSON.stringify(failures.slice(0, 50)),
    ]
  );

  return {
    ok: true,
    cycle,
    dry_run: dryRun,
    candidates_checked: candidates.length,
    committees_checked: committeesChecked,
    disbursements_checked: disbursementsChecked,
    consultants_imported: consultantsImported,
    relationships_imported: relationshipsImported,
    skipped,
    failures: failures.slice(0, 25),
    preview: preview.slice(0, 50),
  };
}

export async function getConsultantImportStatus() {
  await ensureConsultantImportSchema();

  const [runs, totals, relationships] = await Promise.all([
    pool.query(`SELECT * FROM consultant_import_runs ORDER BY id DESC LIMIT 10`),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_consultants,
        COUNT(*) FILTER (WHERE source = 'fec_schedule_b')::int AS fec_imported,
        ROUND(AVG(COALESCE(influence_score, 0))::numeric, 2) AS avg_influence,
        MAX(source_updated_at) AS last_source_update
      FROM consultants
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS relationships,
        COUNT(DISTINCT candidate_id)::int AS candidates_mapped,
        COUNT(DISTINCT consultant_id)::int AS consultants_mapped,
        COALESCE(SUM(total_amount), 0)::numeric AS total_amount
      FROM consultant_candidate_relationships
    `),
  ]);

  return {
    ok: true,
    summary: {
      ...(totals.rows[0] || {}),
      ...(relationships.rows[0] || {}),
    },
    recent_runs: runs.rows,
  };
}

export async function getConsultantRankings(options = {}) {
  await ensureConsultantImportSchema();

  const cycle = num(options.cycle, getFecConfig().defaultCycle);
  const limit = Math.min(Math.max(num(options.limit, 25), 1), 100);

  const result = await pool.query(
    `
      SELECT
        c.*,
        COUNT(DISTINCT r.candidate_id)::int AS mapped_candidates,
        COUNT(DISTINCT r.candidate_state)::int AS mapped_states,
        COUNT(DISTINCT r.category)::int AS mapped_categories,
        COALESCE(SUM(r.total_amount), 0)::numeric AS mapped_amount
      FROM consultants c
      LEFT JOIN consultant_candidate_relationships r
        ON r.consultant_id = c.id
        AND r.cycle = $1
      GROUP BY c.id
      ORDER BY
        COALESCE(c.influence_score, 0) DESC,
        COALESCE(SUM(r.total_amount), 0) DESC,
        c.name ASC
      LIMIT $2
    `,
    [cycle, limit]
  );

  return {
    ok: true,
    cycle,
    results: result.rows,
  };
}

export async function getBattlegroundConsultantRankings(options = {}) {
  await ensureConsultantImportSchema();

  const cycle = num(options.cycle, getFecConfig().defaultCycle);
  const limit = Math.min(Math.max(num(options.limit, 25), 1), 100);
  const states = String(options.states || "AZ,GA,MI,NV,NC,PA,WI")
    .split(",")
    .map((item) => normalizeState(item))
    .filter(Boolean);

  const result = await pool.query(
    `
      SELECT
        c.*,
        COUNT(DISTINCT r.candidate_id)::int AS battleground_candidates,
        COUNT(DISTINCT r.candidate_state)::int AS battleground_states,
        COALESCE(SUM(r.total_amount), 0)::numeric AS battleground_amount
      FROM consultants c
      JOIN consultant_candidate_relationships r
        ON r.consultant_id = c.id
      WHERE r.cycle = $1
        AND r.candidate_state = ANY($2)
      GROUP BY c.id
      ORDER BY
        COALESCE(c.battleground_score, 0) DESC,
        COALESCE(SUM(r.total_amount), 0) DESC
      LIMIT $3
    `,
    [cycle, states, limit]
  );

  return {
    ok: true,
    cycle,
    states,
    results: result.rows,
  };
}

export async function getConsultantOverlaps(options = {}) {
  await ensureConsultantImportSchema();

  const cycle = num(options.cycle, getFecConfig().defaultCycle);
  const limit = Math.min(Math.max(num(options.limit, 50), 1), 100);

  const result = await pool.query(
    `
      SELECT
        c.id AS consultant_id,
        c.name AS consultant_name,
        c.category,
        c.influence_score,
        COUNT(DISTINCT r.candidate_id)::int AS candidate_count,
        COUNT(DISTINCT r.candidate_party)::int AS party_count,
        COUNT(DISTINCT r.candidate_state)::int AS state_count,
        ARRAY_AGG(DISTINCT r.candidate_party) FILTER (WHERE r.candidate_party IS NOT NULL) AS parties,
        ARRAY_AGG(DISTINCT r.candidate_state) FILTER (WHERE r.candidate_state IS NOT NULL) AS states,
        COALESCE(SUM(r.total_amount), 0)::numeric AS total_amount
      FROM consultants c
      JOIN consultant_candidate_relationships r
        ON r.consultant_id = c.id
      WHERE r.cycle = $1
      GROUP BY c.id, c.name, c.category, c.influence_score
      HAVING COUNT(DISTINCT r.candidate_id) >= 2
      ORDER BY party_count DESC, candidate_count DESC, total_amount DESC
      LIMIT $2
    `,
    [cycle, limit]
  );

  return {
    ok: true,
    cycle,
    results: result.rows.map((row) => ({
      ...row,
      overlap_type: Number(row.party_count || 0) > 1 ? "cross_party_exposure" : "multi_candidate_network",
      risk_label: Number(row.party_count || 0) > 1 ? "Potential opposition exposure" : "Shared consultant network",
    })),
  };
}

export async function getOppositionExposure(options = {}) {
  await ensureConsultantImportSchema();

  const cycle = num(options.cycle, getFecConfig().defaultCycle);
  const party = clean(options.party || "");
  const state = normalizeState(options.state || "");
  const limit = Math.min(Math.max(num(options.limit, 50), 1), 100);

  const params = [cycle, limit];
  const where = [`r.cycle = $1`];

  if (party) {
    params.push(`%${party}%`);
    where.push(`COALESCE(r.candidate_party, '') NOT ILIKE $${params.length}`);
  }

  if (state) {
    params.push(state);
    where.push(`r.candidate_state = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        c.id AS consultant_id,
        c.name AS consultant_name,
        c.category,
        c.influence_score,
        r.candidate_id,
        r.candidate_name,
        r.candidate_state,
        r.candidate_office,
        r.candidate_party,
        r.total_amount,
        r.transaction_count,
        r.last_disbursement_date,
        r.confidence
      FROM consultants c
      JOIN consultant_candidate_relationships r
        ON r.consultant_id = c.id
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(r.total_amount, 0) DESC, COALESCE(c.influence_score, 0) DESC
      LIMIT $2
    `,
    params
  );

  return {
    ok: true,
    cycle,
    filters: { party, state, limit },
    results: result.rows,
  };
}

export async function getCandidateConsultantRelationships(candidateId, options = {}) {
  await ensureConsultantImportSchema();

  const cycle = num(options.cycle, getFecConfig().defaultCycle);

  const result = await pool.query(
    `
      SELECT
        r.*,
        c.name AS consultant_name,
        c.category AS consultant_category,
        c.state AS consultant_state,
        c.influence_score,
        c.battleground_score,
        c.overlap_score,
        c.exposure_score
      FROM consultant_candidate_relationships r
      JOIN consultants c ON c.id = r.consultant_id
      WHERE r.candidate_id = $1
        AND r.cycle = $2
      ORDER BY r.total_amount DESC
    `,
    [candidateId, cycle]
  );

  return {
    ok: true,
    cycle,
    candidate_id: Number(candidateId),
    results: result.rows,
  };
}
