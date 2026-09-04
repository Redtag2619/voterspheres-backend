import jwt from "jsonwebtoken";
import pool from "../config/database.js";

function extractToken(req) {
  const authHeader = String(
    req.headers?.authorization || ""
  ).trim();

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  /*
   * Native EventSource cannot send Authorization headers.
   * Keep query-token support for authenticated SSE endpoints.
   *
   * This token is still fully verified below with JWT verification.
   */
  const queryToken = req.query?.token
    ? String(req.query.token).trim()
    : "";

  return queryToken || "";
}

function getJwtSecret() {
  const secret = String(
    process.env.JWT_SECRET || ""
  ).trim();

  if (secret) {
    return secret;
  }

  /*
   * Never permit the development fallback in production.
   */
  if (
    String(process.env.NODE_ENV || "")
      .trim()
      .toLowerCase() === "production"
  ) {
    throw new Error(
      "JWT_SECRET is required in production."
    );
  }

  return "dev-secret";
}

function normalizePositiveInteger(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function normalizeRole(value = "") {
  return clean(value || "user").toLowerCase();
}

function normalizePlanTier(value = "") {
  return clean(value || "starter").toLowerCase();
}

function normalizeFirmStatus(value = "") {
  return clean(value || "active").toLowerCase();
}

function normalizeSubscriptionStatus(value = "") {
  const status = clean(value).toLowerCase();
  return status || null;
}

function unauthorized(
  res,
  error = "Unauthorized"
) {
  return res.status(401).json({
    error,
  });
}

export async function requireAuth(
  req,
  res,
  next
) {
  try {
    const token = extractToken(req);

    if (!token) {
      return unauthorized(
        res,
        "Missing bearer token"
      );
    }

    const secret = getJwtSecret();

    let payload;

    try {
      payload = jwt.verify(
        token,
        secret,
        {
          algorithms: ["HS256"],
        }
      );
    } catch (error) {
      const name = clean(error?.name);

      if (name === "TokenExpiredError") {
        return unauthorized(
          res,
          "Token expired"
        );
      }

      if (name === "JsonWebTokenError") {
        return unauthorized(
          res,
          "Invalid token"
        );
      }

      if (name === "NotBeforeError") {
        return unauthorized(
          res,
          "Token is not active"
        );
      }

      return unauthorized(
        res,
        "Unauthorized"
      );
    }

    const userId =
      normalizePositiveInteger(
        payload?.id
      ) ||
      normalizePositiveInteger(
        payload?.userId
      ) ||
      normalizePositiveInteger(
        payload?.user_id
      ) ||
      normalizePositiveInteger(
        payload?.sub
      ) ||
      null;

    if (!userId) {
      return unauthorized(
        res,
        "Unable to determine authenticated user"
      );
    }

    /*
     * The database is authoritative for current user identity
     * and firm ownership.
     *
     * Token firm claims are retained only as a compatibility
     * fallback if the user record has no firm_id.
     */
    const firmIdFromToken =
      normalizePositiveInteger(
        payload?.firm_id
      ) ||
      normalizePositiveInteger(
        payload?.firmId
      ) ||
      null;

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

    const user =
      userResult.rows?.[0] || null;

    if (!user) {
      return unauthorized(
        res,
        "User not found"
      );
    }

    const databaseFirmId =
      normalizePositiveInteger(
        user.firm_id
      );

    const resolvedFirmId =
      databaseFirmId ||
      firmIdFromToken ||
      null;

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
            subscription_status,
            current_period_end,
            stripe_customer_id,
            stripe_subscription_id
          FROM firms
          WHERE id = $1
          LIMIT 1
        `,
        [resolvedFirmId]
      );

      firm =
        firmResult.rows?.[0] ||
        null;

      /*
       * If a firm ID is associated with the user/token but
       * the corresponding firm no longer exists, do not let
       * the request proceed with a phantom tenant.
       */
      if (!firm) {
        return unauthorized(
          res,
          "Firm not found"
        );
      }
    }

    const role =
      normalizeRole(user.role);

    const planTier =
      normalizePlanTier(
        firm?.plan_tier
      );

    const firmStatus =
      normalizeFirmStatus(
        firm?.status
      );

    const subscriptionStatus =
      normalizeSubscriptionStatus(
        firm?.subscription_status
      );

    req.user = {
      id: user.id,

      first_name:
        clean(user.first_name),

      last_name:
        clean(user.last_name),

      email:
        clean(user.email),

      role,

      firm_id:
        resolvedFirmId,

      firm_name:
        firm?.name || null,

      firm_slug:
        firm?.slug || null,

      plan_tier:
        planTier,

      firm_status:
        firmStatus,

      subscription_status:
        subscriptionStatus,

      current_period_end:
        firm?.current_period_end ||
        null,

      stripe_customer_id:
        firm?.stripe_customer_id ||
        null,

      stripe_subscription_id:
        firm?.stripe_subscription_id ||
        null,
    };

    req.auth = {
      token,

      payload,

      user:
        req.user,

      userId:
        req.user.id,

      user_id:
        req.user.id,

      firmId:
        req.user.firm_id,

      firm_id:
        req.user.firm_id,

      planTier,

      plan_tier:
        planTier,

      role,

      subscriptionStatus,

      subscription_status:
        subscriptionStatus,

      firmStatus,

      firm_status:
        firmStatus,
    };

    return next();
  } catch (error) {
    /*
     * Configuration failures should be loud in production,
     * but the API response should not expose internal details.
     */
    if (
      error?.message ===
      "JWT_SECRET is required in production."
    ) {
      console.error(
        "[auth] production configuration error:",
        error.message
      );

      return res.status(500).json({
        error:
          "Authentication service is not configured.",
      });
    }

    console.error(
      "[auth] authentication failed:",
      error?.message || error
    );

    return unauthorized(
      res,
      "Unauthorized"
    );
  }
}

export default requireAuth;
