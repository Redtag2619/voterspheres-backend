import "dotenv/config";

import { pool } from "../db/pool.js";

import { rollbackPollingCycleRemediation } from "../services/pollingCycleRemediation.service.js";

 

function argument(name, fallback = null) {

  const prefix = `--${name}=`;

  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;

}

 

const batchId = argument("batch-id");

const apply = process.argv.includes("--apply");

const confirmation = argument("confirm");

 

if (!batchId) throw new Error("Use --batch-id=<applied batch id>.");

 

try {

  if (!apply) {

    console.log(JSON.stringify({

      mode: "preview",

      batch_id: batchId,

      required_confirmation: `ROLLBACK-${batchId}`,

      policy: "No database records were changed.",

    }, null, 2));

    console.log("Preview only. Rollback requires --apply and the exact confirmation token.");

  } else {

    if (confirmation !== `ROLLBACK-${batchId}`) {

      throw new Error(`Rollback requires --confirm=ROLLBACK-${batchId}.`);

    }

    const result = await rollbackPollingCycleRemediation({

      batchId,

      rolledBackBy: argument("operator", process.env.USERNAME || process.env.USER || "cli-operator"),

      note: argument("note", "Phase 2.2 operator rollback"),

    });

    console.log(JSON.stringify(result, null, 2));

  }

} catch (error) {

  console.error("Polling-cycle rollback failed.");

  console.error(error);

  process.exitCode = 1;

} finally {

  await pool.end();

}
