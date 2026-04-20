import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();

let cachedDb = null;
let cachedDbSource = null;

function parseCsv(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function getBetaConfig() {
  return {
    enabled: String(process.env.BETA_ACCESS_ENABLED || "true").toLowerCase() === "true",
    publicSignupEnabled:
      String(process.env.BETA_PUBLIC_SIGNUP_ENABLED || "false").toLowerCase() === "true",
    allowedEmails: parseCsv(process.env.BETA_ALLOWLIST_EMAILS || ""),
    allowedDomains: parseCsv(process.env.BETA_ALLOWLIST_DOMAINS || ""),
    inviteCode: String(process.env.BETA_INVITE_CODE || "").trim(),
    message:
      process.env.BETA_ACCESS_MESSAGE ||
      "VoterSpheres is currently in a private beta. Your email is not yet approved for access."
  };
}

async function getDb() {
  if (cachedDb) {
    return { db: cachedDb, source: cachedDbSource };
  }

  const candidates = [
    "../config/database.js",
    "../config/db.js",
    "../db.js",
    "../database.js",
    "../lib/database.js",
    "../lib/db.js",
    "../services/../config/database.js",
    "../services/../config/db.js"
  ];

  for (const path of candidates) {
    try {
      const mod = await import(path);
      const db = mod.default || mod.db || mod.pool || mod.client || null;

      if (db) {
        cachedDb = db;
        cachedDbSource = path;
        return { db, source: path };
      }
    } catch {
      // try next
    }
  }

  return { db: null, source: null };
}

async function safeQuery(sql, params = []) {
  const { db, source } = await getDb();

  if (!db) {
    throw new Error(
      "Database connection not available. Auth route could not resolve your DB module."
    );
  }

  if (typeof db.query === "function") {
    const result = await db.query(sql, params);
    return { ...result, _dbSource: source };
  }

  if (typeof db.execute === "function") {
    const [rows] = await db.execute(sql, params);
    return { rows, _dbSource: source };
  }

  throw new Error(`Unsupported DB driver from source: ${source}`);
}

async function ensureBetaTables() {
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS beta_access_requests (
      id SERIAL PRIMARY KEY,
      full_name TEXT,
      firm_name TEXT,
      email TEXT NOT NULL,
      role TEXT,
      notes TEXT,
      source TEXT DEFAULT 'landing_page',
      status TEXT DEFAULT 'pending',
      reviewed_by_user_id INTEGER,
      reviewed_by_email TEXT,
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE TABLE IF NOT EXISTS beta_access_approvals (
      id SERIAL PRIMARY KEY,
      email TEXT,
      domain TEXT,
      access_type TEXT NOT NULL DEFAULT 'email',
      is_active BOOLEAN DEFAULT true,
      approved_by_user_id INTEGER,
      approved_by_email TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await safeQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_beta_access_approvals_email
      ON beta_access_approvals (LOWER(email))
      WHERE email IS NOT NULL
  `);

  await safeQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_beta_access_approvals_domain
      ON beta_access_approvals (LOWER(domain))
      WHERE domain IS NOT NULL
  `);
}

async function isApprovedInDb(email) {
  await ensureBetaTables();

  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const domain = normalized.split("@")[1] || "";

  const result = await safeQuery(
    `
      SELECT id
      FROM beta_access_approvals
      WHERE is_active = true
        AND (
          LOWER(email) = LOWER($1)
          OR (LOWER(domain) = LOWER($2) AND access_type = 'domain')
        )
      LIMIT 1
    `,
    [normalized, domain]
  );

  return Boolean(result.rows?.length);
}

async function isEmailApproved(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const config = getBetaConfig();
  if (!config.enabled) return true;
  if (config.publicSignupEnabled) return true;
  if (config.allowedEmails.includes(normalized)) return true;

  const domain = normalized.split("@")[1] || "";
  if (domain && config.allowedDomains.includes(domain)) return true;

  return await isApprovedInDb(normalized);
}

function isInviteCodeApproved(inviteCode) {
  const config = getBetaConfig();
  if (!config.enabled) return true;
  if (!config.inviteCode) return false;
  return String(inviteCode || "").trim() === config.inviteCode;
}

async function assertBetaSignupAccess(email, inviteCode = "") {
  const config = getBetaConfig();

  if (!config.enabled) return;
  if (config.publicSignupEnabled) return;
  if (await isEmailApproved(email)) return;
  if (isInviteCodeApproved(inviteCode)) return;

  const error = new Error(config.message);
  error.status = 403;
  throw error;
}

async function assertBetaLoginAccess(email) {
  const config = getBetaConfig();

  if (!config.enabled) return;
  if (await isEmailApproved(email)) return;

  const error = new Error(config.message);
  error.status = 403;
  throw error;
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

router.get("/debug/db", async (_req, res) => {
  try {
    const { db, source } = await getDb();

    return res.status(200).json({
      ok: Boolean(db),
      source: source || null
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "DB debug failed"
    });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      firm_name,
      email,
      password,
      role = "admin",
      invite_code = ""
    } = req.body || {};

    if (!first_name || !last_name || !firm_name || !email || !password) {
      return res.status(400).json({ error: "Missing required signup fields" });
    }

    try {
  await assertBetaSignupAccess(email, invite_code);
} catch (betaError) {
  // 🚨 Capture blocked signup attempt
  try {
    await safeQuery(`
      CREATE TABLE IF NOT EXISTS pending_signup_attempts (
        id SERIAL PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        firm_name TEXT,
        email TEXT NOT NULL,
        requested_role TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        source TEXT DEFAULT 'signup_form',
        approved_approval_id INTEGER,
        reviewed_by_user_id INTEGER,
        reviewed_by_email TEXT,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await safeQuery(
      `
        INSERT INTO pending_signup_attempts (
          first_name,
          last_name,
          firm_name,
          email,
          requested_role,
          notes,
          status,
          source,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,'pending','signup_form',NOW(),NOW())
      `,
      [
        first_name || "",
        last_name || "",
        firm_name || "",
        normalizeEmail(email),
        role || "user",
        "Blocked by private beta gate"
      ]
    );
  } catch (logError) {
    console.error("Failed to log pending signup:", logError);
  }

  return res.status(betaError.status || 403).json({
    error: betaError.message
  });
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
    return res.status(error.status || 500).json({
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

    await assertBetaLoginAccess(email);

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
    return res.status(error.status || 500).json({
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
