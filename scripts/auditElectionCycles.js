import "dotenv/config";
import { pool } from "../db/pool.js";

async function tableExists(name) {
  const result = await pool.query(`SELECT to_regclass($1) AS name`, [`public.${name}`]);
  return Boolean(result.rows[0]?.name);
}

async function main() {
  const report = { generated_at: new Date().toISOString(), workspaces: {}, candidates: {}, fundraising: {} };

  if (await tableExists("workspaces")) {
    const rows = await pool.query(`
      SELECT COALESCE(NULLIF(TRIM(cycle), ''), '[blank]') AS cycle, COUNT(*)::int AS records
      FROM workspaces
      GROUP BY 1
      ORDER BY 1
    `);
    report.workspaces.by_cycle = rows.rows;
    report.workspaces.invalid = rows.rows.filter((row) => !/^\d{4}$/.test(row.cycle) || Number(row.cycle) < 2026 || Number(row.cycle) % 2 !== 0);
  }

  if (await tableExists("candidates")) {
    const rows = await pool.query(`
      SELECT COALESCE(election_year::text, '[null]') AS cycle, COUNT(*)::int AS records
      FROM candidates
      GROUP BY 1
      ORDER BY 1
    `);
    report.candidates.by_cycle = rows.rows;
  }

  if (await tableExists("fundraising_live")) {
    const rows = await pool.query(`
      SELECT COALESCE(election_year::text, '[null]') AS cycle, COUNT(*)::int AS records,
             COALESCE(SUM(receipts), 0)::numeric AS receipts
      FROM fundraising_live
      GROUP BY 1
      ORDER BY 1
    `);
    report.fundraising.by_cycle = rows.rows;
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.workspaces.invalid?.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error("Election-cycle audit failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
