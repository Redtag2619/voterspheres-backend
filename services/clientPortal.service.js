import crypto from "crypto";
import { pool } from "../db/pool.js";
import { getExecutiveMissionControl } from "./executiveMissionControl.service.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

function clean(value = "") {
  return String(value || "")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<font\b[^>]*>(.*?)<\/font>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[client-portal] skipped query:", error.message);
    return [];
  }
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

export async function ensureClientPortalTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_portal_clients (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NULL,
      client_name TEXT NOT NULL,
      organization TEXT NULL,
      email TEXT NULL,
      access_level TEXT DEFAULT 'standard',
      portal_token TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active',
      allowed_sections JSONB DEFAULT '["reports","summary","signals","workspace"]'::jsonb,
      last_viewed_at TIMESTAMPTZ NULL,
      created_by INTEGER NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_client_portal_clients_firm
    ON client_portal_clients (firm_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_client_portal_clients_token
    ON client_portal_clients (portal_token);
  `);
}

export async function createClientPortalAccess({ user = {}, payload = {} }) {
  await ensureClientPortalTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const clientName = clean(payload.client_name || payload.name);
  if (!clientName) throw new Error("Client name is required.");

  const token = generateToken();

  const result = await pool.query(
    `
      INSERT INTO client_portal_clients (
        firm_id, workspace_id, client_name, organization, email,
        access_level, portal_token, status, allowed_sections,
        created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8::jsonb,$9,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      payload.workspace_id || null,
      clientName,
      payload.organization || null,
      payload.email || null,
      payload.access_level || "standard",
      token,
      JSON.stringify(
        Array.isArray(payload.allowed_sections)
          ? payload.allowed_sections
          : ["reports", "summary", "signals", "workspace"]
      ),
      userId,
    ]
  );

  return result.rows[0];
}

export async function listClientPortalAccess({ user = {} }) {
  await ensureClientPortalTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      SELECT id, firm_id, workspace_id, client_name, organization, email,
             access_level, portal_token, status, allowed_sections,
             last_viewed_at, created_at, updated_at
      FROM client_portal_clients
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `,
    [firmId]
  );

  return result.rows;
}

export async function updateClientPortalAccess({ user = {}, id, payload = {} }) {
  await ensureClientPortalTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const result = await pool.query(
    `
      UPDATE client_portal_clients
      SET
        client_name = COALESCE($3, client_name),
        organization = COALESCE($4, organization),
        email = COALESCE($5, email),
        access_level = COALESCE($6, access_level),
        status = COALESCE($7, status),
        allowed_sections = COALESCE($8::jsonb, allowed_sections),
        updated_at = NOW()
      WHERE id = $1 AND firm_id = $2
      RETURNING *
    `,
    [
      id,
      firmId,
      payload.client_name || null,
      payload.organization || null,
      payload.email || null,
      payload.access_level || null,
      payload.status || null,
      payload.allowed_sections ? JSON.stringify(payload.allowed_sections) : null,
    ]
  );

  if (!result.rows[0]) throw new Error("Client portal access not found.");
  return result.rows[0];
}

export async function revokeClientPortalAccess({ user = {}, id }) {
  return updateClientPortalAccess({
    user,
    id,
    payload: { status: "revoked" },
  });
}

export async function getClientPortalDashboardByToken({ token }) {
  await ensureClientPortalTables();

  if (!token) throw new Error("Missing portal token.");

  const accessResult = await pool.query(
    `
      SELECT *
      FROM client_portal_clients
      WHERE portal_token = $1
      LIMIT 1
    `,
    [token]
  );

  const access = accessResult.rows[0];

  if (!access) throw new Error("Client portal not found.");
  if (access.status !== "active") throw new Error("Client portal access is not active.");

  await pool.query(
    `
      UPDATE client_portal_clients
      SET last_viewed_at = NOW()
      WHERE id = $1
    `,
    [access.id]
  );

  const firmUser = {
    firm_id: access.firm_id,
    firmId: access.firm_id,
  };

  const mission = await getExecutiveMissionControl({ user: firmUser });

  const reports = await safeQuery(
    `
      SELECT id, title, report_type, state, status, executive_summary,
             report_body, created_at, updated_at
      FROM intelligence_reports
      WHERE firm_id = $1
        AND ($2::integer IS NULL OR workspace_id = $2 OR workspace_id IS NULL)
      ORDER BY created_at DESC
      LIMIT 12
    `,
    [access.firm_id, access.workspace_id || null]
  );

  const workspace = access.workspace_id
    ? (
        await safeQuery(
          `
            SELECT id, name, campaign_name, title, state, office, cycle, status, created_at, updated_at
            FROM workspaces
            WHERE id = $1 AND firm_id = $2
            LIMIT 1
          `,
          [access.workspace_id, access.firm_id]
        )
      )[0] || null
    : null;

  const allowedSections = Array.isArray(access.allowed_sections)
    ? access.allowed_sections
    : ["reports", "summary", "signals", "workspace"];

  const signals = (mission.critical_signals || []).slice(0, 10).map((signal) => ({
    id: signal.id,
    title: clean(signal.title || "Political signal"),
    summary: clean(signal.summary || signal.source || "Signal"),
    state: signal.state || "National",
    risk: signal.risk || signal.severity || "Stable",
    score: signal.signal_score || 0,
    observed_at: signal.observed_at || signal.created_at,
  }));

  const workspaceHealth = (mission.workspace_health || []).filter((item) => {
    if (!access.workspace_id) return true;
    return String(item.id) === String(access.workspace_id);
  });

  return {
    client: {
      id: access.id,
      client_name: access.client_name,
      organization: access.organization,
      access_level: access.access_level,
      allowed_sections: allowedSections,
    },
    workspace,
    summary: {
      mission_risk: mission.summary?.mission_risk || "Stable",
      pressure_score: mission.summary?.pressure_score || 0,
      signals: signals.length,
      reports: reports.length,
      workspaces: workspaceHealth.length,
      updated_at: new Date().toISOString(),
    },
    reports: allowedSections.includes("reports") ? reports : [],
    signals: allowedSections.includes("signals") ? signals : [],
    workspace_health: allowedSections.includes("workspace") ? workspaceHealth : [],
    public_summary: allowedSections.includes("summary")
      ? {
          headline: `${access.client_name} campaign intelligence portal`,
          assessment:
            mission.summary?.mission_risk === "Stable"
              ? "Current campaign operating environment is stable. Continue monitoring reports and signals."
              : `Current operating environment is ${mission.summary?.mission_risk}. Review the latest reports and signal watch.`,
          next_step:
            reports[0]?.title
              ? `Review latest report: ${reports[0].title}`
              : "Generate a new intelligence report for this client.",
        }
      : null,
  };
}
