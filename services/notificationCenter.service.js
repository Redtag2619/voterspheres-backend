import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

function getUserId(user = {}) {
  return user.id || user.user_id || user.sub || null;
}

function clean(value = "") {
  return String(value || "")
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
    console.warn("[notification-center] skipped query:", error.message);
    return [];
  }
}

function levelFromRisk(value = "") {
  const risk = String(value || "").toLowerCase();
  if (["critical", "high", "danger", "overdue", "at risk", "at_risk"].some((x) => risk.includes(x))) return "critical";
  if (["elevated", "medium", "watch", "open", "pending"].some((x) => risk.includes(x))) return "warning";
  return "info";
}

function sourcePath(source = "") {
  const s = String(source || "").toLowerCase();

  if (s.includes("signal")) return "/political-intelligence";
  if (s.includes("war")) return "/war-room";
  if (s.includes("mission")) return "/mission-control";
  if (s.includes("task")) return "/command-center";
  if (s.includes("crm")) return "/campaign-crm";
  if (s.includes("client")) return "/client-portal-admin";
  if (s.includes("report")) return "/intelligence-reports";
  if (s.includes("export")) return "/report-exports";
  if (s.includes("revenue")) return "/revenue-intelligence";
  if (s.includes("vendor")) return "/vendors";
  if (s.includes("graph")) return "/political-intelligence";

  return "/national-command";
}

function notification({
  id,
  source,
  category,
  title,
  body,
  level = "info",
  state = "National",
  status = "unread",
  source_id = null,
  source_path = null,
  created_at = null,
  metadata = {},
}) {
  return {
    id: String(id),
    source,
    category,
    title: clean(title || "Notification"),
    body: clean(body || ""),
    level,
    state: state || "National",
    status,
    source_id,
    source_path: source_path || sourcePath(source),
    created_at: created_at || new Date().toISOString(),
    metadata,
  };
}

export async function ensureNotificationCenterTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_events (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      user_id INTEGER NULL,
      source TEXT NOT NULL,
      source_id TEXT NULL,
      category TEXT DEFAULT 'general',
      level TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT NULL,
      state TEXT NULL,
      status TEXT DEFAULT 'unread',
      source_path TEXT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      read_at TIMESTAMPTZ NULL,
      archived_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notification_events_firm
    ON notification_events (firm_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notification_events_status
    ON notification_events (firm_id, status, created_at DESC);
  `);
}

export async function createNotificationEvent({ user = {}, payload = {} }) {
  await ensureNotificationCenterTables();

  const firmId = getFirmId(user);
  const userId = getUserId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const title = clean(payload.title);
  if (!title) throw new Error("Notification title is required.");

  const result = await pool.query(
    `
      INSERT INTO notification_events (
        firm_id, user_id, source, source_id, category, level,
        title, body, state, status, source_path, metadata,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'unread',$10,$11::jsonb,NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      userId,
      payload.source || "Manual",
      payload.source_id || null,
      payload.category || "general",
      payload.level || "info",
      title,
      payload.body || null,
      payload.state || null,
      payload.source_path || sourcePath(payload.source),
      JSON.stringify(payload.metadata || {}),
    ]
  );

  return result.rows[0];
}

async function getManualNotifications(firmId) {
  return safeQuery(
    `
      SELECT *
      FROM notification_events
      WHERE firm_id = $1
        AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
    `,
    [firmId]
  );
}

