import { collectPoliticalSignals } from "../adapters/politicalIntelligenceFabric.adapters.js";
 
import {
  savePoliticalBrief,
  saveSnapshot,
  listPoliticalBriefs,
  getPoliticalBrief,
  listWatchlist,
  upsertWatchlist,
  deleteWatchlist,
  saveScenario,
} from "./politicalIntelligenceMemory.service.js";
 
import {
  getCongressUpdates,
  getElectionAdministrationUpdates,
  getOpenFecFinance,
  getPollingProviderData,
  getWeatherFieldRisk,
  searchCurrentPoliticalNews,
} from "./executiveVoiceLiveSources.service.js";
 
const clean = (value = "") =>
  String(value ?? "").trim();
 
const clamp = (value, min = 0, max = 100) =>
  Math.max(
    min,
    Math.min(max, Number(value) || 0)
  );
 
const asArray = (value) =>
  Array.isArray(value) ? value : [];

function extractNumericValues(value, depth = 0) {
  if (
    depth > 5 ||
    value === null ||
    value === undefined
  ) {
    return [];
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? [value]
      : [];
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed)
      ? [parsed]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      extractNumericValues(item, depth + 1)
    );
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "score",
      "value",
      "average",
      "avg",
      "mean",
      "risk",
      "support",
      "mobilization",
      "confidence",
      "count",
    ];

    const preferredValues = preferredKeys.flatMap((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
        ? extractNumericValues(value[key], depth + 1)
        : []
    );

    if (preferredValues.length) {
      return preferredValues;
    }

    return Object.values(value).flatMap((item) =>
      extractNumericValues(item, depth + 1)
    );
  }

  return [];
}

function safeNumericValue(
  value,
  fallback = 0,
  strategy = "average"
) {
  const values = extractNumericValues(value);

  if (!values.length) {
    return Number(fallback) || 0;
  }

  if (strategy === "max") {
    return Math.max(...values);
  }

  if (strategy === "min") {
    return Math.min(...values);
  }

  if (strategy === "sum") {
    return values.reduce((sum, item) => sum + item, 0);
  }

  return (
    values.reduce((sum, item) => sum + item, 0) /
    values.length
  );
}
 
function severityFromScore(score) {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}
 
function urgencyWeight(value = "") {
  const normalized = clean(value).toLowerCase();
 
  if (
    ["critical", "urgent", "immediate"].includes(
      normalized
    )
  ) {
    return 95;
  }
 
  if (
    ["high", "elevated"].includes(normalized)
  ) {
    return 78;
  }
 
  if (
    ["medium", "moderate"].includes(normalized)
  ) {
    return 55;
  }
 
  return 30;
}
 
function daysUntil(value) {
  if (!value) return null;
 
  const time = new Date(value).getTime();
 
  if (!Number.isFinite(time)) {
    return null;
  }
 
  return Math.ceil(
    (time - Date.now()) / 86400000
  );
}
 
function evidence(source, record, label) {
  return {
    source,
    source_id:
      record?.id ??
      record?.entity_id ??
      record?.url ??
      null,
    label,
    observed_at:
      record?.updated_at ||
      record?.created_at ||
      record?.published_at ||
      record?.date ||
      new Date().toISOString(),
    record,
  };
}
 
function getStateCode(record = {}) {
  return clean(
    record?.state_code ||
      record?.stateCode ||
      record?.state ||
      record?.jurisdiction_code ||
      record?.jurisdiction
  )
    .toUpperCase()
    .slice(0, 2);
}
 
function extractRows(payload, depth = 0) {
  if (depth > 4 || payload === null || payload === undefined) {
    return [];
  }
 
  if (Array.isArray(payload)) {
    return payload;
  }
 
  if (typeof payload !== "object") {
    return [];
  }
 
  const preferredKeys = [
    "items",
    "results",
    "records",
    "data",
    "signals",
    "findings",
    "articles",
    "news",
    "polls",
    "updates",
    "bills",
    "committees",
    "candidates",
    "reports",
    "totals",
    "active_alerts",
    "forecast_periods",
    "records",
    "payload",
    "response",
    "result",
  ];
 
  for (const key of preferredKeys) {
    const value = payload[key];
 
    if (Array.isArray(value)) {
      return value;
    }
 
    if (
      value &&
      typeof value === "object"
    ) {
      const nested = extractRows(
        value,
        depth + 1
      );
 
      if (nested.length) {
        return nested;
      }
    }
  }
 
  return [];
}
 
function safeErrorMessage(result) {
  if (!result || result.status !== "rejected") {
    return null;
  }
 
  return (
    result.reason?.message ||
    String(result.reason || "Source failed")
  ).slice(0, 500);
}
 
