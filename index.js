import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const { Pool } = pkg;
const app = express();

/* ============================
   PATH FIX (ESM)
============================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================
   MIDDLEWARE
============================ */
app.use(cors());
app.use(express.json());

/* ============================
   SERVE FRONTEND FILES
============================ */
app.use(express.static(path.join(__dirname, "public")));

/* ============================
   DATABASE
============================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

/* ============================
   HEALTH CHECK (RENDER REQUIRES)
============================ */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ============================
   API ROOT
============================ */
app.get("/api", (req, res) => {
  res.json({ message: "API running" });
});

/* ============================
   DROPDOWNS
============================ */
app.get("/api/dropdowns/states", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM states ORDER BY name"
  );
  res.json(rows);
});

/* ============================
   CANDIDATES
============================ */
app.get("/api/candidates", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.full_name,
      s.name AS state,
      p.name AS party,
      o.name AS office,
      co.name AS county
    FROM candidates c
    LEFT JOIN states s ON c.state_id = s.id
    LEFT JOIN parties p ON c.party_id = p.id
    LEFT JOIN offices o ON c.office_id = o.id
    LEFT JOIN counties co ON c.county_id = co.id
    ORDER BY c.full_name
    LIMIT 50
  `);
  res.json(rows);
});

/* ============================
   FRONTEND FALLBACK
============================ */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ============================
   START SERVER
============================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
