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
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`
User-agent: *
Allow: /

Sitemap: ${req.protocol}://${req.get("host")}/sitemap.xml
  `);
});
app.get("/sitemap.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT slug, updated_at
      FROM candidate
      WHERE slug IS NOT NULL
    `);

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const urls = rows
      .map(
        (c) => `
  <url>
    <loc>${baseUrl}/candidate/${c.slug}</loc>
    <lastmod>${(c.updated_at || new Date()).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`
      )
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  ${urls}
</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating sitemap");
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
