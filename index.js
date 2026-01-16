const pool = require("./db");
const express = require("express");
const cors = require("cors");

const app = express();

/**
 * ✅ Explicit CORS configuration
 */
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


/**
 * ✅ Explicit cache control for browser safety
 */
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json());

// Root health check
app.get("/", (req, res) => {
  res.send("VoterSpheres API is running");
});

// Search endpoint (PostgreSQL-powered)
app.get("/search", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.json({ query: "", results: {} });
  }

  try {
    const elections = await pool.query(
      `
      SELECT id, election_year, state, office
      FROM elections
      WHERE state ILIKE $1 OR office ILIKE $1
      `,
      [`%${query}%`]
    );

    const candidates = await pool.query(
      `
      SELECT id, full_name, office, state
      FROM candidates
      WHERE full_name ILIKE $1 OR state ILIKE $1
      `,
      [`%${query}%`]
    );

    const ballotMeasures = await pool.query(
      `
      SELECT id, ballot_number, title, state
      FROM ballot_measures
      WHERE title ILIKE $1 OR state ILIKE $1
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
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});
