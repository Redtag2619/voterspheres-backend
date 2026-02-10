import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 10000;

/* ===========================
   PATH SETUP
=========================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===========================
   MIDDLEWARE
=========================== */
app.use(cors());
app.use(express.json());

/* ===========================
   DATABASE
=========================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ DB error", err);
  }
})();

/* ===========================
   STATIC FRONTEND
=========================== */
app.use(express.static(path.join(__dirname, "public")));

/* ===========================
   API — CANDIDATE BY SLUG
=========================== */
app.get("/api/candidate/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        full_name,
        slug,
        state,
        party,
        county,
        office,
        photo
      FROM candidate
      WHERE slug = $1
      LIMIT 1
      `,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===========================
   CLEAN URL REWRITE
   /candidate/john-smith
=========================== */
app.get("/candidate/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "candidate.html"));
});

/* ===========================
   HEALTH CHECK
=========================== */
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

/* ===========================
   START SERVER
=========================== */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
