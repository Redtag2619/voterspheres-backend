import express from "express";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(express.json());

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.send("VoterSpheres Backend Running");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   TABLE + INDEXES
========================= */

async function ensureTable() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate (
      id SERIAL PRIMARY KEY,
      name TEXT,
      office TEXT,
      state TEXT,
      party TEXT,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Performance indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidate_name ON candidate(name);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidate_state ON candidate(state);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidate_office ON candidate(office);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidate_party ON candidate(party);`);

  console.log("✅ Table + indexes ready");
}

/* =========================
   SEARCH API
========================= */

app.get("/search", async (req, res) => {

  try {

    const {
      q = "",
      state,
      office,
      party,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (page - 1) * limit;

    let conditions = [];
    let values = [];
    let index = 1;

    if (q) {
      conditions.push(`name ILIKE $${index}`);
      values.push(`%${q}%`);
      index++;
    }

    if (state) {
      conditions.push(`state = $${index}`);
      values.push(state);
      index++;
    }

    if (office) {
      conditions.push(`office ILIKE $${index}`);
      values.push(`%${office}%`);
      index++;
    }

    if (party) {
      conditions.push(`party = $${index}`);
      values.push(party);
      index++;
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const query = `
      SELECT *
      FROM candidate
      ${whereClause}
      ORDER BY id DESC
      LIMIT $${index}
      OFFSET $${index + 1}
    `;

    values.push(limit, offset);

    const { rows } = await pool.query(query, values);

    res.json({
      page: Number(page),
      limit: Number(limit),
      results: rows.length,
      data: rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

/* =========================
   QUICK STATE ENDPOINT
========================= */

app.get("/state/:state", async (req, res) => {

  const state = req.params.state.toUpperCase();

  const { rows } = await pool.query(
    `SELECT * FROM candidate WHERE state = $1 LIMIT 100`,
    [state]
  );

  res.json(rows);
});

/* =========================
   BASIC LIST
========================= */

app.get("/candidate", async (req, res) => {

  const { rows } = await pool.query(
    "SELECT * FROM candidate ORDER BY id DESC LIMIT 100"
  );

  res.json(rows);
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 10000;

ensureTable().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
});
