import express from "express";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 10000;

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// Needed for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== MIDDLEWARE =====
app.use(express.json());

// ===== SERVE FRONTEND =====
// 🔥 THIS IS THE PART YOU WERE MISSING
app.use(express.static(path.join(__dirname, "public")));

// ===== API: Candidate by Slug =====
app.get("/api/candidate/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      `SELECT id, full_name, state, party, county, office, photo
       FROM candidate
       WHERE slug = $1
       LIMIT 1`,
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

// ===== ROBOTS.TXT =====
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`
User-agent: *
Allow: /

Sitemap: ${req.protocol}://${req.get("host")}/sitemap.xml
  `);
});

// ===== SITEMAP.XML =====
app.get("/sitemap.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, updated_at FROM candidate WHERE slug IS NOT NULL`
    );

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

    res.header("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <priority>1.0</priority>
  </url>
  ${urls}
</urlset>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Sitemap error");
  }
});

// ===== SPA FALLBACK (CRITICAL) =====
// 🔥 This fixes /candidate/john-smith showing "Cannot GET"
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
