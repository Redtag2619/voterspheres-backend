import { sendWorkspaceReportEmail } from "./reportEmail.service.js";

let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db/pool.js",
    "../db.js",
    "../database.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.pool || mod.default || mod.db || null;
      if (db?.query) {
        cachedDb = db;
        return db;
      }
    } catch {
      // try next
    }
  }

  throw new Error("Database connection not found for scheduled reports service");
}

async function query(sql, params = []) {
  const db = await getDb();
  return db.query(sql, params);
}

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizeStatus(status = "open") {
  const value = String(status || "").toLowerCase();
  if (["complete", "completed", "done", "resolved"].includes(value)) return "complete";
  if (["in_progress", "in progress", "started", "active"].includes(value)) return "in_progress";
  if (["blocked", "hold", "paused"].includes(value)) return "blocked";
  return "open";
}

function isHighPriority(task = {}) {
  return ["high", "critical"].includes(String(task.priority || "").toLowerCase());
}

function isLinkedSignal(task = {}) {
  return Boolean(
    task.metadata?.feed_id ||
      task.metadata?.signal_id ||
      task.metadata?.vendor_action_id
  );
}

function hoursOld(task = {}) {
  const raw = task.updated_at || task.created_at;
  if (!raw) return 0;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 0;

  return Math.max(0, Math.round((Date.now() - date.getTime()) / 36e5));
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeFileName(value = "workspace-report") {
  return (
    String(value || "workspace-report")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "workspace-report"
  );
}

function normalizeEmailList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);

  return String(value || "")
    .split(",")
    .map(text)
    .filter(Boolean);
}

function buildAnalytics(tasks = []) {
  const openTasks = tasks.filter((task) => normalizeStatus(task.status) !== "complete");
  const completeTasks = tasks.filter((task) => normalizeStatus(task.status) === "complete");
  const blockedTasks = tasks.filter((task) => normalizeStatus(task.status) === "blocked");
  const inProgressTasks = tasks.filter((task) => normalizeStatus(task.status) === "in_progress");
  const highPriorityTasks = tasks.filter(isHighPriority);
  const linkedSignals = tasks.filter(isLinkedSignal);
  const resolvedSignals = linkedSignals.filter((task) => normalizeStatus(task.status) === "complete");
  const agingTasks = openTasks.filter((task) => hoursOld(task) >= 24);
  const slaRiskTasks = openTasks.filter((task) => isHighPriority(task) && hoursOld(task) >= 2);

  const total = tasks.length;
  const completionRate = total ? Math.round((completeTasks.length / total) * 100) : 0;
  const signalClosureRate = linkedSignals.length
    ? Math.round((resolvedSignals.length / linkedSignals.length) * 100)
    : 0;

  return {
    total,
    open: openTasks.length,
    complete: completeTasks.length,
    blocked: blockedTasks.length,
    inProgress: inProgressTasks.length,
    highPriority: highPriorityTasks.length,
    linkedSignals: linkedSignals.length,
    resolvedSignals: resolvedSignals.length,
    aging: agingTasks.length,
    slaRisk: slaRiskTasks.length,
    completionRate,
    signalClosureRate
  };
}

