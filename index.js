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
   DATABASE CONNECTION
====================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false   // local = no ssl
});

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB ERROR:", err.message);
  }
}

testDB();

/* ======================
   BASIC TEST ROUTE
====================== */

app.get("/", (req, res) => {
  res.json({ status: "Backend running" });
});

/* ======================
   CANDIDATES API
====================== */

app.get("/api/candidates", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name FROM candidates ORDER BY name LIMIT 50"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   STATES DROPDOWN (SAFE)
====================== */

app.get("/api/dropdowns/states", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT state FROM candidates WHERE state IS NOT NULL ORDER BY state"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   START SERVER
====================== */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
