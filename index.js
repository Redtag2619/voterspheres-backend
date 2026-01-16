const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL pool (Render uses DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "VoterSpheres Backend v1 — PostgreSQL Search Enabled",
  });
});

/**
 * 🔍 SEARCH ENDPOINT
 * Example: /search?q=texas
 */
app.get("/search", async (req, res) => {
  const q = req.query.q;

  if (!q) {
    return res.status(400).json({ error: "Missing search query" });
  }

  try {
    const sql = `
      SELECT
        'Election' AS type,
        e.id,
        e.election_year,
        e.office,
        e.state
      FROM elections e
      WHERE
        e.state ILIKE $1
        OR e.office ILIKE $1

      UNION ALL

      SELECT
        'Candidate' AS type,
        c.id,
        NULL AS election_year,
        c.office,
        c.state
      FROM candidates c
      WHERE
        c.full_name ILIKE $1
        OR c.office ILIKE $1
        OR c.state ILIKE $1

      UNION ALL

      SELECT
        'BallotMeasure' AS type,
        b.id,
        NULL AS election_year,
        b.title AS office,
        b.state
      FROM ballot_measures b
      WHERE
        b.title ILIKE $1
        OR b.description ILIKE $1
        OR b.state ILIKE $1

      LIMIT 50;
    `;

    const result = await pool.query(sql, [`%${q}%`]);

    res.json({
      query: q,
      results: result.rows,
    });
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({
      error: "Search failed",
      message: err.message,
    });
  }
});

/**
 * 🧪 DATABASE DEBUG ENDPOINT (TEMPORARY)
 * Visit: /__db_check
 */
app.get("/__db_check", async (req, res) => {
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
      database: dbInfo.rows[0],
      tables: tables.rows.map(t => t.tablename),
    });
  } catch (err) {
    console.error("DB CHECK ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
