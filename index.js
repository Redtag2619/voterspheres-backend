import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ✅ PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ✅ Test DB connection on startup
(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to database");
  } catch (err) {
    console.error("DB CONNECTION ERROR:", err);
  }
})();

// ✅ Health check route
app.get("/health", (req, res) => {
  res.send("Backend OK");
});

// ✅ Voters API route
app.get("/api/voters", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, city, party
      FROM public.voters
      LIMIT 100;
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to load voters" });
  }
});

// ✅ Server listen (IMPORTANT — correct port)
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
