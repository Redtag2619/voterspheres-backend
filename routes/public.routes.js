import express from "express";

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
      "Database connection not available. Public route could not resolve your DB module."
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
}

router.post("/enterprise-leads", async (req, res) => {
  try {
    await ensureBetaTables();

    const {
      full_name = "",
      firm_name = "",
      email = "",
      role = "",
      notes = ""
    } = req.body || {};

    if (!full_name || !firm_name || !email || !role) {
      return res.status(400).json({
        error: "Full name, firm name, email, and role are required."
      });
    }

    const result = await safeQuery(
      `
        INSERT INTO beta_access_requests (
          full_name,
          firm_name,
          email,
          role,
          notes,
          source,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'landing_page', 'pending', NOW(), NOW())
        RETURNING id, email, status, created_at
      `,
      [full_name, firm_name, email, role, notes]
    );

    return res.status(201).json({
      success: true,
      request: result.rows?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to submit access request"
    });
  }
});

export default router;
