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

  const resolvedFirmId = firmId(user);

 

  if (!resolvedFirmId) {

    const error = new Error("Missing firm context");

    error.statusCode = 401;

    throw error;

  }

 

  const normalizedState = String(state || "")

    .trim()

    .toUpperCase();

 

  const normalizedOffice = String(office || "").trim();

  const normalizedRisk = String(risk || "").trim();

  const normalizedWorkspaceId = workspaceId || null;

 

  const hasScopedFilters = Boolean(

    normalizedWorkspaceId ||

      normalizedState ||

      normalizedOffice ||

      normalizedRisk

  );

 

  const workspaceParams = [resolvedFirmId];

  let workspaceWhere = "WHERE firm_id = $1";

 

  if (normalizedWorkspaceId) {

    workspaceParams.push(normalizedWorkspaceId);

    workspaceWhere += ` AND id = $${workspaceParams.length}`;

  }

 

  if (normalizedState) {

    workspaceParams.push(normalizedState);

    workspaceWhere +=

      ` AND UPPER(COALESCE(state, '')) = $${workspaceParams.length}`;

  }

 

  if (normalizedOffice) {

    workspaceParams.push(`%${normalizedOffice}%`);

    workspaceWhere +=

      ` AND COALESCE(office, '') ILIKE $${workspaceParams.length}`;

  }

 

  const taskParams = [resolvedFirmId];

  let taskWhere = "WHERE firm_id = $1";

 

  if (normalizedWorkspaceId) {

    taskParams.push(normalizedWorkspaceId);

    taskWhere +=

      ` AND workspace_id = $${taskParams.length}`;

  }

 

  if (normalizedState) {

    taskParams.push(normalizedState);

    taskWhere +=

      ` AND UPPER(COALESCE(state, '')) = $${taskParams.length}`;

  }

 

  if (normalizedOffice) {

    taskParams.push(`%${normalizedOffice}%`);

    taskWhere +=

      ` AND COALESCE(office, '') ILIKE $${taskParams.length}`;

  }

 

  const signalParams = [resolvedFirmId];

  let signalWhere = "WHERE firm_id = $1";

 

  if (normalizedWorkspaceId) {

    signalParams.push(normalizedWorkspaceId);

    signalWhere +=

      ` AND (workspace_id = $${signalParams.length} OR workspace_id IS NULL)`;

  }

 

  if (normalizedState) {

    signalParams.push(normalizedState);

    signalWhere +=

      ` AND UPPER(COALESCE(state, '')) = $${signalParams.length}`;

  }

 

  const alertParams = [resolvedFirmId];

  let alertWhere = "WHERE firm_id = $1";

 

  if (normalizedState) {

    alertParams.push(normalizedState);

    alertWhere +=

      ` AND UPPER(COALESCE(state, '')) = $${alertParams.length}`;

  }

 

  const strategyParams = [];

  let strategyWhere = "";

 

  if (normalizedState) {

    strategyParams.push(normalizedState);

    strategyWhere =

      `WHERE UPPER(COALESCE(state, '')) = $${strategyParams.length}`;

  }

 

  const activityParams = [...taskParams];

  const activityWhere = taskWhere;

 

  const unavailableSource = (key, reason) => ({

    key,

    ok: false,

    unavailable: true,

    rows: [],

    error: null,

    reason,

    checked_at: now(),

  });

 

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

    getExecutiveKpis({ user }).catch((error) => ({

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

            LOWER(COALESCE(priority, ''))

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

        ${signalWhere}

        ORDER BY

          COALESCE(signal_score, 0) DESC,

          COALESCE(updated_at, created_at) DESC

        LIMIT 100

      `,

      signalParams

    ),

 

    safeQuery(

      "notification_events",

      `

        SELECT *

        FROM notification_events

        ${alertWhere}

        ORDER BY

          COALESCE(updated_at, created_at) DESC

        LIMIT 100

      `,

      alertParams

    ),

 

    safeQuery(

      "strategy_recommendations",

      `

        SELECT *

        FROM strategy_recommendations

        ${strategyWhere}

        ORDER BY

          COALESCE(calculated_at, updated_at, created_at) DESC,

          COALESCE(strategy_score, 0) DESC

        LIMIT 100

      `,

      strategyParams

    ),

 

    Promise.resolve(

      unavailableSource(

        "decision_intelligence",

        "The decision_intelligence table is not present in the current database schema."

      )

    ),

 

    Promise.resolve(

      unavailableSource(

        "executive_ai_missions",

        "The executive_ai_missions table is not present in the current database schema."

      )

    ),

 

    safeQuery(

      "workspace_activity",

      `

        SELECT

          id,

          'task'::text AS type,

          COALESCE(title, 'Task activity') AS title,

          COALESCE(updated_at, created_at) AS activity_time,

          workspace_id,

          state,

          office,

          status,

          priority

        FROM tasks

        ${activityWhere}

        ORDER BY

          activity_time DESC

        LIMIT 100

      `,

      activityParams

    ),

  ]);

 

  const kpis = kpiData?.summary || {};

  const tasks = tasksResult.rows || [];

 

  let workspaces = workspaceRows(

    workspacesResult.rows || [],

    tasks

  );

 

  if (normalizedRisk) {

    workspaces = workspaces.filter(

      (item) =>

        String(item.risk || "").toLowerCase() ===

        normalizedRisk.toLowerCase()

    );

  }

 

  const signals = signalsResult.rows || [];

  const alerts = alertsResult.rows || [];

 

  const scopedOpenTasks = tasks.filter(

    (item) => normalizeStatus(item.status) !== "complete"

  );

 

  const scopedBlockedTasks = tasks.filter(

    (item) => normalizeStatus(item.status) === "blocked"

  );

 

  const scopedCompletedTasks = tasks.filter(

    (item) => normalizeStatus(item.status) === "complete"

  );

 

  const scopedUrgentTasks = scopedOpenTasks.filter((item) =>

    ["critical", "high"].includes(

      String(item.priority || "").toLowerCase()

    )

  );

 

  const scopedCriticalSignals = signals.filter((item) => {

    const severity = String(item.severity || "").toLowerCase();

    const riskValue = String(item.risk || "").toLowerCase();

    return (

      severity === "critical" ||

      severity === "high" ||

      riskValue === "critical" ||

      riskValue === "high"

    );

  });

 

  const scopedCriticalAlerts = alerts.filter((item) =>

    ["critical", "high"].includes(

      String(item.level || item.severity || "").toLowerCase()

    )

  );

 

  const pressure = workspaces.length

    ? Math.round(

        workspaces.reduce(

          (sum, item) => sum + num(item.pressure_score),

          0

        ) / workspaces.length

      )

    : 0;

 

  const executionScore = clamp(

    100 -

      pressure * 0.45 -

      scopedBlockedTasks.length * 3 -

      scopedUrgentTasks.length * 2

  );

 

  const unavailableStatus = (result) => ({

    key: result.key,

    ok: false,

    status: "unavailable",

    freshness: "unknown",

    last_seen: null,

    checked_at: result.checked_at,

    error: null,

    reason: result.reason || null,

  });

 

  const statusRows = [

    ...(Array.isArray(kpiData?.source_status)

      ? kpiData.source_status

      : []),

 

    sourceStatus(

      workspacesResult,

      workspacesResult.rows?.[0]?.updated_at

    ),

 

    sourceStatus(

      tasksResult,

      tasksResult.rows?.[0]?.updated_at

    ),

 

    sourceStatus(

      signalsResult,

      signalsResult.rows?.[0]?.updated_at ||

        signalsResult.rows?.[0]?.created_at

    ),

 

    sourceStatus(

      alertsResult,

      alertsResult.rows?.[0]?.updated_at ||

        alertsResult.rows?.[0]?.created_at

    ),

 

    sourceStatus(

      strategyResult,

      strategyResult.rows?.[0]?.calculated_at ||

        strategyResult.rows?.[0]?.updated_at ||

        strategyResult.rows?.[0]?.created_at

    ),

 

    decisionsResult.unavailable

      ? unavailableStatus(decisionsResult)

      : sourceStatus(

          decisionsResult,

          decisionsResult.rows?.[0]?.updated_at ||

            decisionsResult.rows?.[0]?.created_at

        ),

 

    missionsResult.unavailable

      ? unavailableStatus(missionsResult)

      : sourceStatus(

          missionsResult,

          missionsResult.rows?.[0]?.updated_at ||

            missionsResult.rows?.[0]?.created_at

        ),

 

    sourceStatus(

      activityResult,

      activityResult.rows?.[0]?.activity_time

    ),

  ].filter(

    (item, index, array) =>

      array.findIndex(

        (candidate) => candidate.key === item.key

      ) === index

  );

 

  const confidenceEligible = statusRows.filter(

    (item) => item.status !== "unavailable"

  );

 

  const available = confidenceEligible.filter(

    (item) => item.status === "available"

  ).length;

 

  const confidence = confidenceEligible.length

    ? Math.round(

        (available / confidenceEligible.length) * 100

      )

    : 0;

 

  const readiness = clamp(

    num(kpis.live_readiness) * 0.5 +

      executionScore * 0.3 +

      Math.max(0, 100 - num(kpis.national_risk)) * 0.2

  );

 

  const overall = Math.round(

    readiness * 0.4 +

      executionScore * 0.35 +

      confidence * 0.25

  );

 

  const health = {

    overall_score: overall,

    readiness_score: Math.round(readiness),

    execution_score: Math.round(executionScore),

    intelligence_confidence: confidence,

    national_risk: num(kpis.national_risk),

    pressure_score: pressure,

    status:

      overall >= 80

        ? "Operational"

        : overall >= 60

          ? "Watch"

          : "Intervention Required",

  };

 

  const strategyRecommendations = strategyResult.rows || [];

 

  const scopedRecommendationKpis = {

    ...kpis,

    urgent_tasks: scopedUrgentTasks.length,

    critical_signals: scopedCriticalSignals.length,

    critical_alerts: scopedCriticalAlerts.length,

  };

 

  const recommendations = [

    ...strategyRecommendations.map((item) => ({

      id: item.id,

      title:

        item.title ||

        item.summary ||

        "Strategy recommendation",

      detail:

        item.recommended_action ||

        item.summary ||

        item.rationale ||

        "",

      priority: item.priority || "Medium",

      owner: item.owner_role || "Strategy",

      source: "strategy_recommendations",

      route: "/strategy",

      workspace_id:

        item.command_center_payload?.workspace_id ||

        item.metadata?.workspace_id ||

        null,

      status: item.status || "open",

      raw: item,

    })),

 

    ...generatedRecommendations({

      kpis: scopedRecommendationKpis,

      workspaces,

      signals,

      alerts,

    }),

  ].slice(0, 20);

 

  const urgent = workspaces.filter((item) =>

    ["Critical", "High"].includes(item.risk)

  );

 

  const degraded = statusRows.filter(

    (item) => item.status === "degraded"

  );

 

  const unavailable = statusRows.filter(

    (item) => item.status === "unavailable"

  );

 

  const scopedSummary = {

    total_workspaces: workspaces.length,

    active_workspaces: workspaces.filter(

      (item) =>

        String(item.status || "active").toLowerCase() ===

        "active"

    ).length,

    critical_workspaces: workspaces.filter(

      (item) => item.risk === "Critical"

    ).length,

    high_risk_workspaces: urgent.length,

    stable_workspaces: workspaces.filter(

      (item) => item.risk === "Stable"

    ).length,

    total_tasks: tasks.length,

    open_tasks: scopedOpenTasks.length,

    urgent_tasks: scopedUrgentTasks.length,

    blocked_tasks: scopedBlockedTasks.length,

    completed_tasks: scopedCompletedTasks.length,

    political_signals: signals.length,

    critical_signals: scopedCriticalSignals.length,

    alerts: alerts.length,

    critical_alerts: scopedCriticalAlerts.length,

    national_pressure_score: pressure,

    source_count: statusRows.length,

    available_source_count: statusRows.filter(

      (item) => item.status === "available"

    ).length,

    degraded_source_count: degraded.length,

    unavailable_source_count: unavailable.length,

  };

 

  const firmContext = {

    scope: "firm-wide",

    total_workspaces: num(kpis.total_workspaces),

    active_workspaces: num(kpis.active_workspaces),

    total_tasks: num(kpis.total_tasks),

    open_tasks: num(kpis.open_tasks),

    urgent_tasks: num(kpis.urgent_tasks),

    blocked_tasks: num(kpis.blocked_tasks),

    total_signals: num(kpis.total_signals),

    critical_signals: num(kpis.critical_signals),

    total_alerts: num(kpis.total_alerts),

    critical_alerts: num(kpis.critical_alerts),

    national_risk: num(kpis.national_risk),

    live_readiness: num(kpis.live_readiness),

    intelligence_confidence: num(kpis.intelligence_confidence),

  };

 

  const scopeLabel = [

    normalizedState || null,

    normalizedOffice || null,

    normalizedWorkspaceId

      ? `workspace ${normalizedWorkspaceId}`

      : null,

  ]

    .filter(Boolean)

    .join(" / ") || "firm-wide";

 

  const scopedSummarySentence =

    `${scopeLabel} scope: ${workspaces.length} workspaces, ` +

    `${scopedOpenTasks.length} open tasks, ` +

    `${signals.length} political signals, and ${alerts.length} alerts.`;

 

  const firmContextSentence = hasScopedFilters

    ? ` Firm-wide context: ${num(kpis.active_workspaces)} active workspaces and ` +

      `${num(kpis.open_tasks)} open tasks.`

    : "";

 

  const sourceHealthSentence =

    ` ${degraded.length} intelligence sources are degraded` +

    `${unavailable.length ? ` and ${unavailable.length} are unavailable` : ""}.`;

 

  return {

    ok: true,

    generated_at: now(),

 

    scope: {

      firm_id: resolvedFirmId,

      workspace_id: normalizedWorkspaceId,

      state: normalizedState,

      office: normalizedOffice,

      risk: normalizedRisk,

      scope_type: hasScopedFilters ? "requested-scope" : "firm-wide",

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

        scopedSummarySentence +

        firmContextSentence +

        sourceHealthSentence,

 

      recommended_action:

        recommendations[0]?.title ||

        "Maintain executive oversight.",

 

      decision_window:

        urgent.length || scopedUrgentTasks.length

          ? "Next 24 hours"

          : "Next executive review",

 

      confidence_percentage: confidence,

 

      source_modules: statusRows

        .filter((item) => item.status === "available")

        .map((item) => item.key),

 

      degraded_sources: degraded.map((item) => item.key),

 

      unavailable_sources: unavailable.map((item) => item.key),

    },

 

    kpis,

    firm_context: firmContext,

    scoped_summary: scopedSummary,

 

    // Kept for backward compatibility. This summary is intentionally scoped

    // to the user's requested workspace/state/office filters.

    summary: scopedSummary,

 

    workspaces,

    urgent_workspaces: urgent.slice(0, 10),

    tasks,

    signals,

    alerts,

    recommendations,

 

    strategy: {

      recommendations: strategyRecommendations,

      scope_note:

        normalizedState

          ? `Strategy recommendations are filtered to ${normalizedState}.`

          : "Strategy recommendations are global because this table has no firm_id column.",

    },

 

    decision_intelligence: {

      items: [],

      status: "unavailable",

      reason: decisionsResult.reason || null,

    },

 

    missions: [],

    missions_status: {

      status: "unavailable",

      reason: missionsResult.reason || null,

    },

 

    activity: activityResult.rows || [],

    source_status: statusRows,

  };

}
