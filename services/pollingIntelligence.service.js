import { pool } from "../db/pool.js";
import {
  ensureUnifiedPollingSchema,
  ingestPollingSignals,
} from "./pollingIngestion.service.js";

const clean = (value = "") => String(value ?? "").trim();
const upperState = (value = "") => {
  const next = clean(value).toUpperCase();
  if (!next || next === "NATIONAL") return "US";
  return next === "US" ? "US" : next.slice(0, 2);
};

export async function runPollingIntelligenceIngestion(options = {}) {
  return ingestPollingSignals(options);
}

export async function listPollingIntelligence({
  state = "",
  office = "",
  candidate = "",
  pollType = "",
  recordType = "",
  measuredOnly = false,
  limit = 100,
} = {}) {
  await ensureUnifiedPollingSchema();

  const params = [];
  const conditions = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (clean(state) && upperState(state) !== "US") {
    conditions.push(`UPPER(COALESCE(state, '')) = ${push(upperState(state))}`);
  }
  if (clean(office)) conditions.push(`office ILIKE ${push(`%${clean(office)}%`)}`);
  if (clean(candidate)) conditions.push(`candidate_name ILIKE ${push(`%${clean(candidate)}%`)}`);
  if (clean(pollType)) conditions.push(`poll_type = ${push(clean(pollType))}`);
  if (clean(recordType)) conditions.push(`record_type = ${push(clean(recordType))}`);
  if (measuredOnly) conditions.push(`COALESCE(is_estimate, FALSE) = FALSE`);

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT *
      FROM polling_results
      ${whereSql}
      ORDER BY COALESCE(field_end, published_at::date, updated_at::date) DESC NULLS LAST,
               pollster ASC,
               answer ASC
      LIMIT ${Math.max(1, Math.min(Number(limit) || 100, 1000))}
    `,
    params
  );

  return {
    ok: true,
    count: result.rows.length,
    results: result.rows,
    generated_at: new Date().toISOString(),
  };
}

export async function getPollingIntelligenceHealth() {
  await ensureUnifiedPollingSchema();

  const [summary, latestRun] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::integer AS answer_rows,
        COUNT(DISTINCT poll_id)::integer AS poll_count,
        COUNT(DISTINCT pollster)::integer AS pollster_count,
        COUNT(*) FILTER (WHERE COALESCE(is_estimate, FALSE) = FALSE)::integer AS measured_rows,
        COUNT(*) FILTER (WHERE COALESCE(is_estimate, FALSE) = TRUE)::integer AS estimate_rows,
        MAX(COALESCE(field_end, published_at::date, updated_at::date)) AS freshest_record
      FROM polling_results
    `),
    pool.query(`
      SELECT *
      FROM polling_ingestion_runs
      ORDER BY started_at DESC
      LIMIT 1
    `),
  ]);

  const row = summary.rows[0] || {};

  return {
    ok: Number(row.answer_rows || 0) > 0,
    build: "5.7.0",
    service: "unified-polling-intelligence",
    provider: "VoteHub",
    canonical_table: "polling_results",
    paid_api_required: false,
    answer_rows: Number(row.answer_rows || 0),
    poll_count: Number(row.poll_count || 0),
    pollster_count: Number(row.pollster_count || 0),
    measured_rows: Number(row.measured_rows || 0),
    estimate_rows: Number(row.estimate_rows || 0),
    freshest_record: row.freshest_record || null,
    latest_run: latestRun.rows[0] || null,
    generated_at: new Date().toISOString(),
  };
}

export default {
  runPollingIntelligenceIngestion,
  listPollingIntelligence,
  getPollingIntelligenceHealth,
};
