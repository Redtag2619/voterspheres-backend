import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing bearer token",
      });
    }

    const token = authHeader.slice(7).trim();

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        error: "Missing JWT_SECRET",
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        error: "Invalid or expired token",
      });
    }

    const userId =
      payload?.id ||
      payload?.userId ||
      payload?.user_id ||
      payload?.sub ||
      payload?.user?.id ||
      null;

    const firmIdFromToken =
      payload?.firm_id ||
      payload?.firmId ||
      payload?.user?.firm_id ||
      payload?.user?.firmId ||
      null;

    if (!userId && !firmIdFromToken) {
      return res.status(401).json({
        error: "Unable to determine authenticated user",
      });
    }

    let user = null;
    let firm = null;

    if (userId) {
      const userResult = await pool.query(
        `
          SELECT id, email, role, firm_id
          FROM app_users
          WHERE id = $1
          LIMIT 1
        `,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          error: "User not found",
        });
      }

      user = userResult.rows[0];
    }

    const resolvedFirmId = user?.firm_id || firmIdFromToken || null;

    if (!resolvedFirmId) {
      return res.status(403).json({
        error: "No firm linked to this account",
      });
    }

    const firmResult = await pool.query(
      `
        SELECT
          id,
          name,
          firm_name,
          email,
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

    if (firmResult.rows.length === 0) {
      return res.status(403).json({
        error: "Firm not found",
      });
    }

    firm = firmResult.rows[0];

    req.auth = {
      token,
      payload,
      user: user || null,
      userId: user?.id || userId || null,
      firm,
      firmId: firm.id,
      planTier: String(firm.plan_tier || "free").toLowerCase(),
      role: user?.role || null,
    };

    next();
  } catch (error) {
    console.error("requireAuth error:", error);
    return res.status(500).json({
      error: "Authentication failed",
    });
  }
}
