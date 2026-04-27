import express from "express";

const router = express.Router();

let cachedDb = null;
let cachedDbSource = null;

async function getDb() {
  if (cachedDb) return { db: cachedDb, source: cachedDbSource };

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
    } catch {}
  }

  return { db: null, source: null };
}

async function safeQuery(sql, params = []) {
  const { db, source } = await getDb();

  if (!db) {
    throw new Error("Database connection not available.");
  }

  if (typeof db.query === "function") {
    const result = await db.query(sql, params);
    return { ...result, _dbSource: source };
  }

  if (typeof db.execute === "function") {
    const [rows] = await db.execute(sql, params);
    return { rows, _dbSource: source };
  }

  throw new Error(`Unsupported DB driver: ${source}`);
}

async function ensureEnterpriseLeadsTable() {
  // Base table
  await safeQuery(`
    CREATE TABLE IF NOT EXISTS enterprise_leads (
      id SERIAL PRIMARY KEY,
      full_name TEXT,
      firm_name TEXT,
      email TEXT,
      role TEXT,
      notes TEXT,
      source TEXT DEFAULT 'landing_page',
      status TEXT DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // 🔥 Critical: ensure all columns exist (fixes your 500)
  await safeQuery(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS role TEXT`);
  await safeQuery(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS notes TEXT`);
  await safeQuery(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS source TEXT`);
  await safeQuery(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS status TEXT`);
  await safeQuery(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMP`);
  await safeQuery(`ALTER TABLE enterprise_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
}

router.post("/enterprise-leads", async (req, res) => {
  try {
    await ensureEnterpriseLeadsTable();

    const {
      full_name = "",
      firm_name = "",
      email = "",
      role = "",
      notes = "",
      team_size = "",
      message = ""
    } = req.body || {};

    // 🔥 Normalize payload (fix frontend/backend mismatch)
    const finalRole = role || team_size || "Website Lead";
    const finalNotes = notes || message || "";

    if (!full_name || !firm_name || !email) {
      return res.status(400).json({
        error: "full_name, firm_name, and email are required"
      });
    }

    const result = await safeQuery(
      `
        INSERT INTO enterprise_leads (
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
        VALUES ($1,$2,$3,$4,$5,'landing_page','new',NOW(),NOW())
        RETURNING *
      `,
      [full_name, firm_name, email, finalRole, finalNotes]
    );

    return res.status(201).json({
      ok: true,
      lead: result.rows?.[0] || null
    });
  } catch (error) {
    console.error("❌ Enterprise lead error:", error);

    return res.status(500).json({
      error: error.message || "Failed to submit enterprise lead"
    });
  }
});

export default router;
