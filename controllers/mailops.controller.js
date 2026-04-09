import { pool } from "../db/pool.js";

const demoMailOpsDashboard = {
  metrics: [
    { label: "Mail Drops", value: "18", delta: "4 active today", tone: "up" },
    { label: "Delivery Risk", value: "3", delta: "2 elevated", tone: "down" },
    { label: "Postal Alerts", value: "7", delta: "Live monitoring", tone: "up" },
    { label: "On-Time Rate", value: "94%", delta: "+2.1%", tone: "up" },
  ],
  drops: [
    {
      id: 1,
      campaign: "GA Senate Victory",
      state: "Georgia",
      office: "Senate",
      risk: "Elevated",
      location: "Atlanta NDC",
      status: "Elevated",
      in_home: "2026-10-14",
      note: "Watch weekend clearance volume",
    },
    {
      id: 2,
      campaign: "PA Governor Push",
      state: "Pennsylvania",
      office: "Governor",
      risk: "Watch",
      location: "Philadelphia P&DC",
      status: "On Track",
      in_home: "2026-10-16",
      note: "Vendor scan performance stable",
    },
  ],
  alerts: [
    {
      id: 1,
      title: "Atlanta NDC delay pressure increasing",
      severity: "High",
      source: "MailOps",
      detail: "Projected slip risk on high-volume trays.",
      state: "Georgia",
      office: "Senate",
      risk: "Elevated",
    },
    {
      id: 2,
      title: "Philadelphia scan recovery improving",
      severity: "Medium",
      source: "MailOps",
      detail: "Recent tray movement indicates stabilization.",
      state: "Pennsylvania",
      office: "Governor",
      risk: "Watch",
    },
  ],
  demo: true,
};

function applyExecutiveFilters(rows, query = {}) {
  const state = String(query.state || "").trim().toLowerCase();
  const office = String(query.office || "").trim().toLowerCase();
  const risk = String(query.risk || "").trim().toLowerCase();

  return rows.filter((row) => {
    const rowState = String(row.state || "").trim().toLowerCase();
    const rowOffice = String(row.office || "").trim().toLowerCase();
    const rowRisk = String(row.risk || "").trim().toLowerCase();

    if (state && rowState !== state) return false;
    if (office && rowOffice !== office) return false;
    if (risk && rowRisk !== risk) return false;

    return true;
  });
}

function buildMetricsFromLiveData(drops, alerts) {
  const activeDrops = drops.length;
  const elevatedDrops = drops.filter(
    (row) => String(row.status || "").toLowerCase() === "elevated"
  ).length;
  const highAlerts = alerts.filter(
    (row) => String(row.severity || "").toLowerCase() === "high"
  ).length;

  const onTrackDrops = drops.filter(
    (row) => String(row.status || "").toLowerCase() === "on track"
  ).length;

  const onTimeRate = activeDrops
    ? `${Math.round((onTrackDrops / activeDrops) * 100)}%`
    : "0%";

  return [
    {
      label: "Mail Drops",
      value: String(activeDrops),
      delta: `${Math.min(activeDrops, 4)} active today`,
      tone: "up",
    },
    {
      label: "Delivery Risk",
      value: String(elevatedDrops),
      delta: elevatedDrops > 0 ? `${elevatedDrops} elevated` : "No elevated drops",
      tone: elevatedDrops > 0 ? "down" : "up",
    },
    {
      label: "Postal Alerts",
      value: String(alerts.length),
      delta: highAlerts > 0 ? `${highAlerts} high severity` : "Monitoring stable",
      tone: alerts.length > 0 ? "up" : "neutral",
    },
    {
      label: "On-Time Rate",
      value: onTimeRate,
      delta: onTrackDrops > 0 ? `${onTrackDrops} on track` : "No active drops",
      tone: "up",
    },
  ];
}

export async function getMailOpsDashboard(req, res) {
  try {
    const dropsResult = await pool.query(`
      SELECT
        id,
        campaign,
        state,
        office,
        risk,
        location,
        status,
        in_home,
        note
      FROM mailops_drops
      ORDER BY in_home ASC NULLS LAST, id DESC
    `);

    const alertsResult = await pool.query(`
      SELECT
        id,
        title,
        severity,
        source,
        detail,
        state,
        office,
        risk
      FROM mailops_alerts
      ORDER BY id DESC
    `);

    const drops = applyExecutiveFilters(dropsResult.rows || [], req.query);
    const alerts = applyExecutiveFilters(alertsResult.rows || [], req.query);

    const metrics = buildMetricsFromLiveData(drops, alerts);

    return res.json({
      metrics,
      drops,
      alerts,
      demo: false,
    });
  } catch (error) {
    console.error("getMailOpsDashboard fallback:", error.message);

    const filteredDrops = applyExecutiveFilters(
      demoMailOpsDashboard.drops,
      req.query
    );
    const filteredAlerts = applyExecutiveFilters(
      demoMailOpsDashboard.alerts,
      req.query
    );

    const metrics = buildMetricsFromLiveData(filteredDrops, filteredAlerts);

    return res.json({
      metrics,
      drops: filteredDrops,
      alerts: filteredAlerts,
      demo: true,
    });
  }
}
