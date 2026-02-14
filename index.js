require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

/* ===============================
   DATABASE
================================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ===============================
   CONFIG
================================= */
const BASE_URL = "https://voterspheres.org";
const SITEMAP_LIMIT = 50000;

/* ===============================
   HEALTH CHECK
================================= */
app.get("/", (req, res) => {
  res.send("VoterSpheres Backend Running");
});

/* ===============================
   API ROUTES
================================= */

// Get all candidates
app.get("/api/candidates", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, full_name, slug, state, party, county, office, updated_at
      FROM candidates
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get candidate by slug
app.get("/api/candidates/:slug", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM candidates WHERE slug = $1`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===============================
   ROBOTS.TXT
================================= */
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml`);
});

/* ===============================
   SITEMAP HELPERS
================================= */

function generateUrlXML(url, lastmod) {
  return `
  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;
}

function wrapUrlSet(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urls.join("")}
  </urlset>`;
}

function wrapSitemapIndex(sitemaps) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${sitemaps.join("")}
  </sitemapindex>`;
}

/* ===============================
   MAIN SITEMAP INDEX
================================= */
app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FROM candidates
    `);

    const total = parseInt(result.rows[0].count);
    const chunks = Math.ceil(total / SITEMAP_LIMIT);

    let sitemapEntries = [];

    // Static sitemap
    sitemapEntries.push(`
      <sitemap>
        <loc>${BASE_URL}/sitemap-static.xml</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
      </sitemap>`);

    // State sitemap
    sitemapEntries.push(`
      <sitemap>
        <loc>${BASE_URL}/sitemap-states.xml</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
      </sitemap>`);

    // Candidate chunks
    for (let i = 1; i <= chunks; i++) {
      sitemapEntries.push(`
        <sitemap>
          <loc>${BASE_URL}/sitemap-candidates-${i}.xml</loc>
          <lastmod>${new Date().toISOString()}</lastmod>
        </sitemap>`);
    }

    res.header("Content-Type", "application/xml");
    res.send(wrapSitemapIndex(sitemapEntries));
  } catch (err) {
    console.error(err);
    res.status(500).send("Sitemap error");
  }
});

/* ===============================
   STATIC PAGES SITEMAP
================================= */
app.get("/sitemap-static.xml", (req, res) => {
  const now = new Date().toISOString();

  const urls = [
    generateUrlXML(`${BASE_URL}/`, now),
    generateUrlXML(`${BASE_URL}/states`, now),
  ];

  res.header("Content-Type", "application/xml");
  res.send(wrapUrlSet(urls));
});

/* ===============================
   STATE SITEMAP
================================= */
app.get("/sitemap-states.xml", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT state FROM candidates
      ORDER BY state
    `);

    const urls = result.rows.map(row =>
      generateUrlXML(
        `${BASE_URL}/state/${row.state.toLowerCase()}`,
        new Date().toISOString()
      )
    );

    res.header("Content-Type", "application/xml");
    res.send(wrapUrlSet(urls));
  } catch (err) {
    console.error(err);
    res.status(500).send("State sitemap error");
  }
});

/* ===============================
   CANDIDATE SITEMAP (AUTO CHUNKED)
================================= */
app.get("/sitemap-candidates-:page.xml", async (req, res) => {
  try {
    const page = parseInt(req.params.page);
    const offset = (page - 1) * SITEMAP_LIMIT;

    const result = await pool.query(`
      SELECT slug, updated_at
      FROM candidates
      ORDER BY id
      LIMIT $1 OFFSET $2
    `, [SITEMAP_LIMIT, offset]);

    const urls = result.rows.map(candidate =>
      generateUrlXML(
        `${BASE_URL}/candidate/${candidate.slug}`,
        candidate.updated_at
          ? new Date(candidate.updated_at).toISOString()
          : new Date().toISOString()
      )
    );

    res.header("Content-Type", "application/xml");
    res.send(wrapUrlSet(urls));
  } catch (err) {
    console.error(err);
    res.status(500).send("Candidate sitemap error");
  }
});

/* ===============================
   SERVER START
================================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