function sourceHealthFromSettled(
  settledResult,
  rows,
  extra = {}
) {
  const payload =
    settledResult?.status === "fulfilled"
      ? settledResult.value
      : null;

  const configured =
    settledResult?.status === "fulfilled"
      ? payload?.configured !== false
      : true;

  const providerOk =
    settledResult?.status === "fulfilled" &&
    payload?.ok === true;

  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings
    : [];

  const diagnosticError = Array.isArray(payload?.diagnostics)
    ? payload.diagnostics.find((item) => item?.error)?.error
    : null;

  const error =
    safeErrorMessage(settledResult) ||
    diagnosticError ||
    (!configured
      ? warnings[0] || "Provider is not configured."
      : !providerOk
        ? warnings[0] || payload?.summary || null
        : null);

  return {
    ok: providerOk,
    configured,
    count: rows.length,
    degraded:
      settledResult?.status === "rejected" ||
      payload?.degraded === true ||
      !providerOk ||
      !configured ||
      Boolean(extra.degraded),
    error,
    provider: payload?.provider || null,
    cached: Boolean(payload?.cached),
    stale: Boolean(payload?.stale),
    summary: payload?.summary || null,
    warnings,
    diagnostics: Array.isArray(payload?.diagnostics)
      ? payload.diagnostics
      : [],
    checked_at:
      payload?.generated_at ||
      new Date().toISOString(),
    ...extra,
  };
}
 
function candidateFindings(rows = []) {
  return rows.flatMap((candidate) => {
    const cash =
      Number(candidate.cash_on_hand) || 0;
    const raised =
      Number(candidate.total_raised) || 0;
    const ratio =
      raised > 0 ? cash / raised : 0;
 
    if (raised <= 0 && cash <= 0) {
      return [];
    }
 
    const score = clamp(
      35 +
        (raised > 1000000
          ? 25
          : raised > 250000
            ? 15
            : 5) +
        (ratio < 0.12
          ? 25
          : ratio < 0.25
            ? 12
            : 0)
    );
 
    return [
      {
        category: "candidate_finance",
        entity_type: "candidate",
        entity_id: candidate.id,
        entity_name: candidate.name,
        state_code: getStateCode(candidate),
        title:
          `${candidate.name}: financial posture requires review`,
        summary:
          ratio < 0.12
            ? "Cash-on-hand is low relative to reported fundraising."
            : "Fundraising activity is material enough to affect competitive posture.",
        score,
        severity: severityFromScore(score),
        confidence: raised > 0 ? 82 : 58,
        metrics: {
          total_raised: raised,
          cash_on_hand: cash,
          liquidity_ratio: ratio,
        },
        evidence: [
          evidence(
            "candidates",
            candidate,
            "Candidate financial record"
          ),
        ],
      },
    ];
  });
}
 
function taskFindings(rows = []) {
  return rows.flatMap((task) => {
    const days = daysUntil(task.due_date);
 
    const incomplete =
      ![
        "complete",
        "completed",
        "closed",
      ].includes(
        clean(task.status).toLowerCase()
      );
 
    if (!incomplete) {
      return [];
    }
 
    const overdue =
      days !== null && days < 0;
 
    const score = clamp(
      urgencyWeight(task.priority) +
        (overdue
          ? 20
          : days !== null && days <= 3
            ? 12
            : 0)
    );
 
    if (score < 50) {
      return [];
    }
 
    return [
      {
        category: "execution",
        entity_type: "task",
        entity_id: task.id,
        entity_name: task.title,
        state_code: getStateCode(task),
        title: overdue
          ? `Overdue execution item: ${task.title}`
          : `Execution pressure: ${task.title}`,
        summary: overdue
          ? `The task is ${Math.abs(days)} day(s) overdue.`
          : `The task is due within ${days ?? "an unknown number of"} day(s).`,
        score,
        severity: severityFromScore(score),
        confidence: 92,
        metrics: {
          status: task.status,
          priority: task.priority,
          days_until_due: days,
        },
        evidence: [
          evidence(
            "tasks",
            task,
            "Execution task"
          ),
        ],
      },
    ];
  });
}
 
function vendorFindings(rows = []) {
  return rows.flatMap((vendor) => {
    const coverage =
      Number(vendor.coverage_score) || 0;
    const riskText =
      clean(vendor.risk).toLowerCase();
 
    const risky =
      ["high", "critical", "elevated"].includes(
        riskText
      );
 
    if (coverage >= 65 && !risky) {
      return [];
    }
 
    const score = clamp(
      (100 - coverage) * 0.75 +
        (risky ? 25 : 5)
    );
 
    return [
      {
        category: "vendor_capacity",
        entity_type: "vendor",
        entity_id: vendor.id,
        entity_name: vendor.name,
        state_code: getStateCode(vendor),
        title:
          `Vendor capacity risk: ${vendor.name}`,
        summary:
          `Coverage score ${coverage}; risk ${vendor.risk || "Unknown"}; tier ${vendor.tier || "Unrated"}.`,
        score,
        severity: severityFromScore(score),
        confidence: coverage > 0 ? 84 : 55,
        metrics: {
          coverage_score: coverage,
          risk: vendor.risk,
          tier: vendor.tier,
        },
        evidence: [
          evidence(
            "vendors",
            vendor,
            "Vendor capacity record"
          ),
        ],
      },
    ];
  });
}
 