export async function getNotificationCenter({ user = {}, filters = {} }) {
  await ensureNotificationCenterTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const manual = await getManualNotifications(firmId);

  const signals = await safeQuery(
    `
      SELECT id, title, summary, state, risk, severity, signal_score, created_at
      FROM political_signals
      WHERE firm_id = $1
      ORDER BY created_at DESC NULLS LAST
      LIMIT 40
    `,
    [firmId]
  );

  const tasks = await safeQuery(
    `
      SELECT id, title, description, status, priority, state, source, created_at, updated_at
      FROM tasks
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 40
    `,
    [firmId]
  );

  const reports = await safeQuery(
    `
      SELECT id, title, report_type, state, status, executive_summary, created_at
      FROM intelligence_reports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 25
    `,
    [firmId]
  );

  const exports = await safeQuery(
    `
      SELECT id, title, export_type, status, created_at
      FROM report_exports
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 25
    `,
    [firmId]
  );

  const clientPortals = await safeQuery(
    `
      SELECT id, client_name, organization, email, status, last_viewed_at, created_at
      FROM client_portal_clients
      WHERE firm_id = $1
      ORDER BY COALESCE(last_viewed_at, created_at) DESC
      LIMIT 30
    `,
    [firmId]
  );

  const invoices = await safeQuery(
    `
      SELECT i.id, i.title, i.amount, i.status, i.due_date, i.created_at, c.client_name
      FROM consultant_invoices i
      LEFT JOIN consultant_clients c ON c.id = i.client_id
      WHERE i.firm_id = $1
      ORDER BY i.created_at DESC
      LIMIT 30
    `,
    [firmId]
  );

  const vendors = await safeQuery(
    `
      SELECT id, name, vendor_name, category, state, status, risk, coverage_tier, updated_at, created_at
      FROM vendors
      WHERE firm_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 30
    `,
    [firmId]
  );

  const crm = await safeQuery(
    `
      SELECT id, title, type, status, priority, due_date, created_at
      FROM campaign_crm_activities
      WHERE firm_id = $1
      ORDER BY created_at DESC
      LIMIT 30
    `,
    [firmId]
  );

  const generated = [
    ...signals.map((s) =>
      notification({
        id: `signal-${s.id}`,
        source: "Political Signals",
        category: "signal",
        title: s.title || "Political signal detected",
        body: s.summary || `Signal score ${s.signal_score || 0}`,
        level: levelFromRisk(s.risk || s.severity || s.signal_score),
        state: s.state || "National",
        source_id: s.id,
        source_path: "/political-intelligence",
        created_at: s.created_at,
        metadata: { signal_score: s.signal_score, risk: s.risk || s.severity },
      })
    ),

    ...tasks
      .filter((t) => !["complete", "completed", "done", "resolved"].includes(String(t.status || "").toLowerCase()))
      .map((t) =>
        notification({
          id: `task-${t.id}`,
          source: "Mission Tasks",
          category: "task",
          title: t.title || "Open task",
          body: t.description || `Status: ${t.status || "open"}`,
          level: levelFromRisk(t.priority || t.status),
          state: t.state || "National",
          source_id: t.id,
          source_path: "/command-center",
          created_at: t.updated_at || t.created_at,
          metadata: { priority: t.priority, status: t.status, source: t.source },
        })
      ),

    ...reports.map((r) =>
      notification({
        id: `report-${r.id}`,
        source: "Intelligence Reports",
        category: "report",
        title: r.title || "Report generated",
        body: r.executive_summary || `${r.report_type || "report"} generated`,
        level: "info",
        state: r.state || "National",
        source_id: r.id,
        source_path: "/intelligence-reports",
        created_at: r.created_at,
        metadata: { report_type: r.report_type, status: r.status },
      })
    ),

    ...exports.map((e) =>
      notification({
        id: `export-${e.id}`,
        source: "Report Exports",
        category: "export",
        title: e.title || "Report export generated",
        body: `${e.export_type || "export"} is ready.`,
        level: "info",
        source_id: e.id,
        source_path: "/report-exports",
        created_at: e.created_at,
        metadata: { export_type: e.export_type, status: e.status },
      })
    ),

    ...clientPortals
      .filter((c) => c.last_viewed_at)
      .map((c) =>
        notification({
          id: `client-portal-${c.id}`,
          source: "Client Portal",
          category: "client",
          title: `${c.client_name} viewed client portal`,
          body: c.organization || c.email || "Client portal viewed.",
          level: "info",
          source_id: c.id,
          source_path: "/client-portal-admin",
          created_at: c.last_viewed_at,
          metadata: { status: c.status, email: c.email },
        })
      ),

    ...invoices
      .filter((i) => ["overdue", "open", "sent"].includes(String(i.status || "").toLowerCase()))
      .map((i) =>
        notification({
          id: `invoice-${i.id}`,
          source: "Revenue Intelligence",
          category: "revenue",
          title: `${i.status === "overdue" ? "Overdue invoice" : "Open invoice"}: ${i.title}`,
          body: `${i.client_name || "Client"} • $${Number(i.amount || 0).toLocaleString()}`,
          level: String(i.status).toLowerCase() === "overdue" ? "critical" : "warning",
          source_id: i.id,
          source_path: "/revenue-intelligence",
          created_at: i.created_at,
          metadata: { amount: i.amount, due_date: i.due_date, status: i.status },
        })
      ),

    ...vendors
      .filter((v) => ["high", "at risk", "thin", "medium"].includes(String(v.risk || v.coverage_tier || "").toLowerCase()))
      .map((v) =>
        notification({
          id: `vendor-${v.id}`,
          source: "Vendor Network",
          category: "vendor",
          title: `Vendor coverage watch: ${v.name || v.vendor_name}`,
          body: `${v.category || "Vendor"} • ${v.state || "National"} • ${v.risk || v.coverage_tier || "Review"}`,
          level: levelFromRisk(v.risk || v.coverage_tier),
          state: v.state || "National",
          source_id: v.id,
          source_path: "/vendors",
          created_at: v.updated_at || v.created_at,
          metadata: { category: v.category, status: v.status, risk: v.risk, coverage_tier: v.coverage_tier },
        })
      ),

    ...crm
      .filter((a) => !["complete", "completed", "done"].includes(String(a.status || "").toLowerCase()))
      .map((a) =>
        notification({
          id: `crm-${a.id}`,
          source: "Campaign CRM",
          category: "crm",
          title: a.title || "CRM follow-up",
          body: `${a.type || "activity"} • ${a.status || "open"}`,
          level: levelFromRisk(a.priority || a.status),
          source_id: a.id,
          source_path: "/campaign-crm",
          created_at: a.created_at,
          metadata: { priority: a.priority, due_date: a.due_date, status: a.status },
        })
      ),
  ];

  const manualNormalized = manual.map((m) =>
    notification({
      id: `manual-${m.id}`,
      source: m.source,
      category: m.category,
      title: m.title,
      body: m.body,
      level: m.level,
      state: m.state,
      status: m.status,
      source_id: m.source_id,
      source_path: m.source_path,
      created_at: m.created_at,
      metadata: m.metadata || {},
    })
  );

  let notifications = [...manualNormalized, ...generated]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 250);

  if (filters.level) notifications = notifications.filter((n) => n.level === filters.level);
  if (filters.category) notifications = notifications.filter((n) => n.category === filters.category);
  if (filters.source) notifications = notifications.filter((n) => n.source === filters.source);
  if (filters.state) notifications = notifications.filter((n) => n.state === filters.state);

  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    notifications = notifications.filter((n) =>
      [n.title, n.body, n.source, n.category, n.state, n.level]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  const summary = {
    total: notifications.length,
    unread: notifications.filter((n) => n.status === "unread").length,
    critical: notifications.filter((n) => n.level === "critical").length,
    warning: notifications.filter((n) => n.level === "warning").length,
    info: notifications.filter((n) => n.level === "info").length,
    signals: notifications.filter((n) => n.category === "signal").length,
    tasks: notifications.filter((n) => n.category === "task").length,
    revenue: notifications.filter((n) => n.category === "revenue").length,
    clients: notifications.filter((n) => n.category === "client").length,
  };

  return {
    summary,
    notifications,
    sources: Array.from(new Set(notifications.map((n) => n.source))).sort(),
    categories: Array.from(new Set(notifications.map((n) => n.category))).sort(),
    states: Array.from(new Set(notifications.map((n) => n.state).filter(Boolean))).sort(),
    updated_at: new Date().toISOString(),
  };
}

export async function markNotificationRead({ user = {}, id }) {
  await ensureNotificationCenterTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  if (!String(id).startsWith("manual-")) return { ok: true, generated: true };

  const dbId = String(id).replace("manual-", "");

  await pool.query(
    `
      UPDATE notification_events
      SET status = 'read', read_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND firm_id = $2
    `,
    [dbId, firmId]
  );

  return { ok: true };
}

export async function archiveNotification({ user = {}, id }) {
  await ensureNotificationCenterTables();

  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  if (!String(id).startsWith("manual-")) return { ok: true, generated: true };

  const dbId = String(id).replace("manual-", "");

  await pool.query(
    `
      UPDATE notification_events
      SET status = 'archived', archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND firm_id = $2
    `,
    [dbId, firmId]
  );

  return { ok: true };
}
