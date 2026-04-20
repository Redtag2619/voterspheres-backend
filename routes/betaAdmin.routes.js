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

async function ensureTables() {
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

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_pending_signup_attempts_email
      ON pending_signup_attempts (LOWER(email))
  `);

  await safeQuery(`
    CREATE INDEX IF NOT EXISTS idx_pending_signup_attempts_status
      ON pending_signup_attempts (status)
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
    await ensureTables();

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
    await ensureTables();

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
    await ensureTables();

    const id = Number(req.params.id);
    const { is_active, notes } = req.body || {};

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

router.get("/pending-signups", async (req, res) => {
  try {
    await ensureTables();

    const q = String(req.query.q || "").trim();

    const result = await safeQuery(
      `
        SELECT
          psa.id,
          psa.first_name,
          psa.last_name,
          psa.firm_name,
          psa.email,
          psa.requested_role,
          psa.notes,
          psa.status,
          psa.source,
          psa.approved_approval_id,
          psa.reviewed_by_user_id,
          psa.reviewed_by_email,
          psa.reviewed_at,
          psa.created_at,
          psa.updated_at,
          EXISTS (
            SELECT 1
            FROM beta_access_approvals baa
            WHERE baa.is_active = true
              AND baa.email IS NOT NULL
              AND LOWER(baa.email) = LOWER(psa.email)
          ) AS already_approved
        FROM pending_signup_attempts psa
        WHERE psa.status IN ('pending', 'approved', 'rejected')
          AND (
            $1 = ''
            OR COALESCE(psa.email, '') ILIKE '%' || $1 || '%'
            OR COALESCE(psa.first_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(psa.last_name, '') ILIKE '%' || $1 || '%'
            OR COALESCE(psa.firm_name, '') ILIKE '%' || $1 || '%'
          )
        ORDER BY
          CASE psa.status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            WHEN 'rejected' THEN 2
            ELSE 3
          END,
          psa.created_at DESC
      `,
      [q]
    );

    return res.json({
      results: result.rows || []
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to load pending signup attempts"
    });
  }
});

router.post("/pending-signups/:id/approve", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid pending signup id" });
    }

    const pendingResult = await safeQuery(
      `
        SELECT *
        FROM pending_signup_attempts
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    const attempt = pendingResult.rows?.[0];
    if (!attempt) {
      return res.status(404).json({ error: "Pending signup not found" });
    }

    const normalizedEmail = normalizeEmail(attempt.email);
    if (!normalizedEmail) {
      return res.status(400).json({ error: "Pending signup has no email" });
    }

    const approvalResult = await safeQuery(
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
        `Approved from pending signup attempt #${attempt.id}`
      ]
    );

    const approval = approvalResult.rows?.[0] || null;

    const updatedPending = await safeQuery(
      `
        UPDATE pending_signup_attempts
        SET
          status = 'approved',
          approved_approval_id = $1,
          reviewed_by_user_id = $2,
          reviewed_by_email = $3,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [
        approval?.id || null,
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    return res.json({
      success: true,
      approval,
      pending_signup: updatedPending.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to approve pending signup"
    });
  }
});

router.patch("/pending-signups/:id/reject", async (req, res) => {
  try {
    await ensureTables();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid pending signup id" });
    }

    const result = await safeQuery(
      `
        UPDATE pending_signup_attempts
        SET
          status = 'rejected',
          reviewed_by_user_id = $1,
          reviewed_by_email = $2,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `,
      [
        req.adminUser?.id || null,
        req.adminUser?.email || null,
        id
      ]
    );

    if (!result.rows?.length) {
      return res.status(404).json({ error: "Pending signup not found" });
    }

    return res.json({
      success: true,
      pending_signup: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to reject pending signup"
    });
  }
});

export default router;
