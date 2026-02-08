import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";

dotenv.config();
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000;

/* ============================
   DATABASE
============================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

await pool.query("SELECT 1");
console.log("✅ Connected to database");

/* ============================
   API ROUTES
============================ */

app.get("/api/candidates", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      c.id,
      c.full_name,
      p.name AS party,
      s.name AS state,
      o.name AS office
    FROM candidates c
    LEFT JOIN parties p ON p.id = c.party_id
    LEFT JOIN states s ON s.id = c.state_id
    LEFT JOIN offices o ON o.id = c.office_id
    ORDER BY c.full_name
  `);
  res.json(rows);
});

app.get("/api/candidates/:id", async (req, res) => {
  const { id } = req.params;

  const { rows } = await pool.query(`
    SELECT
      c.*,
      p.name AS party,
      s.name AS state,
      o.name AS office
    FROM candidates c
    LEFT JOIN parties p ON p.id = c.party_id
    LEFT JOIN states s ON s.id = c.state_id
    LEFT JOIN offices o ON o.id = c.office_id
    WHERE c.id = $1
  `, [id]);

  if (!rows.length) return res.sendStatus(404);
  res.json(rows[0]);
});

/* ============================
   CLEAN URL ROUTE (SEO)
============================ */

// /candidate/john-smith-12
app.get("/candidate/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "candidate.html"));
});

/* ============================
   FALLBACK
============================ */

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () =>
  console.log(`🚀 Backend running on port ${PORT}`)
);