function stateFindings(rows = []) {
  return rows.flatMap((state) => {
    const readiness =
      Number(state.readiness_score) || 0;
    const gaps =
      Number(state.vendor_gaps) || 0;
    const open =
      Number(state.open_tasks) || 0;
 
    const score = clamp(
      (100 - readiness) * 0.7 +
        Math.min(gaps * 8, 24) +
        Math.min(open * 2, 16)
    );
 
    if (score < 45) {
      return [];
    }
 
    return [
      {
        category: "state_operations",
        entity_type: "state",
        entity_id: state.state_code,
        entity_name:
          state.state_name ||
          state.state_code,
        state_code: getStateCode(state),
        title:
          `${state.state_code}: operating readiness below target`,
        summary:
          `Readiness ${readiness}; open tasks ${open}; vendor gaps ${gaps}.`,
        score,
        severity: severityFromScore(score),
        confidence: 88,
        metrics: {
          readiness_score: readiness,
          open_tasks: open,
          vendor_gaps: gaps,
        },
        evidence: [
          evidence(
            "state_operations_summary",
            state,
            "State operations summary"
          ),
        ],
      },
    ];
  });
}
 
function strategyFindings(rows = []) {
  return rows.flatMap((item) => {
    const status =
      clean(item.status).toLowerCase();
 
    if (
      [
        "completed",
        "closed",
        "implemented",
      ].includes(status)
    ) {
      return [];
    }
 
    const score = clamp(
      urgencyWeight(item.priority) * 0.8 +
        (Number(item.confidence) || 50) *
          0.2
    );
 
    return [
      {
        category: "strategy",
        entity_type:
          "strategy_recommendation",
        entity_id: item.id,
        entity_name: item.title,
        state_code: getStateCode(item),
        title:
          `Open strategic recommendation: ${item.title}`,
        summary:
          item.rationale ||
          "An active recommendation remains open.",
        score,
        severity: severityFromScore(score),
        confidence: clamp(
          item.confidence || 65
        ),
        metrics: {
          priority: item.priority,
          status: item.status,
        },
        evidence: [
          evidence(
            "strategy_recommendations",
            item,
            "Strategy recommendation"
          ),
        ],
      },
    ];
  });
}
 
function decisionFindings(rows = []) {
  return rows.flatMap((item) => {
    const status =
      clean(item.status).toLowerCase();
 
    if (
      [
        "completed",
        "closed",
        "resolved",
      ].includes(status)
    ) {
      return [];
    }
 
    const score = clamp(
      urgencyWeight(item.urgency) * 0.75 +
        (Number(item.confidence) || 50) *
          0.25
    );
 
    return [
      {
        category: "decision",
        entity_type: "executive_decision",
        entity_id: item.id,
        entity_name: item.title,
        state_code: getStateCode(item),
        title:
          `Executive decision pending: ${item.title}`,
        summary:
          item.summary ||
          "An executive decision remains unresolved.",
        score,
        severity: severityFromScore(score),
        confidence: clamp(
          item.confidence || 70
        ),
        metrics: {
          urgency: item.urgency,
          status: item.status,
        },
        evidence: [
          evidence(
            "executive_decisions",
            item,
            "Executive decision"
          ),
        ],
      },
    ];
  });
}
 
function influenceFindings(rows = []) {
  return rows.flatMap((item) => {
    const influence =
      Number(item.influence_score) || 0;
    const risk =
      Number(item.risk_score) || 0;
    const momentum =
      Number(item.momentum_score) || 0;
 
    if (influence < 60 && risk < 60) {
      return [];
    }
 
    const score = clamp(
      influence * 0.45 +
        risk * 0.4 +
        Math.max(momentum, 0) * 0.15
    );
 
    return [
      {
        category: "influence",
        entity_type:
          item.entity_type ||
          "influence_entity",
        entity_id: item.entity_id,
        entity_name: item.entity_name,
        state_code: getStateCode(item),
        title:
          `Influence movement: ${item.entity_name}`,
        summary:
          `Influence ${influence}; risk ${risk}; momentum ${momentum}.`,
        score,
        severity: severityFromScore(score),
        confidence: 78,
        metrics: {
          influence_score: influence,
          risk_score: risk,
          momentum_score: momentum,
        },
        evidence: [
          evidence(
            "influence_scores",
            item,
            "Influence score"
          ),
        ],
      },
    ];
  });
}
 
