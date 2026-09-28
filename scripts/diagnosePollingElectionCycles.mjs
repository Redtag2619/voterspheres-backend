import "dotenv/config";

import fs from "node:fs";

import path from "node:path";

import { pool } from "../db/pool.js";

import { diagnosePollingElectionCycles } from "../services/pollingCycleDiagnostic.service.js";

 

function argument(name, fallback = null) {

  const prefix = `--${name}=`;

  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;

}

 

const outputDirectory = path.resolve(argument("output", process.cwd()));

fs.mkdirSync(outputDirectory, { recursive: true });

 

try {

  const report = await diagnosePollingElectionCycles();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const reportPath = path.join(outputDirectory, `polling-cycle-diagnostic-${stamp}.json`);

  const mappingPath = path.join(outputDirectory, `polling-cycle-deterministic-mapping-${stamp}.json`);

 

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  fs.writeFileSync(

    mappingPath,

    `${JSON.stringify(

      report.deterministic.map((item) => ({

        polling_result_id: item.polling_result_id,

        cycle: item.inferred_cycle,

        reason: item.reason,

        evidence: item.authoritative_evidence,

      })),

      null,

      2

    )}\n`,

    "utf8"

  );

 

  console.log(JSON.stringify({ ...report.summary, report_path: reportPath, mapping_path: mappingPath }, null, 2));

  console.log("Phase 2.1.1 diagnostic only: polling_results was not modified.");

} catch (error) {

  console.error(error);

  process.exitCode = 1;

} finally {

  await pool.end();

}
