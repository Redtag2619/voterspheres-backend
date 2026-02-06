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
   CANDIDATES WITH JOINS
====================== */

app.get("/api/candidates", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        c.id,
        c.full_name,
        s.name AS state,
        p.name AS party,
        co.name AS county,
        o.name AS office,
        c.email,
        c.phone,
        c.website,
        c.photo,
        c.created_at
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN offices o ON c.office_id = o.id
      ORDER BY c.full_name
      LIMIT 100
    `);

    res.json(rows);

  } catch (err) {
    console.error("CANDIDATES ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   DROPDOWNS (READABLE)
====================== */

app.get("/api/dropdowns/states", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name
      FROM states
      ORDER BY name
    `);
    res.json(rows);
  } catch {
    res.json([]);
  }
});

app.get("/api/dropdowns/parties", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name
      FROM parties
      ORDER BY name
    `);
    res.json(rows);
  } catch {
    res.json([]);
  }
});

app.get("/api/dropdowns/offices", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name
      FROM offices
      ORDER BY name
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
      SELECT id, name
      FROM counties
      WHERE state_id = $1
      ORDER BY name
    `, [state_id]);

    res.json(rows);
  } catch {
    res.json([]);
  }
});

/* ======================
   SEARCH + FILTER (WITH JOINS)
====================== */

app.get("/api/search", async (req, res) => {
  const { q, state_id, party_id, county_id, office_id } = req.query;

  let conditions = [];
  let values = [];
  let i = 1;

  if (q) {
    conditions.push(`c.full_name ILIKE $${i++}`);
    values.push(`%${q}%`);
  }

  if (state_id) {
    conditions.push(`c.state_id = $${i++}`);
    values.push(state_id);
  }

  if (party_id) {
    conditions.push(`c.party_id = $${i++}`);
    values.push(party_id);
  }

  if (county_id) {
    conditions.push(`c.county_id = $${i++}`);
    values.push(county_id);
  }

  if (office_id) {
    conditions.push(`c.office_id = $${i++}`);
    values.push(office_id);
  }

  const where = conditions.length
    ? "WHERE " + conditions.join(" AND ")
    : "";

  try {
    const { rows } = await pool.query(`
      SELECT 
        c.id,
        c.full_name,
        s.name AS state,
        p.name AS party,
        co.name AS county,
        o.name AS office,
        c.email,
        c.phone,
        c.website,
        c.photo
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN offices o ON c.office_id = o.id
      ${where}
      ORDER BY c.full_name
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
