import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import pkg from "pg";
import express from "express";
import cors from "cors";
import pkg from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


/* ============================
   CORS (allow your frontend)
============================ */

app.use(cors({
  origin: "*",   // you can lock to Vercel domain later
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* ============================
   PostgreSQL Connection
============================ */

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

/* ============================
   Root Route (fixes Cannot GET /)
============================ */

app.get("/", (req, res) => {
  res.json({
    status: "Backend running",
    service: "VoterSpheres API",
    time: new Date()
  });
});

/* ============================
   Health Check
============================ */

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

/* ============================
   API: Get all voters
============================ */

app.get("/api/voters", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM voters LIMIT 100");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   API: Get elections
============================ */

app.get("/api/elections", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM elections");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   API: Create voter (example)
============================ */

app.post("/api/voters", async (req, res) => {
  const { name, email } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO voters(name, email) VALUES($1, $2) RETURNING *",
      [name, email]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   Start Server
============================ */

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
