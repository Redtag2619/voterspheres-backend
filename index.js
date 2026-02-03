import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ===== PostgreSQL (Render + local compatible) =====

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL missing in .env");
  process.exit(1);
}

console.log("✅ Using DATABASE_URL");

// Create pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
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

// ================= ROUTES =================

// Health check
app.get("/", (req, res) => {
  res.send("Backend running ✅");
});

// ---- Candidates search + pagination ----
app.get("/api/candidates", async (req, res) => {
  try {
    const {
      q = "",
      state_id,
      party_id,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (page - 1) * limit;

    let filters = [];
    let values = [];
    let i = 1;

    if (q) {
      filters.push(`full_name ILIKE $${i++}`);
      values.push(`%${q}%`);
    }

    if (state_id) {
      filters.push(`state_id = $${i++}`);
      values.push(state_id);
    }

    if (party_id) {
      filters.push(`party_id = $${i++}`);
      values.push(party_id);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const dataQuery = `
      SELECT * FROM candidates
      ${where}
      ORDER BY full_name
      LIMIT $${i++} OFFSET $${i}
    `;

    values.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) FROM candidates ${where}
    `;

    const [data, count] = await Promise.all([
      pool.query(dataQuery, values),
      pool.query(countQuery, values.slice(0, values.length - 2))
    ]);

    res.json({
      results: data.rows,
      total: Number(count.rows[0].count),
      page: Number(page),
      pages: Math.ceil(count.rows[0].count / limit)
    });

  } catch (err) {
    console.error("CANDIDATE SEARCH ERROR:", err);
    res.status(500).json({ error: "Failed to load candidates" });
  }
});

// ---- Dropdowns ----

app.get("/api/states", async (req, res) => {
  const result = await pool.query("SELECT id, name FROM states ORDER BY name");
  res.json(result.rows);
});

app.get("/api/parties", async (req, res) => {
  const result = await pool.query("SELECT id, name FROM parties ORDER BY name");
  res.json(result.rows);
});

app.get("/api/offices", async (req, res) => {
  const result = await pool.query("SELECT id, name FROM offices ORDER BY name");
  res.json(result.rows);
});

// ================= SERVER =================

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
