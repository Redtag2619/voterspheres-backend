import "dotenv/config";
import { pool } from "../db/pool.js";
import { auditElectionCycleIsolation } from "../services/electionCycleIsolation.service.js";

try {
  const report = await auditElectionCycleIsolation();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const unsafe = report.entities.some(
    (item) => item.available && (item.invalid_cycle > 0 || item.unregistered_cycle > 0)
  );
  process.exitCode = unsafe ? 2 : 0;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

