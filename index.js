import express from "express";
import cors from "cors";
import pg from "pg";

const app = express();
const PORT = process.env.PORT || 10000;

/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(express.json());

/* ---------- DATABASE ---------- */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ---------- HEALTH CHECK ---------- */
app.get("/", (req, res) => {
  res.send("VoterSpheres Backend v1 — PostgreSQL Search Enabled");
});

/* ---------- SEARCH ENDPOINT ---------- */
app.get("/search", async (req, res) => {
  const q = req.query.q;

  if (!q) {
    return res.json({ query: "", results: [] });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        title,
        state,
        year
      FROM elections
      WHERE
        title ILIKE $1
        OR state ILIKE $1
      ORDER BY year DESC
      LIMIT 20
      `,
      [`%${q}%`]
    );

    res.json({
      query: q,
      results: rows.map(r => ({
        type: "Election",
        title: r.title,
        state: r.state,
        year: r.year
      }))
    });

  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

/* ---------- START SERVER ---------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
