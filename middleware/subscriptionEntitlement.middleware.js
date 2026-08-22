import { requireAuth } from "./auth.middleware.js";
import {
  consumeUsage,
  hasEntitlement,
  resolveFirmEntitlements,
} from "../services/subscriptionEntitlements.service.js"; 

const RULES = [
  { prefix: "/production-hardening", internal: true },
  { prefix: "/launch-qa", internal: true },
  { prefix: "/launch-readiness", internal: true },
  { prefix: "/database-stability", internal: true },
  { prefix: "/launch-assets", internal: true },
  { prefix: "/launch-data-seeder", internal: true },
  { prefix: "/launch-automation", internal: true },
  { prefix: "/beta-admin", internal: true },
  { prefix: "/enterprise-leads-admin", internal: true },

  { prefix: "/political-intelligence-fabric", entitlement: "political_intelligence_fabric" },
  { prefix: "/national-digital-twin", entitlement: "national_digital_twin" },
  { prefix: "/campaign-simulation", entitlement: "predictive_simulation" },
  { prefix: "/autonomous-campaign-operations", entitlement: "autonomous_operations" },
  { prefix: "/national-election-command-center", entitlement: "national_command" },
  { prefix: "/consultant-business-suite", entitlement: "business_suite" },
  { prefix: "/executive-revenue", entitlement: "revenue_intelligence" },
  { prefix: "/revenue-pipeline", entitlement: "revenue_intelligence" },
  { prefix: "/opportunity-engine", entitlement: "opportunity_engine" },
  { prefix: "/client-portal", entitlement: "client_portal" },
  { prefix: "/firm-users", entitlement: "team_management" },
  { prefix: "/firm-invites", entitlement: "team_management" },

  { prefix: "/executive-intelligence-orchestrator", entitlement: "advanced_ai", metric: "ai_briefings" },
  { prefix: "/ai-campaign-copilot", entitlement: "advanced_ai", metric: "ai_briefings" },
  { prefix: "/executive-ai-command", entitlement: "advanced_ai", metric: "ai_briefings" },
  { prefix: "/ai-strategic-advisor", entitlement: "advanced_ai", metric: "ai_briefings" },
  { prefix: "/ai-tactical", entitlement: "campaign_operations" },
  { prefix: "/election-war-room", entitlement: "war_room" },
  { prefix: "/campaign-crm", entitlement: "campaign_crm" },
  { prefix: "/crm", entitlement: "campaign_crm" },
  { prefix: "/crm-dashboard", entitlement: "campaign_crm" },
  { prefix: "/mailops", entitlement: "mailops" },
  { prefix: "/task-ownership", entitlement: "task_ownership" },
  { prefix: "/coalitions", entitlement: "coalition_intelligence" },
  { prefix: "/influence", entitlement: "influence_intelligence" },
  { prefix: "/strategy", entitlement: "strategy_recommendations" },
  { prefix: "/dark-money-exposure", entitlement: "dark_money" },
  { prefix: "/relationships", entitlement: "relationship_intelligence" },
  { prefix: "/narrative-rapid-response", entitlement: "narrative_response" },
  { prefix: "/signal-workspace-matching", entitlement: "narrative_response" },
  { prefix: "/report-exports", entitlement: "report_exports", metric: "report_exports" },

  { prefix: "/executive-polling-intelligence", entitlement: "polling_intelligence" },
  { prefix: "/polling-intelligence", entitlement: "polling_intelligence" },
  { prefix: "/campaign-finance-intelligence", entitlement: "finance_intelligence" },
  { prefix: "/fec", entitlement: "finance_intelligence" },
  { prefix: "/candidates", entitlement: "candidate_intelligence" },
  { prefix: "/candidate-profiles", entitlement: "candidate_intelligence" },
  { prefix: "/donors", entitlement: "finance_intelligence" },
  { prefix: "/political-signals", entitlement: "political_signals" },
  { prefix: "/news-narrative", entitlement: "narrative_intelligence" },
  { prefix: "/states", entitlement: "state_operations" },
  { prefix: "/search", entitlement: "universal_search" },
  { prefix: "/notifications", entitlement: "notifications" },
  { prefix: "/live-data-refresh", entitlement: "live_data_refresh" },
  { prefix: "/tour/voice", entitlement: "platform_tour", metric: "voice_characters" },
];

function findRule(path = "") {
  return RULES.find((rule) => path === rule.prefix || path.startsWith(`${rule.prefix}/`));
}

function usageAmount(rule, req) {
  if (rule.metric === "voice_characters") {
    return String(req.body?.text || "").length;
  }
  return 1;
}

function shouldMeter(req) {
  return ["POST", "PUT", "PATCH"].includes(String(req.method || "").toUpperCase());
}

async function enforce(req, res, next, rule) {
  try {
    const resolution = await resolveFirmEntitlements({
      firmId: req.user?.firm_id,
      planTier: req.user?.plan_tier,
      user: req.user,
    });

    req.entitlements = resolution;

    if (rule.internal && !resolution.platformAdmin) {
      return res.status(403).json({
        error: "platform_admin_required",
        message: "This endpoint is reserved for VoterSpheres platform administrators.",
      });
    }

    if (rule.entitlement && !hasEntitlement(resolution, rule.entitlement)) {
      return res.status(403).json({
        error: "upgrade_required",
        message: `Your plan does not include ${rule.entitlement}.`,
        current_plan: resolution.plan,
        required_entitlement: rule.entitlement,
        upgrade_url: "/pricing",
      });
    }

    if (rule.metric && shouldMeter(req) && !resolution.platformAdmin) {
      const limit = Number(resolution.limits?.[rule.metric] ?? -1);
      const usage = await consumeUsage({
        firmId: req.user?.firm_id,
        metricKey: rule.metric,
        amount: usageAmount(rule, req),
        limit,
      });

      if (!usage.allowed) {
        return res.status(429).json({
          error: "plan_usage_limit_reached",
          message: `The monthly ${rule.metric} allowance has been reached.`,
          metric: rule.metric,
          used: usage.used,
          limit: usage.limit,
          current_plan: resolution.plan,
          upgrade_url: "/pricing",
        });
      }

      req.subscriptionUsage = usage;
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export function subscriptionEntitlementGateway(req, res, next) {
  const rule = findRule(req.path || req.url || "");
  if (!rule) return next();
  if (req.user) return enforce(req, res, next, rule);
  return requireAuth(req, res, () => enforce(req, res, next, rule));
}

export function requireEntitlement(entitlement) {
  return (req, res, next) =>
    enforce(req, res, next, { entitlement });
}

export default subscriptionEntitlementGateway;

