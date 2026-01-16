const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   Middleware
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   PostgreSQL Connection
========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================
   Health Check
========================= */
app.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.send("VoterSpheres Backend v1 — PostgreSQL Connected");
  } catch (err) {
    res.status(500).send("Database connection failed");
  }
});

/* =========================
   Search Endpoint
========================= */
app.get("/search", async (req, res) => {
  const q = (req.query.q || "").toLowerCase();

  try {
    /* ---- Elections ---- */
    const elections = await pool.query(
      `
      SELECT 
        'Election' AS type,
        election_year || ' ' || state || ' ' || office || ' Election' AS title
      FROM elections
      WHERE
        LOWER(state) LIKE $1
        OR LOWER(office) LIKE $1
      `,
      [`%${q}%`]
    );

    /* ---- Candidates ---- */
    const candidates = await pool.query(
      `
      SELECT
        'Candidate' AS type,
        full_name || ' (' || party || ')' AS title
      FROM candidates
      WHERE LOWER(full_name) LIKE $1
      `,
      [`%${q}%`]
    );

    /* ---- Ballot Measures ---- */
    const ballotMeasures = await pool.query(
      `
      SELECT
        'Ballot Measure' AS type,
        title
      FROM ballot_measures
      WHERE LOWER(title) LIKE $1
      `,
      [`%${q}%`]
    );

    res.json({
      query: q,
      results: [
        ...elections.rows,
        ...candidates.rows,
        ...ballotMeasures.rows
      ]
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/* =========================
   Server Start
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
