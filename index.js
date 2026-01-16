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

// Search endpoint
app.get("/search", async (req, res) => {
  const q = req.query.q;

  if (!q) {
    return res.json({ results: [] });
  }

  try {
    const elections = await pool.query(
      `
      SELECT
        id,
        'Election' AS type,
        election_year,
        office,
        state
      FROM elections
      WHERE
        office ILIKE $1
        OR state ILIKE $1
        OR election_type ILIKE $1
      `,
      [`%${q}%`]
    );

    const candidates = await pool.query(
      `
      SELECT
        id,
        'Candidate' AS type,
        full_name,
        office,
        state,
        website
      FROM candidates
      WHERE
        full_name ILIKE $1
        OR office ILIKE $1
        OR state ILIKE $1
      `,
      [`%${q}%`]
    );

    const ballotMeasures = await pool.query(
      `
      SELECT
        id,
        'Ballot Measure' AS type,
        title,
        state,
        ballot_number
      FROM ballot_measures
      WHERE
        title ILIKE $1
        OR state ILIKE $1
      `,
      [`%${q}%`]
    );

    res.json({
      query: q,
      results: {
        elections: elections.rows,
        candidates: candidates.rows,
        ballot_measures: ballotMeasures.rows
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});
