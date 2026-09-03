import { pool } from "../db/pool.js";

 

 

 

/* ============================================================================

 

 * Executive Mission Control

 

 * Build 6 Mission Operations Backend

 

 *

 

 * Responsibilities:

 

 * - Build the executive operating picture for a firm

 

 * - Rank next-24-hour mission interventions

 

 * - Calculate weighted mission pressure

 

 * - Calculate complete workspace risk

 

 * - Surface structured executive recommendations

 

 * - Preserve authoritative system ownership

 

 * - Degrade gracefully when an individual source is unavailable

 

 *

 

 * Backward-compatible response fields:

 

 * - summary

 

 * - mission_items

 

 * - critical_signals

 

 * - open_tasks

 

 * - rapid_responses

 

 * - crm_followups

 

 * - workspace_health

 

 * - vendor_gaps

 

 * - ai_recommendations

 

 * - updated_at

 

 * ========================================================================== */

 

 

 

const SOURCE_ROW_LIMIT = 100;

 

 

 

const RETURN_LIMITS = {

 

  mission_items: 24,

 

  critical_signals: 15,

 

  open_tasks: 20,

 

  rapid_responses: 12,

 

  crm_followups: 12,

 

  workspace_health: 50,

 

  vendor_gaps: 12,

 

  ai_recommendations: 6,

 

};

 

 

 

/* ============================================================================

 

 * General helpers

 

 * ========================================================================== */

 

 

 

function getFirmId(user = {}) {

 

  return (

 

    user.firmId ||

 

    user.firm_id ||

 

    user.firm?.id ||

 

    null

 

  );

 

}

 

 

 

function rows(result) {

 

  return Array.isArray(result?.rows) ? result.rows : [];

 

}

 

 

 

function number(value = 0) {

 

  const parsed = Number(value);

 

  return Number.isFinite(parsed) ? parsed : 0;

 

}

 

 

 

function integer(value = 0) {

 

  return Math.max(0, Math.round(number(value)));

 

}

 

 

 

function clamp(value, min = 0, max = 100) {

 

  return Math.min(max, Math.max(min, number(value)));

 

}

 

 

 

function lower(value = "") {

 

  return String(value ?? "").trim().toLowerCase();

 

}

 

 

 

function clean(value = "", fallback = "") {

 

  const normalized = String(value ?? "")

 

    .replace(/\s+/g, " ")

 

    .trim();

 

 

 

  return normalized || fallback;

 

}

 

 

 

function isClosedStatus(value = "") {

 

  return [

 

    "complete",

 

    "completed",

 

    "done",

 

    "resolved",

 

    "closed",

 

    "cancelled",

 

    "canceled",

 

  ].includes(lower(value));

 

}

 

 

 

function riskTone(score = 0) {

 

  const normalized = clamp(score);

 

 

 

  if (normalized >= 85) return "Critical";

 

  if (normalized >= 65) return "High";

 

  if (normalized >= 42) return "Elevated";

 

  return "Stable";

 

}

 

 

 

function priorityWeight(value = "") {

 

  const normalized = lower(value);

 

 

 

  if (

 

    normalized.includes("critical") ||

 

    normalized.includes("urgent") ||

 

    normalized.includes("severe")

 

  ) {

 

    return 100;

 

  }

 

 

 

  if (normalized.includes("high")) {

 

    return 80;

 

  }

 

 

 

  if (

 

    normalized.includes("elevated") ||

 

    normalized.includes("watch")

 

  ) {

 

    return 60;

 

  }

 

 

 

  if (normalized.includes("medium")) {

 

    return 40;

 

  }

 

 

 

  if (normalized.includes("low")) {

 

    return 20;

 

  }

 

 

 

  return 10;

 

}

 

 

 

function confidenceScore(value, fallback = 75) {

 

  const parsed = Number(value);

 

 

 

  if (!Number.isFinite(parsed)) {

 

    return fallback;

 

  }

 

 

 

  /*

 

   * Support both 0-1 and 0-100 confidence representations.

 

   */

 

  if (parsed >= 0 && parsed <= 1) {

 

    return Math.round(parsed * 100);

 

  }

 

 

 

  return Math.round(clamp(parsed));

 

}

 

 

 

function normalizeScore(value, fallback = 0) {

 

  const parsed = Number(value);

 

 

 

  if (!Number.isFinite(parsed)) {

 

    return clamp(fallback);

 

  }

 

 

 

  return clamp(parsed);

 

}

 

 

 

/* ============================================================================

 

 * Source health

 

 * ========================================================================== */

 

 

 

function sourceHealthEntry({

 

  ok = true,

 

  rowsReturned = 0,

 

  error = null,

 

} = {}) {

 

  return {

 

    status: ok ? "ok" : "unavailable",

 

    available: Boolean(ok),

 

    rows_returned: integer(rowsReturned),

 

    error: error ? clean(error) : null,

 

  };

 

}

 

 

 

async function querySource({

 

  name,

 

  sql,

 

  params = [],

 

}) {

 

  try {

 

    const result = await pool.query(sql, params);

 

    const resultRows = rows(result);

 

 

 

    return {

 

      name,

 

      ok: true,

 

      rows: resultRows,

 

      error: null,

 

      health: sourceHealthEntry({

 

        ok: true,

 

        rowsReturned: resultRows.length,

 

      }),

 

    };

 

  } catch (error) {

 

    console.warn(

 

      `[mission-control] ${name} query unavailable:`,

 

      error?.message || error

 

    );

 

 

 

    return {

 

      name,

 

      ok: false,

 

      rows: [],

 

      error: error?.message || String(error),

 

      health: sourceHealthEntry({

 

        ok: false,

 

        rowsReturned: 0,

 

        error: error?.message || String(error),

 

      }),

 

    };

 

  }

 

}

 

 

 

/* ============================================================================

 

 * Source-specific scoring

 

 * ========================================================================== */

 

 

 

function signalMissionScore(signal = {}) {

 

  const signalScore = normalizeScore(signal.signal_score);

 

  const severityScore = priorityWeight(

 

    signal.risk || signal.severity

 

  );

 

 

 

  /*

 

   * Signal score remains important, but severity classification

 

   * prevents raw volume or weak signals from dominating.

 

   */

 

  return Math.round(

 

    clamp(

 

      signalScore * 0.58 +

 

        severityScore * 0.42

 

    )

 

  );

 

}

 

 

 

function taskMissionScore(task = {}) {

 

  const priorityScore = priorityWeight(task.priority);

 

  const status = lower(task.status);

 

 

 

  let statusPressure = 20;

 

 

 

  if (

 

    status.includes("blocked") ||

 

    status.includes("overdue")

 

  ) {

 

    statusPressure = 100;

 

  } else if (

 

    status.includes("progress") ||

 

    status.includes("active")

 

  ) {

 

    statusPressure = 55;

 

  } else if (

 

    status.includes("open") ||

 

    status.includes("pending")

 

  ) {

 

    statusPressure = 45;

 

  }

 

 

 

  return Math.round(

 

    clamp(

 

      priorityScore * 0.75 +

 

        statusPressure * 0.25

 

    )

 

  );

 

}

 

 

 

function responseMissionScore(response = {}) {

 

  const threatScore = priorityWeight(

 

    response.threat_level ||

 

      response.priority ||

 

      response.status

 

  );

 

 

 

  const explicitScore =

 

    response.threat_score ??

 

    response.risk_score ??

 

    response.score;

 

 

 

  if (

 

    explicitScore !== undefined &&

 

    explicitScore !== null &&

 

    explicitScore !== ""

 

  ) {

 

    return Math.round(

 

      clamp(

 

        normalizeScore(explicitScore) * 0.65 +

 

          threatScore * 0.35

 

      )

 

    );

 

  }

 

 

 

  return Math.round(clamp(threatScore));

 

}

 

 

 

