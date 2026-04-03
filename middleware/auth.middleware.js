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

    if (!userId) {
      return res.status(401).json({ error: "Unable to determine authenticated user" });
    }

    const userResult = await safeQuery(
      `
        select
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          u.role,
          u.firm_id,
          f.name as firm_name,
          f.slug as firm_slug,
          f.plan_tier,
          f.status as firm_status,
          f.stripe_customer_id,
          f.stripe_subscription_id
        from users u
        left join firms f on f.id = u.firm_id
        where u.id = $1
        limit 1
      `,
      [userId]
    );

    const user = userResult.rows?.[0];

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = {
      id: user.id,
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email,
      role: user.role || "user",
      firm_id: user.firm_id || null,
      firm_name: user.firm_name || null,
      firm_slug: user.firm_slug || null,
      plan_tier: user.plan_tier || "starter",
      firm_status: user.firm_status || "active",
      stripe_customer_id: user.stripe_customer_id || null,
      stripe_subscription_id: user.stripe_subscription_id || null
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
