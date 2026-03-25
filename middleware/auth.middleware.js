import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ error: "authentication required" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "JWT_SECRET is not configured" });
    }

    const decoded = jwt.verify(token, secret);

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.role,
        u.firm_id,
        u.status,
        f.name AS firm_name,
        f.plan_tier,
        f.stripe_customer_id,
        f.stripe_subscription_id,
        f.stripe_subscription_status
      FROM app_users u
      LEFT JOIN firms f ON f.id = u.firm_id
      WHERE u.id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "user not found" });
    }

    if (user.status !== "active") {
      return res.status(403).json({ error: "user account is not active" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid or expired token" });
  }
}

export function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: "authentication required" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "insufficient permissions" });
    }

    next();
  };
}

function planRank(plan = "trial") {
  const value = String(plan || "trial").toLowerCase();
  if (value === "enterprise") return 3;
  if (value === "pro") return 2;
  return 1;
}

export function requirePlan(...allowedPlans) {
  return function planGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: "authentication required" });
    }

    const currentPlan = req.user.plan_tier || "trial";
    const currentRank = planRank(currentPlan);
    const allowedRank = Math.min(...allowedPlans.map(planRank));

    if (currentRank < allowedRank) {
      return res.status(402).json({
        error: "subscription upgrade required",
        current_plan: currentPlan,
        required_plan: allowedPlans[0]
      });
    }

    next();
  };
}

export async function requireCampaignFirmAccess(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "authentication required" });
    }

    const campaignId = Number(req.params.id);
    if (!campaignId) {
      return res.status(400).json({ error: "valid campaign id required" });
    }

    const result = await pool.query(
      `
      SELECT id, firm_id
      FROM campaigns
      WHERE id = $1
      LIMIT 1
      `,
      [campaignId]
    );

    const campaign = result.rows[0];

    if (!campaign) {
      return res.status(404).json({ error: "campaign not found" });
    }

    if (!req.user.firm_id || Number(campaign.firm_id) !== Number(req.user.firm_id)) {
      return res.status(403).json({ error: "campaign does not belong to your firm" });
    }

    req.campaign = campaign;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireFirmParamAccess(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "authentication required" });
    }

    const firmId = Number(req.params.id);
    if (!firmId) {
      return res.status(400).json({ error: "valid firm id required" });
    }

    if (Number(req.user.firm_id) !== firmId) {
      return res.status(403).json({ error: "firm does not belong to current user" });
    }

    next();
  } catch (err) {
    next(err);
  }
}
