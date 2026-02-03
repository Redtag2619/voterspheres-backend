import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* ============================
   PostgreSQL Connection
============================ */

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5433,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "postgres",
});

/* ============================
   Test DB Connection
============================ */

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
})();

/* ============================
   Root
============================ */

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

/* ============================
   CANDIDATE SEARCH + PAGINATION
============================ */

app.get("/api/candidates", async (req, res) => {
  const {
    q = "",
    state,
    party,
    office,
    page = 1,
    limit = 25,
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

  try {
    const result = await pool.query(
      `
      SELECT
        c.id,
        c.full_name,
        s.code AS state,
        co.name AS county,
        p.name AS party,
        o.name AS office,
        c.email,
        c.phone,
        c.website
      FROM candidates c
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN counties co ON c.county_id = co.id
      LEFT JOIN parties p ON c.party_id = p.id
      LEFT JOIN offices o ON c.office_id = o.id
      ${whereClause}
      ORDER BY c.full_name
      LIMIT $${i++} OFFSET $${i++}
      `,
      [...values, limit, offset]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("❌ CANDIDATE SEARCH ERROR:", err);
    res.status(500).json({ error: "Failed to search candidates" });
  }
});

/* ============================
   DROPDOWNS
============================ */

/* ---- STATES ---- */

app.get("/api/dropdowns/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, code, name
      FROM states
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ STATES ERROR:", err);
    res.status(500).json({ error: "Failed to load states" });
  }
});

/* ---- PARTIES ---- */

app.get("/api/dropdowns/parties", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, abbreviation
      FROM parties
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ PARTIES ERROR:", err);
    res.status(500).json({ error: "Failed to load parties" });
  }
});

/* ---- OFFICES ---- */

app.get("/api/dropdowns/offices", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM offices
      ORDER BY name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ OFFICES ERROR:", err);
    res.status(500).json({ error: "Failed to load offices" });
  }
});

/* ---- COUNTIES BY STATE ---- */

app.get("/api/dropdowns/counties", async (req, res) => {
  const { state } = req.query;

  if (!state) {
    return res.json([]);
  }

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
    console.error("❌ COUNTIES ERROR:", err);
    res.status(500).json({ error: "Failed to load counties" });
  }
});

/* ============================
   START SERVER
============================ */

const PORT = 10000;

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
