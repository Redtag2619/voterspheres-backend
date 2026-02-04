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

/* ============================
   DATABASE CONNECTION
============================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
}

testDB();

/* ============================
   DROPDOWN ROUTES
============================ */

app.get("/api/dropdowns/candidates", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT name FROM candidates ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dropdowns/consultants", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT name FROM consultants ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dropdowns/vendors", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT name FROM vendors ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   SEARCH + PAGINATION
============================ */

app.get("/api/search", async (req, res) => {
  const {
    candidate,
    consultant,
    vendor,
    page = 1,
    limit = 20
  } = req.query;

  const offset = (page - 1) * limit;

  let filters = [];
  let values = [];
  let idx = 1;

  if (candidate) {
    filters.push(`candidates.name = $${idx++}`);
    values.push(candidate);
  }

  if (consultant) {
    filters.push(`consultants.name = $${idx++}`);
    values.push(consultant);
  }

  if (vendor) {
    filters.push(`vendors.name = $${idx++}`);
    values.push(vendor);
  }

  const whereClause = filters.length
    ? `WHERE ${filters.join(" AND ")}`
    : "";

  try {
    const countQuery = `
      SELECT COUNT(*) FROM relationships
      JOIN candidates ON relationships.candidate_id = candidates.id
      JOIN consultants ON relationships.consultant_id = consultants.id
      JOIN vendors ON relationships.vendor_id = vendors.id
      ${whereClause}
    `;

    const totalResult = await pool.query(countQuery, values);
    const total = Number(totalResult.rows[0].count);

    const dataQuery = `
      SELECT
        candidates.name AS candidate,
        consultants.name AS consultant,
        vendors.name AS vendor
      FROM relationships
      JOIN candidates ON relationships.candidate_id = candidates.id
      JOIN consultants ON relationships.consultant_id = consultants.id
      JOIN vendors ON relationships.vendor_id = vendors.id
      ${whereClause}
      ORDER BY candidates.name
      LIMIT $${idx++} OFFSET $${idx}
    `;

    const dataValues = [...values, limit, offset];

    const { rows } = await pool.query(dataQuery, dataValues);

    res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      results: rows
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   SERVER START
============================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
