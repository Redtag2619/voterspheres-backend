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
   ROOT
=========================== */

app.get("/", (req, res) => {
  res.send("Backend running");
});

/* ===========================
   CANDIDATE SEARCH
=========================== */
/*
Tables used:
candidates
states
parties
offices
counties
*/

app.get("/api/search/candidates", async (req, res) => {
  const { q, state, party } = req.query;

  try {
    const result = await pool.query(
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
      LIMIT 200
      `,
      [q || null, state || null, party || null]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("CANDIDATE SEARCH ERROR:", err);
    res.status(500).json({ error: "Candidate search failed" });
  }
});

/* ===========================
   CONSULTANT SEARCH
=========================== */

app.get("/api/search/consultants", async (req, res) => {
  const { q, state } = req.query;

  try {
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
      LEFT JOIN states s ON c.state_id = s.id
      WHERE
        ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR s.code = $2)
      LIMIT 200
      `,
      [q || null, state || null]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("CONSULTANT SEARCH ERROR:", err);
    res.status(500).json({ error: "Consultant search failed" });
  }
});

/* ===========================
   VENDOR SEARCH
=========================== */

app.get("/api/search/vendors", async (req, res) => {
  const { q, state } = req.query;

  try {
    const result = await pool.query(
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
      LIMIT 200
      `,
      [q || null, state || null]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("VENDOR SEARCH ERROR:", err);
    res.status(500).json({ error: "Vendor search failed" });
  }
});

/* ===========================
   SIMPLE VOTERS (your old)
=========================== */

app.get("/api/voters", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, name, city, party FROM voters LIMIT 100"
    );
    res.json(r.rows);
  } catch (err) {
    console.error("FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to load voters" });
  }
});

/* ===========================
   START SERVER
=========================== */

const PORT = 10000;

app.listen(PORT, () => {
  console.log("🚀 Backend running on port", PORT);
});
