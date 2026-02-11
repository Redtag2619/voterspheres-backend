import express from "express";
import pkg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =============================
   HEALTH CHECK
============================= */
app.get("/", (req, res) => {
  res.json({ status: "VoterSpheres API running" });
});

/* =============================
   GET CANDIDATE BY SLUG
============================= */
app.get("/api/candidate/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      `SELECT id, full_name, slug, state, party, county, office, photo
       FROM candidate
       WHERE slug = $1
       LIMIT 1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =============================
   LIST ALL CANDIDATES (SEO)
============================= */
app.get("/api/candidates", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT full_name, slug, state, party, office
       FROM candidate
       ORDER BY full_name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
/* =============================
   DYNAMIC SITEMAP
============================= */
app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT slug FROM candidate WHERE slug IS NOT NULL`
    );

    const urls = result.rows
      .map(
        row => `
  <url>
    <loc>https://voterspheres.org/${row.slug}</loc>
  </url>`
      )
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://voterspheres.org/</loc>
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

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
