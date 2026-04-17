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
      "Database connection not available. Enterprise leads admin route could not resolve your DB module."
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

async function ensureEnterpriseLeadsTable() {
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS enterprise_leads (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      firm_name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      notes TEXT,
      source TEXT DEFAULT 'landing_page',
      status TEXT DEFAULT 'new',
      reviewed_by_user_id INTEGER,
      reviewed_by_email TEXT,
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
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
    await ensureEnterpriseLeadsTable();

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
        FROM enterprise_leads
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
            WHEN 'new' THEN 0
            WHEN 'contacted' THEN 1
            WHEN 'qualified' THEN 2
            WHEN 'won' THEN 3
            WHEN 'archived' THEN 4
            ELSE 5
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
      error: error.message || "Failed to load enterprise leads"
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await ensureEnterpriseLeadsTable();

    const id = Number(req.params.id);
    const {
      status = "",
      review_notes = ""
    } = req.body || {};

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid lead id" });
    }

    const allowedStatuses = ["new", "contacted", "qualified", "won", "archived"];
    if (!allowedStatuses.includes(String(status))) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const existing = await safeQuery(
      `
        SELECT id
        FROM enterprise_leads
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (!existing.rows?.length) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const updated = await safeQuery(
      `
        UPDATE enterprise_leads
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
      [status, review_notes, req.adminUser?.id || null, req.adminUser?.email || null, id]
    );

    return res.json({
      success: true,
      lead: updated.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to update enterprise lead"
    });
  }
});

export default router;