function coalitionFindings(rows = []) {
  return rows.flatMap((item) => {
    const support = clamp(
      safeNumericValue(
        item.support_score,
        50,
        "average"
      )
    );

    const mobilization = clamp(
      safeNumericValue(
        item.mobilization_score,
        50,
        "average"
      )
    );

    const fragmentation = clamp(
      safeNumericValue(
        item.fragmentation_risk,
        0,
        "max"
      )
    );

    const memberCount = Math.max(
      0,
      Math.round(
        safeNumericValue(
          item.member_count,
          0,
          "max"
        )
      )
    );

    if (
      fragmentation < 45 &&
      support >= 55
    ) {
      return [];
    }

    const score = clamp(
      fragmentation * 0.65 +
        (100 - support) * 0.25 +
        (100 - mobilization) * 0.1
    );

    const coalitionName =
      clean(item.coalition_name) ||
      "Coalition";

    return [
      {
        category: "coalition",
        entity_type: "coalition",
        entity_id:
          `${coalitionName}:${getStateCode(item) || "US"}`,
        entity_name: coalitionName,
        state_code: getStateCode(item),
        title:
          `Coalition stability watch: ${coalitionName}`,
        summary:
          `Support ${Math.round(support)}; ` +
          `mobilization ${Math.round(mobilization)}; ` +
          `fragmentation risk ${Math.round(fragmentation)}; ` +
          `members ${memberCount}.`,
        score,
        severity: severityFromScore(score),
        confidence: 82,
        metrics: {
          support_score: support,
          mobilization_score: mobilization,
          fragmentation_risk:
            fragmentation,
          member_count: memberCount,
        },
        evidence: [
          evidence(
            "coalition_intelligence",
            item,
            "Coalition intelligence"
          ),
        ],
      },
    ];
  });
}
 
function liveNewsFindings(rows = []) {
  return rows.flatMap((item, index) => {
    const title =
      clean(
        item?.title ||
          item?.headline ||
          item?.name
      ) ||
      "Current political development";
 
    const summary =
      clean(
        item?.summary ||
          item?.description ||
          item?.snippet ||
          item?.content
      ) ||
      "A current political development requires review.";
 
    const relevance = clamp(
      item?.relevance_score ||
        item?.score ||
        item?.confidence ||
        62
    );
 
    const score = clamp(
      relevance * 0.7 +
        urgencyWeight(
          item?.severity ||
            item?.priority ||
            item?.risk_level
        ) *
          0.3
    );
 
    return [
      {
        category: "live_news",
        entity_type:
          item?.entity_type ||
          "political_news",
        entity_id:
          item?.id ||
          item?.url ||
          `live-news-${index}`,
        entity_name:
          item?.source ||
          item?.publisher ||
          title,
        state_code: getStateCode(item),
        title,
        summary,
        score,
        severity: severityFromScore(score),
        confidence: clamp(
          item?.confidence ||
            relevance ||
            65
        ),
        metrics: {
          source:
            item?.source ||
            item?.publisher ||
            null,
          published_at:
            item?.published_at ||
            item?.publishedAt ||
            item?.date ||
            null,
          url: item?.url || null,
        },
        evidence: [
          evidence(
            "live_political_news",
            item,
            "Current political news signal"
          ),
        ],
      },
    ];
  });
}
 
function liveFecFindings(rows = []) {
  return rows.flatMap((item, index) => {
    const raised =
      Number(
        item?.receipts ||
          item?.total_receipts ||
          item?.total_raised
      ) || 0;
 
    const spent =
      Number(
        item?.disbursements ||
          item?.total_disbursements ||
          item?.spent
      ) || 0;
 
    const cash =
      Number(
        item?.cash_on_hand ||
          item?.cash_on_hand_end_period
      ) || 0;
 
    if (
      raised <= 0 &&
      spent <= 0 &&
      cash <= 0
    ) {
      return [];
    }
 
    const burnRatio =
      raised > 0 ? spent / raised : 0;
 
    const score = clamp(
      40 +
        Math.min(raised / 100000, 25) +
        (burnRatio > 0.85
          ? 25
          : burnRatio > 0.65
            ? 12
            : 0)
    );
 
    const name =
      item?.committee_name ||
      item?.candidate_name ||
      item?.name ||
      "Political committee";
 
    return [
      {
        category: "live_fec",
        entity_type:
          item?.entity_type ||
          "committee",
        entity_id:
          item?.committee_id ||
          item?.candidate_id ||
          item?.id ||
          `fec-${index}`,
        entity_name: name,
        state_code: getStateCode(item),
        title:
          `${name}: current FEC activity requires review`,
        summary:
          `Receipts ${raised}; disbursements ${spent}; cash on hand ${cash}.`,
        score,
        severity: severityFromScore(score),
        confidence: 90,
        metrics: {
          total_receipts: raised,
          total_disbursements: spent,
          cash_on_hand: cash,
          burn_ratio: burnRatio,
        },
        evidence: [
          evidence(
            "openfec",
            item,
            "Current OpenFEC record"
          ),
        ],
      },
    ];
  });
}
 
