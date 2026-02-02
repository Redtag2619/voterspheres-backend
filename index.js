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
   Test DB Connection
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
   Health Check
=========================== */

app.get("/", (req, res) => {
  res.send("Backend is running");
});

/* ===========================
   CANDIDATES SEARCH
=========================== */
/*
Table example:
candidates(
  id,
  name,
  state,
  county,
  office,
  party,
  email,
  phone,
  website,
  social_media,
  address
)
*/

app.get("/api/search/candidates", async (req, res) => {
  const { q, state, party } = req.query;

  try {
    let sql = `
      SELECT *
      FROM candidates
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      sql += ` AND full_name ILIKE $${params.length}`;
    }

    if (state) {
      params.push(state);
      sql += ` AND state = $${params.length}`;
    }

    if (party) {
      params.push(party);
      sql += ` AND party = $${params.length}`;
    }

    const result = await pool.query(sql, params);
    res.json(result.rows);

  } catch (err) {
    console.error("CANDIDATE SEARCH ERROR:", err);
    res.status(500).json({ error: "Failed to search candidates" });
  }
});


/* ===========================
   CONSULTANTS SEARCH
=========================== */
/*
Table example:
consultants(
  id,
  name,
  state,
  email,
  phone,
  website,
  address
)
*/

app.get("/api/search/consultants", async (req, res) => {
  const { q, state } = req.query;

  try {
    let sql = `
      SELECT *
      FROM consultants
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      sql += ` AND full_name ILIKE $${params.length}`;
    }

    if (state) {
      params.push(state);
      sql += ` AND state = $${params.length}`;
    }

    const result = await pool.query(sql, params);
    res.json(result.rows);

  } catch (err) {
    console.error("CONSULTANT SEARCH ERROR:", err);
    res.status(500).json({ error: "Failed to search consultants" });
  }
});

/* ===========================
   VENDORS SEARCH
=========================== */
/*
Table example:
vendors(
  id,
  name,
  state,
  phone,
  email,
  website,
  address,
  service_type
)
*/

app.get("/api/search/vendors", async (req, res) => {
  const { q, state } = req.query;

  try {
    let sql = `
      SELECT *
      FROM vendors
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      sql += ` AND name ILIKE $${params.length}`;
    }

    if (state) {
      params.push(state);
      sql += ` AND state = $${params.length}`;
    }

    const result = await pool.query(sql, params);
    res.json(result.rows);

  } catch (err) {
    console.error("VENDOR SEARCH ERROR:", err);
    res.status(500).json({ error: "Failed to search vendors" });
  }
});

/* ===========================
   START SERVER
=========================== */

const PORT = 10000;

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