function crmMissionScore(activity = {}) {

 

  const explicitPriority =

 

    activity.priority ||

 

    activity.urgency ||

 

    activity.status;

 

 

 

  if (explicitPriority) {

 

    return Math.round(

 

      clamp(priorityWeight(explicitPriority))

 

    );

 

  }

 

 

 

  return 40;

 

}

 

 

 

function vendorMissionScore(vendor = {}) {

 

  const status = lower(vendor.status);

 

  const coverageArea = lower(vendor.coverage_area);

 

  const notes = lower(vendor.notes);

 

 

 

  if (

 

    status.includes("critical") ||

 

    status.includes("unavailable") ||

 

    notes.includes("critical")

 

  ) {

 

    return 90;

 

  }

 

 

 

  if (

 

    status.includes("high") ||

 

    status.includes("gap") ||

 

    notes.includes("capacity gap")

 

  ) {

 

    return 75;

 

  }

 

 

 

  if (

 

    status.includes("risk") ||

 

    status.includes("thin") ||

 

    status.includes("limited") ||

 

    coverageArea.includes("thin") ||

 

    coverageArea.includes("limited")

 

  ) {

 

    return 60;

 

  }

 

 

 

  return 45;

 

}

 

 

 

/* ============================================================================

 

 * Mission item sorting

 

 * ========================================================================== */

 

 

 

function missionItemTimestamp(item = {}) {

 

  const value =

 

    item.created_at ||

 

    item.updated_at ||

 

    item.observed_at;

 

 

 

  const timestamp = value

 

    ? new Date(value).getTime()

 

    : 0;

 

 

 

  return Number.isFinite(timestamp)

 

    ? timestamp

 

    : 0;

 

}

 

 

 

function compareMissionItems(a = {}, b = {}) {

 

  const scoreDiff =

 

    number(b.mission_score) -

 

    number(a.mission_score);

 

 

 

  if (scoreDiff !== 0) {

 

    return scoreDiff;

 

  }

 

 

 

  const urgencyDiff =

 

    number(b.urgency_score) -

 

    number(a.urgency_score);

 

 

 

  if (urgencyDiff !== 0) {

 

    return urgencyDiff;

 

  }

 

 

 

  const priorityDiff =

 

    priorityWeight(b.priority) -

 

    priorityWeight(a.priority);

 

 

 

  if (priorityDiff !== 0) {

 

    return priorityDiff;

 

  }

 

 

 

  const confidenceDiff =

 

    number(b.confidence_score) -

 

    number(a.confidence_score);

 

 

 

  if (confidenceDiff !== 0) {

 

    return confidenceDiff;

 

  }

 

 

 

  return (

 

    missionItemTimestamp(b) -

 

    missionItemTimestamp(a)

 

  );

 

}

 

 

 

/* ============================================================================

 

 * Executive pressure calculation

 

 * ========================================================================== */

 

 

 

function saturation(count, target) {

 

  if (!target || target <= 0) {

 

    return 0;

 

  }

 

 

 

  return clamp((number(count) / target) * 100);

 

}

 

 

 

function calculateExecutivePressure({

 

  signalMetrics = {},

 

  taskMetrics = {},

 

  responseMetrics = {},

 

  crmMetrics = {},

 

  vendorMetrics = {},

 

  workspaceMetrics = {},

 

}) {

 

  /*

 

   * Political intelligence pressure: 30%

 

   *

 

   * Severity matters more than simple record count.

 

   */

 

  const signalSeverity =

 

    saturation(signalMetrics.critical_count, 4) * 0.45 +

 

    saturation(signalMetrics.high_count, 8) * 0.3 +

 

    saturation(signalMetrics.elevated_count, 15) * 0.15 +

 

    normalizeScore(signalMetrics.max_signal_score) * 0.1;

 

 

 

  /*

 

   * Execution pressure: 22%

 

   */

 

  const taskPressure =

 

    saturation(taskMetrics.critical_open, 5) * 0.45 +

 

    saturation(taskMetrics.high_open, 12) * 0.35 +

 

    saturation(taskMetrics.medium_open, 25) * 0.2;

 

 

 

  /*

 

   * Narrative / rapid-response pressure: 17%

 

   */

 

  const responsePressure =

 

    saturation(responseMetrics.critical_open, 3) * 0.5 +

 

    saturation(responseMetrics.high_open, 6) * 0.3 +

 

    saturation(responseMetrics.open_count, 12) * 0.2;

 

 

 

  /*

 

   * Workspace-level operating risk: 16%

 

   */

 

  const workspacePressure =

 

    saturation(workspaceMetrics.critical_count, 3) * 0.5 +

 

    saturation(workspaceMetrics.high_count, 6) * 0.3 +

 

    saturation(workspaceMetrics.elevated_count, 12) * 0.2;

 

 

 

  /*

 

   * Vendor readiness pressure: 8%

 

   */

 

  const vendorPressure =

 

    saturation(vendorMetrics.gap_count, 10);

 

 

 

  /*

 

   * Stakeholder follow-up pressure: 7%

 

   */

 

  const crmPressure =

 

    saturation(crmMetrics.open_followups, 25);

 

 

 

  const weighted =

 

    signalSeverity * 0.3 +

 

    taskPressure * 0.22 +

 

    responsePressure * 0.17 +

 

    workspacePressure * 0.16 +

 

    vendorPressure * 0.08 +

 

    crmPressure * 0.07;

 

 

 

  return {

 

    pressure_score: Math.round(clamp(weighted)),

 

 

 

    components: {

 

      political_signals: Math.round(

 

        clamp(signalSeverity)

 

      ),

 

      execution: Math.round(

 

        clamp(taskPressure)

 

      ),

 

      rapid_response: Math.round(

 

        clamp(responsePressure)

 

      ),

 

      workspace_risk: Math.round(

 

        clamp(workspacePressure)

 

      ),

 

      vendor_capacity: Math.round(

 

        clamp(vendorPressure)

 

      ),

 

      crm_followups: Math.round(

 

        clamp(crmPressure)

 

      ),

 

    },

 

  };

 

}

 

 

 

/* ============================================================================

 

 * Structured executive recommendations

 

 * ========================================================================== */

 

 

 

