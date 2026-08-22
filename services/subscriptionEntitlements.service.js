import { pool } from "../db/pool.js";

export const SUBSCRIPTION_ENTITLEMENT_BUILD = "7.0.0-unified-entitlements"; 

export const PLAN_ORDER = Object.freeze({
  free: 0,
  starter: 1,
  pro: 2,
  enterprise: 3,
});

export const PLAN_CATALOG = Object.freeze({
  free: {
    key: "free",
    label: "Free",
    monthlyPrice: 0,
    entitlements: ["billing", "platform_tour"],
    limits: {
      users: 1,
      workspaces: 0,
      tracked_candidates: 0,
      ai_briefings: 0,
      report_exports: 0,
      voice_characters: 0,
    },
  },
  starter: {
    key: "starter",
    label: "Starter",
    monthlyPrice: 99,
    entitlements: [
      "billing",
      "platform_tour",
      "dashboard",
      "candidate_intelligence",
      "finance_intelligence",
      "polling_intelligence",
      "political_signals",
      "narrative_intelligence",
      "power_rankings",
      "election_maps",
      "state_operations",
      "universal_search",
      "notifications",
      "team_management",
      "basic_ai_briefings",
      "basic_reports",
      "live_data_refresh",
    ],
    limits: {
      users: 1,
      workspaces: 1,
      tracked_candidates: 3,
      ai_briefings: 25,
      report_exports: 10,
      voice_characters: 100000,
    },
  },
  pro: {
    key: "pro",
    label: "Professional",
    monthlyPrice: 149,
    inherits: "starter",
    entitlements: [
      "executive_intelligence",
      "advanced_ai",
      "campaign_operations",
      "campaign_crm",
      "war_room",
      "task_ownership",
      "vendor_network",
      "mailops",
      "relationship_intelligence",
      "narrative_response",
      "dark_money",
      "coalition_intelligence",
      "influence_intelligence",
      "strategy_recommendations",
      "opportunity_heatmap",
      "branded_reports",
      "report_exports",
    ],
    limits: {
      users: 3,
      workspaces: 3,
      tracked_candidates: 15,
      ai_briefings: 150,
      report_exports: 100,
      voice_characters: 500000,
    },
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    monthlyPrice: 499,
    inherits: "pro",
    entitlements: [
      "enterprise_intelligence",
      "political_intelligence_fabric",
      "national_digital_twin",
      "predictive_simulation",
      "autonomous_operations",
      "national_command",
      "executive_operations_map",
      "business_suite",
      "revenue_intelligence",
      "opportunity_engine",
      "client_portal",
      "firm_administration",
      "multi_workspace_operations",
      "enterprise_reports",
    ],
    limits: {
      users: 15,
      workspaces: 15,
      tracked_candidates: -1,
      ai_briefings: 1000,
      report_exports: -1,
      voice_characters: 2000000,
    },
  },
});

function clean(value = "") {
  return String(value ?? "").trim();
}

export function normalizePlan(value = "free") {
  const plan = clean(value).toLowerCase();
  if (["enterprise", "agency", "premium", "business"].includes(plan)) return "enterprise";
  if (["pro", "professional"].includes(plan)) return "pro";
  if (["starter", "basic"].includes(plan)) return "starter";
  return "free";
}

export function isPlatformAdmin(user = {}) {
  const roleMatch = ["platform_admin", "super_admin"].includes(clean(user.role).toLowerCase());
  const allowedEmails = clean(process.env.PLATFORM_ADMIN_EMAILS)
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return roleMatch || allowedEmails.includes(clean(user.email).toLowerCase());
}

export function hasMinimumPlan(currentPlan, minimumPlan = "starter") {
  return PLAN_ORDER[normalizePlan(currentPlan)] >= PLAN_ORDER[normalizePlan(minimumPlan)];
}

