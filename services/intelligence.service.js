import { pool } from "../db/pool.js";

function n(value) {
  return Number(value || 0);
}

function fmtMoney(value) {
  return `$${n(value).toLocaleString()}`; 
}

function normalizeStateName(value = "") {
  const raw = String(value || "").trim();
  return raw || "Unknown";
}

function makeRisk(score) {
  if (score >= 80) return "Elevated";
  if (score >= 60) return "Watch";
  return "Monitor";
}

function makePriority(score) {
  if (score >= 75) return "Tier 1";
  if (score >= 45) return "Tier 2";
  return "Tier 3";
}

function makeOverlayTier(score) {
  if (score >= 80) return "Critical";
  if (score >= 60) return "Elevated";
  if (score >= 35) return "Watch";
  return "Monitor";
}

function severityScore(value = "") {
  const v = String(value || "").toLowerCase();
  if (v === "critical") return 100;
  if (v === "high") return 70;
  if (v === "medium") return 40;
  if (v === "low") return 15;
  return 10;
}

function riskScore(value = "") {
  const v = String(value || "").toLowerCase();
  if (v === "elevated") return 30;
  if (v === "watch") return 15;
  if (v === "monitor") return 5;
  return 0;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[LiveDataHub] query fallback:", error.message);
    return [];
  }
}

function getPacContributions(row = {}) {
  const payload =
    row.source_payload && typeof row.source_payload === "object"
      ? row.source_payload
      : {};

  const pacs = payload.pac_contributions || row.pac_contributions || [];

  if (!Array.isArray(pacs)) return [];

  return pacs
    .map((pac, index) => ({
      id: pac.committee_id || pac.id || `pac-${index}`,
      committee_id: pac.committee_id || pac.id || "N/A",
      committee_name:
        pac.committee_name ||
        pac.name ||
        pac.contributor_name ||
        "Unknown PAC / Committee",
      committee_type: pac.committee_type || pac.type || "Committee",
      committee_party: pac.committee_party || pac.party || "N/A",
      amount: Number(pac.amount || pac.total || pac.contribution_amount || 0),
      city: pac.city || "",
      state: pac.state || "",
      fec_url: pac.fec_url || "",
    }))
    .filter((pac) => pac.committee_name && pac.committee_name !== "Unknown PAC / Committee")
    .sort((a, b) => b.amount - a.amount);
}

function buildFundingSources(row = {}) {
  const receipts = Number(row.receipts || 0);
  const payload =
    row.source_payload && typeof row.source_payload === "object"
      ? row.source_payload
      : {};

  const pacCommittees = getPacContributions(row);
  const pacCommitteeTotal = pacCommittees.reduce(
    (sum, pac) => sum + Number(pac.amount || 0),
    0
  );

  const individual =
    Number(payload.individual_contributions || 0) ||
    Number(payload.individual_itemized_contributions || 0) ||
    Number(payload.individual_unitemized_contributions || 0) ||
    Math.round(receipts * 0.52);

  const smallDollar =
    Number(payload.small_dollar_contributions || 0) ||
    Number(payload.individual_unitemized_contributions || 0) ||
    Math.round(receipts * 0.21);

  const pac =
    Number(payload.pac_contributions_total || 0) ||
    pacCommitteeTotal ||
    Number(payload.other_political_committee_contributions || 0) ||
    Math.round(receipts * 0.16);

  const transfers =
    Number(payload.transfers_from_other_authorized_committee || 0) ||
    Number(payload.transfers || 0) ||
    Math.round(receipts * 0.07);

  const known = individual + smallDollar + pac + transfers;
  const other = Math.max(0, receipts - known);

  return [
    { source: "Individual Contributions", amount: individual },
    { source: "Small-Dollar Contributions", amount: smallDollar },
    { source: "PAC Contributions", amount: pac, committees: pacCommittees },
    { source: "Candidate Committee Transfers", amount: transfers },
    { source: "Other Receipts", amount: other },
  ];
}

export async function getLiveFundraising(input = 250) {
  const filters =
    typeof input === "number"
      ? { limit: input }
      : input && typeof input === "object"
        ? input
        : {};

  const payload = await getFundraisingLeaderboard({
    ...filters,
    limit: Math.max(1, Math.min(Number(filters.limit || 250), 5000)),
  });

  return payload.leaderboard || [];
}

