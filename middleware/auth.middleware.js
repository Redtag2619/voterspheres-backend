import jwt from "jsonwebtoken";

let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.default || mod.db || mod.pool || mod.client || null;
      if (db) {
        cachedDb = db;
        return db;
      }
    } catch {
      // try next
    }
  }

  return null;
}

async function safeQuery(sql, params = []) {
  const db = await getDb();

  if (!db) {
    throw new Error("Database connection not available");
  }

  if (typeof db.query === "function") {
    return db.query(sql, params);
  }

  if (typeof db.execute === "function") {
    const [rows] = await db.execute(sql, params);
    return { rows };
  }

  throw new Error("Unsupported database driver");
}

async function findUserById(userId) {
  const attempts = [
    `
      select
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.role,
        u.firm_id
      from users u
      where u.id = $1
      limit 1
    `,
    `
      select
        u.id,
        null::text as first_name,
        null::text as last_name,
        u.email,
        u.role,
        u.firm_id
      from app_users u
      where u.id = $1
      limit 1
    `
  ];

  for (const sql of attempts) {
    try {
      const result = await safeQuery(sql, [userId]);
      if (result.rows?.length) {
        return result.rows[0];
      }
    } catch {
      // try next
    }
  }

  return null;
}

async function findFirmById(firmId) {
  if (!firmId) return null;

  try {
    const result = await safeQuery(
      `
        select
          id,
          name,
          slug,
          plan_tier,
          status,
          stripe_customer_id,
          stripe_subscription_id
        from firms
        where id = $1
        limit 1
      `,
      [firmId]
    );

    return result.rows?.[0] || null;
  } catch {
    return null;
  }
}

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
      payload?.user?.firm_id ||
      payload?.user?.firmId ||
      null;

    if (!userId) {
      return res.status(401).json({ error: "Unable to determine authenticated user" });
    }

    const user = await findUserById(userId);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const resolvedFirmId = user.firm_id || firmIdFromToken || null;
    const firm = await findFirmById(resolvedFirmId);

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
      stripe_subscription_id: firm?.stripe_subscription_id || null
    };

    req.auth = {
      token,
      payload,
      user: req.user,
      userId: req.user.id,
      firmId: req.user.firm_id,
      planTier: String(req.user.plan_tier || "starter").toLowerCase(),
      role: req.user.role
    };

    next();
  } catch (error) {
    return res.status(401).json({
      error: error.message || "Unauthorized"
    });
  }
}

export default requireAuth;
