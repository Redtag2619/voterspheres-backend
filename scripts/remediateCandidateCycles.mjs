
import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "../db/pool.js";
import { normalizeFederalElectionCycle } from "../utils/electionCycle.js";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

const mappingPath = argument("mapping");
const apply = process.argv.includes("--apply");
if (!mappingPath) throw new Error("Use --mapping=path/to/candidate-cycle-mapping.json");

const absolutePath = path.resolve(mappingPath);
const rows = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
if (!Array.isArray(rows)) throw new Error("Mapping file must contain a JSON array.");

const normalized = rows.map((row, index) => ({
  candidate_id: Number(row.candidate_id),
  cycle: normalizeFederalElectionCycle(row.cycle, { fieldName: `rows[${index}].cycle` }),
  reason: String(row.reason || "Manual evidence review").trim(),
}));

if (normalized.some((row) => !Number.isInteger(row.candidate_id) || row.candidate_id <= 0)) {
  throw new Error("Every candidate_id must be a positive integer.");
}

console.log(JSON.stringify({ mode: apply ? "apply" : "preview", records: normalized }, null, 2));
if (!apply) {
  console.log("Preview only. Re-run with --apply after reviewing every mapping.");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const row of normalized) {
    const registered = await client.query(
      "SELECT 1 FROM election_cycles WHERE cycle_year = $1 AND is_selectable = TRUE",
      [row.cycle]
    );
    if (!registered.rows.length) throw new Error(`Cycle ${row.cycle} is not selectable.`);

    const updated = await client.query(
      `UPDATE candidates
       SET election_year = $1, cycle_resolution_status = 'confirmed', updated_at = NOW()
       WHERE id = $2 AND election_year IS NULL
       RETURNING id`,
      [row.cycle, row.candidate_id]
    );
    if (!updated.rows.length) throw new Error(`Candidate ${row.candidate_id} is missing or already resolved.`);

    await client.query(
      `UPDATE election_cycle_remediation_queue
       SET status = 'resolved', resolved_cycle = $1, resolution_note = $2,
           resolved_at = NOW(), updated_at = NOW()
       WHERE entity_table = 'candidates' AND entity_id = $3::text
         AND issue_code = 'missing_election_cycle' AND status = 'pending'`,
      [row.cycle, row.reason, row.candidate_id]
    );
  }
  await client.query("COMMIT");
  console.log(`Applied ${normalized.length} evidence-backed candidate cycle mappings.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
