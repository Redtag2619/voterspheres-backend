import dotenv from "dotenv";
import { pool } from "../db/pool.js";
import { fetchLiveFundraisingSnapshot } from "../providers/fec.provider.js";

dotenv.config();

const DEFAULT_CYCLE = Number(process.env.FEC_CYCLE || 2026);
const DEFAULT_LIMIT = Number(process.env.FEC_INGEST_LIMIT || 25);
const DEFAULT_INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS || 300000);

async function ensureFundraisingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fundraising_snapshots (
      id SERIAL PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      candidate_name TEXT,
      state TEXT,
      office TEXT,
      party TEXT,
      cycle INT,
      receipts NUMERIC DEFAULT 0,
      disbursements NUMERIC DEFAULT 0,
      cash_on_hand NUMERIC DEFAULT 0,
      debt NUMERIC DEFAULT 0,
      coverage_start_date DATE,
      coverage_end_date DATE,
      fetched_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function runFundraisingIngestion({
  cycle = DEFAULT_CYCLE,
  limit = DEFAULT_LIMIT,
  office = "",
  state = "",
  q = ""
} = {}) {
  await ensureFundraisingTable();

  const rows = await fetchLiveFundraisingSnapshot({
    cycle,
    limit,
    office,
    state,
    q
  });

  const inserted = [];

  for (const row of rows) {
    const result = await pool.query(
      `
      INSERT INTO fundraising_snapshots (
        candidate_id,
        candidate_name,
        state,
        office,
        party,
        cycle,
        receipts,
        disbursements,
        cash_on_hand,
        debt,
        coverage_start_date,
        coverage_end_date
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      )
      RETURNING *
      `,
      [
        row.candidate_id,
        row.name || null,
        row.state || null,
        row.office || null,
        row.party || null,
        cycle,
        Number(row?.totals?.receipts || 0),
        Number(row?.totals?.disbursements || 0),
        Number(row?.totals?.cash_on_hand_end_period || 0),
        Number(row?.totals?.debts_owed_by_committee || 0),
        row?.totals?.coverage_start_date || null,
        row?.totals?.coverage_end_date || null
      ]
    );

    inserted.push(result.rows[0]);
  }

  return {
    ok: true,
    cycle,
    inserted: inserted.length,
    rows: inserted
  };
}

export function startFundraisingIngestionJob() {
  if (process.env.DISABLE_FUNDRAISING_JOB === "true") {
    console.log("⏸ Fundraising ingestion job disabled");
    return null;
  }

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      const result = await runFundraisingIngestion();
      console.log(
        `💰 Fundraising ingestion completed: ${result.inserted} rows for cycle ${result.cycle}`
      );
    } catch (err) {
      console.error("Fundraising ingestion failed:", err.message);
    } finally {
      running = false;
    }
  };

  tick();
  const timer = setInterval(tick, DEFAULT_INTERVAL_MS);
  console.log(`⏱ Fundraising ingestion scheduled every ${DEFAULT_INTERVAL_MS}ms`);

  return timer;
}
