import express from "express";
import { requireRoles } from "../middleware/roles.middleware.js";

const router = express.Router();

let cachedDb = null;
let cachedDbSource = null;

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
    "../lib/db.js"
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
      "Database connection not available. Beta admin route could not resolve your DB module."
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

async function ensureTable() {
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

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function normalizeDomain(domain = "") {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

async function hydrateAdminUser(req, _res, next) {
  try {
    const result = await safeQuery(
      `
        SELECT id, email, role, firm_id
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.authUser.id]
    );

    req.adminUser = result.rows?.[0] || null;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(requireRoles("admin"));
router.use(hydrateAdminUser);

router.get("/", async (req, res) => {
  try {
    await ensureTable();

    const q = String(req.query.q || "").trim();

    const result = await safeQuery(
      `
        SELECT
          id,
          email,
          domain,
          access_type,
          is_active,
          approved_by_user_id,
          approved_by_email,
          notes,
          created_at,
          updated_at
        FROM beta_access_approvals
        WHERE (
          $1 = ''
          OR COALESCE(email, '') ILIKE '%' || $1 || '%'
          OR COALESCE(domain, '') ILIKE '%' || $1 || '%'
          OR COALESCE(notes, '') ILIKE '%' || $1 || '%'
        )
        ORDER BY is_active DESC, created_at DESC
      `,
      [q]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load beta approvals"
    });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureTable();

    const {
      access_type = "email",
      email = "",
      domain = "",
      notes = ""
    } = req.body || {};

    const normalizedType = String(access_type || "").trim().toLowerCase();

    if (!["email", "domain"].includes(normalizedType)) {
      return res.status(400).json({ error: "Invalid access_type" });
    }

    if (normalizedType === "email") {
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail) {
        return res.status(400).json({ error: "Email is required" });
      }

      const result = await safeQuery(
        `
          INSERT INTO beta_access_approvals (
            email,
            domain,
            access_type,
            is_active,
            approved_by_user_id,
            approved_by_email,
            notes,
            created_at,
            updated_at
          )
          VALUES ($1, NULL, 'email', true, $2, $3, $4, NOW(), NOW())
          ON CONFLICT (LOWER(email)) WHERE email IS NOT NULL
          DO UPDATE SET
            is_active = true,
            approved_by_user_id = EXCLUDED.approved_by_user_id,
            approved_by_email = EXCLUDED.approved_by_email,
            notes = EXCLUDED.notes,
            updated_at = NOW()
          RETURNING *
        `,
        [
          normalizedEmail,
          req.adminUser?.id || null,
          req.adminUser?.email || null,
          notes || ""
        ]
      );

      return res.status(201).json({
        success: true,
        approval: result.rows?.[0] || null
      });
    }

    const normalizedDomain = normalizeDomain(domain);

    if (!normalizedDomain) {
      return res.status(400).json({ error: "Domain is required" });
    }

    const result = await safeQuery(
      `
        INSERT INTO beta_access_approvals (
          email,
          domain,
          access_type,
          is_active,
          approved_by_user_id,
          approved_by_email,
          notes,
          created_at,
          updated_at
        )
        VALUES (NULL, $1, 'domain', true, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (LOWER(domain)) WHERE domain IS NOT NULL
        DO UPDATE SET
          is_active = true,
          approved_by_user_id = EXCLUDED.approved_by_user_id,
          approved_by_email = EXCLUDED.approved_by_email,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING *
      `,
      [
        normalizedDomain,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        notes || ""
      ]
    );

    return res.status(201).json({
      success: true,
      approval: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to create beta approval"
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await ensureTable();

    const id = Number(req.params.id);
    const {
      is_active,
      notes
    } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid approval id" });
    }

    const existing = await safeQuery(
      `
        SELECT *
        FROM beta_access_approvals
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (!existing.rows?.length) {
      return res.status(404).json({ error: "Approval not found" });
    }

    const current = existing.rows[0];

    const result = await safeQuery(
      `
        UPDATE beta_access_approvals
        SET
          is_active = $1,
          notes = $2,
          approved_by_user_id = $3,
          approved_by_email = $4,
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `,
      [
        typeof is_active === "boolean" ? is_active : current.is_active,
        typeof notes === "string" ? notes : current.notes,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      approval: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update beta approval"
    });
  }
});

export default router;
