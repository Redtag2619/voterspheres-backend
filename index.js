import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* ================================
   PostgreSQL (Render-ready)
================================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// Test DB connection
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
})();

/* ================================
   Helpers
================================ */

const buildPagination = (page = 1, limit = 20) => {
  page = Number(page);
  limit = Number(limit);
  const offset = (page - 1) * limit;
  return { limit, offset };
};

/* ================================
   ROOT
================================ */

app.get("/", (req, res) => {
  res.send("🚀 VoterSpheres API running");
});

/* ================================
   DROPDOWN ROUTES
================================ */

app.get("/api/states", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, code FROM states ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/parties", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, abbreviation FROM parties ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/offices", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM offices ORDER BY name"
  );
  res.json(rows);
});

app.get("/api/counties", async (req, res) => {
  const { state_id } = req.query;

  let query = "SELECT id, name FROM counties";
  let params = [];

  if (state_id) {
    query += " WHERE state_id = $1";
    params.push(state_id);
  }

  query += " ORDER BY name";

  const { rows } = await pool.query(query, params);
  res.json(rows);
});

/* ================================
   CANDIDATES SEARCH + PAGINATION
================================ */

app.get("/api/candidates", async (req, res) => {
  try {
    const {
      q,
      state_id,
      party_id,
      office_id,
      county_id,
      page = 1,
      limit = 20,
    } = req.query;

    const { offset } = buildPagination(page, limit);

    let where = [];
    let params = [];

    if (q) {
      params.push(`%${q}%`);
      where.push(`c.full_name ILIKE $${params.length}`);
    }

    if (state_id) {
      params.push(state_id);
      where.push(`c.state_id = $${params.length}`);
    }

    if (party_id) {
      params.push(party_id);
      where.push(`c.party_id = $${params.length}`);
    }

    if (office_id) {
      params.push(office_id);
      where.push(`c.office_id = $${params.length}`);
    }

    if (county_id) {
      params.push(county_id);
      where.push(`c.county_id = $${params.length}`);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM candidates c ${whereSQL}`,
      params
    );

    const total = Number(countResult.rows[0].count);

    // Data
    params.push(limit, offset);

    const dataQuery = `
      SELECT 
        c.id,
        c.full_name,
        c.email,
        c.phone,
        c.website,
        c.address,
        s.name AS state,
        p.name AS party,
        o.name AS office,
        co.name AS county
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN offices o ON c.office_id = o.id
      LEFT JOIN counties co ON c.county_id = co.id
      ${whereSQL}
      ORDER BY c.full_name
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `;

    const { rows } = await pool.query(dataQuery, params);

    res.json({
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
      results: rows,
    });
  } catch (err) {
    console.error("CANDIDATE SEARCH ERROR:", err);
    res.status(500).json({ error: "Candidate search failed" });
  }
});

/* ================================
   CONSULTANTS
================================ */

app.get("/api/consultants", async (req, res) => {
  try {
    const { q, state_id, page = 1, limit = 20 } = req.query;
    const { offset } = buildPagination(page, limit);

    let where = [];
    let params = [];

    if (q) {
      params.push(`%${q}%`);
      where.push(`name ILIKE $${params.length}`);
    }

    if (state_id) {
      params.push(state_id);
      where.push(`state_id = $${params.length}`);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const count = await pool.query(
      `SELECT COUNT(*) FROM consultants ${whereSQL}`,
      params
    );

    params.push(limit, offset);

    const data = await pool.query(
      `
      SELECT 
        c.id,
        c.name,
        c.email,
        c.phone,
        c.website,
        s.name AS state
      FROM consultants c
      LEFT JOIN states s ON c.state_id = s.id
      ${whereSQL}
      ORDER BY c.name
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
      params
    );

    res.json({
      total: Number(count.rows[0].count),
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(count.rows[0].count / limit),
      results: data.rows,
    });
  } catch (err) {
    console.error("CONSULTANT SEARCH ERROR:", err);
    res.status(500).json({ error: "Consultant search failed" });
  }
});

/* ================================
   VENDORS
================================ */

app.get("/api/vendors", async (req, res) => {
  try {
    const { q, state_id, page = 1, limit = 20 } = req.query;
    const { offset } = buildPagination(page, limit);

    let where = [];
    let params = [];

    if (q) {
      params.push(`%${q}%`);
      where.push(`name ILIKE $${params.length}`);
    }

    if (state_id) {
      params.push(state_id);
      where.push(`state_id = $${params.length}`);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const count = await pool.query(
      `SELECT COUNT(*) FROM vendors ${whereSQL}`,
      params
    );

    params.push(limit, offset);

    const data = await pool.query(
      `
      SELECT 
        v.id,
        v.name,
        v.phone,
        v.email,
        v.website,
        v.address,
        s.name AS state
      FROM vendors v
      LEFT JOIN states s ON v.state_id = s.id
      ${whereSQL}
      ORDER BY v.name
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
      params
    );

    res.json({
      total: Number(count.rows[0].count),
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(count.rows[0].count / limit),
      results: data.rows,
    });
  } catch (err) {
    console.error("VENDOR SEARCH ERROR:", err);
    res.status(500).json({ error: "Vendor search failed" });
  }
});

/* ================================
   SERVER
================================ */

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🚀 Backend running on port", PORT);
});
