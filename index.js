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
app.use(cors({
  origin: [
    "https://voterspheres.org",
    "https://www.voterspheres.org"
  ],
}));

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
   SEARCH ENDPOINT
   ======================= */
app.get("/search", async (req, res) => {
  const q = (req.query.q || "").toLowerCase();

  if (!q) {
    return res.json({ query: q, results: [] });
  }

  try {
    const results = [];

    // Elections
    const elections = await pool.query(
      `SELECT id, title, state
       FROM elections
       WHERE LOWER(title) LIKE $1
          OR LOWER(state) LIKE $1`,
      [`%${q}%`]
    );

    elections.rows.forEach(row => {
      results.push({
        type: "Election",
        title: row.title,
        state: row.state,
      });
    });

    // Candidates
    const candidates = await pool.query(
      `SELECT name, office
       FROM candidates
       WHERE LOWER(name) LIKE $1
          OR LOWER(office) LIKE $1`,
      [`%${q}%`]
    );

    candidates.rows.forEach(row => {
      results.push({
        type: "Candidate",
        title: `${row.name} — ${row.office}`,
      });
    });

    // Ballot Measures
    const measures = await pool.query(
      `SELECT title
       FROM ballot_measures
       WHERE LOWER(title) LIKE $1`,
      [`%${q}%`]
    );

    measures.rows.forEach(row => {
      results.push({
        type: "Ballot Measure",
        title: row.title,
      });
    });

    res.json({ query: q, results });

  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({
      error: "Search failed",
      details: err.message,
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