function buildExecutiveRecommendations({

 

  pressureScore,

 

  missionRisk,

 

  totals,

 

  pressureComponents,

 

  sourceHealth,

 

}) {

 

  const recommendations = [];

 

 

 

  const add = ({

 

    id,

 

    title,

 

    recommendation,

 

    rationale,

 

    priority,

 

    type = "Strategy Recommendation",

 

    missionScore,

 

    confidence = 88,

 

    source = "Executive Mission Control",

 

  }) => {

 

    recommendations.push({

 

      id,

 

      type,

 

      title,

 

      recommendation,

 

      description: recommendation,

 

      rationale,

 

      priority,

 

      mission_score: Math.round(

 

        clamp(missionScore)

 

      ),

 

      priority_score: priorityWeight(priority),

 

      urgency_score: Math.round(

 

        clamp(missionScore)

 

      ),

 

      confidence_score: confidenceScore(

 

        confidence

 

      ),

 

      source,

 

    });

 

  };

 

 

 

  if (totals.critical_signals > 0) {

 

    add({

 

      id: "signal-response-ownership",

 

      title: "Assign rapid-response ownership",

 

      recommendation:

 

        "Critical political signals are active. Assign response ownership and establish the next decision checkpoint before the next news cycle.",

 

      rationale: `${totals.critical_signals} critical political signal${

 

        totals.critical_signals === 1 ? "" : "s"

 

      } currently require executive attention.`,

 

      priority: "Critical",

 

      missionScore: Math.max(

 

        88,

 

        pressureComponents.political_signals

 

      ),

 

      confidence: 94,

 

      source: "Political Signals",

 

    });

 

  } else if (

 

    totals.high_signals > 0 ||

 

    totals.elevated_signals > 0

 

  ) {

 

    add({

 

      id: "signal-monitoring-posture",

 

      title: "Maintain elevated signal watch",

 

      recommendation:

 

        "Political signals are elevated but below critical posture. Confirm monitoring ownership and escalation thresholds.",

 

      rationale: `${totals.high_signals} high and ${totals.elevated_signals} elevated signals are active.`,

 

      priority:

 

        totals.high_signals > 0

 

          ? "High"

 

          : "Elevated",

 

      missionScore: Math.max(

 

        60,

 

        pressureComponents.political_signals

 

      ),

 

      confidence: 90,

 

      source: "Political Signals",

 

    });

 

  }

 

 

 

  if (

 

    totals.critical_open_tasks > 0 ||

 

    totals.high_open_tasks > 0

 

  ) {

 

    add({

 

      id: "execution-priority",

 

      title: "Clear high-priority execution backlog",

 

      recommendation:

 

        "Prioritize critical and high execution tasks for owner assignment, blocker removal, and completion during the next 24 hours.",

 

      rationale: `${totals.critical_open_tasks} critical and ${totals.high_open_tasks} high-priority open tasks remain.`,

 

      priority:

 

        totals.critical_open_tasks > 0

 

          ? "Critical"

 

          : "High",

 

      missionScore: Math.max(

 

        72,

 

        pressureComponents.execution

 

      ),

 

      confidence: 93,

 

      source: "Command Center",

 

    });

 

  }

 

 

 

  if (totals.open_rapid_responses > 0) {

 

    add({

 

      id: "rapid-response-readiness",

 

      title: "Close active narrative-response gaps",

 

      recommendation:

 

        "Review active rapid-response work, confirm message approval authority, and assign completion responsibility.",

 

      rationale: `${totals.open_rapid_responses} rapid-response workflow${

 

        totals.open_rapid_responses === 1

 

          ? " is"

 

          : "s are"

 

      } still open.`,

 

      priority:

 

        totals.critical_rapid_responses > 0

 

          ? "Critical"

 

          : totals.high_rapid_responses > 0

 

            ? "High"

 

            : "Elevated",

 

      missionScore: Math.max(

 

        58,

 

        pressureComponents.rapid_response

 

      ),

 

      confidence: 90,

 

      source: "Narrative Rapid Response",

 

    });

 

  }

 

 

 

  if (totals.at_risk_workspaces > 0) {

 

    add({

 

      id: "workspace-risk-review",

 

      title: "Review at-risk campaign workspaces",

 

      recommendation:

 

        "Review the highest-pressure workspaces and confirm that each material risk has an accountable owner and operating response.",

 

      rationale: `${totals.at_risk_workspaces} workspace${

 

        totals.at_risk_workspaces === 1

 

          ? " is"

 

          : "s are"

 

      } currently rated Elevated, High, or Critical.`,

 

      priority:

 

        totals.critical_workspaces > 0

 

          ? "Critical"

 

          : totals.high_workspaces > 0

 

            ? "High"

 

            : "Elevated",

 

      missionScore: Math.max(

 

        60,

 

        pressureComponents.workspace_risk

 

      ),

 

      confidence: 91,

 

      source: "Executive Mission Control",

 

    });

 

  }

 

 

 

  if (totals.vendor_gaps > 0) {

 

    add({

 

      id: "vendor-capacity-review",

 

      title: "Resolve vendor capacity gaps",

 

      recommendation:

 

        "Review vendor coverage before committing additional field, mail, digital, research, or communications activity.",

 

      rationale: `${totals.vendor_gaps} vendor coverage gap${

 

        totals.vendor_gaps === 1 ? "" : "s"

 

      } currently require review.`,

 

      priority:

 

        totals.vendor_gaps >= 5

 

          ? "High"

 

          : "Elevated",

 

      missionScore: Math.max(

 

        50,

 

        pressureComponents.vendor_capacity

 

      ),

 

      confidence: 87,

 

      source: "Vendor Network",

 

    });

 

  }

 

 

 

  if (totals.crm_followups > 0) {

 

    add({

 

      id: "crm-followup-review",

 

      title: "Complete stakeholder follow-ups",

 

      recommendation:

 

        "Close outstanding stakeholder follow-ups before initiating avoidable new outreach and ensure relationship commitments have accountable owners.",

 

      rationale: `${totals.crm_followups} CRM follow-up${

 

        totals.crm_followups === 1 ? "" : "s"

 

      } remain open.`,

 

      priority:

 

        totals.crm_followups >= 20

 

          ? "High"

 

          : "Elevated",

 

      missionScore: Math.max(

 

        45,

 

        pressureComponents.crm_followups

 

      ),

 

      confidence: 86,

 

      source: "Campaign CRM",

 

    });

 

  }

 

 

 

  const unavailableSources = Object.entries(

 

    sourceHealth

 

  )

 

    .filter(

 

      ([, value]) =>

 

        value?.status === "unavailable"

 

    )

 

    .map(([name]) => name);

 

 

 

  if (unavailableSources.length > 0) {

 

    add({

 

      id: "source-coverage-degraded",

 

      title: "Restore degraded intelligence coverage",

 

      recommendation:

 

        "One or more Mission Control data sources are unavailable. Restore source coverage before treating the operating picture as complete.",

 

      rationale: `Unavailable sources: ${unavailableSources.join(

 

        ", "

 

      )}.`,

 

      priority: "High",

 

      missionScore: 82,

 

      confidence: 100,

 

      source: "Mission Control Source Health",

 

    });

 

  }

 

 

 

  if (

 

    recommendations.length === 0 &&

 

    pressureScore < 42

 

  ) {

 

    add({

 

      id: "stable-operating-posture",

 

      title: "Maintain current operating cadence",

 

      recommendation:

 

        "No material cross-system exception currently requires executive intervention. Maintain monitoring and normal operating cadence.",

 

      rationale: `Mission pressure is ${pressureScore}% with a ${missionRisk} posture.`,

 

      priority: "Stable",

 

      missionScore: Math.max(

 

        10,

 

        pressureScore

 

      ),

 

      confidence: 92,

 

    });

 

  }

 

 

 

  return recommendations

 

    .sort(compareMissionItems)

 

    .slice(

 

      0,

 

      RETURN_LIMITS.ai_recommendations

 

    );

 

}

 

 

 

/* ============================================================================

 

 * Main service

 

 * ========================================================================== */

 

 

 

