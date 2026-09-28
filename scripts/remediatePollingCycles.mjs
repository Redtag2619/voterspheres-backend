import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../db/pool.js";
import {
  applyPollingCycleRemediation,
  previewPollingCycleRemediation,
} from "../services/pollingCycleRemediation.service.js";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const mappingPath = argument("mapping");
const outputPath = path.resolve(argument("output", "./polling-cycle-remediation-plan.json"));
const apply = process.argv.includes("--apply");

if (!mappingPath) {
  throw new Error("Use --mapping=path/to/polling-cycle-deterministic-mapping.json");
}

const mappingRows = JSON.parse(fs.readFileSync(path.resolve(mappingPath), "utf8"));

try {
  if (!apply) {
    const plan = await previewPollingCycleRemediation({ mappingRows });
    const publicPlan = {
      generated_at: new Date().toISOString(),
      mode: "preview",
      records: plan.records,
      groups: plan.groups,
      cycle_counts: plan.cycle_counts,
      mapping_sha256: plan.mapping_sha256,
      policy: "No database records were changed. Apply requires the exact record count and SHA-256 from this preview.",
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(publicPlan, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ...publicPlan, output_path: outputPath }, null, 2));
    console.log("Preview only. Review the plan before using --apply.");
  } else {
    const confirmCount = argument("confirm-count");
    const confirmSha256 = argument("confirm-sha256");
    if (!confirmCount || !confirmSha256) {
      throw new Error("Apply requires --confirm-count and --confirm-sha256 from a fresh preview.");
    }
    const result = await applyPollingCycleRemediation({
      mappingRows,
      confirmCount,
      confirmSha256,
      appliedBy: argument("operator", process.env.USERNAME || process.env.USER || "cli-operator"),
    });
    console.log(JSON.stringify({
      status: result.status,
      batch_id: result.batch_id,
      records: result.records,
      groups: result.groups,
      cycle_counts: result.cycle_counts,
      mapping_sha256: result.mapping_sha256,
    }, null, 2));
  }
} catch (error) {
  console.error("Polling-cycle remediation failed.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
