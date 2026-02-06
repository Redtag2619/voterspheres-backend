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

    const test = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
    );

    console.log("📦 Tables found:", test.rows.map(t => t.table_name));

  } catch (err) {
    console.error("❌ DB ERROR:", err.message);
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
   CANDIDATES (SCHEMA FIXED)
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
      FROM public.candidates c
      LEFT JOIN public.states s ON c.state_id = s.id
      LEFT JOIN public.parties p ON c.party_id = p.id
      LEFT JOIN public.counties co ON c.county_id = co.id
      LEFT JOIN public.offices o ON c.office_id = o.id
      ORDER BY c.full_name
      LIMIT 100
    `);

    res.json(rows);

  } catch (err) {
    console.error("CANDIDATE ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   DROPDOWNS
====================== */

app.get("/api/dropdowns/states", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM public.states ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/parties", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM public.parties ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/offices", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM public.offices ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/dropdowns/counties", async (req, res) => {
  const { state_id } = req.query;

  const { rows } = await pool.query(
    "SELECT id, name FROM public.counties WHERE state_id=$1 ORDER BY name",
    [state_id]
  );

  res.json(rows);
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
      FROM public.candidates c
      LEFT JOIN public.states s ON c.state_id = s.id
      LEFT JOIN public.parties p ON c.party_id = p.id
      LEFT JOIN public.counties co ON c.county_id = co.id
      LEFT JOIN public.offices o ON c.office_id = o.id
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
   CONSULTANTS & VENDORS
====================== */

app.get("/api/consultants", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM public.consultants ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/vendors", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM public.vendors ORDER BY name"
  );
  res.json(rows);
});

/* ======================
   START SERVER
====================== */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
