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

async function hydrateAdminUser(req, _res, next) {
  try {
    await ensureBetaTables();

    const userResult = await safeQuery(
      `
        SELECT id, email, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.authUser.id]
    );

    req.adminUser = userResult.rows?.[0] || null;
    return next();
  } catch (error) {
    return next(error);
  }
}

router.use(requireRoles("admin"));
router.use(hydrateAdminUser);

router.get("/requests", async (req, res) => {
  try {
    const { status = "", q = "" } = req.query;

    const result = await safeQuery(
      `
        SELECT
          id,
          full_name,
          firm_name,
          email,
          role,
          notes,
          source,
          status,
          reviewed_by_user_id,
          reviewed_by_email,
          reviewed_at,
          review_notes,
          created_at,
          updated_at
        FROM beta_access_requests
        WHERE ($1 = '' OR status = $1)
          AND (
            $2 = ''
            OR COALESCE(full_name, '') ILIKE '%' || $2 || '%'
            OR COALESCE(firm_name, '') ILIKE '%' || $2 || '%'
            OR COALESCE(email, '') ILIKE '%' || $2 || '%'
            OR COALESCE(role, '') ILIKE '%' || $2 || '%'
          )
        ORDER BY
          CASE status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            WHEN 'denied' THEN 2
            ELSE 3
          END,
          created_at DESC
      `,
      [status, q]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load beta requests"
    });
  }
});

router.get("/approvals", async (_req, res) => {
  try {
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
        ORDER BY updated_at DESC, created_at DESC
      `
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load approvals"
    });
  }
});

router.post("/approvals", async (req, res) => {
  try {
    const { email = "", domain = "", access_type = "email", notes = "" } = req.body || {};

    if (access_type === "email" && !email) {
      return res.status(400).json({ error: "Email is required for email approvals" });
    }

    if (access_type === "domain" && !domain) {
      return res.status(400).json({ error: "Domain is required for domain approvals" });
    }

    const normalizedEmail = String(email || "").trim().toLowerCase() || null;
    const normalizedDomain = String(domain || "").trim().toLowerCase() || null;

    let result;

    if (access_type === "domain") {
      result = await safeQuery(
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
        [normalizedDomain, req.adminUser.id, req.adminUser.email, notes]
      );
    } else {
      result = await safeQuery(
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
        [normalizedEmail, req.adminUser.id, req.adminUser.email, notes]
      );
    }

    return res.status(201).json({
      success: true,
      approval: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to save approval"
    });
  }
});

router.patch("/requests/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status = "", review_notes = "", auto_approve = false } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid request id" });
    }

    if (!["pending", "approved", "denied"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const existing = await safeQuery(
      `
        SELECT *
        FROM beta_access_requests
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const request = existing.rows?.[0];
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    const updated = await safeQuery(
      `
        UPDATE beta_access_requests
        SET
          status = $1,
          review_notes = $2,
          reviewed_by_user_id = $3,
          reviewed_by_email = $4,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `,
      [status, review_notes, req.adminUser.id, req.adminUser.email, id]
    );

    if (status === "approved" && auto_approve && request.email) {
      await safeQuery(
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
        `,
        [String(request.email).trim().toLowerCase(), req.adminUser.id, req.adminUser.email, review_notes]
      );
    }

    return res.json({
      success: true,
      request: updated.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update request"
    });
  }
});

router.delete("/approvals/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid approval id" });
    }

    await safeQuery(
      `
        UPDATE beta_access_approvals
        SET
          is_active = false,
          updated_at = NOW()
        WHERE id = $1
      `,
      [id]
    );

    return res.json({
      success: true
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to disable approval"
    });
  }
});

export default router;
