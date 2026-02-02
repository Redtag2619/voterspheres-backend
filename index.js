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
