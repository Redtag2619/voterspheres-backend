import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ✅ PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5433,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "postgres",
});

// ✅ Test DB connection
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to database");
  } catch (err) {
    console.error("DB CONNECTION ERROR:", err);
  }
})();
app.get("/test", (req, res) => {
  res.json({ ok: true });
});

// ✅ API route
app.get("/api/voters", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, city, party FROM voters LIMIT 100"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to load voters" });
  }
});

// ✅ Root test route
app.get("/", (req, res) => {
  res.send("Backend is running");
});

// ✅ FORCE PORT (no env confusion)
const PORT = 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Backend running on port", PORT);
});

app.get("/api/search/candidates", async (req, res) => {
  try {
    const {
      q = "",
      state,
      party,
      office,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (page - 1) * limit;

    let filters = [];
    let values = [];
    let i = 1;

    if (q) {
      filters.push(`c.full_name ILIKE $${i++}`);
      values.push(`%${q}%`);
    }

    if (state) {
      filters.push(`s.code = $${i++}`);
      values.push(state);
    }

    if (party) {
      filters.push(`p.abbreviation = $${i++}`);
      values.push(party);
    }

    if (office) {
      filters.push(`o.name = $${i++}`);
      values.push(office);
    }

    const whereClause = filters.length
      ? "WHERE " + filters.join(" AND ")
      : "";

    const query = `
      SELECT
        c.id,
        c.full_name,
        s.code AS state,
        co.name AS county,
        p.abbreviation AS party,
        o.name AS office,
        c.website,
        c.email,
        c.phone
      FROM candidates c
      JOIN states s ON c.state_id = s.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN offices o ON c.office_id = o.id
      ${whereClause}
      ORDER BY c.full_name
      LIMIT $${i++} OFFSET $${i++}
    `;

    values.push(limit, offset);

    const result = await pool.query(query, values);

    res.json({
      page: Number(page),
      results: result.rows.length,
      data: result.rows
    });

  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({ error: "Search failed" });
  }
});
app.get("/api/search/consultants", async (req, res) => {
  try {
    const { q = "", state } = req.query;

    const result = await pool.query(
      `
      SELECT 
        c.id,
        c.name,
        s.code AS state,
        c.email,
        c.phone,
        c.website
      FROM consultants c
      JOIN states s ON c.state_id = s.id
      WHERE 
        c.name ILIKE $1
        AND ($2::text IS NULL OR s.code = $2)
      ORDER BY c.name
      LIMIT 100
      `,
      [`%${q}%`, state || null]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Consultant search failed" });
  }
});
app.get("/api/search/vendors", async (req, res) => {
  try {
    const { q = "", state } = req.query;

    const result = await pool.query(
      `
      SELECT 
        v.id,
        v.name,
        s.code AS state,
        v.phone,
        v.email,
        v.website
      FROM vendors v
      JOIN states s ON v.state_id = s.id
      WHERE 
        v.name ILIKE $1
        AND ($2::text IS NULL OR s.code = $2)
      ORDER BY v.name
      LIMIT 100
      `,
      [`%${q}%`, state || null]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Vendor search failed" });
  }
});