export async function getFundraisingLeaderboard(input = {}) {
  const filters =
    typeof input === "number"
      ? { limit: input }
      : input && typeof input === "object"
        ? input
        : {};

  const limit = Math.max(1, Math.min(Number(filters.limit || 1000), 5000));
  const state = String(filters.state || "").trim().toUpperCase();
  const office = String(filters.office || "").trim();
  const party = String(filters.party || "").trim();
  const candidate = String(filters.candidate || "").trim();
  const pac = String(filters.pac || "").trim();
  const cycle = Number(
    filters.cycle ||
      process.env.FEC_DEFAULT_CYCLE ||
      process.env.FEC_CYCLE ||
      2026
  );

  try {
    const where = [];
    const params = [];

    if (cycle) {
      params.push(cycle);
      where.push(`election_year = $${params.length}`);
    }

    if (state) {
      params.push(state);
      where.push(`UPPER(COALESCE(state, '')) = $${params.length}`);
    }

    if (office) {
      params.push(`%${office}%`);
      where.push(`COALESCE(office, '') ILIKE $${params.length}`);
    }

    if (party) {
      params.push(`%${party}%`);
      where.push(`COALESCE(party, '') ILIKE $${params.length}`);
    }

    if (candidate) {
      params.push(`%${candidate}%`);
      where.push(`COALESCE(name, '') ILIKE $${params.length}`);
    }

    if (pac) {
      params.push(`%${pac}%`);
      where.push(`
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(source_payload->'pac_contributions', '[]'::jsonb)) AS pac_item
          WHERE COALESCE(pac_item->>'committee_name', '') ILIKE $${params.length}
        )
      `);
    }

    params.push(limit);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await pool.query(
      `
        SELECT
          candidate_id,
          name,
          state,
          office,
          district,
          party,
          COALESCE(receipts, 0)::numeric AS receipts,
          COALESCE(cash_on_hand, 0)::numeric AS cash_on_hand,
          coverage_end_date,
          election_year,
          source,
          source_updated_at,
          source_payload,
          created_at,
          updated_at
        FROM fundraising_live
        ${whereSql}
        ORDER BY COALESCE(receipts, 0)::numeric DESC NULLS LAST,
                 COALESCE(cash_on_hand, 0)::numeric DESC NULLS LAST,
                 name ASC
        LIMIT $${params.length}
      `,
      params
    );

    const leaderboard = result.rows.map((row, index) => {
      const pacContributions = getPacContributions(row);

      return {
        rank: index + 1,
        candidate_id: row.candidate_id,
        name: row.name || "Unknown Candidate",
        state: row.state || "N/A",
        office: row.office || "Race",
        district: row.district || "Statewide",
        party: row.party || "N/A",
        receipts: Number(row.receipts || 0),
        cash_on_hand: Number(row.cash_on_hand || 0),
        coverage_end_date: row.coverage_end_date || null,
        election_year: Number(row.election_year || cycle),
        source: row.source || "FEC",
        source_updated_at:
          row.source_updated_at || row.updated_at || row.created_at || null,
        pac_contributions: pacContributions,
        funding_sources: buildFundingSources(row),
      };
    });

    const totalReceipts = leaderboard.reduce(
      (sum, row) => sum + Number(row.receipts || 0),
      0
    );

    const totalCashOnHand = leaderboard.reduce(
      (sum, row) => sum + Number(row.cash_on_hand || 0),
      0
    );

    const pacCommittees = new Set(
      leaderboard.flatMap((row) =>
        (row.pac_contributions || []).map((pacRow) => pacRow.committee_name)
      )
    );

    return {
      ok: true,
      source: "fec",
      table: "fundraising_live",
      cycle,
      limit,
      count: leaderboard.length,
      leaderboard,
      summary: {
        tracked_candidates: leaderboard.length,
        total_receipts: totalReceipts,
        total_cash_on_hand: totalCashOnHand,
        average_receipts: leaderboard.length
          ? Math.round(totalReceipts / leaderboard.length)
          : 0,
        pac_committees: pacCommittees.size,
      },
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[Intelligence] fundraising_live leaderboard failed:", error);

    return {
      ok: false,
      source: "fec-error",
      table: "fundraising_live",
      error: error.message,
      cycle,
      limit,
      count: 0,
      leaderboard: [],
      summary: {
        tracked_candidates: 0,
        total_receipts: 0,
        total_cash_on_hand: 0,
        average_receipts: 0,
        pac_committees: 0,
      },
      updated_at: new Date().toISOString(),
    };
  }
}

export async function getExecutiveFeedEvents(limit = 20) {
  const rows = await safeQuery(
    `
      SELECT
        id,
        event_type,
        severity,
        title,
        source,
        state,
        office,
        risk,
        candidate_name,
        candidate_id,
        vendor_id,
        metadata,
        created_at
      FROM executive_feed_events
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `,
    [limit]
  );

  return rows.map((row) => ({
    id: row.id,
    time: row.created_at
      ? new Date(row.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Now",
    title: row.title || "Live intelligence signal",
    source: row.source || "Intelligence Feed",
    severity: row.severity || "Info",
    type: row.event_type || "intelligence.signal",
    event_type: row.event_type || "intelligence.signal",
    state: normalizeStateName(row.state),
    office: row.office || "N/A",
    risk: row.risk || "Monitor",
    candidate_name: row.candidate_name,
    candidate_id: row.candidate_id,
    vendor_id: row.vendor_id,
    metadata: row.metadata || {},
    created_at: row.created_at,
  }));
}

export async function getVendorSignals(limit = 25) {
  return safeQuery(
    `
      SELECT *
      FROM vendors
      ORDER BY id DESC
      LIMIT $1
    `,
    [limit]
  );
}

export async function getConsultantSignals(limit = 25) {
  return safeQuery(
    `
      SELECT *
      FROM consultants
      ORDER BY id DESC
      LIMIT $1
    `,
    [limit]
  );
}

export async function getDonorSignals(limit = 25) {
  return safeQuery(
    `
      SELECT *
      FROM donors
      ORDER BY id DESC
      LIMIT $1
    `,
    [limit]
  );
}

export async function getMailOpsSignals(limit = 25) {
  const rows = await safeQuery(
    `
      SELECT *
      FROM mailops_events
      ORDER BY event_time DESC NULLS LAST, id DESC
      LIMIT $1
    `,
    [limit]
  );

  if (rows.length) return rows;

  return safeQuery(
    `
      SELECT *
      FROM mail_ops_events
      ORDER BY id DESC
      LIMIT $1
    `,
    [limit]
  );
}

export async function getIntelligenceMap() {
  const rows = await getLiveFundraising(1000);
  const groups = new Map();

  for (const row of rows) {
    const state = normalizeStateName(row.state);
    const office = row.office || "Race";
    const key = `${state}::${office}`;

    if (!groups.has(key)) {
      groups.set(key, {
        state,
        office,
        totalReceipts: 0,
        totalCashOnHand: 0,
        candidates: [],
        last_synced_at: row.source_updated_at || null,
      });
    }

    const group = groups.get(key);
    group.totalReceipts += n(row.receipts);
    group.totalCashOnHand += n(row.cash_on_hand);

    if (
      row.source_updated_at &&
      (!group.last_synced_at || row.source_updated_at > group.last_synced_at)
    ) {
      group.last_synced_at = row.source_updated_at;
    }

    group.candidates.push({
      candidate_id: row.candidate_id,
      name: row.name || "Unknown Candidate",
      party: row.party || "N/A",
      receipts: n(row.receipts),
      cash_on_hand: n(row.cash_on_hand),
      pac_count: row.pac_contributions?.length || 0,
      rank: 0,
    });
  }

  const battlegrounds = Array.from(groups.values())
    .map((group) => {
      const candidates = group.candidates
        .sort((a, b) => b.receipts - a.receipts)
        .slice(0, 5)
        .map((candidate, index) => ({
          ...candidate,
          rank: index + 1,
        }));

      const receiptsScore = Math.min(
        60,
        Math.round(group.totalReceipts / 250000)
      );
      const cashScore = Math.min(
        25,
        Math.round(group.totalCashOnHand / 300000)
      );
      const depthScore = Math.min(15, candidates.length * 3);
      const overlayScore = Math.min(
        100,
        receiptsScore + cashScore + depthScore
      );

      return {
        state: group.state,
        office: group.office,
        overlayScore,
        overlayTier: makeOverlayTier(overlayScore),
        totalReceipts: group.totalReceipts,
        totalCashOnHand: group.totalCashOnHand,
        candidates,
        last_synced_at: group.last_synced_at,
      };
    })
    .sort((a, b) => b.overlayScore - a.overlayScore);

  return {
    summary: {
      trackedStates: new Set(battlegrounds.map((item) => item.state)).size,
      overlays: battlegrounds.length,
      last_synced_at:
        battlegrounds
          .map((item) => item.last_synced_at)
          .filter(Boolean)
          .sort()
          .at(-1) || null,
    },
    battlegrounds,
  };
}

export async function getBattlegroundDashboardData() {
  const map = await getIntelligenceMap();

  return map.battlegrounds.slice(0, 8).map((item) => {
    const probability = Math.max(
      49,
      Math.min(62, Math.round(item.overlayScore / 2 + 18))
    );
    const momentum = Number((item.overlayScore / 30).toFixed(1));
    const risk = makeRisk(item.overlayScore);
    const priority = makePriority(item.overlayScore);
    const topCandidate = item.candidates?.[0] || null;

    return {
      race: `${item.state} ${item.office}`,
      candidate: topCandidate?.name || `${item.state} ${item.office}`,
      state: item.state,
      office: item.office,
      probability: `${probability}%`,
      win_probability: probability,
      momentum: momentum >= 0 ? `+${momentum}` : String(momentum),
      risk,
      priority,
      receipts: item.totalReceipts,
      cash_on_hand: item.totalCashOnHand,
      vendor_count: 0,
      candidates: item.candidates,
    };
  });
}

export async function getIntelligenceSummary() {
  const [
    fundraisingPayload,
    feed,
    vendors,
    consultants,
    donors,
    mailops,
    map,
  ] = await Promise.all([
    getFundraisingLeaderboard(250),
    getExecutiveFeedEvents(25),
    getVendorSignals(25),
    getConsultantSignals(25),
    getDonorSignals(25),
    getMailOpsSignals(25),
    getIntelligenceMap(),
  ]);

  return {
    generated_at: new Date().toISOString(),
    summary: {
      fundraising_records: fundraisingPayload.leaderboard.length,
      pac_committees: fundraisingPayload.summary?.pac_committees || 0,
      feed_events: feed.length,
      vendors: vendors.length,
      consultants: consultants.length,
      donors: donors.length,
      mailops_events: mailops.length,
      map_overlays: map.summary.overlays,
      tracked_states: map.summary.trackedStates,
    },
  };
}

export async function getIntelligenceDashboard() {
  const [
    summary,
    battlegrounds,
    fundraisingPayload,
    executiveFeed,
    vendors,
    donors,
    consultants,
    mailops,
  ] = await Promise.all([
    getIntelligenceSummary(),
    getBattlegroundDashboardData(),
    getFundraisingLeaderboard(25),
    getExecutiveFeedEvents(12),
    getVendorSignals(8),
    getDonorSignals(8),
    getConsultantSignals(8),
    getMailOpsSignals(8),
  ]);

  const leaderboard = fundraisingPayload.leaderboard || [];
  const totalReceipts = fundraisingPayload.summary?.total_receipts || 0;
  const totalCash = fundraisingPayload.summary?.total_cash_on_hand || 0;

  return {
    generated_at: new Date().toISOString(),
    metrics: [
      {
        label: "Fundraising Leaders",
        value: String(leaderboard.length),
        delta: "Live finance records",
        tone: "up",
      },
      {
        label: "Receipts Modeled",
        value: fmtMoney(totalReceipts),
        delta: "From fundraising_live",
        tone: "up",
      },
      {
        label: "Cash On Hand",
        value: fmtMoney(totalCash),
        delta: "Reserve strength",
        tone: "up",
      },
      {
        label: "PAC Committees",
        value: String(fundraisingPayload.summary?.pac_committees || 0),
        delta: "Named committee records",
        tone: "up",
      },
    ],
    feed: executiveFeed,
    executiveFeed,
    battlegrounds,
    leaderboard,
    fundraisingLeaders: leaderboard,
    fundraisingSummary: fundraisingPayload.summary,
    vendors,
    donors,
    consultants,
    mailops,
    summary: summary.summary,
  };
}

export async function getIntelligenceForecast() {
  const battlegrounds = await getBattlegroundDashboardData();

  return {
    generated_at: new Date().toISOString(),
    results: battlegrounds,
  };
}

export async function getIntelligenceRankings() {
  const fundraisingPayload = await getFundraisingLeaderboard(50);

  return {
    generated_at: new Date().toISOString(),
    results: fundraisingPayload.leaderboard,
  };
}

export async function getCandidateIntelligenceSummary(filters = {}) {
  const rows = await safeQuery(
    `
      SELECT
        id,
        external_id,
        full_name,
        state,
        office,
        party,
        last_imported_at
      FROM candidates
      ORDER BY last_imported_at DESC NULLS LAST, full_name ASC
      LIMIT 100
    `
  );

  return {
    total: rows.length,
    filters,
    summary: {
      candidates_tracked: rows.length,
      active_states: new Set(rows.map((r) => r.state).filter(Boolean)).size,
      offices_tracked: new Set(rows.map((r) => r.office).filter(Boolean)).size,
      last_updated: new Date().toISOString(),
    },
    results: rows,
  };
}

function buildActionFromSignal(item, index) {
  const sev = String(item.severity || "").toLowerCase();
  const risk = String(item.risk || "").toLowerCase();

  let actionType = "Review";
  let priority = "Normal";
  let due = "Next Cycle";

  if (sev === "critical") {
    actionType = "Escalate Immediately";
    priority = "Immediate";
    due = "Now";
  } else if (sev === "high") {
    actionType = "Investigate Now";
    priority = "High";
    due = "Today";
  } else if (risk === "elevated") {
    actionType = "Mitigate Risk";
    priority = "High";
    due = "Today";
  } else if (risk === "watch") {
    actionType = "Monitor Closely";
    priority = "Normal";
    due = "Next Cycle";
  }

  return {
    id: `action-${item.id || index}`,
    title: `${actionType}: ${item.title || "Live signal"}`,
    owner: item.source || "Command",
    priority,
    due,
    detail:
      item.metadata?.recommendation ||
      item.metadata?.description ||
      `State: ${item.state || "N/A"} • Office: ${item.office || "N/A"}`,
    state: item.state || "National",
    office: item.office || "N/A",
    risk: item.risk || "Monitor",
  };
}

export async function getIntelligenceCommand() {
  const dashboard = await getIntelligenceDashboard();

  const scoredFeed = (dashboard.feed || []).map((item) => ({
    ...item,
    score: severityScore(item.severity) + riskScore(item.risk),
  }));

  const prioritizedFeed = scoredFeed.sort((a, b) => b.score - a.score);

  const urgentFeed = prioritizedFeed.filter((item) =>
    ["High", "Critical"].includes(item.severity)
  );

  const mailopsActions = (dashboard.mailops || [])
    .slice(0, 4)
    .map((item, index) => ({
      id: `mailops-action-${item.id || index}`,
      title: `MailOps: ${item.campaign || "Review mail operation"}`,
      owner: "MailOps",
      priority: ["High", "Elevated", "Delayed"].includes(
        item.severity || item.status
      )
        ? "High"
        : "Normal",
      due: ["High", "Elevated", "Delayed"].includes(
        item.severity || item.status
      )
        ? "Today"
        : "Next Cycle",
      detail: item.note || `${item.location || "Mail operation"} requires review.`,
      state: item.state || "National",
      office: item.office || "N/A",
      risk: item.risk || "Monitor",
    }));

  const actions = [
    ...prioritizedFeed.slice(0, 8).map(buildActionFromSignal),
    ...mailopsActions,
  ].slice(0, 10);

  return {
    generated_at: new Date().toISOString(),
    metrics: dashboard.metrics,
    battlegrounds: dashboard.battlegrounds,
    feed: prioritizedFeed.slice(0, 20),
    urgent_feed: urgentFeed,
    actions,
    command: {
      top_battlegrounds: dashboard.battlegrounds.slice(0, 5),
      top_fundraising: dashboard.leaderboard.slice(0, 5),
      urgent_feed: urgentFeed,
      vendor_signals: dashboard.vendors.slice(0, 10),
      donor_signals: dashboard.donors.slice(0, 10),
      consultant_signals: dashboard.consultants.slice(0, 10),
      mailops_signals: dashboard.mailops.slice(0, 10),
    },
  };
}
