import pool from "../db.js";

const PLAN_LIMITS = {
  free: 25,
  pro: 1000,
  agency: Infinity
};

export default async function usageMiddleware(req, res, next) {
  try {
    const organizationId = req.user.organizationId;

    // Get organization subscription
    const orgResult = await pool.query(
      `SELECT subscription_plan FROM organizations WHERE id = $1`,
      [organizationId]
    );

    const organization = orgResult.rows[0];

    if (!organization) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const plan = organization.subscription_plan;
    const limit = PLAN_LIMITS[plan] || 25;

    if (limit === Infinity) {
      return next();
    }

    // Count this month's usage
    const usageResult = await pool.query(
      `SELECT COUNT(*) FROM usage_logs
       WHERE organization_id = $1
       AND action_type = 'candidate_search'
       AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)`,
      [organizationId]
    );

    const count = parseInt(usageResult.rows[0].count);

    if (count >= limit) {
      return res.status(403).json({
        error: "Monthly search limit reached. Upgrade your plan."
      });
    }

    next();

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Usage check failed" });
  }
}