function collectPlanEntitlements(planKey, collected = new Set()) {
  const plan = PLAN_CATALOG[normalizePlan(planKey)] || PLAN_CATALOG.free;
  if (plan.inherits) collectPlanEntitlements(plan.inherits, collected);
  for (const entitlement of plan.entitlements || []) collected.add(entitlement);
  return collected;
}

export function getPlanDefinition(planKey = "free") {
  const key = normalizePlan(planKey);
  const plan = PLAN_CATALOG[key];
  return {
    ...plan,
    entitlements: [...collectPlanEntitlements(key)],
    limits: { ...plan.limits },
  };
}

async function getOverrides(firmId) {
  if (!firmId) return [];
  try {
    const result = await pool.query(
      `SELECT entitlement_key, enabled, limit_override
         FROM firm_entitlement_overrides
        WHERE firm_id = $1
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [firmId]
    );
    return result.rows;
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

export async function resolveFirmEntitlements({ firmId, planTier, user } = {}) {
  const platformAdmin = isPlatformAdmin(user);
  const plan = getPlanDefinition(platformAdmin ? "enterprise" : planTier);
  const entitlementSet = new Set(plan.entitlements);
  const limits = { ...plan.limits };
  const overrides = platformAdmin ? [] : await getOverrides(firmId);

  for (const override of overrides) {
    if (override.enabled) entitlementSet.add(override.entitlement_key);
    else entitlementSet.delete(override.entitlement_key);
    if (override.limit_override !== null && override.limit_override !== undefined) {
      limits[override.entitlement_key] = Number(override.limit_override);
    }
  }

  return {
    build: SUBSCRIPTION_ENTITLEMENT_BUILD,
    plan: platformAdmin ? "enterprise" : plan.key,
    planLabel: platformAdmin ? "Platform Administrator" : plan.label,
    monthlyPrice: platformAdmin ? null : plan.monthlyPrice,
    platformAdmin,
    entitlements: [...entitlementSet].sort(),
    limits,
  };
}

export function hasEntitlement(resolution, entitlementKey) {
  return Boolean(
    resolution?.platformAdmin ||
      resolution?.entitlements?.includes(clean(entitlementKey))
  );
}

function currentPeriodStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getUsage(firmId) {
  if (!firmId) return {};
  const result = await pool.query(
    `SELECT metric_key, used
       FROM subscription_usage
      WHERE firm_id = $1 AND period_start = $2`,
    [firmId, currentPeriodStart()]
  );
  return Object.fromEntries(result.rows.map((row) => [row.metric_key, Number(row.used)]));
}

export async function consumeUsage({ firmId, metricKey, amount = 1, limit = -1 } = {}) {
  if (!firmId || !metricKey || Number(limit) < 0) {
    return { allowed: true, used: 0, limit: Number(limit) };
  }

  const increment = Math.max(0, Number(amount) || 0);
  const result = await pool.query(
    `INSERT INTO subscription_usage (firm_id, metric_key, period_start, used)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (firm_id, metric_key, period_start)
     DO UPDATE SET used = subscription_usage.used + EXCLUDED.used, updated_at = NOW()
     RETURNING used`,
    [firmId, metricKey, currentPeriodStart(), increment]
  );

  const used = Number(result.rows[0]?.used || 0);
  if (used > Number(limit)) {
    await pool.query(
      `UPDATE subscription_usage
          SET used = GREATEST(0, used - $4), updated_at = NOW()
        WHERE firm_id = $1 AND metric_key = $2 AND period_start = $3`,
      [firmId, metricKey, currentPeriodStart(), increment]
    );
    return { allowed: false, used: used - increment, limit: Number(limit) };
  }

  return { allowed: true, used, limit: Number(limit) };
}

export default {
  PLAN_CATALOG,
  normalizePlan,
  hasMinimumPlan,
  getPlanDefinition,
  resolveFirmEntitlements,
  hasEntitlement,
  getUsage,
  consumeUsage,
  isPlatformAdmin,
};
