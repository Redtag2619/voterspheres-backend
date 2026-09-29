import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../db/pool.js";
import { runPollingIngestionCanary } from "../services/pollingIngestionCanary.service.js";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

try {
  const report = await runPollingIngestionCanary({
    limit: Number(arg("limit", "5")),
    pollType: arg("poll-type"),
    subject: arg("subject"),
    pollster: arg("pollster"),
    fromDate: arg("from-date"),
    state: arg("state"),
    office: arg("office"),
  });

  const outputRoot = path.resolve(arg("output", "./diagnostics/polling-ingestion-canary"));
  fs.mkdirSync(outputRoot, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-");
  const outputPath = path.join(outputRoot, `polling-ingestion-canary-${stamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({
    canary_version: report.canary_version,
    generated_at: report.generated_at,
    mode: report.mode,
    fetched_poll_groups: report.fetched_poll_groups,
    normalized_answer_rows: report.normalized_answer_rows,
    would_accept_groups: report.would_accept_groups,
    would_accept_answers: report.would_accept_answers,
    would_quarantine_groups: report.would_quarantine_groups,
    would_quarantine_answers: report.would_quarantine_answers,
    accepted_cycle_counts: report.accepted_cycle_counts,
    database_unchanged: report.database_unchanged,
    plan_sha256: report.plan_sha256,
    output_path: outputPath,
  }, null, 2));
  console.log("Phase 2.4 read-only canary: no database records were changed.");

  if (report.database_unchanged !== true) process.exitCode = 2;
} catch (error) {
  console.error("Polling ingestion canary failed.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
