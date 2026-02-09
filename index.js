import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();

const { Pool } = pkg;
const app = express();

/* -------------------- REQUIRED FOR RENDER -------------------- */
const PORT = process.env.PORT || 10000;

/* -------------------- MIDDLEWARE -------------------- */
app.use(cors());
app.use(express.json());

/* -------------------- PATH FIXES -------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------- UPLOADS -------------------- */
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}
app.use("/uploads", express.static(UPLOAD_DIR));

/* -------------------- DATABASE -------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

/* -------------------- HEALTH CHECK -------------------- */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* -------------------- ROBOTS.TXT -------------------- */
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Allow: /

Sitemap: https://yourdomain.com/sitemap.xml`);
});

/* -------------------- SITEMAP.XML -------------------- */
app.get("/sitemap.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug FROM public.candidate WHERE slug IS NOT NULL`
    );

    const urls = rows
      .map(
        (c) =>
          `<url>
  <loc>https://yourdomain.com/candidate/${c.slug}</loc>
</url>`
      )
      .join("");

    res.type("application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://yourdomain.com/</loc>
  </url>
  ${urls}
</urlset>`);
  } catch (err) {
    console.error("SITEMAP ERROR:", err);
    res.status(500).send("Sitemap error");
  }
});

/* -------------------- CANDIDATE LIST (PAGINATED) -------------------- */
app.get("/api/candidates", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  try {
    const data = await pool.query(
      `SELECT id, full_name, state, party, county, office, slug, photo
       FROM public.candidate
       ORDER BY full_name
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = await pool.query(
      `SELECT COUNT(*) FROM public.candidate`
    );

    res.json({
      results: data.rows,
      total: parseInt(total.rows[0].count),
      page,
      pages: Math.ceil(total.rows[0].count / limit),
    });
  } catch (err) {
    console.error("CANDIDATE LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load candidates" });
  }
});

/* -------------------- CANDIDATE PROFILE (SLUG URL) -------------------- */
app.get("/api/candidate/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      `SELECT id, full_name, state, party, county, office, photo
       FROM public.candidate
       WHERE slug = $1
       LIMIT 1`,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("CANDIDATE PROFILE ERROR:", err);
    res.status(500).json({ error: "Profile error" });
  }
});

/* -------------------- SERVER START -------------------- */
app.listen(PORT, "0.0.0.0", async () => {
  try {
    await pool.query("SELECT 1");
    console.log(`🚀 Server running on port ${PORT}`);
    console.log("✅ Connected to database");
  } catch (err) {
    console.error("❌ Database connection failed", err);
  }
});
