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
   TEST DB
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
  res.json({ status: "Backend OK" });
});

/* ======================
   CANDIDATES (JOIN NAMES)
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
        c.photo
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
   SEARCH
====================== */

app.get("/api/search", async (req, res) => {
  const { q, state_id, party_id, county_id, office_id } = req.query;

  let filters = [];
  let values = [];
  let i = 1;

  if (q) {
    filters.push(`c.full_name ILIKE $${i++}`);
    values.push(`%${q}%`);
  }

  if (state_id) {
    filters.push(`c.state_id = $${i++}`);
    values.push(state_id);
  }

  if (party_id) {
    filters.push(`c.party_id = $${i++}`);
    values.push(party_id);
  }

  if (county_id) {
    filters.push(`c.county_id = $${i++}`);
    values.push(county_id);
  }

  if (office_id) {
    filters.push(`c.office_id = $${i++}`);
    values.push(office_id);
  }

  const where = filters.length ? "WHERE " + filters.join(" AND ") : "";

  try {
    const { rows } = await pool.query(`
      SELECT
        c.id,
        c.full_name,
        s.name AS state,
        p.name AS party,
        co.name AS county,
        o.name AS office
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
   DROPDOWNS
====================== */

app.get("/api/dropdowns/states", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM states ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/parties", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM parties ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/offices", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM offices ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/counties", async (req, res) => {
  const { state_id } = req.query;

  const { rows } = await pool.query(
    "SELECT id, name FROM counties WHERE state_id=$1 ORDER BY name",
    [state_id]
  );

  res.json(rows);
});

/* ======================
   CONSULTANTS
====================== */

app.get("/api/consultants", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM consultants ORDER BY name"
  );
  res.json(rows);
});

/* ======================
   VENDORS
====================== */

app.get("/api/vendors", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM vendors ORDER BY name"
  );
  res.json(rows);
});

/* ======================
   START
====================== */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
