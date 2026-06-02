import { pool } from "../db/pool.js";

function text(value = "") {
  return String(value ?? "").trim();
}

function riskFromScore(score = 0) {
  if (score >= 82) return "Critical";
  if (score >= 65) return "High";
  if (score >= 42) return "Elevated";
  return "Stable";
}

function scoreSignal({ severity = "medium", signal_type = "fec", state = "" } = {}) {
  let score = 20;
  const s = text(severity).toLowerCase();

  if (s === "critical") score += 55;
  else if (s === "high") score += 40;
  else if (s === "medium") score += 25;
  else score += 10;

  if (signal_type === "fundraising" || signal_type === "fec") score += 10;
  if (state) score += 5;

  return Math.min(100, Math.max(0, Math.round(score)));
}

export async function ensurePoliticalSignalsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS political_signals (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER,
      workspace_id INTEGER,
      signal_type TEXT NOT NULL DEFAULT 'general',
      source TEXT DEFAULT 'Manual',
      title TEXT NOT NULL,
      summary TEXT,
      state TEXT,
      county TEXT,
      severity TEXT DEFAULT 'medium',
      signal_score INTEGER DEFAULT 0,
      risk TEXT DEFAULT 'Stable',
      url TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      observed_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS signal_type TEXT DEFAULT 'general'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'Manual'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS summary TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS state TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS county TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS signal_score INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS risk TEXT DEFAULT 'Stable'`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS url TEXT`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS observed_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await pool.query(`ALTER TABLE political_signals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_firm_id ON political_signals(firm_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_workspace_id ON political_signals(workspace_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_state ON political_signals(state)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_type ON political_signals(signal_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_observed ON political_signals(observed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_political_signals_dedupe ON political_signals((metadata->>'dedupe_key'))`);
}

async function getDefaultFirmId() {
  const { rows } = await pool.query(
    `
      SELECT id
      FROM firms
      ORDER BY id ASC
      LIMIT 1
    `
  ).catch(() => ({ rows: [] }));

  return rows[0]?.id || 1;
}

function severityFromMoney(amount = 0) {
  const value = Number(amount || 0);

  if (value >= 1000000) return "critical";
  if (value >= 250000) return "high";
  if (value >= 50000) return "medium";
  return "low";
}

function money(value = 0) {
  const amount = Number(value || 0);
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function getCandidateName(row = {}) {
  return (
    row.name ||
    row.candidate_name ||
    row.full_name ||
    row.cand_name ||
    row.committee_name ||
    "FEC candidate"
  );
}

function getState(row = {}) {
  return text(row.state || row.state_code || row.candidate_state || row.office_state).toUpperCase();
}

function getAmount(row = {}) {
  return Number(
    row.receipts ||
      row.total_receipts ||
      row.disbursements ||
      row.total_disbursements ||
      row.cash_on_hand ||
      row.cash_on_hand_end_period ||
      row.amount ||
      0
  );
}

function getCycle(row = {}) {
  return row.cycle || row.election_year || row.two_year_transaction_period || 2026;
}

async function findFecRows(limit = 500) {
  const candidates = [
    `
      SELECT *
      FROM fec_candidates
      ORDER BY COALESCE(receipts, total_receipts, disbursements, total_disbursements, cash_on_hand, cash_on_hand_end_period, 0) DESC NULLS LAST
      LIMIT $1
    `,
    `
      SELECT *
      FROM candidates
      WHERE fec_candidate_id IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT $1
    `,
  ];

  for (const sql of candidates) {
    try {
      const { rows } = await pool.query(sql, [limit]);
      if (rows.length) return rows;
    } catch {
      // Try next known table shape.
    }
  }

  return [];
}

export async function importPoliticalSignalsFromFec({ firmId = null, limit = 500 } = {}) {
  await ensurePoliticalSignalsTable();

  const resolvedFirmId = firmId || await getDefaultFirmId();
  const rows = await findFecRows(limit);

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const candidateName = getCandidateName(row);
    const state = getState(row);
    const amount = getAmount(row);
    const cycle = getCycle(row);
    const severity = severityFromMoney(amount);
    const score = scoreSignal({ severity, signal_type: "fec", state });
    const risk = riskFromScore(score);

    const dedupeKey = [
      "fec",
      row.candidate_id || row.fec_candidate_id || row.id || candidateName,
      state || "national",
      cycle,
      Math.round(amount),
    ].join(":");

    const existing = await pool.query(
      `
        SELECT id
        FROM political_signals
        WHERE metadata->>'dedupe_key' = $1
        LIMIT 1
      `,
      [dedupeKey]
    );

    if (existing.rows[0]) {
      skipped += 1;
      continue;
    }

    const title =
      amount > 0
        ? `FEC fundraising signal: ${candidateName} reports ${money(amount)} activity`
        : `FEC candidate signal: ${candidateName} updated for ${cycle}`;

    const summary =
      amount > 0
        ? `${candidateName} shows ${money(amount)} in reported FEC activity for the ${cycle} cycle${state ? ` in ${state}` : ""}.`
        : `${candidateName} has an FEC-linked record for the ${cycle} cycle${state ? ` in ${state}` : ""}.`;

    await pool.query(
      `
        INSERT INTO political_signals (
          firm_id,
          workspace_id,
          signal_type,
          source,
          title,
          summary,
          state,
          county,
          severity,
          signal_score,
          risk,
          url,
          metadata,
          observed_at,
          created_at,
          updated_at
        )
        VALUES ($1,NULL,$2,$3,$4,$5,$6,NULL,$7,$8,$9,NULL,$10::jsonb,NOW(),NOW(),NOW())
      `,
      [
        resolvedFirmId,
        amount > 0 ? "fundraising" : "fec",
        "FEC",
        title,
        summary,
        state || null,
        severity,
        score,
        risk,
        JSON.stringify({
          dedupe_key: dedupeKey,
          source_table: row.receipts !== undefined || row.total_receipts !== undefined ? "fec_candidates" : "candidates",
          candidate_id: row.candidate_id || row.fec_candidate_id || row.id || null,
          candidate_name: candidateName,
          cycle,
          amount,
          raw: row,
        }),
      ]
    );

    inserted += 1;
  }

  return {
    ok: true,
    source: "FEC",
    scanned: rows.length,
    inserted,
    skipped,
    firm_id: resolvedFirmId,
    updated_at: new Date().toISOString(),
  };
}
