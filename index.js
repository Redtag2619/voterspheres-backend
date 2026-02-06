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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

/* ======================
   TEST DB
====================== */

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
   HOME
====================== */

app.get("/", (req, res) => {
  res.json({ status: "Backend running" });
});

/* ======================
   SAFE CANDIDATES API
====================== */

app.get("/api/candidates", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name='candidates'
    `);

    if (result.rows.length === 0) {
      return res.json({
        warning: "candidates table does not exist yet",
        data: []
      });
    }

    const data = await pool.query(
      "SELECT id, name, state, party, county, office FROM candidates ORDER BY name"
    );

    res.json(data.rows);

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   STATES DROPDOWN SAFE
====================== */

app.get("/api/dropdowns/states", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state 
      FROM candidates
      WHERE state IS NOT NULL
      ORDER BY state
    `);
    res.json(result.rows);
  } catch {
    res.json([]); // safe empty
  }
});

/* ======================
   START
====================== */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
