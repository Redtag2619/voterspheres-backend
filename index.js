// index.js — VoterSpheres Backend (Production)

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

/* ================================
   CORS CONFIGURATION
================================ */
app.use(
  cors({
    origin: [
      "https://voterspheres.org",
      "https://www.voterspheres.org"
    ],
    methods: ["GET"],
    allowedHeaders: ["Content-Type"],
  })
);

/* ================================
   SECURITY & CACHE CONTROL
================================ */
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json());

/* ================================
   HEALTH & VERSION CHECK
================================ */
app.get("/", (req, res) => {
  res.send("VoterSpheres API is running");
});

app.get("/__version", (req, res) => {
  res.send("VoterSpheres Backend v1 — PostgreSQL Search Enabled");
});

/* ================================
   DATABASE TEST ENDPOINT
================================ */
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      success: true,
      time: result.rows[0].now
    });
  } catch (err) {
    console.error("DB TEST ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Database connection failed"
    });
  }
});

/* ================================
   SEARCH ENDPOINT (REAL DB)
================================ */
app.get("/search", async (req, res) => {
  const query = (req.query.q || "").trim();

  if (!query) {
    return res.json({
      query,
      results: {
        elections: [],
        candidates: [],
        ballot_measures: []
      }
    });
  }

  try {
    const elections = await pool.query(
      `
      SELECT id, office, state, election_date
      FROM elections
      WHERE office ILIKE $1 OR state ILIKE $1
      ORDER BY election_date
      LIMIT 20
      `,
      [`%${query}%`]
    );

    const candidates = await pool.query(
      `
      SELECT id, name, office, state, website
      FROM candidates
      WHERE name ILIKE $1 OR office ILIKE $1 OR state ILIKE $1
      LIMIT 20
      `,
      [`%${query}%`]
    );

    const ballotMeasures = await pool.query(
      `
      SELECT id, title, state, election_date
      FROM ballot_measures
      WHERE title ILIKE $1 OR state ILIKE $1
      LIMIT 20
      `,
      [`%${query}%`]
    );

    res.json({
      query,
      results: {
        elections: elections.rows,
        candidates: candidates.rows,
        ballot_measures: ballotMeasures.rows
      }
    });
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({
      error: "Search failed"
    });
  }
});

/* ================================
   SERVER START
================================ */
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`VoterSpheres backend running on port ${PORT}`);
});
