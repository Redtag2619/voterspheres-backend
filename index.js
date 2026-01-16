const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

/* =======================
   PostgreSQL Connection
   ======================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =======================
   Middleware
   ======================= */
app.use(cors());
app.use(express.json());

/* =======================
   Health Check
   ======================= */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "VoterSpheres Backend v1 — PostgreSQL Search Enabled",
  });
});

/* =======================
   SEARCH ENDPOINT (FIXED FOR REAL SCHEMA)
   ======================= */
app.get("/search", async (req, res) => {
  const q = (req.query.q || "").toLowerCase();

  if (!q) {
    return res.json({ query: q, results: [], count: 0 });
  }

  try {
    const results = [];

    /* ========= BALLOT MEASURES ========= */
    const measures = await pool.query(
      `
      SELECT
        title,
        description,
        state,
        county,
        election_date
      FROM public.ballot_measures
      WHERE
        LOWER(title) LIKE $1
        OR LOWER(description) LIKE $1
        OR LOWER(state) LIKE $1
        OR LOWER(county) LIKE $1
      `,
      [`%${q}%`]
    );

    measures.rows.forEach(row => {
      results.push({
        type: "Ballot Measure",
        title: row.title,
        location: row.state || row.county || "",
        date: row.election_date,
      });
    });

    /* ========= ELECTIONS ========= */
    const elections = await pool.query(
      `
      SELECT
        election_year,
        election_type,
        office,
        state,
        primary_date,
        general_date
      FROM public.elections
      WHERE
        LOWER(office) LIKE $1
        OR LOWER(state) LIKE $1
        OR LOWER(election_type) LIKE $1
      `,
      [`%${q}%`]
    );

    elections.rows.forEach(row => {
      results.push({
        type: "Election",
        title: `${row.office} (${row.election_year})`,
        location: row.state,
        date: row.general_date || row.primary_date,
      });
    });

    res.json({
      query: q,
      count: results.length,
      results,
    });

  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({
      error: "Search failed",
      message: err.message,
    });
  }
});

/* =======================
   START SERVER
   ======================= */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