function buildReportHtml({ workspace, tasks, analytics }) {
  const generatedAt = new Date().toLocaleString();

  const taskRows = tasks.slice(0, 25).map((task) => {
    const status = normalizeStatus(task.status);
    return `
      <tr>
        <td><strong>${escapeHtml(task.title)}</strong><br/>${escapeHtml(task.description || "")}</td>
        <td>${escapeHtml(task.status || "open")}</td>
        <td>${escapeHtml(task.priority || "medium")}</td>
        <td>${escapeHtml(task.assigned_to || "Command Team")}</td>
        <td>${escapeHtml(task.source || "command_center")}</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(workspace.name)} Scheduled Report</title>
  <style>
    body { margin:0; padding:34px; font-family:Arial,Helvetica,sans-serif; color:#0f172a; background:#f8fafc; }
    .report { max-width:1040px; margin:0 auto; background:white; border:1px solid #e2e8f0; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(15,23,42,.08); }
    .hero { background:linear-gradient(135deg,#0f172a,#1e3a8a); color:white; padding:30px; }
    .eyebrow { text-transform:uppercase; letter-spacing:.12em; font-size:11px; font-weight:800; color:#93c5fd; }
    h1 { margin:8px 0 0; font-size:30px; line-height:1.15; }
    .subtitle { margin-top:8px; color:#cbd5e1; line-height:1.5; }
    .body { padding:28px 30px 34px; }
    .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin:18px 0 26px; }
    .card { border:1px solid #e2e8f0; border-radius:16px; padding:15px; background:#f8fafc; }
    .label { font-size:11px; font-weight:800; letter-spacing:.06em; color:#64748b; text-transform:uppercase; }
    .value { margin-top:8px; font-size:24px; font-weight:900; color:#0f172a; }
    .sub { margin-top:4px; font-size:12px; color:#64748b; }
    h2 { margin:28px 0 10px; font-size:18px; color:#0f172a; }
    table { width:100%; border-collapse:collapse; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; margin-bottom:18px; }
    th { background:#f1f5f9; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#475569; padding:11px; }
    td { border-top:1px solid #e2e8f0; padding:11px; vertical-align:top; font-size:13px; color:#334155; }
    .footer { margin-top:26px; padding-top:18px; border-top:1px solid #e2e8f0; color:#64748b; font-size:12px; }
  </style>
</head>
<body>
  <div class="report">
    <div class="hero">
      <div class="eyebrow">VoterSpheres Scheduled Workspace Report</div>
      <h1>${escapeHtml(workspace.name || "Campaign Workspace")}</h1>
      <div class="subtitle">
        ${escapeHtml(workspace.state || "National")} • ${escapeHtml(workspace.office || "Statewide")} • ${escapeHtml(workspace.cycle || "2026")}<br/>
        Generated ${escapeHtml(generatedAt)}
      </div>
    </div>

    <div class="body">
      <h2>Executive Summary</h2>
      <div class="grid">
        <div class="card"><div class="label">Open Tasks</div><div class="value">${analytics.open}</div><div class="sub">${analytics.highPriority} high priority</div></div>
        <div class="card"><div class="label">Completion Rate</div><div class="value">${analytics.completionRate}%</div><div class="sub">${analytics.complete} of ${analytics.total} closed</div></div>
        <div class="card"><div class="label">Signal Closure</div><div class="value">${analytics.signalClosureRate}%</div><div class="sub">${analytics.resolvedSignals} of ${analytics.linkedSignals} resolved</div></div>
        <div class="card"><div class="label">SLA Risk</div><div class="value">${analytics.slaRisk}</div><div class="sub">${analytics.aging} aging tasks</div></div>
      </div>

      <h2>Workspace Profile</h2>
      <table>
        <tbody>
          <tr><th>Candidate</th><td>${escapeHtml(workspace.candidate_name || "Not set")}</td><th>Status</th><td>${escapeHtml(workspace.status || "active")}</td></tr>
          <tr><th>State</th><td>${escapeHtml(workspace.state || "National")}</td><th>Office</th><td>${escapeHtml(workspace.office || "Statewide")}</td></tr>
          <tr><th>Workspace ID</th><td>${escapeHtml(workspace.id)}</td><th>Cycle</th><td>${escapeHtml(workspace.cycle || "2026")}</td></tr>
        </tbody>
      </table>

      <h2>Workspace Tasks</h2>
      <table>
        <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Owner</th><th>Source</th></tr></thead>
        <tbody>
          ${taskRows || `<tr><td colspan="5">No tasks in this workspace.</td></tr>`}
        </tbody>
      </table>

      <div class="footer">
        Prepared automatically by VoterSpheres scheduled reporting.
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function ensureScheduledReportTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS workspace_report_schedules (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      recipients TEXT[] DEFAULT ARRAY[]::TEXT[],
      frequency TEXT DEFAULT 'weekly',
      day_of_week INTEGER DEFAULT 1,
      hour INTEGER DEFAULT 9,
      timezone TEXT DEFAULT 'America/Chicago',
      enabled BOOLEAN DEFAULT true,
      last_sent_at TIMESTAMP,
      next_run_at TIMESTAMP,
      created_by_user_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS firm_id INTEGER`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS workspace_id INTEGER`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS name TEXT`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS recipients TEXT[] DEFAULT ARRAY[]::TEXT[]`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'weekly'`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS day_of_week INTEGER DEFAULT 1`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS hour INTEGER DEFAULT 9`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Chicago'`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE workspace_report_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_workspace_report_schedules_due
      ON workspace_report_schedules(enabled, next_run_at)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS workspace_report_sends (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      workspace_id INTEGER NOT NULL,
      report_id INTEGER,
      schedule_id INTEGER,
      provider TEXT,
      provider_message_id TEXT,
      recipient_email TEXT,
      subject TEXT,
      status TEXT DEFAULT 'sent',
      error TEXT,
      sent_by_user_id INTEGER,
      sent_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE workspace_report_sends ADD COLUMN IF NOT EXISTS schedule_id INTEGER`);
}

export function calculateNextRunAt(schedule = {}, fromDate = new Date()) {
  const frequency = text(schedule.frequency || "weekly").toLowerCase();
  const hour = Math.max(0, Math.min(23, Number(schedule.hour ?? 9)));
  const dayOfWeek = Math.max(0, Math.min(6, Number(schedule.day_of_week ?? 1)));

  const next = new Date(fromDate);
  next.setMinutes(0, 0, 0);
  next.setHours(hour);

  if (frequency === "daily") {
    if (next <= fromDate) next.setDate(next.getDate() + 1);
    return next;
  }

  const currentDay = next.getDay();
  let daysUntil = (dayOfWeek - currentDay + 7) % 7;

  if (daysUntil === 0 && next <= fromDate) {
    daysUntil = 7;
  }

  next.setDate(next.getDate() + daysUntil);
  return next;
}

export async function generateWorkspaceReport({ firmId, workspaceId }) {
  const workspaceResult = await query(
    `
      SELECT *
      FROM workspaces
      WHERE id = $1 AND firm_id = $2
      LIMIT 1
    `,
    [workspaceId, firmId]
  );

  const workspace = workspaceResult.rows?.[0];
  if (!workspace) throw new Error("Workspace not found");

  const tasksResult = await query(
    `
      SELECT *
      FROM tasks
      WHERE firm_id = $1 AND workspace_id = $2
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      LIMIT 250
    `,
    [firmId, workspaceId]
  );

  const tasks = tasksResult.rows || [];
  const analytics = buildAnalytics(tasks);
  const html = buildReportHtml({ workspace, tasks, analytics });
  const filename = `${safeFileName(workspace.name || "workspace")}-scheduled-report-${new Date().toISOString().slice(0, 10)}.html`;

  const saved = await query(
    `
      INSERT INTO workspace_reports (
        firm_id,
        workspace_id,
        title,
        filename,
        html,
        summary,
        generated_by_user_id,
        generated_by_name,
        generated_at,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,NULL,'Scheduled Report',NOW(),NOW(),NOW())
      RETURNING *
    `,
    [
      firmId,
      workspaceId,
      `${workspace.name || "Workspace"} Scheduled Report`,
      filename,
      html,
      JSON.stringify({
        open: analytics.open,
        complete: analytics.complete,
        blocked: analytics.blocked,
        slaRisk: analytics.slaRisk,
        signalClosureRate: analytics.signalClosureRate
      })
    ]
  );

  return {
    workspace,
    tasks,
    analytics,
    report: saved.rows[0]
  };
}

export async function sendScheduledReport(schedule = {}) {
  const recipients = normalizeEmailList(schedule.recipients);
  if (!recipients.length) {
    throw new Error("Schedule has no recipients");
  }

  const generated = await generateWorkspaceReport({
    firmId: schedule.firm_id,
    workspaceId: schedule.workspace_id
  });

  const subject = `${generated.workspace.name || "Workspace"} — Scheduled VoterSpheres Report`;
  const message = `Attached is the scheduled VoterSpheres workspace report for ${generated.workspace.name || "this campaign workspace"}.`;

  const result = await sendWorkspaceReportEmail({
    to: recipients,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2>${escapeHtml(subject)}</h2>
        <p>${escapeHtml(message)}</p>
        <p>The full report is attached as an HTML file.</p>
      </div>
    `,
    textBody: message,
    filename: generated.report.filename
  });

  for (const recipient of recipients) {
    await query(
      `
        INSERT INTO workspace_report_sends (
          firm_id,
          workspace_id,
          report_id,
          schedule_id,
          provider,
          provider_message_id,
          recipient_email,
          subject,
          status,
          sent_by_user_id,
          sent_at,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent',NULL,NOW(),NOW())
      `,
      [
        schedule.firm_id,
        schedule.workspace_id,
        generated.report.id,
        schedule.id,
        result.provider,
        result.provider_message_id,
        recipient,
        subject
      ]
    );
  }

  const nextRunAt = calculateNextRunAt(schedule, new Date());

  await query(
    `
      UPDATE workspace_report_schedules
      SET
        last_sent_at = NOW(),
        next_run_at = $2,
        updated_at = NOW()
      WHERE id = $1
    `,
    [schedule.id, nextRunAt]
  );

  return {
    ok: true,
    report: generated.report,
    provider: result.provider,
    provider_message_id: result.provider_message_id,
    recipients,
    next_run_at: nextRunAt
  };
}

export async function runDueScheduledReports({ limit = 10 } = {}) {
  await ensureScheduledReportTables();

  const result = await query(
    `
      SELECT *
      FROM workspace_report_schedules
      WHERE enabled = true
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
      LIMIT $1
    `,
    [limit]
  );

  const runs = [];

  for (const schedule of result.rows || []) {
    try {
      const run = await sendScheduledReport(schedule);
      runs.push({ schedule_id: schedule.id, ok: true, ...run });
    } catch (error) {
      runs.push({
        schedule_id: schedule.id,
        ok: false,
        error: error.message || "Scheduled report failed"
      });

      const nextRunAt = calculateNextRunAt(schedule, new Date());

      await query(
        `
          UPDATE workspace_report_schedules
          SET next_run_at = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [schedule.id, nextRunAt]
      );
    }
  }

  return {
    ok: true,
    checked: result.rows.length,
    runs
  };
}

let scheduledReportTimer = null;

export function startScheduledReportRunner() {
  if (scheduledReportTimer) return scheduledReportTimer;

  const enabled = String(process.env.ENABLE_SCHEDULED_REPORTS || "true").toLowerCase() !== "false";
  if (!enabled) return null;

  const intervalMs = Number(process.env.SCHEDULED_REPORT_INTERVAL_MS || 5 * 60 * 1000);

  scheduledReportTimer = setInterval(async () => {
    try {
      const result = await runDueScheduledReports({ limit: 10 });
      if (result.runs?.length) {
        console.log("✅ Scheduled reports processed", result);
      }
    } catch (error) {
      console.error("Scheduled report runner failed:", error.message || error);
    }
  }, intervalMs);

  scheduledReportTimer.unref?.();

  console.log(`✅ Scheduled report runner enabled (${intervalMs}ms)`);

  return scheduledReportTimer;
}

export default {
  ensureScheduledReportTables,
  calculateNextRunAt,
  generateWorkspaceReport,
  sendScheduledReport,
  runDueScheduledReports,
  startScheduledReportRunner
};
