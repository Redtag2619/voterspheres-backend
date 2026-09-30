import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { pool } from "../db/pool.js";
import {
  classifyIncomingPollingGroup,
  loadSelectablePollingCycles,
} from "../services/pollingIngestionCycleGuard.service.js";

export const CLOSEOUT_VERSION = "2.7.0";

const clean = (value = "") => String(value ?? "").trim();

export function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    result[key] = rest.length ? rest.join("=") : true;
  }
  return result;
}

export function unresolvedGroupKey(row = {}) {
  const source = clean(row.source || "unknown").toLowerCase();
  const pollId = clean(row.poll_id);
  if (pollId) return `${source}|${pollId}`;
  return JSON.stringify({
    source,
    pollster: row.pollster || null,
    subject: row.subject || null,
    state: row.state || null,
    office: row.office || null,
    field_start: row.field_start || null,
    field_end: row.field_end || null,
  });
}

export function groupUnresolvedRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = unresolvedGroupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([group_key, members]) => ({ group_key, members }));
}

export function buildCloseoutPlan(rows = [], registeredCycles = new Set()) {
  const groups = groupUnresolvedRows(rows);
  const decisions = groups.map(({ group_key, members }) => {
    const classification = classifyIncomingPollingGroup(members, registeredCycles);
    return {
      group_key,
      poll_id: members[0]?.poll_id || null,
      source: members[0]?.source || null,
      poll_type: members[0]?.poll_type || null,
      answer_rows: members.length,
      record_ids: members.map((row) => String(row.id)).sort(),
      decision: classification.accepted ? "deterministic" : "quarantined",
      proposed_temporal_scope: classification.accepted
        ? classification.temporal_scope
        : "unresolved",
      proposed_cycle: classification.accepted ? classification.cycle : null,
      issue_code: classification.issue_code || null,
      evidence: classification.evidence || [],
    };
  });

  const deterministic = decisions.filter((item) => item.decision === "deterministic");
  const quarantined = decisions.filter((item) => item.decision === "quarantined");
  const mapping = deterministic.flatMap((group) => group.record_ids.map((id) => ({
    polling_result_id: id,
    temporal_scope: group.proposed_temporal_scope,
    cycle: group.proposed_cycle,
    group_key: group.group_key,
    evidence: group.evidence,
  })));

  const byScope = {};
  for (const item of mapping) {
    byScope[item.temporal_scope] = (byScope[item.temporal_scope] || 0) + 1;
  }
  const byIssue = {};
  for (const item of quarantined) {
    const key = item.issue_code || "unresolved";
    byIssue[key] = (byIssue[key] || 0) + item.answer_rows;
  }

  return {
    decisions,
    mapping,
    summary: {
      unresolved_records: rows.length,
      unresolved_groups: groups.length,
      deterministic_records: mapping.length,
      deterministic_groups: deterministic.length,
      quarantined_records: quarantined.reduce((sum, item) => sum + item.answer_rows, 0),
      quarantined_groups: quarantined.length,
      deterministic_by_scope: byScope,
      quarantined_by_issue: byIssue,
    },
  };
}

export function stableMappingHash(mapping = []) {
  const canonical = [...mapping]
    .map((item) => ({
      polling_result_id: String(item.polling_result_id),
      temporal_scope: item.temporal_scope,
      cycle: item.cycle === null ? null : Number(item.cycle),
      group_key: item.group_key,
    }))
    .sort((a, b) => a.polling_result_id.localeCompare(b.polling_result_id));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function loadUnresolvedRows(client = pool) {
  const result = await client.query(`
    SELECT
      id, poll_id, source, source_dataset, poll_type, pollster, subject,
      state, district, office, race_name, candidate_name, candidate_id,
      field_start, field_end, published_at, election_date, cycle,
      temporal_scope, source_payload, ingested_at
    FROM polling_results
    WHERE temporal_scope = 'unresolved'
    ORDER BY source, poll_id, id
  `);
  return result.rows;
}

export async function runCloseoutAudit({ client = pool } = {}) {
  const registeredCycles = await loadSelectablePollingCycles(client);
  const rows = await loadUnresolvedRows(client);
  const plan = buildCloseoutPlan(rows, registeredCycles);
  const mappingSha256 = stableMappingHash(plan.mapping);
  return {
    closeout_version: CLOSEOUT_VERSION,
    generated_at: new Date().toISOString(),
    mode: "diagnostic_only",
    policy: "Only complete poll groups accepted by the current deterministic ingestion guard enter the mapping. No database records are changed.",
    closeout_status:
      plan.summary.unresolved_records === 0
        ? "complete"
        : plan.summary.deterministic_records > 0
          ? "deterministic_correction_available"
          : "ambiguous_records_remain_quarantined",
    mapping_sha256: mappingSha256,
    ...plan,
  };
}

async function main() {
  const args = parseArgs();
  const outputDirectory = path.resolve(String(args.output || "./diagnostics/phase-2-7"));
  const report = await runCloseoutAudit();
  fs.mkdirSync(outputDirectory, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-");
  const reportPath = path.join(outputDirectory, `polling-quarantine-closeout-${stamp}.json`);
  const mappingPath = path.join(outputDirectory, `polling-quarantine-deterministic-mapping-${stamp}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mappingPath, `${JSON.stringify(report.mapping, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    closeout_version: report.closeout_version,
    generated_at: report.generated_at,
    closeout_status: report.closeout_status,
    ...report.summary,
    mapping_sha256: report.mapping_sha256,
    report_path: reportPath,
    mapping_path: mappingPath,
    policy: "Diagnostic only; polling_results was not modified.",
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main()
    .catch((error) => {
      console.error(error?.stack || error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

