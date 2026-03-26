import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { hasPlanAccess, normalizePlan } from "../lib/plans.js";

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

async function resolveAuthFromToken(req) {
  const token = getBearerToken(req);

  if (!token) {
    const error = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  if (!process.env.JWT_SECRET) {
    const error = new Error("Missing JWT_SECRET");
    error.statusCode = 500;
    throw error;
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const error = new Error("Invalid or expired token");
    error.statusCode = 401;
    throw error;
  }

  const userId =
    payload?.id ||
    payload?.userId ||
    payload?.user_id ||
    payload?.sub ||
    payload?.user?.id ||
    null;

  let firmId =
    payload?.firm_id ||
    payload?.firmId ||
    payload?.user?.firm_id ||
    payload?.user?.firmId ||
    null;

  let role =
    payload?.role ||
    payload?.user?.role ||
    "user";

  if (!firmId && userId) {
    const userResult = await pool.query(
      `
        SELECT id, email, role, firm_id
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      const error = new Error("User not found");
      error.statusCode = 401;
      throw error;
    }

    const user = userResult.rows[0];
    firmId = user.firm_id;
    role = user.role || role;
  }

  if (!firmId) {
    const error = new Error("No firm is linked to this account");
    error.statusCode = 403;
    throw error;
  }

  const firmResult = await pool.query(
    `
      SELECT id, plan_tier, status, stripe_customer_id, stripe_subscription_id
      FROM firms
      WHERE id = $1
      LIMIT 1
    `,
    [firmId]
  );

  if (firmResult.rows.length === 0) {
    const error = new Error("Firm not found");
    error.statusCode = 404;
    throw error;
  }

  const firm = firmResult.rows[0];
  const planTier = normalizePlan(firm.plan_tier);

  req.auth = {
    token,
    payload,
    userId,
    firmId,
    role,
    planTier,
    firm,
  };

  return req.auth;
}

export function requireAuth(req, res, next) {
  resolveAuthFromToken(req)
    .then(() => next())
    .catch((error) => {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Authentication failed",
      });
    });
}

export function requirePlan(requiredPlan = "starter") {
  return async function planMiddleware(req, res, next) {
    try {
      const auth = await resolveAuthFromToken(req);

      if (!hasPlanAccess(auth.planTier, requiredPlan)) {
        return res.status(403).json({
          error: `This endpoint requires a ${requiredPlan} plan or higher`,
          requiredPlan,
          currentPlan: auth.planTier,
        });
      }

      return next();
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Authorization failed",
      });
    }
  };
}

export const requireStarter = requirePlan("starter");
export const requirePro = requirePlan("pro");
export const requireEnterprise = requirePlan("enterprise");
