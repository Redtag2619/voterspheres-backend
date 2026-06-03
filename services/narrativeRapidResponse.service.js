import { pool } from "../db/pool.js";
import { ensurePoliticalSignalsTable } from "./politicalSignalIngestion.service.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

function clean(value = "") {
  return String(value ?? "").trim();
}

export async function ensureNarrativeRapidResponsesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS narrative_rapid_responses (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NULL,
      political_signal_id INTEGER NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      priority TEXT DEFAULT 'medium',
      owner TEXT NULL,
      state TEXT NULL,
      county TEXT NULL,
      threat_level TEXT DEFAULT 'medium',
      narrative_summary TEXT NULL,
      response_strategy TEXT NULL,
      draft_message TEXT NULL,
      approval_status TEXT DEFAULT 'pending',
      source TEXT DEFAULT 'Narrative Rapid Response',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_by INTEGER NULL,
      reviewed_at TIMESTAMPTZ NULL,
      escalated_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

function threatFromSignal(signal = {}) {
  const risk = String(signal.risk || signal.severity || "").toLowerCase();
  const score = Number(signal.signal_score || 0);

  if (risk === "critical" || score >= 82) return "critical";
  if (risk === "high" || score >= 65) return "high";
  if (risk === "elevated" || score >= 42) return "elevated";
  return "medium";
}

function draftCounterMessage(signal = {}) {
  const title = clean(signal.title || "Political narrative signal");
  const state = signal.state || "national";
  const source = signal.source || "media monitoring";

  return [
    `Rapid Response Draft: ${title}`,
    "",
    `Core frame: Voters in ${state} deserve clear facts, not noise or political spin.`,
    "",
    `Recommended response: Acknowledge the issue directly, reinforce the campaign's core message, and move the conversation back to voter impact.`,
    "",
    `Source context: ${source}.`,
  ].join("\n");
}

export async function getNarrativeRapidResponseDashboard({ user = {} }) {
  await ensurePoliticalSignalsTable();
  await ensureNarrativeRapidResponsesTable();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const responseRows = await pool.query(
    `
      SELECT r.*, ps.title AS signal_title, ps.url AS signal_url, ps.signal_type, ps.risk AS signal_risk
      FROM narrative_rapid_responses r
      LEFT JOIN political_signals ps ON ps.id = r.political_signal_id
      WHERE r.firm_id = $1
      ORDER BY r.updated_at DESC, r.created_at DESC
      LIMIT 200
    `,
    [firmId]
  );

  const signalRows = await pool.query(
    `
      SELECT ps.*
      FROM political_signals ps
      LEFT JOIN narrative_rapid_responses r
        ON r.political_signal_id = ps.id
       AND r.firm_id = ps.firm_id
      WHERE ps.firm_id = $1
        AND ps.signal_type = 'news'
        AND r.id IS NULL
      ORDER BY ps.observed_at DESC NULLS LAST, ps.created_at DESC NULLS LAST
      LIMIT 100
    `,
    [firmId]
  );

  const responses = responseRows.rows || [];
  const signals = signalRows.rows || [];

  return {
    summary: {
      responses: responses.length,
      open: responses.filter((r) => ["draft", "open", "in_progress"].includes(String(r.status).toLowerCase())).length,
      reviewed: responses.filter((r) => String(r.status).toLowerCase() === "reviewed").length,
      escalated: responses.filter((r) => String(r.status).toLowerCase() === "escalated").length,
      pending_signals: signals.length,
      critical: responses.filter((r) => String(r.threat_level).toLowerCase() === "critical").length,
      high: responses.filter((r) => String(r.threat_level).toLowerCase() === "high").length,
    },
    responses,
    signals,
    updated_at: new Date().toISOString(),
  };
}

export async function createNarrativeRapidResponse({ user = {}, payload = {} }) {
  await ensurePoliticalSignalsTable();
  await ensureNarrativeRapidResponsesTable();

  const firmId = getFirmId(user);
  const userId = getUserId(user);

  if (!firmId) throw new Error("Missing firm context.");

  let signal = null;

  if (payload.political_signal_id) {
    const signalRes = await pool.query(
      `SELECT * FROM political_signals WHERE id = $1 AND firm_id = $2 LIMIT 1`,
      [payload.political_signal_id, firmId]
    );
    signal = signalRes.rows[0] || null;
  }

  const title =
    clean(payload.title) ||
    clean(signal?.title) ||
    "Narrative rapid response";

  const narrativeSummary =
    clean(payload.narrative_summary) ||
    clean(signal?.summary) ||
    "Narrative pressure detected and queued for review.";

  const threatLevel =
    clean(payload.threat_level) ||
    threatFromSignal(signal || payload);

  const draftMessage =
    clean(payload.draft_message) ||
    draftCounterMessage(signal || payload);

  const result = await pool.query(
    `
      INSERT INTO narrative_rapid_responses (
        firm_id, workspace_id, political_signal_id, title, status, priority,
        owner, state, county, threat_level, narrative_summary,
        response_strategy, draft_message, approval_status, source, metadata,
        created_by, created_at, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,NOW(),NOW()
      )
      RETURNING *
    `,
    [
      firmId,
      payload.workspace_id || signal?.workspace_id || null,
      payload.political_signal_id || null,
      title,
      payload.status || "draft",
      payload.priority || threatLevel,
      payload.owner || null,
      payload.state || signal?.state || null,
      payload.county || signal?.county || null,
      threatLevel,
      narrativeSummary,
      payload.response_strategy || "Review source, validate facts, assign owner, and prepare approved response.",
      draftMessage,
      payload.approval_status || "pending",
      payload.source || "Narrative Rapid Response",
      JSON.stringify({
        created_from: "narrative_rapid_response_workflow",
        signal_url: signal?.url || null,
        signal_source: signal?.source || null,
      }),
      userId,
    ]
  );

  return result.rows[0];
}

export async function updateNarrativeRapidResponse({ user = {}, id, payload = {} }) {
  await ensureNarrativeRapidResponsesTable();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const fields = [];
  const values = [];
  let i = 1;

  const allowed = [
    "title",
    "status",
    "priority",
    "owner",
    "threat_level",
    "narrative_summary",
    "response_strategy",
    "draft_message",
    "approval_status",
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      fields.push(`${key} = $${i}`);
      values.push(payload[key]);
      i += 1;
    }
  }

  if (payload.status === "reviewed") {
    fields.push(`reviewed_at = NOW()`);
  }

  if (payload.status === "escalated") {
    fields.push(`escalated_at = NOW()`);
  }

  fields.push(`updated_at = NOW()`);

  values.push(id, firmId);

  const result = await pool.query(
    `
      UPDATE narrative_rapid_responses
      SET ${fields.join(", ")}
      WHERE id = $${i} AND firm_id = $${i + 1}
      RETURNING *
    `,
    values
  );

  if (!result.rows[0]) throw new Error("Rapid response not found.");
  return result.rows[0];
}
