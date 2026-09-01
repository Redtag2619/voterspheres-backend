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

 

const STATE_CODE_BY_NAME = {

  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",

  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",

  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",

  KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA",

  MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT",

  NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",

  "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",

  OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",

  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX",

  UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",

  WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC", DC: "DC",

};

 

const STATE_NAME_BY_CODE = Object.fromEntries(

  Object.entries(STATE_CODE_BY_NAME).map(([name, code]) => [code, name])

);

 

function geographyValues(value = "") {

  const raw = String(value || "").trim().toUpperCase();

  if (!raw) return [];

  if (["NATIONAL", "NATIONWIDE", "US", "USA", "UNITED STATES"].includes(raw)) {

    return ["NATIONAL", "NATIONWIDE", "US", "USA", "UNITED STATES"];

  }

  const code = STATE_CODE_BY_NAME[raw] || (STATE_NAME_BY_CODE[raw] ? raw : "");

  const name = code ? STATE_NAME_BY_CODE[code] : raw;

  return [...new Set([raw, code, name].filter(Boolean))];

}

 

function isNationalGeography(value = "") {

  return geographyValues(value).some((item) =>

    ["NATIONAL", "NATIONWIDE", "US", "USA", "UNITED STATES"].includes(item)

  );

}

 

function canonicalRisk(value = "", score = null) {

  const raw = String(value || "").trim().toLowerCase();

  if (["critical", "danger", "severe", "intervention", "intervention required"].includes(raw)) return "Critical";

  if (["high", "urgent"].includes(raw)) return "High";

  if (["elevated", "medium", "moderate", "watch", "degraded"].includes(raw)) return "Elevated";

  if (["stable", "low", "normal", "operational", "available", "active"].includes(raw)) return "Stable";

  if (score !== null && score !== undefined && score !== "") return riskFromScore(score);

  return raw ? String(value) : "Stable";

}

 

function matchesRiskFilter(value, requestedRisk = "", score = null) {

  if (!requestedRisk) return true;

  return canonicalRisk(value, score).toLowerCase() === canonicalRisk(requestedRisk).toLowerCase();

}

 

