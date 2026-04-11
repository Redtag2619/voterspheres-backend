import jwt from "jsonwebtoken";
import pool from "../config/database.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const secret = process.env.JWT_SECRET || "dev-secret";
    const payload = jwt.verify(token, secret);

    const userId =
      payload?.id ||
      payload?.userId ||
      payload?.user_id ||
      payload?.sub ||
      null;

    const firmIdFromToken =
      payload?.firm_id ||
      payload?.firmId ||
      null;

    if (!userId) {
      return res.status(401).json({
        error: "Unable to determine authenticated user",
      });
    }

    const userResult = await pool.query(
      `
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          u.role,
          u.firm_id
        FROM users u
        WHERE u.id = $1
        LIMIT 1
      `,
      [userId]
    );

    const user = userResult.rows?.[0];

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const resolvedFirmId = user.firm_id || firmIdFromToken || null;

    let firm = null;
    if (resolvedFirmId) {
      const firmResult = await pool.query(
        `
          SELECT
            id,
            name,
            slug,
            plan_tier,
            status,
            stripe_customer_id,
            stripe_subscription_id
          FROM firms
          WHERE id = $1
          LIMIT 1
        `,
        [resolvedFirmId]
      );

      firm = firmResult.rows?.[0] || null;
    }

    req.user = {
      id: user.id,
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email,
      role: user.role || "user",
      firm_id: resolvedFirmId,
      firm_name: firm?.name || null,
      firm_slug: firm?.slug || null,
      plan_tier: firm?.plan_tier || "starter",
      firm_status: firm?.status || "active",
      stripe_customer_id: firm?.stripe_customer_id || null,
      stripe_subscription_id: firm?.stripe_subscription_id || null,
    };

    req.auth = {
      token,
      payload,
      user: req.user,
      userId: req.user.id,
      firmId: req.user.firm_id,
      planTier: String(req.user.plan_tier || "starter").toLowerCase(),
      role: req.user.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      error: error.message || "Unauthorized",
    });
  }
}

export default requireAuth;
