import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import {
  fetchVoteHubPolls,
  normalizeVoteHubPoll,
} from "./pollingIngestion.service.js";
import {
  classifyIncomingPollingGroup,
  loadSelectablePollingCycles,
} from "./pollingIngestionCycleGuard.service.js";

const sha256 = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

export function normalizeCanaryLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 5;
  return Math.min(parsed, 10);
}

export function buildPollingIngestionCanaryReport({
  polls = [],
  registeredCycles = new Set(),
  context = {},
  before = null,
  after = null,
} = {}) {
  const groups = polls.map((item, index) => {
    const rows = normalizeVoteHubPoll(item, context);
    const classification = classifyIncomingPollingGroup(rows, registeredCycles);
    const first = rows[0] || {};

    return {
      sample_index: index + 1,
      poll_id: first.poll_id || null,
      source: first.source || "VoteHub",
      subject: first.subject || null,
      state: first.state || null,
      office: first.office || null,
      field_end: first.field_end || null,
      answer_rows: rows.length,
      decision: classification.accepted ? "would_accept" : "would_quarantine",
      cycle: classification.cycle,
      issue_code: classification.issue_code,
      evidence: classification.evidence,
    };
  });

  const accepted = groups.filter((group) => group.decision === "would_accept");
  const quarantined = groups.filter((group) => group.decision === "would_quarantine");
  const cycleCounts = {};
  for (const group of accepted) {
    const key = String(group.cycle);
    cycleCounts[key] = (cycleCounts[key] || 0) + group.answer_rows;
  }

  const stablePlan = groups.map((group) => ({
    poll_id: group.poll_id,
    answer_rows: group.answer_rows,
    decision: group.decision,
    cycle: group.cycle,
    issue_code: group.issue_code,
  }));

  return {
    canary_version: "2.4.0",
    generated_at: new Date().toISOString(),
    mode: "read_only",
    fetched_poll_groups: polls.length,
    normalized_answer_rows: groups.reduce((sum, group) => sum + group.answer_rows, 0),
    would_accept_groups: accepted.length,
    would_accept_answers: accepted.reduce((sum, group) => sum + group.answer_rows, 0),
    would_quarantine_groups: quarantined.length,
    would_quarantine_answers: quarantined.reduce((sum, group) => sum + group.answer_rows, 0),
    accepted_cycle_counts: cycleCounts,
    database_unchanged: before && after
      ? JSON.stringify(before) === JSON.stringify(after)
      : null,
    database_before: before,
    database_after: after,
    plan_sha256: sha256(JSON.stringify(stablePlan)),
    groups,
    policy: "Read-only canary. No polling_results, quarantine, or ingestion-run records were changed.",
  };
}

export async function pollingCanarySnapshot(client = pool) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM polling_results) AS polling_results,
      (SELECT COUNT(*)::integer FROM polling_results WHERE cycle IS NULL) AS unresolved_results,
      (SELECT COUNT(*)::integer FROM polling_ingestion_quarantine) AS quarantined_groups,
      (SELECT COUNT(*)::integer FROM polling_ingestion_runs) AS ingestion_runs
  `);
  return result.rows[0];
}

export async function runPollingIngestionCanary({
  limit = 5,
  pollType = "",
  subject = "",
  pollster = "",
  fromDate = "",
  state = "",
  office = "",
  client = pool,
  fetchPolls = fetchVoteHubPolls,
} = {}) {
  const safeLimit = normalizeCanaryLimit(limit);
  const before = await pollingCanarySnapshot(client);
  const registeredCycles = await loadSelectablePollingCycles(client);
  const polls = await fetchPolls({
    pollType,
    subject,
    pollster,
    fromDate,
    limit: safeLimit,
  });
  const after = await pollingCanarySnapshot(client);

  return buildPollingIngestionCanaryReport({
    polls: polls.slice(0, safeLimit),
    registeredCycles,
    context: { pollType, subject, state, office },
    before,
    after,
  });
}