function genericLiveFindings(
  rows = [],
  {
    category,
    source,
    entityType,
    defaultConfidence = 75,
  }
) {
  return rows.flatMap((item, index) => {
    const title = clean(
      item?.title ||
        item?.headline ||
        item?.name ||
        item?.label ||
        item?.question
    );
 
    if (!title) {
      return [];
    }
 
    const score = clamp(
      item?.score ||
        item?.risk_score ||
        item?.priority_score ||
        item?.confidence ||
        60
    );
 
    return [
      {
        category,
        entity_type:
          item?.entity_type ||
          entityType,
        entity_id:
          item?.id ||
          item?.url ||
          `${category}-${index}`,
        entity_name:
          item?.entity_name ||
          item?.name ||
          title,
        state_code: getStateCode(item),
        title,
        summary:
          clean(
            item?.summary ||
              item?.description ||
              item?.detail ||
              item?.status
          ) ||
          `${title} requires political intelligence review.`,
        score,
        severity: severityFromScore(score),
        confidence: clamp(
          item?.confidence ||
            defaultConfidence
        ),
        metrics:
          item?.metrics ||
          {},
        evidence: [
          evidence(
            source,
            item,
            `${source} live-source record`
          ),
        ],
      },
    ];
  });
}
 
function deduplicate(findings = []) {
  const map = new Map();
 
  for (const finding of findings) {
    const key = [
      finding.category,
      finding.entity_type,
      finding.entity_id ||
        finding.entity_name ||
        finding.title,
      finding.state_code || "US",
    ].join(":");
 
    const existing = map.get(key);
 
    if (
      !existing ||
      finding.score > existing.score
    ) {
      map.set(key, finding);
    }
  }
 
  return [...map.values()];
}
 
function actionForFinding(finding) {
  const actions = {
    candidate_finance:
      "Review finance velocity, burn rate, and upcoming filing exposure.",
    execution:
      "Assign an owner, confirm deadline, and clear the blocking dependency.",
    vendor_capacity:
      "Validate coverage, identify a backup vendor, and resolve the capability gap.",
    state_operations:
      "Open a state recovery plan with county, staffing, vendor, and task owners.",
    strategy:
      "Accept, revise, or reject the recommendation and convert it into execution tasks.",
    decision:
      "Schedule an executive decision checkpoint and record the final disposition.",
    influence:
      "Validate the influence movement and prepare an engagement or containment response.",
    coalition:
      "Engage coalition leadership and address the highest fragmentation driver.",
    live_news:
      "Verify the development, assess campaign impact, and route the signal to the appropriate owner.",
    live_fec:
      "Review current FEC movement, cash position, burn rate, and filing exposure.",
    live_polling:
      "Validate methodology, compare movement, and update the campaign forecast.",
    live_legislation:
      "Assess policy and campaign implications and assign monitoring ownership.",
    election_administration:
      "Confirm the jurisdictional update and evaluate operational or compliance impact.",
    weather_field_risk:
      "Adjust field, event, travel, and voter-contact plans for the identified weather risk.",
  };
 
  return {
    title:
      actions[finding.category] ||
      "Review the finding and assign an accountable owner.",
    category: finding.category,
    entity_type: finding.entity_type,
    entity_id: finding.entity_id,
    state_code:
      finding.state_code || null,
    priority: finding.severity,
    due_window:
      finding.severity === "critical"
        ? "24h"
        : finding.severity === "high"
          ? "72h"
          : "7d",
  };
}
 
function summarize(findings, sourceHealth) {
  const critical = findings.filter(
    (item) =>
      item.severity === "critical"
  ).length;
 
  const high = findings.filter(
    (item) =>
      item.severity === "high"
  ).length;
 
  const healthySources =
    Object.values(sourceHealth).filter(
      (item) => item.ok
    ).length;
 
  const totalSources =
    Object.keys(sourceHealth).length;
 
  const liveFindings = findings.filter(
    (item) =>
      String(item.category).startsWith(
        "live_"
      ) ||
      [
        "election_administration",
        "weather_field_risk",
      ].includes(item.category)
  ).length;
 
  if (!findings.length) {
    return (
      `No material political intelligence risks were detected across ` +
      `${healthySources} of ${totalSources} available sources.`
    );
  }
 
  return (
    `${findings.length} material finding(s) detected, including ` +
    `${critical} critical and ${high} high-severity item(s). ` +
    `${liveFindings} finding(s) came from live external sources. ` +
    `${healthySources} of ${totalSources} configured sources responded successfully.`
  );
}
 