export async function getExecutiveMissionControl({

 

  user = {},

 

}) {

 

  const firmId = getFirmId(user);

 

 

 

  if (!firmId) {

 

    throw new Error("Missing firm context.");

 

  }

 

 

 

  /* ==========================================================================

 

   * Operational source records

 

   * ======================================================================== */

 

 

 

  const [

 

    signalsSource,

 

    tasksSource,

 

    workspacesSource,

 

    crmContactsSource,

 

    crmActivitiesSource,

 

    rapidResponsesSource,

 

    vendorsSource,

 

  ] = await Promise.all([

 

    querySource({

 

      name: "political_signals",

 

      sql: `

 

        SELECT *

 

        FROM political_signals

 

        WHERE firm_id = $1

 

        ORDER BY

 

          signal_score DESC NULLS LAST,

 

          observed_at DESC NULLS LAST,

 

          created_at DESC NULLS LAST

 

        LIMIT $2

 

      `,

 

      params: [firmId, SOURCE_ROW_LIMIT],

 

    }),

 

 

 

    querySource({

 

      name: "tasks",

 

      sql: `

 

        SELECT *

 

        FROM tasks

 

        WHERE firm_id = $1

 

        ORDER BY

 

          CASE

 

            WHEN LOWER(COALESCE(priority, '')) = 'critical' THEN 1

 

            WHEN LOWER(COALESCE(priority, '')) = 'high' THEN 2

 

            WHEN LOWER(COALESCE(priority, '')) = 'elevated' THEN 3

 

            WHEN LOWER(COALESCE(priority, '')) = 'medium' THEN 4

 

            ELSE 5

 

          END,

 

          updated_at DESC NULLS LAST,

 

          created_at DESC NULLS LAST

 

        LIMIT $2

 

      `,

 

      params: [firmId, SOURCE_ROW_LIMIT],

 

    }),

 

 

 

    querySource({

 

      name: "workspaces",

 

      sql: `

 

        SELECT *

 

        FROM workspaces

 

        WHERE firm_id = $1

 

          AND LOWER(COALESCE(status, 'active')) = 'active'

 

        ORDER BY

 

          updated_at DESC NULLS LAST,

 

          created_at DESC NULLS LAST

 

      `,

 

      params: [firmId],

 

    }),

 

 

 

    querySource({

 

      name: "campaign_crm_contacts",

 

      sql: `

 

        SELECT *

 

        FROM campaign_crm_contacts

 

        WHERE firm_id = $1

 

        ORDER BY updated_at DESC NULLS LAST

 

        LIMIT $2

 

      `,

 

      params: [firmId, SOURCE_ROW_LIMIT],

 

    }),

 

 

 

    querySource({

 

      name: "campaign_crm_activities",

 

      sql: `

 

        SELECT

 

          a.*,

 

          c.full_name AS contact_name

 

        FROM campaign_crm_activities a

 

        LEFT JOIN campaign_crm_contacts c

 

          ON c.id = a.contact_id

 

        WHERE a.firm_id = $1

 

        ORDER BY a.created_at DESC

 

        LIMIT $2

 

      `,

 

      params: [firmId, SOURCE_ROW_LIMIT],

 

    }),

 

 

 

    querySource({

 

      name: "narrative_rapid_responses",

 

      sql: `

 

        SELECT *

 

        FROM narrative_rapid_responses

 

        WHERE firm_id = $1

 

        ORDER BY

 

          updated_at DESC NULLS LAST,

 

          created_at DESC NULLS LAST

 

        LIMIT $2

 

      `,

 

      params: [firmId, SOURCE_ROW_LIMIT],

 

    }),

 

 

 

    querySource({

 

      name: "vendors",

 

      sql: `

 

        SELECT *

 

        FROM vendors

 

        ORDER BY

 

          updated_at DESC NULLS LAST,

 

          created_at DESC NULLS LAST

 

        LIMIT $1

 

      `,

 

      params: [SOURCE_ROW_LIMIT],

 

    }),

 

  ]);

 

 

 

  const signals = signalsSource.rows;

 

  const tasks = tasksSource.rows;

 

  const workspaces = workspacesSource.rows;

 

  const crmContacts = crmContactsSource.rows;

 

  const crmActivities = crmActivitiesSource.rows;

 

  const rapidResponses =

 

    rapidResponsesSource.rows;

 

  const vendors = vendorsSource.rows;

 

 

 

  /*

 

   * crmContacts is intentionally retained as a source-health dependency.

 

   * Mission Control currently consumes activity records rather than exposing

 

   * the contact collection directly.

 

   */

 

  void crmContacts;

 

 

 

  /* ==========================================================================

 

   * Authoritative aggregate queries

 

   *

 

   * These queries are not presentation-limited.

 

   * ======================================================================== */

 

 

 

  const [

 

    signalMetricsSource,

 

    taskMetricsSource,

 

    responseMetricsSource,

 

    crmMetricsSource,

 

    vendorMetricsSource,

 

  ] = await Promise.all([

 

    querySource({

 

      name: "political_signal_metrics",

 

      sql: `

 

        SELECT

 

          COUNT(*)::int AS total_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(risk, severity, '')

 

            ) = 'critical'

 

          )::int AS critical_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(risk, severity, '')

 

            ) = 'high'

 

          )::int AS high_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(risk, severity, '')

 

            ) = 'elevated'

 

          )::int AS elevated_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(risk, severity, '')

 

              ) IN (

 

                'critical',

 

                'high'

 

              )

 

              OR COALESCE(signal_score, 0) >= 60

 

          )::int AS material_count,

 

 

 

          COALESCE(

 

            AVG(signal_score),

 

            0

 

          )::float AS avg_signal_score,

 

 

 

          COALESCE(

 

            MAX(signal_score),

 

            0

 

          )::float AS max_signal_score

 

 

 

        FROM political_signals

 

        WHERE firm_id = $1

 

      `,

 

      params: [firmId],

 

    }),

 

 

 

    querySource({

 

      name: "task_metrics",

 

      sql: `

 

        SELECT

 

          COUNT(*)::int AS total_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(status, '')

 

            ) NOT IN (

 

              'complete',

 

              'completed',

 

              'done',

 

              'resolved',

 

              'closed',

 

              'cancelled',

 

              'canceled'

 

            )

 

          )::int AS open_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(status, '')

 

              ) NOT IN (

 

                'complete',

 

                'completed',

 

                'done',

 

                'resolved',

 

                'closed',

 

                'cancelled',

 

                'canceled'

 

              )

 

              AND LOWER(

 

                COALESCE(priority, '')

 

              ) = 'critical'

 

          )::int AS critical_open,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(status, '')

 

              ) NOT IN (

 

                'complete',

 

                'completed',

 

                'done',

 

                'resolved',

 

                'closed',

 

                'cancelled',

 

                'canceled'

 

              )

 

              AND LOWER(

 

                COALESCE(priority, '')

 

              ) = 'high'

 

          )::int AS high_open,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(status, '')

 

              ) NOT IN (

 

                'complete',

 

                'completed',

 

                'done',

 

                'resolved',

 

                'closed',

 

                'cancelled',

 

                'canceled'

 

              )

 

              AND LOWER(

 

                COALESCE(priority, '')

 

              ) IN (

 

                'medium',

 

                'elevated'

 

              )

 

          )::int AS medium_open

 

 

 

        FROM tasks

 

        WHERE firm_id = $1

 

      `,

 

      params: [firmId],

 

    }),

 

 

 

    querySource({

 

      name: "rapid_response_metrics",

 

      sql: `

 

        SELECT

 

          COUNT(*)::int AS total_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(status, '')

 

            ) NOT IN (

 

              'complete',

 

              'completed',

 

              'done',

 

              'resolved',

 

              'closed',

 

              'cancelled',

 

              'canceled'

 

            )

 

          )::int AS open_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(status, '')

 

              ) NOT IN (

 

                'complete',

 

                'completed',

 

                'done',

 

                'resolved',

 

                'closed',

 

                'cancelled',

 

                'canceled'

 

              )

 

              AND LOWER(

 

                COALESCE(

 

                  threat_level,

 

                  ''

 

                )

 

              ) = 'critical'

 

          )::int AS critical_open,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(status, '')

 

              ) NOT IN (

 

                'complete',

 

                'completed',

 

                'done',

 

                'resolved',

 

                'closed',

 

                'cancelled',

 

                'canceled'

 

              )

 

              AND LOWER(

 

                COALESCE(

 

                  threat_level,

 

                  ''

 

                )

 

              ) = 'high'

 

          )::int AS high_open

 

 

 

        FROM narrative_rapid_responses

 

        WHERE firm_id = $1

 

      `,

 

      params: [firmId],

 

    }),

 

 

 

    querySource({

 

      name: "crm_metrics",

 

      sql: `

 

        SELECT

 

          COUNT(*)::int AS total_activities,

 

 

 

          COUNT(*) FILTER (

 

            WHERE completed_at IS NULL

 

          )::int AS open_followups

 

 

 

        FROM campaign_crm_activities

 

        WHERE firm_id = $1

 

      `,

 

      params: [firmId],

 

    }),

 

 

 

    querySource({

 

      name: "vendor_metrics",

 

      sql: `

 

        SELECT

 

          COUNT(*)::int AS total_count,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(COALESCE(status, '')) LIKE '%gap%'

 

              OR LOWER(COALESCE(status, '')) LIKE '%risk%'

 

              OR LOWER(COALESCE(status, '')) LIKE '%thin%'

 

              OR LOWER(COALESCE(status, '')) LIKE '%limited%'

 

              OR LOWER(COALESCE(status, '')) LIKE '%unavailable%'

 

              OR LOWER(COALESCE(coverage_area, '')) LIKE '%limited%'

 

              OR LOWER(COALESCE(coverage_area, '')) LIKE '%thin%'

 

              OR LOWER(COALESCE(notes, '')) LIKE '%coverage gap%'

 

              OR LOWER(COALESCE(notes, '')) LIKE '%capacity gap%'

 

          )::int AS gap_count

 

 

 

        FROM vendors

 

      `,

 

      params: [],

 

    }),

 

  ]);

 

 

 

  const signalMetrics =

 

    signalMetricsSource.rows[0] || {};

 

 

 

  const taskMetrics =

 

    taskMetricsSource.rows[0] || {};

 

 

 

  const responseMetrics =

 

    responseMetricsSource.rows[0] || {};

 

 

 

  const crmMetrics =

 

    crmMetricsSource.rows[0] || {};

 

 

 

  const vendorMetrics =

 

    vendorMetricsSource.rows[0] || {};

 

 

 

  /* ==========================================================================

 

   * Presentation record filtering

 

   * ======================================================================== */

 

 

 

  const openTasks = tasks.filter(

 

    (task) => !isClosedStatus(task.status)

 

  );

 

 

 

  const criticalSignals = signals.filter(

 

    (signal) => {

 

      const risk = lower(

 

        signal.risk || signal.severity

 

      );

 

 

 

      const score = number(

 

        signal.signal_score

 

      );

 

 

 

      return (

 

        ["critical", "high"].includes(risk) ||

 

        score >= 60

 

      );

 

    }

 

  );

 

 

 

  const openResponses =

 

    rapidResponses.filter(

 

      (item) =>

 

        !isClosedStatus(item.status)

 

    );

 

 

 

  const openCrmFollowUps =

 

    crmActivities.filter(

 

      (item) => !item.completed_at

 

    );

 

 

 

  const vendorGaps = vendors.filter(

 

    (vendor) => {

 

      const status = lower(vendor.status);

 

      const coverageArea = lower(

 

        vendor.coverage_area

 

      );

 

      const notes = lower(vendor.notes);

 

      const services = lower(vendor.services);

 

      const capabilities = lower(

 

        vendor.capabilities

 

      );

 

 

 

      return (

 

        status.includes("gap") ||

 

        status.includes("risk") ||

 

        status.includes("thin") ||

 

        status.includes("limited") ||

 

        status.includes("unavailable") ||

 

        coverageArea.includes("limited") ||

 

        coverageArea.includes("thin") ||

 

        notes.includes("coverage gap") ||

 

        notes.includes("capacity gap") ||

 

        services.includes("capacity gap") ||

 

        capabilities.includes("capacity gap")

 

      );

 

    }

 

  );

 

 

 

  /* ==========================================================================

 

   * Complete workspace health

 

   *

 

   * Workspaces themselves are not presentation-limited.

 

   *

 

   * Task and signal aggregates are queried separately so workspace pressure

 

   * does not depend on the top-N presentation rows loaded above.

 

   * ======================================================================== */

 

 

 

  const [

 

    workspaceTaskMetricsSource,

 

    workspaceSignalMetricsSource,

 

  ] = await Promise.all([

 

    querySource({

 

      name: "workspace_task_metrics",

 

      sql: `

 

        SELECT

 

          workspace_id,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(status, '')

 

            ) NOT IN (

 

              'complete',

 

              'completed',

 

              'done',

 

              'resolved',

 

              'closed',

 

              'cancelled',

 

              'canceled'

 

            )

 

          )::int AS open_tasks,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(status, '')

 

              ) NOT IN (

 

                'complete',

 

                'completed',

 

                'done',

 

                'resolved',

 

                'closed',

 

                'cancelled',

 

                'canceled'

 

              )

 

              AND LOWER(

 

                COALESCE(priority, '')

 

              ) = 'critical'

 

          )::int AS critical_tasks,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(status, '')

 

              ) NOT IN (

 

                'complete',

 

                'completed',

 

                'done',

 

                'resolved',

 

                'closed',

 

                'cancelled',

 

                'canceled'

 

              )

 

              AND LOWER(

 

                COALESCE(priority, '')

 

              ) = 'high'

 

          )::int AS high_tasks

 

 

 

        FROM tasks

 

        WHERE firm_id = $1

 

        GROUP BY workspace_id

 

      `,

 

      params: [firmId],

 

    }),

 

 

 

    querySource({

 

      name: "workspace_signal_metrics",

 

      sql: `

 

        SELECT

 

          workspace_id,

 

 

 

          COUNT(*)::int AS signals,

 

 

 

          COUNT(*) FILTER (

 

            WHERE

 

              LOWER(

 

                COALESCE(

 

                  risk,

 

                  severity,

 

                  ''

 

                )

 

              ) IN (

 

                'critical',

 

                'high'

 

              )

 

              OR COALESCE(

 

                signal_score,

 

                0

 

              ) >= 60

 

          )::int AS material_signals,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(

 

                risk,

 

                severity,

 

                ''

 

              )

 

            ) = 'critical'

 

          )::int AS critical_signals,

 

 

 

          COUNT(*) FILTER (

 

            WHERE LOWER(

 

              COALESCE(

 

                risk,

 

                severity,

 

                ''

 

              )

 

            ) = 'high'

 

          )::int AS high_signals,

 

 

 

          COALESCE(

 

            AVG(signal_score),

 

            0

 

          )::float AS avg_signal_score,

 

 

 

          COALESCE(

 

            MAX(signal_score),

 

            0

 

          )::float AS max_signal_score

 

 

 

        FROM political_signals

 

        WHERE firm_id = $1

 

        GROUP BY workspace_id

 

      `,

 

      params: [firmId],

 

    }),

 

  ]);

 

 

 

  const taskMetricsByWorkspace = new Map(

 

    workspaceTaskMetricsSource.rows.map(

 

      (item) => [

 

        String(item.workspace_id ?? ""),

 

        item,

 

      ]

 

    )

 

  );

 

 

 

  const signalMetricsByWorkspace = new Map(

 

    workspaceSignalMetricsSource.rows.map(

 

      (item) => [

 

        String(item.workspace_id ?? ""),

 

        item,

 

      ]

 

    )

 

  );

 

 

 

  const workspaceHealth = workspaces

 

    .map((workspace) => {

 

      const key = String(workspace.id);

 

 

 

      const taskStats =

 

        taskMetricsByWorkspace.get(key) ||

 

        {};

 

 

 

      const signalStats =

 

        signalMetricsByWorkspace.get(key) ||

 

        {};

 

 

 

      const open = integer(

 

        taskStats.open_tasks

 

      );

 

 

 

      const criticalTasks = integer(

 

        taskStats.critical_tasks

 

      );

 

 

 

      const highTasks = integer(

 

        taskStats.high_tasks

 

      );

 

 

 

      const materialSignals = integer(

 

        signalStats.material_signals

 

      );

 

 

 

      const criticalWorkspaceSignals =

 

        integer(

 

          signalStats.critical_signals

 

        );

 

 

 

      const highWorkspaceSignals =

 

        integer(signalStats.high_signals);

 

 

 

      const avgSignalScore =

 

        normalizeScore(

 

          signalStats.avg_signal_score

 

        );

 

 

 

      const maxSignalScore =

 

        normalizeScore(

 

          signalStats.max_signal_score

 

        );

 

 

 

      /*

 

       * Workspace pressure is severity weighted.

 

       *

 

       * Critical/high tasks and critical/high signals matter more than

 

       * simple volume. General backlog contributes but cannot independently

 

       * force a workspace into Critical posture.

 

       */

 

      const taskComponent =

 

        saturation(criticalTasks, 3) *

 

          0.5 +

 

        saturation(highTasks, 6) *

 

          0.3 +

 

        saturation(open, 15) *

 

          0.2;

 

 

 

      const signalComponent =

 

        saturation(

 

          criticalWorkspaceSignals,

 

          2

 

        ) *

 

          0.45 +

 

        saturation(

 

          highWorkspaceSignals,

 

          4

 

        ) *

 

          0.25 +

 

        saturation(materialSignals, 8) *

 

          0.15 +

 

        avgSignalScore * 0.05 +

 

        maxSignalScore * 0.1;

 

 

 

      const score = Math.round(

 

        clamp(

 

          taskComponent * 0.45 +

 

            signalComponent * 0.55

 

        )

 

      );

 

 

 

      return {

 

        id: workspace.id,

 

 

 

        name:

 

          workspace.name ||

 

          workspace.campaign_name ||

 

          workspace.title ||

 

          `Workspace ${workspace.id}`,

 

 

 

        state:

 

          workspace.state ||

 

          "National",

 

 

 

        office:

 

          workspace.office ||

 

          "Campaign",

 

 

 

        cycle:

 

          workspace.cycle ||

 

          "2026",

 

 

 

        open_tasks: open,

 

 

 

        critical_tasks: criticalTasks,

 

 

 

        high_tasks: highTasks,

 

 

 

        signals: integer(

 

          signalStats.signals

 

        ),

 

 

 

        material_signals: materialSignals,

 

 

 

        critical_signals:

 

          criticalWorkspaceSignals,

 

 

 

        high_signals:

 

          highWorkspaceSignals,

 

 

 

        average_signal_score:

 

          Math.round(avgSignalScore),

 

 

 

        maximum_signal_score:

 

          Math.round(maxSignalScore),

 

 

 

        pressure_score: score,

 

 

 

        mission_score: score,

 

 

 

        risk: riskTone(score),

 

      };

 

    })

 

    .sort(

 

      (a, b) =>

 

        number(b.pressure_score) -

 

        number(a.pressure_score)

 

    );

 

 

 

  const workspaceMetrics = {

 

    total_count: workspaceHealth.length,

 

 

 

    critical_count:

 

      workspaceHealth.filter(

 

        (workspace) =>

 

          workspace.risk === "Critical"

 

      ).length,

 

 

 

    high_count:

 

      workspaceHealth.filter(

 

        (workspace) =>

 

          workspace.risk === "High"

 

      ).length,

 

 

 

    elevated_count:

 

      workspaceHealth.filter(

 

        (workspace) =>

 

          workspace.risk === "Elevated"

 

      ).length,

 

  };

 

 

 

  workspaceMetrics.at_risk_count =

 

    workspaceMetrics.critical_count +

 

    workspaceMetrics.high_count +

 

    workspaceMetrics.elevated_count;

 

 

 

  /* ==========================================================================

 

   * Weighted executive pressure

 

   * ======================================================================== */

 

 

 

  const pressure = calculateExecutivePressure({

 

    signalMetrics,

 

    taskMetrics,

 

    responseMetrics,

 

    crmMetrics,

 

    vendorMetrics,

 

    workspaceMetrics,

 

  });

 

 

 

  const pressureScore =

 

    pressure.pressure_score;

 

 

 

  const missionRisk =

 

    riskTone(pressureScore);

 

 

 

  /* ==========================================================================

 

   * Mission items

 

   * ======================================================================== */

 

 

 

  const signalMissionItems =

 

    criticalSignals.map((signal) => {

 

      const score =

 

        signalMissionScore(signal);

 

 

 

      const risk =

 

        clean(

 

          signal.risk ||

 

            signal.severity

 

        );

 

 

 

      const priority =

 

        risk && lower(risk) !== "stable"

 

          ? risk

 

          : score >= 85

 

            ? "Critical"

 

            : score >= 65

 

              ? "High"

 

              : score >= 42

 

                ? "Elevated"

 

                : "Medium";

 

 

 

      return {

 

        id: `signal-${signal.id}`,

 

        type: "Political Signal",

 

 

 

        title:

 

          signal.title ||

 

          "Political signal",

 

 

 

        description:

 

          signal.summary ||

 

          signal.source ||

 

          "Review political signal.",

 

 

 

        priority,

 

 

 

        mission_score: score,

 

        priority_score:

 

          priorityWeight(priority),

 

        urgency_score: score,

 

 

 

        risk_score:

 

          normalizeScore(

 

            signal.signal_score,

 

            score

 

          ),

 

 

 

        confidence_score:

 

          confidenceScore(

 

            signal.confidence_score ??

 

              signal.confidence,

 

            85

 

          ),

 

 

 

        state:

 

          signal.state ||

 

          "National",

 

 

 

        source:

 

          signal.source ||

 

          signal.signal_type ||

 

          "Signal Engine",

 

 

 

        action:

 

          "Review signal and assign response.",

 

 

 

        url:

 

          signal.url || null,

 

 

 

        created_at:

 

          signal.observed_at ||

 

          signal.created_at,

 

      };

 

    });

 

 

 

  const taskMissionItems =

 

    openTasks.map((task) => {

 

      const score =

 

        taskMissionScore(task);

 

 

 

      const priority =

 

        clean(task.priority, "Medium");

 

 

 

      return {

 

        id: `task-${task.id}`,

 

        type: "Execution Task",

 

 

 

        title:

 

          task.title ||

 

          "Open task",

 

 

 

        description:

 

          task.description ||

 

          task.source ||

 

          "Execution item needs attention.",

 

 

 

        priority,

 

 

 

        mission_score: score,

 

        priority_score:

 

          priorityWeight(priority),

 

        urgency_score: score,

 

        risk_score: score,

 

 

 

        confidence_score: 100,

 

 

 

        state:

 

          task.state ||

 

          "National",

 

 

 

        source:

 

          task.source ||

 

          "Command Center",

 

 

 

        action:

 

          "Assign owner, remove blockers, or complete task.",

 

 

 

        url: null,

 

 

 

        created_at:

 

          task.updated_at ||

 

          task.created_at,

 

      };

 

    });

 

 

 

  const responseMissionItems =

 

    openResponses.map((response) => {

 

      const score =

 

        responseMissionScore(response);

 

 

 

      const priority = clean(

 

        response.threat_level ||

 

          response.priority ||

 

          response.status,

 

        "Medium"

 

      );

 

 

 

      return {

 

        id: `response-${response.id}`,

 

        type: "Rapid Response",

 

 

 

        title:

 

          response.title ||

 

          "Narrative response",

 

 

 

        description:

 

          response.response_strategy ||

 

          response.narrative_summary ||

 

          "Narrative response requires action.",

 

 

 

        priority,

 

 

 

        mission_score: score,

 

        priority_score:

 

          priorityWeight(priority),

 

        urgency_score: score,

 

        risk_score: score,

 

 

 

        confidence_score:

 

          confidenceScore(

 

            response.confidence_score ??

 

              response.confidence,

 

            85

 

          ),

 

 

 

        state:

 

          response.state ||

 

          "National",

 

 

 

        source:

 

          "Narrative Rapid Response",

 

 

 

        action:

 

          "Finalize response and assign owner.",

 

 

 

        url: null,

 

 

 

        created_at:

 

          response.updated_at ||

 

          response.created_at,

 

      };

 

    });

 

 

 

  const crmMissionItems =

 

    openCrmFollowUps.map((activity) => {

 

      const score =

 

        crmMissionScore(activity);

 

 

 

      const priority =

 

        score >= 65

 

          ? "High"

 

          : score >= 42

 

            ? "Elevated"

 

            : "Medium";

 

 

 

      return {

 

        id: `crm-${activity.id}`,

 

        type: "CRM Follow-Up",

 

 

 

        title:

 

          activity.title ||

 

          "CRM follow-up",

 

 

 

        description:

 

          activity.body ||

 

          activity.outcome ||

 

          activity.contact_name ||

 

          "CRM activity needs follow-up.",

 

 

 

        priority,

 

 

 

        mission_score: score,

 

        priority_score:

 

          priorityWeight(priority),

 

        urgency_score: score,

 

        risk_score: score,

 

 

 

        confidence_score: 100,

 

 

 

        state:

 

          activity.state ||

 

          "National",

 

 

 

        source:

 

          "Campaign CRM",

 

 

 

        action:

 

          "Complete CRM activity.",

 

 

 

        url: null,

 

 

 

        created_at:

 

          activity.created_at,

 

      };

 

    });

 

 

 

  const vendorMissionItems =

 

    vendorGaps.map((vendor) => {

 

      const score =

 

        vendorMissionScore(vendor);

 

 

 

      const priority =

 

        score >= 85

 

          ? "Critical"

 

          : score >= 65

 

            ? "High"

 

            : "Elevated";

 

 

 

      return {

 

        id: `vendor-${vendor.id}`,

 

        type: "Vendor Capacity Gap",

 

 

 

        title:

 

          vendor.name ||

 

          vendor.vendor_name ||

 

          "Vendor capacity gap",

 

 

 

        description:

 

          vendor.notes ||

 

          vendor.category ||

 

          "Vendor capacity or coverage requires review.",

 

 

 

        priority,

 

 

 

        mission_score: score,

 

        priority_score:

 

          priorityWeight(priority),

 

        urgency_score: score,

 

        risk_score: score,

 

 

 

        confidence_score: 95,

 

 

 

        state:

 

          vendor.state ||

 

          "National",

 

 

 

        source:

 

          "Vendor Network",

 

 

 

        action:

 

          "Review coverage and resolve capacity gap.",

 

 

 

        url: null,

 

 

 

        created_at:

 

          vendor.updated_at ||

 

          vendor.created_at,

 

      };

 

    });

 

 

 

  const missionItems = [

 

    ...signalMissionItems,

 

    ...taskMissionItems,

 

    ...responseMissionItems,

 

    ...crmMissionItems,

 

    ...vendorMissionItems,

 

  ]

 

    .sort(compareMissionItems)

 

    .slice(

 

      0,

 

      RETURN_LIMITS.mission_items

 

    );

 

 

 

  /* ==========================================================================

 

   * Authoritative totals

 

   *

 

   * Prefer aggregate-query values. Fall back to available row sets only when

 

   * a metrics query is unavailable.

 

   * ======================================================================== */

 

 

 

  const totalCriticalSignals =

 

    signalMetricsSource.ok

 

      ? integer(

 

          signalMetrics.critical_count

 

        )

 

      : criticalSignals.filter(

 

          (item) =>

 

            lower(

 

              item.risk ||

 

                item.severity

 

            ) === "critical"

 

        ).length;

 

 

 

  const totalHighSignals =

 

    signalMetricsSource.ok

 

      ? integer(

 

          signalMetrics.high_count

 

        )

 

      : criticalSignals.filter(

 

          (item) =>

 

            lower(

 

              item.risk ||

 

                item.severity

 

            ) === "high"

 

        ).length;

 

 

 

  const totalElevatedSignals =

 

    signalMetricsSource.ok

 

      ? integer(

 

          signalMetrics.elevated_count

 

        )

 

      : signals.filter(

 

          (item) =>

 

            lower(

 

              item.risk ||

 

                item.severity

 

            ) === "elevated"

 

        ).length;

 

 

 

  const totalMaterialSignals =

 

    signalMetricsSource.ok

 

      ? integer(

 

          signalMetrics.material_count

 

        )

 

      : criticalSignals.length;

 

 

 

  const totalOpenTasks =

 

    taskMetricsSource.ok

 

      ? integer(taskMetrics.open_count)

 

      : openTasks.length;

 

 

 

  const totalCriticalOpenTasks =

 

    taskMetricsSource.ok

 

      ? integer(

 

          taskMetrics.critical_open

 

        )

 

      : openTasks.filter(

 

          (item) =>

 

            lower(item.priority) ===

 

            "critical"

 

        ).length;

 

 

 

  const totalHighOpenTasks =

 

    taskMetricsSource.ok

 

      ? integer(taskMetrics.high_open)

 

      : openTasks.filter(

 

          (item) =>

 

            lower(item.priority) ===

 

            "high"

 

        ).length;

 

 

 

  const totalOpenResponses =

 

    responseMetricsSource.ok

 

      ? integer(

 

          responseMetrics.open_count

 

        )

 

      : openResponses.length;

 

 

 

  const totalCriticalResponses =

 

    responseMetricsSource.ok

 

      ? integer(

 

          responseMetrics.critical_open

 

        )

 

      : openResponses.filter(

 

          (item) =>

 

            lower(

 

              item.threat_level

 

            ) === "critical"

 

        ).length;

 

 

 

  const totalHighResponses =

 

    responseMetricsSource.ok

 

      ? integer(

 

          responseMetrics.high_open

 

        )

 

      : openResponses.filter(

 

          (item) =>

 

            lower(

 

              item.threat_level

 

            ) === "high"

 

        ).length;

 

 

 

  const totalCrmFollowups =

 

    crmMetricsSource.ok

 

      ? integer(

 

          crmMetrics.open_followups

 

        )

 

      : openCrmFollowUps.length;

 

 

 

  const totalVendorGaps =

 

    vendorMetricsSource.ok

 

      ? integer(

 

          vendorMetrics.gap_count

 

        )

 

      : vendorGaps.length;

 

 

 

  const totals = {

 

    critical_signals:

 

      totalCriticalSignals,

 

 

 

    high_signals:

 

      totalHighSignals,

 

 

 

    elevated_signals:

 

      totalElevatedSignals,

 

 

 

    material_signals:

 

      totalMaterialSignals,

 

 

 

    open_tasks:

 

      totalOpenTasks,

 

 

 

    critical_open_tasks:

 

      totalCriticalOpenTasks,

 

 

 

    high_open_tasks:

 

      totalHighOpenTasks,

 

 

 

    open_rapid_responses:

 

      totalOpenResponses,

 

 

 

    critical_rapid_responses:

 

      totalCriticalResponses,

 

 

 

    high_rapid_responses:

 

      totalHighResponses,

 

 

 

    crm_followups:

 

      totalCrmFollowups,

 

 

 

    vendor_gaps:

 

      totalVendorGaps,

 

 

 

    workspaces:

 

      workspaceHealth.length,

 

 

 

    at_risk_workspaces:

 

      workspaceMetrics.at_risk_count,

 

 

 

    critical_workspaces:

 

      workspaceMetrics.critical_count,

 

 

 

    high_workspaces:

 

      workspaceMetrics.high_count,

 

 

 

    elevated_workspaces:

 

      workspaceMetrics.elevated_count,

 

  };

 

 

 

  totals.operational_exceptions =

 

    totals.material_signals +

 

    totals.open_rapid_responses +

 

    totals.vendor_gaps +

 

    totals.at_risk_workspaces;

 

 

 

  /* ==========================================================================

 

   * Source-health / degraded mode

 

   * ======================================================================== */

 

 

 

  const sourceHealth = {

 

    political_signals:

 

      signalsSource.health,

 

 

 

    political_signal_metrics:

 

      signalMetricsSource.health,

 

 

 

    tasks:

 

      tasksSource.health,

 

 

 

    task_metrics:

 

      taskMetricsSource.health,

 

 

 

    workspaces:

 

      workspacesSource.health,

 

 

 

    workspace_task_metrics:

 

      workspaceTaskMetricsSource.health,

 

 

 

    workspace_signal_metrics:

 

      workspaceSignalMetricsSource.health,

 

 

 

    campaign_crm_contacts:

 

      crmContactsSource.health,

 

 

 

    campaign_crm_activities:

 

      crmActivitiesSource.health,

 

 

 

    crm_metrics:

 

      crmMetricsSource.health,

 

 

 

    rapid_response:

 

      rapidResponsesSource.health,

 

 

 

    rapid_response_metrics:

 

      responseMetricsSource.health,

 

 

 

    vendors:

 

      vendorsSource.health,

 

 

 

    vendor_metrics:

 

      vendorMetricsSource.health,

 

  };

 

 

 

  const unavailableSources =

 

    Object.entries(sourceHealth)

 

      .filter(

 

        ([, health]) =>

 

          health.status ===

 

          "unavailable"

 

      )

 

      .map(([name]) => name);

 

 

 

  const degraded =

 

    unavailableSources.length > 0;

 

 

 

  /* ==========================================================================

 

   * Structured executive intelligence

 

   * ======================================================================== */

 

 

 

  const aiRecommendations =

 

    buildExecutiveRecommendations({

 

      pressureScore,

 

      missionRisk,

 

      totals,

 

      pressureComponents:

 

        pressure.components,

 

      sourceHealth,

 

    });

 

 

 

  /* ==========================================================================

 

   * Response

 

   * ======================================================================== */

 

 

 

  return {

 

    summary: {

 

      /*

 

       * Existing frontend contract

 

       */

 

      pressure_score:

 

        pressureScore,

 

 

 

      mission_risk:

 

        missionRisk,

 

 

 

      critical_signals:

 

        totals.critical_signals,

 

 

 

      open_tasks:

 

        totals.open_tasks,

 

 

 

      rapid_responses:

 

        totals.open_rapid_responses,

 

 

 

      crm_followups:

 

        totals.crm_followups,

 

 

 

      workspaces:

 

        totals.workspaces,

 

 

 

      vendor_gaps:

 

        totals.vendor_gaps,

 

 

 

      /*

 

       * Build 6 authoritative totals

 

       */

 

      political_signal_total:

 

        integer(

 

          signalMetrics.total_count

 

        ),

 

 

 

      material_signals:

 

        totals.material_signals,

 

 

 

      critical_signal_count:

 

        totals.critical_signals,

 

 

 

      high_signal_count:

 

        totals.high_signals,

 

 

 

      elevated_signal_count:

 

        totals.elevated_signals,

 

 

 

      critical_open_tasks:

 

        totals.critical_open_tasks,

 

 

 

      high_open_tasks:

 

        totals.high_open_tasks,

 

 

 

      at_risk_workspaces:

 

        totals.at_risk_workspaces,

 

 

 

      critical_workspaces:

 

        totals.critical_workspaces,

 

 

 

      high_workspaces:

 

        totals.high_workspaces,

 

 

 

      elevated_workspaces:

 

        totals.elevated_workspaces,

 

 

 

      operational_exceptions:

 

        totals.operational_exceptions,

 

 

 

      ai_recommendations:

 

        aiRecommendations.length,

 

 

 

      /*

 

       * Data completeness

 

       */

 

      degraded,

 

 

 

      unavailable_sources:

 

        unavailableSources.length,

 

    },

 

 

 

    pressure_components:

 

      pressure.components,

 

 

 

    mission_items:

 

      missionItems,

 

 

 

    /*

 

     * Presentation collections remain limited.

 

     * Authoritative totals are supplied separately in summary.

 

     */

 

    critical_signals:

 

      criticalSignals

 

        .slice()

 

        .sort(

 

          (a, b) =>

 

            signalMissionScore(b) -

 

            signalMissionScore(a)

 

        )

 

        .slice(

 

          0,

 

          RETURN_LIMITS.critical_signals

 

        ),

 

 

 

    open_tasks:

 

      openTasks

 

        .slice()

 

        .sort(

 

          (a, b) =>

 

            taskMissionScore(b) -

 

            taskMissionScore(a)

 

        )

 

        .slice(

 

          0,

 

          RETURN_LIMITS.open_tasks

 

        ),

 

 

 

    rapid_responses:

 

      openResponses

 

        .slice()

 

        .sort(

 

          (a, b) =>

 

            responseMissionScore(b) -

 

            responseMissionScore(a)

 

        )

 

        .slice(

 

          0,

 

          RETURN_LIMITS.rapid_responses

 

        ),

 

 

 

    crm_followups:

 

      openCrmFollowUps

 

        .slice()

 

        .sort(

 

          (a, b) =>

 

            crmMissionScore(b) -

 

            crmMissionScore(a)

 

        )

 

        .slice(

 

          0,

 

          RETURN_LIMITS.crm_followups

 

        ),

 

 

 

    workspace_health:

 

      workspaceHealth.slice(

 

        0,

 

        RETURN_LIMITS.workspace_health

 

      ),

 

 

 

    vendor_gaps:

 

      vendorGaps

 

        .slice()

 

        .sort(

 

          (a, b) =>

 

            vendorMissionScore(b) -

 

            vendorMissionScore(a)

 

        )

 

        .slice(

 

          0,

 

          RETURN_LIMITS.vendor_gaps

 

        ),

 

 

 

    ai_recommendations:

 

      aiRecommendations,

 

 

 

    source_health:

 

      sourceHealth,

 

 

 

    degraded,

 

 

 

    unavailable_sources:

 

      unavailableSources,

 

 

 

    generated_at:

 

      new Date().toISOString(),

 

 

 

    updated_at:

 

      new Date().toISOString(),

 

  };

 

}
