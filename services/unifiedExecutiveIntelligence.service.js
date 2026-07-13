import { pool } from "../db/pool.js";
import { getExecutiveKpis } from "./executiveKpi.service.js";

const now = () => new Date().toISOString();

const num = (value = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const clamp = (value) =>
  Math.max(0, Math.min(100, num(value)));

function firmId(user = {}) {
  return (
    user.firmId ||
    user.firm_id ||
    user.firm?.id ||
    null
  );
}

function normalizeStatus(value = "") {
  const status = String(value || "")
    .toLowerCase()
    .trim();

  if (
    [
      "complete",
      "completed",
      "done",
      "resolved",
      "closed",
    ].includes(status)
  ) {
    return "complete";
  }

  if (
    [
      "blocked",
      "paused",
      "hold",
      "stalled",
    ].includes(status)
  ) {
    return "blocked";
  }

  if (
    [
      "in_progress",
      "in progress",
      "active",
      "started",
    ].includes(status)
  ) {
    return "in_progress";
  }

  return "open";
}

function riskFromScore(score = 0) {
  if (num(score) >= 82) return "Critical";
  if (num(score) >= 65) return "High";
  if (num(score) >= 42) return "Elevated";

  return "Stable";
}

function freshness(value) {
  if (!value) return "unknown";

  const stamp = new Date(value).getTime();

  if (!Number.isFinite(stamp)) {
    return "unknown";
  }

  const age = Date.now() - stamp;

  if (age <= 60 * 60 * 1000) {
    return "live";
  }

  if (age <= 24 * 60 * 60 * 1000) {
    return "fresh";
  }

  if (age <= 7 * 24 * 60 * 60 * 1000) {
    return "aging";
  }

  return "stale";
}

async function safeQuery(
  key,
  sql,
  params = []
) {
  try {
    const result = await pool.query(
      sql,
      params
    );

    return {
      key,
      ok: true,
      rows: result.rows || [],
      error: null,
      checked_at: now(),
    };
  } catch (error) {
    console.warn(
      `[unified-executive-intelligence] ${key} degraded:`,
      error.message
    );

    return {
      key,
      ok: false,
      rows: [],
      error: error.message,
      checked_at: now(),
    };
  }
}

function sourceStatus(
  result,
  lastSeen = null
) {
  return {
    key: result.key,
    ok: result.ok,
    status: result.ok
      ? "available"
      : "degraded",
    freshness: freshness(lastSeen),
    last_seen: lastSeen || null,
    checked_at: result.checked_at,
    error: result.error || null,
  };
}

function workspaceRows(
  workspaces = [],
  tasks = []
) {
  return workspaces
    .map((workspace) => {
      const rows = tasks.filter(
        (task) =>
          String(task.workspace_id || "") ===
          String(workspace.id)
      );

      const open = rows.filter(
        (task) =>
          normalizeStatus(task.status) !==
          "complete"
      );

      const complete = rows.filter(
        (task) =>
          normalizeStatus(task.status) ===
          "complete"
      );

      const blocked = rows.filter(
        (task) =>
          normalizeStatus(task.status) ===
          "blocked"
      );

      const high = rows.filter((task) =>
        ["critical", "high"].includes(
          String(task.priority || "")
            .toLowerCase()
        )
      );

      const county = rows.filter(
        (task) => {
          const metadata =
            task.metadata || {};

          const source = String(
            task.source ||
              metadata.source ||
              ""
          ).toLowerCase();

          return (
            source.includes(
              "state_operations"
            ) ||
            source.includes("county") ||
            Boolean(
              metadata.county ||
                metadata.county_name ||
                metadata.heat_score
            )
          );
        }
      );

      const activeCounty = county.filter(
        (task) =>
          normalizeStatus(task.status) !==
          "complete"
      );

      const completionRate =
        rows.length > 0
          ? Math.round(
              (complete.length /
                rows.length) *
                100
            )
          : 0;

      const pressure = clamp(
        open.length * 6 +
          blocked.length * 10 +
          high.length * 9 +
          activeCounty.length * 14 +
          Math.max(
            0,
            70 - completionRate
          ) *
            0.25
      );

      return {
        ...workspace,

        pressure_score:
          Math.round(pressure),

        risk: riskFromScore(pressure),

        task_count: rows.length,

        open_task_count:
          open.length,

        completed_task_count:
          complete.length,

        blocked_task_count:
          blocked.length,

        high_priority_task_count:
          high.length,

        county_escalation_count:
          county.length,

        active_county_escalation_count:
          activeCounty.length,

        completion_rate:
          completionRate,

        latest_tasks:
          rows.slice(0, 5),
      };
    })
    .sort(
      (a, b) =>
        num(b.pressure_score) -
        num(a.pressure_score)
    );
}

function generatedRecommendations({
  kpis,
  workspaces,
  signals,
  alerts,
}) {
  const rows = [];

  const urgent =
    workspaces.find((item) =>
      ["Critical", "High"].includes(
        item.risk
      )
    );

  if (urgent) {
    rows.push({
      id: `workspace-${urgent.id}`,

      title:
        `Review ${
          urgent.name ||
          "high-risk workspace"
        }`,

      detail:
        `${urgent.open_task_count || 0} open tasks, ` +
        `${urgent.blocked_task_count || 0} blocked, and ` +
        `${urgent.pressure_score || 0}% pressure.`,

      priority: urgent.risk,

      owner:
        "Executive Operations",

      source:
        "workspace_intelligence",

      route:
        `/campaign-workspace/${urgent.id}`,

      workspace_id:
        urgent.id,

      status: "open",
    });
  }

  if (num(kpis.urgent_tasks)) {
    rows.push({
      id: "urgent-tasks",

      title:
        "Resolve urgent execution tasks",

      detail:
        `${kpis.urgent_tasks} urgent tasks require executive ownership.`,

      priority: "High",

      owner:
        "Mission Control",

      source:
        "executive_kpis",

      route:
        "/mission-control",

      status: "open",
    });
  }

  if (
    num(kpis.critical_signals) ||
    signals.length
  ) {
    rows.push({
      id: "signals",

      title:
        "Review elevated political signals",

      detail:
        `${
          num(kpis.critical_signals) ||
          signals.length
        } elevated signals are active.`,

      priority: "Elevated",

      owner:
        "Intelligence Director",

      source:
        "political_signals",

      route:
        "/political-signals",

      status: "open",
    });
  }

  if (
    num(kpis.critical_alerts) ||
    alerts.length
  ) {
    rows.push({
      id: "alerts",

      title:
        "Clear critical executive alerts",

      detail:
        `${
          num(kpis.critical_alerts) ||
          alerts.length
        } alerts require review.`,

      priority: "High",

      owner:
        "Executive Chief of Staff",

      source:
        "notification_events",

      route:
        "/notifications",

      status: "open",
    });
  }

  if (
    num(kpis.live_readiness) < 75
  ) {
    rows.push({
      id: "readiness",

      title:
        "Increase live-data readiness",

      detail:
        `Live readiness is ${num(
          kpis.live_readiness
        )}%. Review degraded sources.`,

      priority:
        num(kpis.live_readiness) < 50
          ? "High"
          : "Elevated",

      owner:
        "Data Operations",

      source:
        "executive_kpis",

      route:
        "/live-intelligence-layer",

      status: "open",
    });
  }

  if (rows.length) {
    return rows;
  }

  return [
    {
      id: "stable",

      title:
        "Maintain current executive posture",

      detail:
        "No critical cross-platform escalation is currently detected.",

      priority: "Stable",

      owner:
        "Executive Operations",

      source:
        "unified_executive_intelligence",

      route:
        "/executive-workspace",

      status: "monitoring",
    },
  ];
}

export async function getUnifiedExecutiveIntelligence(
  {
    user = {},
    workspaceId = null,
    state = "",
    office = "",
    risk = "",
  } = {}
) {
  const resolvedFirmId =
    firmId(user);

  if (!resolvedFirmId) {
    const error = new Error(
      "Missing firm context"
    );

    error.statusCode = 401;

    throw error;
  }

  const workspaceParams = [
    resolvedFirmId,
  ];

  let workspaceWhere =
    "WHERE firm_id = $1";

  if (workspaceId) {
    workspaceParams.push(
      workspaceId
    );

    workspaceWhere +=
      ` AND id = $${workspaceParams.length}`;
  }

  if (state) {
    workspaceParams.push(
      String(state).toUpperCase()
    );

    workspaceWhere +=
      ` AND UPPER(COALESCE(state, '')) = $${workspaceParams.length}`;
  }

  if (office) {
    workspaceParams.push(
      `%${office}%`
    );

    workspaceWhere +=
      ` AND COALESCE(office, '') ILIKE $${workspaceParams.length}`;
  }

  const taskParams = [
    resolvedFirmId,
  ];

  let taskWhere =
    "WHERE firm_id = $1";

  if (workspaceId) {
    taskParams.push(
      workspaceId
    );

    taskWhere +=
      ` AND workspace_id = $${taskParams.length}`;
  }

  const [
    kpiData,
    workspacesResult,
    tasksResult,
    signalsResult,
    alertsResult,
    strategyResult,
    decisionsResult,
    missionsResult,
    activityResult,
  ] = await Promise.all([
    getExecutiveKpis({
      user,
    }).catch((error) => ({
      summary: {},
      source_status: [],
      error: error.message,
      updated_at: now(),
    })),

    safeQuery(
      "workspaces",
      `
        SELECT *
        FROM workspaces
        ${workspaceWhere}
        ORDER BY
          updated_at DESC,
          created_at DESC
        LIMIT 250
      `,
      workspaceParams
    ),

    safeQuery(
      "tasks",
      `
        SELECT *
        FROM tasks
        ${taskWhere}
        ORDER BY
          CASE
            LOWER(
              COALESCE(
                priority,
                ''
              )
            )
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            ELSE 3
          END,
          updated_at DESC,
          created_at DESC
        LIMIT 500
      `,
      taskParams
    ),

    safeQuery(
      "political_signals",
      `
        SELECT *
        FROM political_signals
        WHERE firm_id = $1
        ORDER BY
          COALESCE(
            signal_score,
            0
          ) DESC,
          COALESCE(
            updated_at,
            created_at
          ) DESC
        LIMIT 100
      `,
      [resolvedFirmId]
    ),

    safeQuery(
      "notification_events",
      `
        SELECT *
        FROM notification_events
        WHERE firm_id = $1
        ORDER BY
          COALESCE(
            updated_at,
            created_at
          ) DESC
        LIMIT 100
      `,
      [resolvedFirmId]
    ),

    safeQuery(
      "strategy_recommendations",
      `
        SELECT *
        FROM strategy_recommendations
        WHERE firm_id = $1
        ORDER BY
          COALESCE(
            updated_at,
            created_at
          ) DESC
        LIMIT 100
      `,
      [resolvedFirmId]
    ),

    safeQuery(
      "decision_intelligence",
      `
        SELECT *
        FROM decision_intelligence
        WHERE firm_id = $1
        ORDER BY
          COALESCE(
            updated_at,
            created_at
          ) DESC
        LIMIT 100
      `,
      [resolvedFirmId]
    ),

    safeQuery(
      "executive_ai_missions",
      `
        SELECT *
        FROM executive_ai_missions
        WHERE firm_id = $1
        ORDER BY
          COALESCE(
            updated_at,
            created_at
          ) DESC
        LIMIT 100
      `,
      [resolvedFirmId]
    ),

    safeQuery(
      "workspace_activity",
      `
        SELECT
          id,
          'task'::text AS type,
          COALESCE(
            title,
            'Task activity'
          ) AS title,
          COALESCE(
            updated_at,
            created_at
          ) AS activity_time,
          workspace_id,
          status,
          priority
        FROM tasks
        WHERE firm_id = $1
        ORDER BY
          activity_time DESC
        LIMIT 100
      `,
      [resolvedFirmId]
    ),
  ]);

  const kpis =
    kpiData?.summary || {};

  const tasks =
    tasksResult.rows || [];

  let workspaces =
    workspaceRows(
      workspacesResult.rows || [],
      tasks
    );

  if (risk) {
    workspaces =
      workspaces.filter(
        (item) =>
          String(item.risk)
            .toLowerCase() ===
          String(risk)
            .toLowerCase()
      );
  }

  const signals =
    signalsResult.rows || [];

  const alerts =
    alertsResult.rows || [];

  const pressure =
    workspaces.length
      ? Math.round(
          workspaces.reduce(
            (sum, item) =>
              sum +
              num(
                item.pressure_score
              ),
            0
          ) /
            workspaces.length
        )
      : 0;

  const executionScore =
    clamp(
      100 -
        pressure * 0.45 -
        num(
          kpis.blocked_tasks
        ) *
          3 -
        num(
          kpis.urgent_tasks
        ) *
          2
    );

  const statusRows = [
    ...(
      Array.isArray(
        kpiData?.source_status
      )
        ? kpiData.source_status
        : []
    ),

    sourceStatus(
      workspacesResult,
      workspacesResult.rows?.[0]
        ?.updated_at
    ),

    sourceStatus(
      tasksResult,
      tasksResult.rows?.[0]
        ?.updated_at
    ),

    sourceStatus(
      signalsResult,
      signalsResult.rows?.[0]
        ?.updated_at ||
        signalsResult.rows?.[0]
          ?.created_at
    ),

    sourceStatus(
      alertsResult,
      alertsResult.rows?.[0]
        ?.updated_at ||
        alertsResult.rows?.[0]
          ?.created_at
    ),

    sourceStatus(
      strategyResult,
      strategyResult.rows?.[0]
        ?.updated_at ||
        strategyResult.rows?.[0]
          ?.created_at
    ),

    sourceStatus(
      decisionsResult,
      decisionsResult.rows?.[0]
        ?.updated_at ||
        decisionsResult.rows?.[0]
          ?.created_at
    ),

    sourceStatus(
      missionsResult,
      missionsResult.rows?.[0]
        ?.updated_at ||
        missionsResult.rows?.[0]
          ?.created_at
    ),

    sourceStatus(
      activityResult,
      activityResult.rows?.[0]
        ?.activity_time
    ),
  ].filter(
    (
      item,
      index,
      array
    ) =>
      array.findIndex(
        (candidate) =>
          candidate.key ===
          item.key
      ) === index
  );

  const available =
    statusRows.filter(
      (item) =>
        item.status ===
        "available"
    ).length;

  const confidence =
    statusRows.length
      ? Math.round(
          (available /
            statusRows.length) *
            100
        )
      : 0;

  const readiness =
    clamp(
      num(
        kpis.live_readiness
      ) *
        0.5 +
        executionScore *
          0.3 +
        Math.max(
          0,
          100 -
            num(
              kpis.national_risk
            )
        ) *
          0.2
    );

  const overall =
    Math.round(
      readiness * 0.4 +
        executionScore * 0.35 +
        confidence * 0.25
    );

  const health = {
    overall_score:
      overall,

    readiness_score:
      Math.round(
        readiness
      ),

    execution_score:
      Math.round(
        executionScore
      ),

    intelligence_confidence:
      confidence,

    national_risk:
      num(
        kpis.national_risk
      ),

    pressure_score:
      pressure,

    status:
      overall >= 80
        ? "Operational"
        : overall >= 60
          ? "Watch"
          : "Intervention Required",
  };

  const strategyRecommendations =
    strategyResult.rows || [];

  const recommendations = [
    ...strategyRecommendations.map(
      (item) => ({
        id: item.id,

        title:
          item.title ||
          item.recommendation ||
          "Strategy recommendation",

        detail:
          item.detail ||
          item.description ||
          item.rationale ||
          "",

        priority:
          item.priority ||
          item.risk ||
          "Medium",

        owner:
          item.owner ||
          "Strategy",

        source:
          "strategy_recommendations",

        route:
          "/strategy",

        workspace_id:
          item.workspace_id ||
          null,

        status:
          item.status ||
          "open",

        raw: item,
      })
    ),

    ...generatedRecommendations({
      kpis,
      workspaces,
      signals,
      alerts,
    }),
  ].slice(0, 20);

  const urgent =
    workspaces.filter(
      (item) =>
        [
          "Critical",
          "High",
        ].includes(
          item.risk
        )
    );

  const degraded =
    statusRows.filter(
      (item) =>
        item.status ===
        "degraded"
    );

  return {
    ok: true,

    generated_at:
      now(),

    scope: {
      firm_id:
        resolvedFirmId,

      workspace_id:
        workspaceId ||
        null,

      state,
      office,
      risk,
    },

    health,

    briefing: {
      headline:
        overall >= 80
          ? "Executive posture is operational."
          : overall >= 60
            ? "Executive posture requires focused review."
            : "Executive posture requires immediate intervention.",

      strategic_summary:
        `${workspaces.length} workspaces are unified with ` +
        `${urgent.length} high-risk campaigns, ` +
        `${num(kpis.open_tasks)} open tasks, and ` +
        `${degraded.length} degraded intelligence sources.`,

      recommended_action:
        recommendations[0]
          ?.title ||
        "Maintain executive oversight.",

      decision_window:
        urgent.length ||
        num(kpis.urgent_tasks)
          ? "Next 24 hours"
          : "Next executive review",

      confidence_percentage:
        confidence,

      source_modules:
        statusRows
          .filter(
            (item) =>
              item.ok
          )
          .map(
            (item) =>
              item.key
          ),

      degraded_sources:
        degraded.map(
          (item) =>
            item.key
        ),
    },

    kpis,

    summary: {
      total_workspaces:
        workspaces.length,

      active_workspaces:
        workspaces.filter(
          (item) =>
            String(
              item.status ||
                "active"
            ).toLowerCase() ===
            "active"
        ).length,

      critical_workspaces:
        workspaces.filter(
          (item) =>
            item.risk ===
            "Critical"
        ).length,

      high_risk_workspaces:
        urgent.length,

      stable_workspaces:
        workspaces.filter(
          (item) =>
            item.risk ===
            "Stable"
        ).length,

      total_tasks:
        tasks.length,

      open_tasks:
        tasks.filter(
          (item) =>
            normalizeStatus(
              item.status
            ) !==
            "complete"
        ).length,

      blocked_tasks:
        tasks.filter(
          (item) =>
            normalizeStatus(
              item.status
            ) ===
            "blocked"
        ).length,

      completed_tasks:
        tasks.filter(
          (item) =>
            normalizeStatus(
              item.status
            ) ===
            "complete"
        ).length,

      national_pressure_score:
        pressure,

      source_count:
        statusRows.length,

      degraded_source_count:
        degraded.length,
    },

    workspaces,

    urgent_workspaces:
      urgent.slice(0, 10),

    tasks,

    signals,

    alerts,

    recommendations,

    strategy: {
      recommendations:
        strategyRecommendations,
    },

    decision_intelligence: {
      items:
        decisionsResult.rows ||
        [],
    },

    missions:
      missionsResult.rows ||
      [],

    activity:
      activityResult.rows ||
      [],

    source_status:
      statusRows,
  };
}