function jsonWorkspaceId(item = {}) {

  return (

    item.workspace_id ||

    item.metadata?.workspace_id ||

    item.command_center_payload?.workspace_id ||

    null

  );

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

 

 

 

  let selectedWorkspace = null;

 

  if (normalizedWorkspaceId) {

    const selectedWorkspaceResult = await safeQuery(

      "selected_workspace",

      `

        SELECT *

        FROM workspaces

        WHERE firm_id = $1

          AND id = $2

        LIMIT 1

      `,

      [resolvedFirmId, normalizedWorkspaceId]

    );

 

    selectedWorkspace = selectedWorkspaceResult.rows?.[0] || null;

 

    if (!selectedWorkspace) {

      const error = new Error("Selected workspace was not found for this firm.");

      error.statusCode = 404;

      throw error;

    }

  }

 

  const contextualState = normalizedState || String(selectedWorkspace?.state || "").trim();

  const contextualOffice = normalizedOffice || String(selectedWorkspace?.office || "").trim();

  const stateValues = geographyValues(contextualState);

  const nationalContext = isNationalGeography(contextualState);

 

  const workspaceParams = [resolvedFirmId];

  let workspaceWhere = "WHERE firm_id = $1";

 

  if (normalizedWorkspaceId) {

    workspaceParams.push(normalizedWorkspaceId);

    workspaceWhere += ` AND id = $${workspaceParams.length}`;

  } else {

    if (normalizedState) {

      workspaceParams.push(geographyValues(normalizedState));

      workspaceWhere += ` AND UPPER(TRIM(COALESCE(state, ''))) = ANY($${workspaceParams.length}::text[])`;

    }

 

    if (normalizedOffice) {

      workspaceParams.push(`%${normalizedOffice}%`);

      workspaceWhere += ` AND COALESCE(office, '') ILIKE $${workspaceParams.length}`;

    }

  }

 

  const taskParams = [resolvedFirmId];

  let taskWhere = "WHERE firm_id = $1";

 

  if (normalizedWorkspaceId) {

    taskParams.push(normalizedWorkspaceId);

    taskWhere += ` AND workspace_id = $${taskParams.length}`;

  } else {

    if (normalizedState) {

      taskParams.push(geographyValues(normalizedState));

      taskWhere += ` AND UPPER(TRIM(COALESCE(state, ''))) = ANY($${taskParams.length}::text[])`;

    }

 

    if (normalizedOffice) {

      taskParams.push(`%${normalizedOffice}%`);

      taskWhere += ` AND COALESCE(office, '') ILIKE $${taskParams.length}`;

    }

  }

 

  const signalParams = [resolvedFirmId];

  let signalWhere = "WHERE firm_id = $1";

 

  if (normalizedWorkspaceId) {

    signalParams.push(String(normalizedWorkspaceId));

    const workspaceParam = signalParams.length;

 

    if (stateValues.length) {

      signalParams.push(stateValues);

      const stateParam = signalParams.length;

      signalWhere += nationalContext

        ? ` AND (workspace_id::text = $${workspaceParam} OR (workspace_id IS NULL AND (NULLIF(TRIM(state), '') IS NULL OR UPPER(TRIM(state)) = ANY($${stateParam}::text[]))))`

        : ` AND (workspace_id::text = $${workspaceParam} OR (workspace_id IS NULL AND UPPER(TRIM(COALESCE(state, ''))) = ANY($${stateParam}::text[])))`;

    } else {

      signalWhere += ` AND workspace_id::text = $${workspaceParam}`;

    }

  } else if (normalizedState) {

    signalParams.push(geographyValues(normalizedState));

    signalWhere += ` AND UPPER(TRIM(COALESCE(state, ''))) = ANY($${signalParams.length}::text[])`;

  }

 

  const alertParams = [resolvedFirmId];

  let alertWhere = "WHERE firm_id = $1";

 

  if (normalizedWorkspaceId) {

    alertParams.push(String(normalizedWorkspaceId));

    const workspaceParam = alertParams.length;

 

    if (stateValues.length) {

      alertParams.push(stateValues);

      const stateParam = alertParams.length;

      alertWhere += nationalContext

        ? ` AND (COALESCE(metadata->>'workspace_id', '') = $${workspaceParam} OR ((metadata->>'workspace_id') IS NULL AND (NULLIF(TRIM(state), '') IS NULL OR UPPER(TRIM(state)) = ANY($${stateParam}::text[]))))`

        : ` AND (COALESCE(metadata->>'workspace_id', '') = $${workspaceParam} OR ((metadata->>'workspace_id') IS NULL AND UPPER(TRIM(COALESCE(state, ''))) = ANY($${stateParam}::text[])))`;

    } else {

      alertWhere += ` AND COALESCE(metadata->>'workspace_id', '') = $${workspaceParam}`;

    }

  } else if (normalizedState) {

    alertParams.push(geographyValues(normalizedState));

    alertWhere += ` AND UPPER(TRIM(COALESCE(state, ''))) = ANY($${alertParams.length}::text[])`;

  }

 

  const strategyParams = [];

  let strategyWhere = "";

 

  if (normalizedWorkspaceId) {

    strategyParams.push(String(normalizedWorkspaceId));

    const workspaceParam = strategyParams.length;

    const directWorkspaceSql = `(COALESCE(command_center_payload->>'workspace_id', metadata->>'workspace_id', '') = $${workspaceParam})`;

    const unassignedSql = `(COALESCE(command_center_payload->>'workspace_id', metadata->>'workspace_id', '') = '')`;

 

    if (stateValues.length) {

      strategyParams.push(stateValues);

      const stateParam = strategyParams.length;

      strategyWhere = nationalContext

        ? `WHERE (${directWorkspaceSql} OR (${unassignedSql} AND (NULLIF(TRIM(state), '') IS NULL OR UPPER(TRIM(state)) = ANY($${stateParam}::text[]))))`

        : `WHERE (${directWorkspaceSql} OR (${unassignedSql} AND UPPER(TRIM(COALESCE(state, ''))) = ANY($${stateParam}::text[])))`;

    } else {

      strategyWhere = `WHERE ${directWorkspaceSql}`;

    }

  } else if (normalizedState) {

    strategyParams.push(geographyValues(normalizedState));

    strategyWhere = `WHERE UPPER(TRIM(COALESCE(state, ''))) = ANY($${strategyParams.length}::text[])`;

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

 

        LIMIT 500

 

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

 

        LIMIT 500

 

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

 

        LIMIT 250

 

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

 

 

 

  // Risk is a finding/recommendation filter, not a workspace-identity filter.

  // A selected workspace must remain visible even when no intelligence matches

  // the requested risk level.

 

  const signals = (signalsResult.rows || []).filter((item) =>

    matchesRiskFilter(

      item.severity || item.risk,

      normalizedRisk,

      item.signal_score

    )

  );

 

  const alerts = (alertsResult.rows || []).filter((item) =>

    matchesRiskFilter(

      item.level || item.severity || item.metadata?.risk || item.metadata?.priority,

      normalizedRisk,

      item.metadata?.risk_score || item.metadata?.score

    )

  );

 

 

 

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

 

 

 

  const strategyRecommendations = (strategyResult.rows || []).filter((item) =>

    matchesRiskFilter(

      item.priority || item.metadata?.priority || item.metadata?.risk,

      normalizedRisk,

      null

    )

  );

 

 

 

  const scopedRecommendationKpis = {

 

    ...kpis,

 

    urgent_tasks: scopedUrgentTasks.length,

 

    critical_signals: scopedCriticalSignals.length,

 

    critical_alerts: scopedCriticalAlerts.length,

 

  };

 

 

 

  const recommendationCandidates = [

 

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

 

      workspace_id: jsonWorkspaceId(item),

 

      status: item.status || "open",

 

      raw: item,

 

    })),

 

 

 

    ...generatedRecommendations({

 

      kpis: scopedRecommendationKpis,

 

      workspaces,

 

      signals,

 

      alerts,

 

    }),

 

  ];

 

  const recommendations = recommendationCandidates

    .filter((item) => matchesRiskFilter(item.priority, normalizedRisk, null))

    .slice(0, 20);

 

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

    selectedWorkspace?.name || null,

    normalizedState || (!normalizedWorkspaceId ? contextualState : null),

    normalizedOffice || null,

    normalizedRisk ? `${canonicalRisk(normalizedRisk)} risk` : null,

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

      workspace_name: selectedWorkspace?.name || null,

      workspace_state: selectedWorkspace?.state || null,

      workspace_office: selectedWorkspace?.office || null,

      workspace_cycle: selectedWorkspace?.cycle || null,

      state: normalizedState,

      effective_state: contextualState || null,

      office: normalizedOffice,

      effective_office: contextualOffice || null,

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

 

      scope_note: normalizedWorkspaceId

        ? `Strategy recommendations are scoped to ${selectedWorkspace?.name || `workspace ${normalizedWorkspaceId}`} using direct workspace metadata plus matching geographic context.`

        : normalizedState

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
