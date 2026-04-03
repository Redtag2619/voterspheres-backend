import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

async function getDb() {
  const candidates = [
    "../config/database.js",
    "../db.js",
    "../config/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      return mod.default || mod.db || mod.pool || mod.client || null;
    } catch {
      // keep trying
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

  throw new Error("Database driver does not support query/execute");
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function ensureUniqueFirmSlug(baseSlug) {
  const slugBase = baseSlug || `firm-${Date.now()}`;

  const { rows } = await safeQuery(
    `
      select slug
      from firms
      where slug = $1
         or slug like $2
    `,
    [slugBase, `${slugBase}-%`]
  );

  const existing = new Set((rows || []).map((r) => r.slug));

  if (!existing.has(slugBase)) {
    return slugBase;
  }

  let counter = 2;
  while (existing.has(`${slugBase}-${counter}`)) {
    counter += 1;
  }

  return `${slugBase}-${counter}`;
}

function signToken(user) {
  const secret = process.env.JWT_SECRET || "dev-secret";
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      firm_id: user.firm_id
    },
    secret,
    { expiresIn: "7d" }
  );
}

router.post("/signup", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      firm_name,
      email,
      password,
      role = "admin"
    } = req.body || {};

    if (!first_name || !last_name || !firm_name || !email || !password) {
      return res.status(400).json({ error: "Missing required signup fields" });
    }

    const existingUser = await safeQuery(
      `select id from users where lower(email) = lower($1) limit 1`,
      [email]
    );

    if (existingUser.rows?.length) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const slug = await ensureUniqueFirmSlug(slugify(firm_name));

    const firmInsert = await safeQuery(
      `
        insert into firms (
          name,
          slug,
          plan_tier,
          status,
          created_at
        )
        values ($1, $2, $3, $4, now())
        returning id, name, slug, plan_tier, status
      `,
      [firm_name, slug, "starter", "active"]
    );

    const firm = firmInsert.rows[0];

    const password_hash = await bcrypt.hash(password, 10);

    const userInsert = await safeQuery(
      `
        insert into users (
          first_name,
          last_name,
          email,
          password_hash,
          role,
          firm_id,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, now())
        returning id, first_name, last_name, email, role, firm_id
      `,
      [first_name, last_name, email, password_hash, role, firm.id]
    );

    const user = userInsert.rows[0];
    const token = signToken(user);

    return res.status(201).json({
      token,
      user,
      firm
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Signup failed"
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await safeQuery(
      `
        select
          id,
          first_name,
          last_name,
          email,
          password_hash,
          role,
          firm_id
        from users
        where lower(email) = lower($1)
        limit 1
      `,
      [email]
    );

    const user = result.rows?.[0];

    if (!user) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password_hash || "");

    if (!valid) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const token = signToken(user);

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        firm_id: user.firm_id
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Login failed"
    });
  }
});

router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const secret = process.env.JWT_SECRET || "dev-secret";
    const decoded = jwt.verify(token, secret);

    const result = await safeQuery(
      `
        select
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          u.role,
          u.firm_id,
          f.name as firm_name,
          f.plan_tier,
          f.status
        from users u
        left join firms f on f.id = u.firm_id
        where u.id = $1
        limit 1
      `,
      [decoded.id]
    );

    const user = result.rows?.[0];

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(user);
  } catch (error) {
    return res.status(401).json({
      error: error.message || "Unauthorized"
    });
  }
});

export default router;