async function collectLivePoliticalSignals({
  sources = {},
  scope,
  timeHorizon,
  refresh = true,
  options = {},
}) {
  const stateCode =
    scope?.state_code || null;
 
  const query = [
    stateCode
      ? `${stateCode} politics elections campaigns`
      : "United States politics elections campaigns",
    timeHorizon
      ? `time horizon ${timeHorizon}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
 
  const candidateIds = asArray(
    sources.candidates
  )
    .map(
      (candidate) =>
        candidate?.fec_candidate_id ||
        candidate?.candidate_id ||
        candidate?.fec_id
    )
    .filter(Boolean)
    .slice(0, 5);
 
  const tasks = [];
 
  if (options.includeNews !== false) {
    tasks.push({
      key: "live_news",
      promise: searchCurrentPoliticalNews({
        query,
        state: stateCode || "",
        limit: 30,
      }),
    });
  }
 
  if (options.includePolling !== false) {
    tasks.push({
      key: "live_polling",
      promise: getPollingProviderData({
        query,
        state_code: stateCode,
        limit: 20,
        refresh,
      }),
    });
  }
 
  if (options.includeLegislation !== false) {
    tasks.push({
      key: "live_congress",
      promise: getCongressUpdates({
        query: stateCode ? "election" : "",
        limit: 20,
      }),
    });
  }
 
  if (
    options.includeElectionAdministration !==
    false
  ) {
    tasks.push({
      key:
        "live_election_administration",
      promise:
        getElectionAdministrationUpdates({
          query:
            stateCode
              ? `${stateCode} election administration voting ballot`
              : "election administration voting ballot",
          state: stateCode || "",
          limit: 20,
        }),
    });
  }
 
  if (options.includeWeatherRisk !== false) {
    tasks.push({
      key: "live_weather_risk",
      promise: stateCode
        ? getWeatherFieldRisk({
            state_code: stateCode,
            location: `${stateCode} field operations`,
          })
        : Promise.resolve({
            ok: true,
            configured: true,
            provider: "nws",
            summary:
              "National weather risk requires a state-scoped scan.",
            data: { records: [] },
            records: [],
            warnings: [],
            diagnostics: [],
            degraded: false,
            generated_at: new Date().toISOString(),
          }),
    });
  }
 
  if (options.includeFec !== false) {
    if (candidateIds.length) {
      candidateIds.forEach(
        (candidateId, index) => {
          tasks.push({
            key: `live_fec_${index}`,
            mergeKey: "live_fec",
            promise: getOpenFecFinance({
              candidateId,
              cycle: 2026,
            }),
          });
        }
      );
    } else {
      tasks.push({
        key: "live_fec",
        promise: getOpenFecFinance({
          cycle: 2026,
        }),
      });
    }
  }
 
  const settled =
    await Promise.allSettled(
      tasks.map((task) => task.promise)
    );
 
  const liveSources = {};
  const sourceHealth = {};
 
  tasks.forEach((task, index) => {
    const result = settled[index];
    const rows =
      result.status === "fulfilled"
        ? extractRows(result.value)
        : [];
 
    const sourceKey =
      task.mergeKey || task.key;
 
    liveSources[sourceKey] = [
      ...asArray(liveSources[sourceKey]),
      ...rows,
    ];
 
    const previousHealth =
      sourceHealth[sourceKey];
 
    const currentHealth =
      sourceHealthFromSettled(
        result,
        rows
      );
 
    sourceHealth[sourceKey] = {
      ...currentHealth,
      ok:
        Boolean(previousHealth?.ok) ||
        currentHealth.ok,
      configured:
        previousHealth?.configured === false
          ? false
          : currentHealth.configured,
      count:
        Number(previousHealth?.count || 0) +
        rows.length,
      degraded:
        Boolean(previousHealth?.degraded) ||
        currentHealth.degraded,
      error:
        previousHealth?.error ||
        currentHealth.error ||
        null,
      warnings: [
        ...asArray(previousHealth?.warnings),
        ...asArray(currentHealth.warnings),
      ],
      diagnostics: [
        ...asArray(previousHealth?.diagnostics),
        ...asArray(currentHealth.diagnostics),
      ],
      checked_at:
        currentHealth.checked_at,
    };
  });
 
  return {
    sources: liveSources,
    sourceHealth,
  };
}
 
export async function runPoliticalIntelligenceScan({
  workspaceId,
  scopeType = "national",
  scopeValue = null,
  stateCode = null,
  timeHorizon = "30d",
  limit = 50,
  includeLiveSources = true,
  refreshLiveSources = true,
  liveSourceOptions = {},
}) {
  const scope = {
    scope_type:
      clean(scopeType) || "national",
    scope_value:
      clean(scopeValue) || null,
    state_code:
      clean(
        stateCode ||
          (scopeType === "state"
            ? scopeValue
            : "")
      )
        .toUpperCase()
        .slice(0, 2) || null,
  };
 
  const collected =
    await collectPoliticalSignals({
      workspaceId,
      scope,
    });
 
  const sources =
    collected?.sources || {};
 
  const liveCollected =
    includeLiveSources
      ? await collectLivePoliticalSignals({
          sources,
          scope,
          timeHorizon,
          refresh: refreshLiveSources,
          options: liveSourceOptions,
        })
      : {
          sources: {},
          sourceHealth: {},
        };
 
  const liveSources =
    liveCollected.sources || {};
 
  const sourceHealth = {
    ...(collected?.sourceHealth || {}),
    ...(liveCollected?.sourceHealth || {}),
  };
 
  for (const [source, health] of Object.entries(sourceHealth)) {
    sourceHealth[source] = {
      ok: Boolean(health?.ok),
      configured:
        health?.configured !== false,
      degraded:
        Boolean(health?.degraded) ||
        health?.configured === false,
      count:
        Number(health?.count) || 0,
      error:
        health?.error || null,
      table:
        health?.table || null,
      provider:
        health?.provider || null,
      summary:
        health?.summary || null,
      warnings:
        asArray(health?.warnings),
      diagnostics:
        asArray(health?.diagnostics),
      cached:
        Boolean(health?.cached),
      stale:
        Boolean(health?.stale),
      details:
        health?.details || {},
      checked_at:
        health?.checked_at ||
        new Date().toISOString(),
    };
  }
 
  const findings = deduplicate([
    ...candidateFindings(
      sources.candidates
    ),
    ...taskFindings(
      sources.tasks
    ),
    ...vendorFindings(
      sources.vendors
    ),
    ...stateFindings(
      sources.state_operations_summary
    ),
    ...strategyFindings(
      sources.strategy_recommendations
    ),
    ...decisionFindings(
      sources.executive_decisions
    ),
    ...influenceFindings(
      sources.influence_scores
    ),
    ...coalitionFindings(
      sources.coalition_intelligence
    ),
    ...liveNewsFindings(
      liveSources.live_news
    ),
    ...liveFecFindings(
      liveSources.live_fec
    ),
    ...genericLiveFindings(
      liveSources.live_polling,
      {
        category: "live_polling",
        source: "polling_provider",
        entityType: "polling_signal",
        defaultConfidence: 78,
      }
    ),
    ...genericLiveFindings(
      liveSources.live_congress,
      {
        category:
          "live_legislation",
        source: "congress",
        entityType: "legislation",
        defaultConfidence: 90,
      }
    ),
    ...genericLiveFindings(
      liveSources.live_election_administration,
      {
        category:
          "election_administration",
        source:
          "election_administration",
        entityType:
          "election_administration_update",
        defaultConfidence: 92,
      }
    ),
    ...genericLiveFindings(
      liveSources.live_weather_risk,
      {
        category:
          "weather_field_risk",
        source: "weather",
        entityType: "field_risk",
        defaultConfidence: 85,
      }
    ),
  ])
    .sort(
      (a, b) => b.score - a.score
    )
    .slice(
      0,
      Math.max(
        1,
        Math.min(
          Number(limit) || 50,
          200
        )
      )
    )
    .map((item, index) => ({
      rank: index + 1,
      ...item,
    }));
 
  const risks = findings
    .filter((item) =>
      ["critical", "high"].includes(
        item.severity
      )
    )
    .map((item) => ({
      title: item.title,
      severity: item.severity,
      score: item.score,
      state_code:
        item.state_code || null,
    }));
 
  const opportunities = findings
    .filter((item) =>
      [
        "influence",
        "coalition",
        "candidate_finance",
        "live_fec",
        "live_polling",
      ].includes(item.category)
    )
    .filter(
      (item) =>
        item.confidence >= 70
    )
    .map((item) => ({
      title:
        `Opportunity review: ${item.entity_name}`,
      rationale: item.summary,
      confidence: item.confidence,
      state_code:
        item.state_code || null,
    }));
 
  const recommendedActions =
    findings
      .slice(0, 12)
      .map(actionForFinding);
 
  const evidenceRecords =
    findings.flatMap(
      (item) =>
        item.evidence || []
    );
 
  const result = {
    scan_key:
      `pif:${workspaceId}:${scope.scope_type}:${scope.scope_value || "all"}:${Date.now()}`,
    scope,
    time_horizon: timeHorizon,
    generated_at:
      new Date().toISOString(),
    executive_summary: summarize(
      findings,
      sourceHealth
    ),
    metrics: {
      finding_count:
        findings.length,
      critical_count:
        findings.filter(
          (item) =>
            item.severity === "critical"
        ).length,
      high_count:
        findings.filter(
          (item) =>
            item.severity === "high"
        ).length,
      medium_count:
        findings.filter(
          (item) =>
            item.severity === "medium"
        ).length,
      live_finding_count:
        findings.filter(
          (item) =>
            String(
              item.category
            ).startsWith("live_") ||
            [
              "election_administration",
              "weather_field_risk",
            ].includes(item.category)
        ).length,
      source_count:
        Object.keys(sourceHealth).length,
      healthy_source_count:
        Object.values(
          sourceHealth
        ).filter((item) => item.ok).length,
      degraded_source_count:
        Object.values(sourceHealth).filter(
          (item) => item.degraded
        ).length,
      unconfigured_source_count:
        Object.values(sourceHealth).filter(
          (item) => item.configured === false
        ).length,
    },
    findings,
    risks,
    opportunities,
    recommended_actions:
      recommendedActions,
    source_health: sourceHealth,
    evidence: evidenceRecords,
  };
 
  await saveSnapshot({
    workspaceId,
    scanKey: result.scan_key,
    scopeType:
      scope.scope_type,
    scopeValue:
      scope.scope_value,
    signalCount:
      findings.length,
    sourceHealth,
    payload: result,
  });
 
  return result;
}
 
export async function getPoliticalFabricOverview({
  workspaceId,
  includeLiveSources = true,
  refreshLiveSources = false,
}) {
  const [
    scan,
    watchlist,
    briefs,
  ] = await Promise.all([
    runPoliticalIntelligenceScan({
      workspaceId,
      limit: 50,
      includeLiveSources,
      refreshLiveSources,
    }),
    listWatchlist({
      workspaceId,
    }),
    listPoliticalBriefs({
      workspaceId,
      limit: 10,
    }),
  ]);
 
  return {
    ...scan,
    watchlist,
    recent_briefs: briefs,
  };
}
 
export async function createPoliticalBrief({
  workspaceId,
  userId,
  title,
  scopeType,
  scopeValue,
  stateCode,
  timeHorizon,
  includeLiveSources = true,
}) {
  const scan =
    await runPoliticalIntelligenceScan({
      workspaceId,
      scopeType,
      scopeValue,
      stateCode,
      timeHorizon,
      limit: 100,
      includeLiveSources,
      refreshLiveSources: true,
    });
 
  return savePoliticalBrief({
    workspaceId,
    userId,
    title:
      title ||
      `${scopeValue || "National"} Political Intelligence Brief`,
    scopeType:
      scan.scope.scope_type,
    scopeValue:
      scan.scope.scope_value,
    timeHorizon:
      scan.time_horizon,
    executiveSummary:
      scan.executive_summary,
    findings: scan.findings,
    risks: scan.risks,
    opportunities:
      scan.opportunities,
    recommendedActions:
      scan.recommended_actions,
    evidence: scan.evidence,
    metadata: {
      metrics: scan.metrics,
      source_health:
        scan.source_health,
    },
  });
}
 
export async function runPoliticalScenario({
  workspaceId,
  userId,
  name,
  scenarioType = "custom",
  assumptions = {},
}) {
  const baseline =
    await runPoliticalIntelligenceScan({
      workspaceId,
      scopeType:
        assumptions.scope_type ||
        "national",
      scopeValue:
        assumptions.scope_value ||
        null,
      stateCode:
        assumptions.state_code ||
        null,
      limit: 50,
      includeLiveSources: true,
      refreshLiveSources: false,
    });
 
  const turnoutShift =
    Number(
      assumptions.turnout_shift
    ) || 0;
 
  const fundingShift =
    Number(
      assumptions.funding_shift
    ) || 0;
 
  const vendorCapacityShift =
    Number(
      assumptions.vendor_capacity_shift
    ) || 0;
 
  const coalitionShift =
    Number(
      assumptions.coalition_shift
    ) || 0;
 
  const projectedOutcomes =
    baseline.findings
      .slice(0, 12)
      .map((finding) => {
        let delta = 0;
 
        if (
          [
            "candidate_finance",
            "live_fec",
          ].includes(finding.category)
        ) {
          delta -= fundingShift * 0.4;
        }
 
        if (
          finding.category ===
          "vendor_capacity"
        ) {
          delta -=
            vendorCapacityShift * 0.5;
        }
 
        if (
          finding.category ===
          "coalition"
        ) {
          delta -=
            coalitionShift * 0.45;
        }
 
        if (
          [
            "coalition",
            "state_operations",
            "live_polling",
          ].includes(finding.category)
        ) {
          delta -= turnoutShift * 0.25;
        }
 
        const projectedScore =
          clamp(
            finding.score - delta
          );
 
        return {
          entity_type:
            finding.entity_type,
          entity_id:
            finding.entity_id,
          entity_name:
            finding.entity_name,
          category:
            finding.category,
          baseline_score:
            finding.score,
          projected_score:
            projectedScore,
          projected_severity:
            severityFromScore(
              projectedScore
            ),
          delta:
            projectedScore -
            finding.score,
        };
      });
 
  const risks =
    projectedOutcomes
      .filter(
        (item) =>
          item.projected_score >= 70
      )
      .map((item) => ({
        title:
          `${item.entity_name} remains ${item.projected_severity}`,
        projected_score:
          item.projected_score,
        category:
          item.category,
      }));
 
  const recommendedActions =
    projectedOutcomes
      .sort(
        (a, b) =>
          b.projected_score -
          a.projected_score
      )
      .slice(0, 8)
      .map((item) => ({
        title:
          `Mitigate ${item.category} exposure for ${item.entity_name}`,
        priority:
          item.projected_severity,
        expected_score_reduction:
          Math.max(
            5,
            Math.round(
              item.projected_score *
                0.12
            )
          ),
      }));
 
  const confidence = clamp(
    55 +
      Object.keys(assumptions).length *
        4 +
      baseline.metrics
        .healthy_source_count *
        2,
    0,
    92
  );
 
  return saveScenario({
    workspaceId,
    userId,
    name,
    scenarioType,
    assumptions,
    baseline: {
      scan_key:
        baseline.scan_key,
      metrics:
        baseline.metrics,
      executive_summary:
        baseline.executive_summary,
    },
    projectedOutcomes,
    risks,
    recommendedActions,
    confidence,
  });
}
 
export {
  listPoliticalBriefs,
  getPoliticalBrief,
  listWatchlist,
  upsertWatchlist,
  deleteWatchlist,
};
