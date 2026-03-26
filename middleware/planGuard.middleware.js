import { pool } from "../db/pool.js";

const PLAN_ORDER = {
  trial: 1,
  pro: 2,
  enterprise: 3
};

function normalizePlan(plan) {
  const value = String(plan || "trial").toLowerCase();
  if (PLAN_ORDER[value]) return value;
  return "trial";
}

export function requirePlan(minPlan = "trial") {
  return async function planGuard(req, res, next) {
    try {
      if (req.user?.role === "platform_admin") {
        return next();
      }

      if (!req.user?.firm_id) {
        return res.status(403).json({ error: "firm subscription required" });
      }

      const result = await pool.query(
        `
        SELECT id, name, plan_tier, stripe_customer_id, stripe_subscription_status
        FROM firms
        WHERE id = $1
        LIMIT 1
        `,
        [req.user.firm_id]
      );

      const firm = result.rows[0];

      if (!firm) {
        return res.status(404).json({ error: "firm not found" });
      }

      const currentPlan = normalizePlan(firm.plan_tier);
      const neededPlan = normalizePlan(minPlan);

      if (PLAN_ORDER[currentPlan] < PLAN_ORDER[neededPlan]) {
        return res.status(403).json({
          error: "upgrade required",
          current_plan: currentPlan,
          required_plan: neededPlan,
          firm: {
            id: firm.id,
            name: firm.name
          }
        });
      }

      req.firm = firm;
      next();
    } catch (err) {
      next(err);
    }
  };
}
