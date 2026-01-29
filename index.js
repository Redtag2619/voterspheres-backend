import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   Middleware
========================= */

app.use(cors({
  origin: "*",   // later you can restrict to frontend domain
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* =========================
   PostgreSQL (Render-ready)
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   Root route
========================= */

app.get("/", (req, res) => {
  res.json({
    status: "Backend running",
    service: "VoterSpheres API"
  });
});

/* =========================
   Health check
========================= */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(500).json({
      status: "error",
      database: "disconnected",
      error: err.message
    });
  }
});

/* =========================
   Sample API routes
========================= */

app.get("/api/voters", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM voters LIMIT 100");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/elections", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM elections");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   Start server
========================= */

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
