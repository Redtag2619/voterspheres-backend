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
   DATABASE CONNECTION
============================ */

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),
  database: process.env.DB_NAME,
  ssl: false
});

// Test DB connection on startup
(async () => {
  try {
    const client = await pool.connect();
    console.log("Connected to database");
    client.release();
  } catch (err) {
    console.error("DB ERROR:", err);
  }
})();

/* ============================
   ROUTES
============================ */

app.get("/api/voters", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        city,
        party
      FROM voters
      LIMIT 100;
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to load voters" });
  }
});

/* ============================
   SERVER START
============================ */

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
