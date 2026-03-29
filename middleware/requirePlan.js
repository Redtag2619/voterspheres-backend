const PLAN_LEVELS = {
  free: 0,
  starter: 1,
  pro: 2,
  enterprise: 3,
};

function normalizePlan(plan) {
  const value = String(plan || "free").toLowerCase().trim();

  if (["starter", "basic"].includes(value)) return "starter";
  if (["pro", "professional"].includes(value)) return "pro";
  if (["enterprise", "business"].includes(value)) return "enterprise";

  return "free";
}

function hasRequiredPlan(currentPlan, requiredPlan) {
  const current = PLAN_LEVELS[normalizePlan(currentPlan)] ?? 0;
  const needed = PLAN_LEVELS[normalizePlan(requiredPlan)] ?? 0;
  return current >= needed;
}

export function requirePlan(requiredPlan = "starter") {
  return (req, res, next) => {
    const currentPlan = req.auth?.planTier || "free";

    if (!hasRequiredPlan(currentPlan, requiredPlan)) {
      return res.status(403).json({
        error: "Upgrade required",
        message: `This endpoint requires the ${requiredPlan} plan.`,
        currentPlan,
        requiredPlan,
      });
    }

    next();
  };
}

export const requireStarter = requirePlan("starter");
export const requirePro = requirePlan("pro");
export const requireEnterprise = requirePlan("enterprise");
