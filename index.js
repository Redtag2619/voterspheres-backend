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
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

/* =========================
   Health Check
========================= */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "VoterSpheres Backend v1 — PostgreSQL Search Enabled",
  });
});

/* =========================
   SEARCH ENDPOINT
========================= */
app.get("/search", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.json({ results: [] });
  }

  try {
    const electionsResult = await pool.query(
      `
      SELECT 
        id,
        election_year,
        office,
        state
      FROM elections
      WHERE
        office ILIKE $1
        OR state ILIKE $1
        OR election_year::text ILIKE $1
      ORDER BY election_year DESC
      `,
      [`%${query}%`]
    );

    const results = electionsResult.rows.map((election) => ({
      type: "Election",
      id: election.id,
      title: `${election.election_year} ${election.state} ${election.office} Election`,
    }));

    res.json({ query, results });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/* =========================
   ELECTION DETAIL ENDPOINT
========================= */
app.get("/elections/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const electionResult = await pool.query(
      `
      SELECT *
      FROM elections
      WHERE id = $1
      `,
      [id]
    );

    if (electionResult.rows.length === 0) {
      return res.status(404).json({ error: "Election not found" });
    }

    const candidatesResult = await pool.query(
      `
      SELECT *
      FROM candidates
      WHERE election_id = $1
      ORDER BY full_name
      `,
      [id]
    );

    res.json({
      election: electionResult.rows[0],
      candidates: candidatesResult.rows,
    });
  } catch (err) {
    console.error("Election detail error:", err);
    res.status(500).json({ error: "Failed to load election" });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
