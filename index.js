import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const { Pool } = pkg;

const app = express();

/* ============================
   MIDDLEWARE
============================ */
app.use(cors());
app.use(express.json());

/* ============================
   PORT (Render + Local)
============================ */
const PORT = process.env.PORT || 10000;

/* ============================
   DATABASE
============================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

/* ============================
   HEALTH CHECK (CRITICAL)
============================ */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

/* ============================
   BASIC API TEST
============================ */
app.get("/", (req, res) => {
  res.json({ message: "VoterSpheres API running" });
});

/* ============================
   DROPDOWNS (MATCH YOUR TABLES)
============================ */

app.get("/api/dropdowns/states", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM states ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load states" });
  }
});

app.get("/api/dropdowns/parties", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM parties ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load parties" });
  }
});

app.get("/api/dropdowns/offices", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM offices ORDER BY name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load offices" });
  }
});

app.get("/api/dropdowns/counties", async (req, res) => {
  const { state_id } = req.query;

  try {
    const { rows } = await pool.query(
      `SELECT id, name
       FROM counties
       WHERE ($1::int IS NULL OR state_id = $1)
       ORDER BY name`,
      [state_id || null]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load counties" });
  }
});

/* ============================
   CANDIDATE SEARCH (SAFE)
============================ */

app.get("/api/candidates", async (req, res) => {
  const {
    state_id,
    party_id,
    county_id,
    office_id,
    page = 1,
    limit = 20
  } = req.query;

  const offset = (page - 1) * limit;

  try {
    const dataQuery = `
      SELECT
        c.id,
        c.full_name,
        s.name AS state,
        p.name AS party,
        o.name AS office,
        co.name AS county
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN offices o ON c.office_id = o.id
      LEFT JOIN counties co ON c.county_id = co.id
      WHERE
        ($1::int IS NULL OR c.state_id = $1)
        AND ($2::int IS NULL OR c.party_id = $2)
        AND ($3::int IS NULL OR c.county_id = $3)
        AND ($4::int IS NULL OR c.office_id = $4)
      ORDER BY c.full_name
      LIMIT $5 OFFSET $6
    `;

    const countQuery = `
      SELECT COUNT(*) FROM candidates
      WHERE
        ($1::int IS NULL OR state_id = $1)
        AND ($2::int IS NULL OR party_id = $2)
        AND ($3::int IS NULL OR county_id = $3)
        AND ($4::int IS NULL OR office_id = $4)
    `;

    const params = [
      state_id || null,
      party_id || null,
      county_id || null,
      office_id || null,
      limit,
      offset
    ];

    const [data, count] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, params.slice(0, 4))
    ]);

    res.json({
      total: Number(count.rows[0].count),
      page: Number(page),
      limit: Number(limit),
      results: data.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Candidate search failed" });
  }
});

/* ============================
   START SERVER
============================ */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
