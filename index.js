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

/* ===========================
   DATABASE
=========================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "db down" });
  }
});

/* ===========================
   PUBLIC CANDIDATE PROFILE
   /api/candidate/:slug
=========================== */

app.get("/api/candidate/:slug", async (req, res) => {
  const { slug } = req.params;

  try {
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
      FROM public.candidate
      WHERE slug = $1
      LIMIT 1
      `,
      [slug]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("CANDIDATE FETCH ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===========================
   START SERVER
=========================== */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
