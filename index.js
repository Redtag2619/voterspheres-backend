const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

/**
 * CORS
 */
app.use(
  cors({
    origin: [
      "https://voterspheres.org",
      "https://www.voterspheres.org"
    ],
    methods: ["GET"],
    allowedHeaders: ["Content-Type"]
  })
);

/**
 * Cache control
 */
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.json());

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("VoterSpheres Backend v1 — PostgreSQL Search Enabled");
});

/**
 * SEARCH — elections + candidates + ballot measures
 */
app.get("/search", async (req, res) => {
  const q = `%${(req.query.q || "").toLowerCase()}%`;

  try {
    const elections = await pool.query(
      `SELECT 'Election' AS type, title
       FROM elections
       WHERE LOWER(title) LIKE $1`,
      [q]
    );

    const candidates = await pool.query(
      `SELECT 'Candidate' AS type, name AS title
       FROM candidates
       WHERE LOWER(name) LIKE $1`,
      [q]
    );

    const ballots = await pool.query(
      `SELECT 'Ballot Measure' AS type, title
       FROM ballot_measures
       WHERE LOWER(title) LIKE $1`,
      [q]
    );

    res.json({
      query: req.query.q,
      results: [
        ...elections.rows,
        ...candidates.rows,
        ...ballots.rows
      ]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * DB test
 */
app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ success: true, time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`VoterSpheres backend running on port ${PORT}`);
});
