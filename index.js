import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* ===========================
   PostgreSQL Connection
=========================== */

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5433,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "postgres",
});

/* ===========================
   Test DB
=========================== */

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
})();

/* ===========================
   Helpers
=========================== */

function getPagination(query) {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(parseInt(query.limit) || 50, 200);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/* ===========================
   ROOT
=========================== */

app.get("/", (req, res) => {
  res.send("Backend running");
});

/* ===========================
   CANDIDATES (PAGINATED)
=========================== */

app.get("/api/search/candidates", async (req, res) => {
  const { q, state, party } = req.query;
  const { page, limit, offset } = getPagination(req.query);

  try {
    // Total count
    const countResult = await pool.query(
      `
      SELECT COUNT(*) 
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN parties p ON c.party_id = p.id
      WHERE
        ($1::text IS NULL OR c.full_name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.code = $2)
        AND ($3::text IS NULL OR p.name = $3)
      `,
      [q || null, state || null, party || null]
    );

    const total = parseInt(countResult.rows[0].count);

    // Data
    const dataResult = await pool.query(
      `
      SELECT 
        c.id,
        c.full_name,
        s.code AS state,
        p.name AS party,
        o.name AS office,
        co.name AS county,
        c.email,
        c.phone,
        c.website
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN offices o ON c.office_id = o.id
      LEFT JOIN counties co ON c.county_id = co.id
      WHERE
        ($1::text IS NULL OR c.full_name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.code = $2)
        AND ($3::text IS NULL OR p.name = $3)
      ORDER BY c.full_name
      LIMIT $4 OFFSET $5
      `,
      [q || null, state || null, party || null, limit, offset]
    );

    res.json({
      data: dataResult.rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });

  } catch (err) {
    console.error("CANDIDATE SEARCH ERROR:", err);
    res.status(500).json({ error: "Candidate search failed" });
  }
});

/* ===========================
   CONSULTANTS (PAGINATED)
=========================== */

app.get("/api/search/consultants", async (req, res) => {
  const { q, state } = req.query;
  const { page, limit, offset } = getPagination(req.query);

  try {
    const countResult = await pool.query(
      `
      SELECT COUNT(*)
      FROM consultants c
      LEFT JOIN states s ON c.state_id = s.id
      WHERE
        ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.code = $2)
      `,
      [q || null, state || null]
    );

    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `
      SELECT 
        c.id,
        c.name,
        s.code AS state,
        c.email,
        c.phone,
        c.website
      FROM consultants c
      LEFT JOIN states s ON c.state_id = s.id
      WHERE
        ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.code = $2)
      ORDER BY c.name
      LIMIT $3 OFFSET $4
      `,
      [q || null, state || null, limit, offset]
    );

    res.json({
      data: dataResult.rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });

  } catch (err) {
    console.error("CONSULTANT SEARCH ERROR:", err);
    res.status(500).json({ error: "Consultant search failed" });
  }
});

/* ===========================
   VENDORS (PAGINATED)
=========================== */

app.get("/api/search/vendors", async (req, res) => {
  const { q, state } = req.query;
  const { page, limit, offset } = getPagination(req.query);

  try {
    const countResult = await pool.query(
      `
      SELECT COUNT(*)
      FROM vendors v
      LEFT JOIN states s ON v.state_id = s.id
      WHERE
        ($1::text IS NULL OR v.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.code = $2)
      `,
      [q || null, state || null]
    );

    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `
      SELECT 
        v.id,
        v.name,
        s.code AS state,
        v.phone,
        v.email,
        v.website,
        v.address
      FROM vendors v
      LEFT JOIN states s ON v.state_id = s.id
      WHERE
        ($1::text IS NULL OR v.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.code = $2)
      ORDER BY v.name
      LIMIT $3 OFFSET $4
      `,
      [q || null, state || null, limit, offset]
    );

    res.json({
      data: dataResult.rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });

  } catch (err) {
    console.error("VENDOR SEARCH ERROR:", err);
    res.status(500).json({ error: "Vendor search failed" });
  }
});

/* ===========================
   START SERVER
=========================== */

const PORT = 10000;
app.get("/api/dropdowns/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, code, name
      FROM states
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("STATES DROPDOWN ERROR:", err);
    res.status(500).json({ error: "Failed to load states" });
  }
});
app.get("/api/dropdowns/parties", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, abbreviation
      FROM parties
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("PARTIES DROPDOWN ERROR:", err);
    res.status(500).json({ error: "Failed to load parties" });
  }
});
app.get("/api/dropdowns/offices", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM offices
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("OFFICES DROPDOWN ERROR:", err);
    res.status(500).json({ error: "Failed to load offices" });
  }
});
app.get("/api/dropdowns/counties", async (req, res) => {
  const { state } = req.query;

  try {
    const result = await pool.query(
      `
      SELECT c.id, c.name
      FROM counties c
      JOIN states s ON c.state_id = s.id
      WHERE s.code = $1
      ORDER BY c.name
      `,
      [state]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("COUNTIES DROPDOWN ERROR:", err);
    res.status(500).json({ error: "Failed to load counties" });
  }
});

app.listen(PORT, () => {
  console.log("🚀 Backend running on port", PORT);
});
