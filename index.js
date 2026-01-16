const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

/**
 * ============================
 * DATABASE CONNECTION
 * ============================
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * ============================
 * DEBUG ROUTE (PLACED AFTER POOL)
 * ============================
 */
app.get("/debug/db", async (req, res) => {
  try {
    const dbInfo = await pool.query(
      "SELECT current_database(), current_user"
    );

    const tables = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    res.json({
      database: {
        current_database: dbInfo.rows[0].current_database,
        current_user: dbInfo.rows[0].current_user
      },
      tables: tables.rows.map(t => t.tablename)
    });
  } catch (err) {
    console.error("DEBUG DB ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * ============================
 * HEALTH CHECK
 * ============================
 */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "VoterSpheres Backend v1 — PostgreSQL Search Enabled"
  });
});

/**
 * ============================
 * SEARCH ENDPOINT
 * ============================
 */
app.get("/search", async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Missing search query" });
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM public.ballot_measures
      WHERE
        title ILIKE $1 OR
        description ILIKE $1 OR
        state ILIKE $1 OR
        county ILIKE $1
      ORDER BY election_date DESC
      LIMIT 50
      `,
      [`%${q}%`]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({
      error: "Search failed",
      message: err.message
    });
  }
});

/**
 * ============================
 * SERVER START
 * ============================
 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
