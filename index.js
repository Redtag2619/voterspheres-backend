import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ======================
   DATABASE
====================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

/* ======================
   TEST CONNECTION
====================== */

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err.message);
  }
}
testDB();

/* ======================
   ROOT
====================== */

app.get("/", (req, res) => {
  res.json({ status: "Backend running OK" });
});

/* ======================
   CANDIDATES (REAL SCHEMA)
====================== */

app.get("/api/candidates", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        id,
        full_name,
        party_id,
        office_id,
        state_id,
        county_id,
        email,
        phone,
        website,
        photo,
        created_at
      FROM candidates
      ORDER BY full_name
      LIMIT 100
    `);

    res.json(rows);

  } catch (err) {
    console.error("CANDIDATES ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   DROPDOWNS (IDS)
====================== */

app.get("/api/dropdowns/states", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT state_id
      FROM candidates
      WHERE state_id IS NOT NULL
      ORDER BY state_id
    `);
    res.json(rows);
  } catch {
    res.json([]);
  }
});

app.get("/api/dropdowns/parties", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT party_id
      FROM candidates
      WHERE party_id IS NOT NULL
      ORDER BY party_id
    `);
    res.json(rows);
  } catch {
    res.json([]);
  }
});

app.get("/api/dropdowns/counties", async (req, res) => {
  const { state_id } = req.query;

  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT county_id
      FROM candidates
      WHERE state_id = $1
      ORDER BY county_id
    `, [state_id]);

    res.json(rows);
  } catch {
    res.json([]);
  }
});

app.get("/api/dropdowns/offices", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT office_id
      FROM candidates
      WHERE office_id IS NOT NULL
      ORDER BY office_id
    `);

    res.json(rows);
  } catch {
    res.json([]);
  }
});

/* ======================
   SEARCH + FILTER
====================== */

app.get("/api/search", async (req, res) => {
  const { q, state_id, party_id, county_id, office_id } = req.query;

  let conditions = [];
  let values = [];
  let i = 1;

  if (q) {
    conditions.push(`full_name ILIKE $${i++}`);
    values.push(`%${q}%`);
  }

  if (state_id) {
    conditions.push(`state_id = $${i++}`);
    values.push(state_id);
  }

  if (party_id) {
    conditions.push(`party_id = $${i++}`);
    values.push(party_id);
  }

  if (county_id) {
    conditions.push(`county_id = $${i++}`);
    values.push(county_id);
  }

  if (office_id) {
    conditions.push(`office_id = $${i++}`);
    values.push(office_id);
  }

  const where = conditions.length
    ? "WHERE " + conditions.join(" AND ")
    : "";

  try {
    const { rows } = await pool.query(`
      SELECT 
        id,
        full_name,
        party_id,
        office_id,
        state_id,
        county_id,
        email,
        phone,
        website,
        photo
      FROM candidates
      ${where}
      ORDER BY full_name
      LIMIT 100
    `, values);

    res.json(rows);

  } catch (err) {
    console.error("SEARCH ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   START SERVER
====================== */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
