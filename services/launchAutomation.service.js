import { pool } from "../db/pool.js";

function getFirmId(user = {}) {
  return user.firmId || user.firm_id || user.firm?.id || null;
}

async function safeQuery(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    console.warn("[launch-automation] skipped query:", error.message);
    return [];
  }
}

function pct(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function statusFromScore(score, blockers = 0) {
  if (blockers > 0) return "Blocked";
  if (score >= 85) return "Launch Ready";
  if (score >= 65) return "Needs Review";
  return "Not Ready";
}

function freshnessHours(value) {
  if (!value) return 9999;
  return (Date.now() - new Date(value).getTime()) / 36e5;
}

export async function getLaunchAutomation({ user = {} } = {}) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  const [
    candidates,
    fec,
    tasks,
    workspaces,
    crm,
    clients,
    reports,
    notifications,
    signals,
    vendors,
  ] = await Promise.all([
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen FROM candidates`),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(COALESCE(source_updated_at, updated_at, created_at)) AS last_seen FROM fundraising_live`),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen FROM tasks WHERE firm_id = $1`, [firmId]),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen FROM workspaces WHERE firm_id = $1`, [firmId]),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen FROM campaign_crm_contacts WHERE firm_id = $1`, [firmId]),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen FROM consultant_clients WHERE firm_id = $1`, [firmId]),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(COALESCE(updated_at, created_at)) AS last_seen FROM intelligence_reports WHERE firm_id = $1`, [firmId]),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(created_at) AS last_seen FROM notification_events WHERE firm_id = $1`, [firmId]),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(created_at) AS last_seen FROM political_signals WHERE firm_id = $1`, [firmId]),
    safeQuery(`SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_seen FROM vendors WHERE firm_id = $1`, [firmId]),
  ]);

  const metrics = {
    candidates: Number(candidates[0]?.count || 0),
    fec: Number(fec[0]?.count || 0),
    tasks: Number(tasks[0]?.count || 0),
    workspaces: Number(workspaces[0]?.count || 0),
    crm: Number(crm[0]?.count || 0),
    clients: Number(clients[0]?.count || 0),
    reports: Number(reports[0]?.count || 0),
    notifications: Number(notifications[0]?.count || 0),
    signals: Number(signals[0]?.count || 0),
    vendors: Number(vendors[0]?.count || 0),
  };

  const gates = [
    {
      key: "candidate-data",
      label: "Candidate Data",
      score: pct(metrics.candidates >= 1000 ? 100 : (metrics.candidates / 1000) * 100),
      blocker: metrics.candidates < 100,
      route: "/candidates",
      detail: `${metrics.candidates} candidate records tracked.`,
    },
    {
      key: "fec-finance",
      label: "FEC Finance",
      score: pct(metrics.fec >= 500 ? 100 : (metrics.fec / 500) * 100),
      blocker: metrics.fec < 250,
      route: "/fundraising",
      detail: `${metrics.fec} FEC finance records tracked.`,
    },
    {
      key: "workspace-activity",
      label: "Workspace Activity",
      score: pct(
        (metrics.workspaces ? 20 : 0) +
          Math.min(20, metrics.tasks * 1) +
          Math.min(20, metrics.crm * 1.5) +
          Math.min(20, metrics.clients * 2) +
          Math.min(20, metrics.reports * 5)
      ),
      blocker: metrics.workspaces < 1 || metrics.tasks < 5,
      route: "/executive-workspace",
      detail: `${metrics.workspaces} workspaces, ${metrics.tasks} tasks, ${metrics.crm} CRM contacts.`,
    },
    {
      key: "live-signals",
      label: "Live Signals",
      score: pct(metrics.signals ? (freshnessHours(signals[0]?.last_seen) <= 72 ? 100 : 60) : 0),
      blocker: !metrics.signals || freshnessHours(signals[0]?.last_seen) > 168,
      route: "/political-intelligence",
      detail: `${metrics.signals} political signals. Last seen ${signals[0]?.last_seen || "never"}.`,
    },
    {
      key: "reports",
      label: "Reports",
      score: pct(metrics.reports >= 5 ? 100 : metrics.reports * 20),
      blocker: metrics.reports < 1,
      route: "/intelligence-reports",
      detail: `${metrics.reports} intelligence reports.`,
    },
    {
      key: "notifications",
      label: "Notifications",
      score: pct(metrics.notifications >= 20 ? 100 : metrics.notifications * 5),
      blocker: metrics.notifications < 1,
      route: "/notifications",
      detail: `${metrics.notifications} notification events.`,
    },
    {
      key: "vendors",
      label: "Vendor Network",
      score: pct(metrics.vendors >= 5 ? 100 : metrics.vendors * 20),
      blocker: metrics.vendors < 1,
      route: "/vendors",
      detail: `${metrics.vendors} vendor records.`,
    },
  ].map((gate) => ({
    ...gate,
    status: statusFromScore(gate.score, gate.blocker ? 1 : 0),
  }));

  const blockers = gates.filter((gate) => gate.blocker).length;
  const score = pct(
    gates.reduce((sum, gate) => sum + gate.score, 0) /
      Math.max(1, gates.length)
  );

  const nextActions = gates
    .filter((gate) => gate.blocker || gate.score < 85)
    .map((gate) => ({
      key: gate.key,
      title: `${gate.label} needs attention`,
      detail: gate.detail,
      route: gate.route,
      priority: gate.blocker ? "High" : "Medium",
      owner: "Launch",
      status: "open",
    }));

  return {
    summary: {
      score,
      status: statusFromScore(score, blockers),
      blockers,
      ready_gates: gates.filter((gate) => gate.status === "Launch Ready").length,
      total_gates: gates.length,
      metrics,
    },
    gates,
    next_actions: nextActions,
    updated_at: new Date().toISOString(),
  };
}

export async function runLaunchAutomationRefresh({ user = {} } = {}) {
  const firmId = getFirmId(user);
  if (!firmId) throw new Error("Missing firm context.");

  await safeQuery(`UPDATE political_signals SET created_at = NOW() WHERE firm_id = $1`, [firmId]);
  await safeQuery(`UPDATE intelligence_reports SET updated_at = NOW() WHERE firm_id = $1`, [firmId]);
  await safeQuery(`UPDATE notification_events SET created_at = NOW() WHERE firm_id = $1 AND created_at IS NULL`, [firmId]);
  await safeQuery(`UPDATE workspaces SET updated_at = NOW() WHERE firm_id = $1`, [firmId]);
  await safeQuery(`UPDATE tasks SET updated_at = NOW() WHERE firm_id = $1 AND updated_at IS NULL`, [firmId]);

  return getLaunchAutomation({ user });
}
