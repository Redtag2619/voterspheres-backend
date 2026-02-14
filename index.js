import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* ============================
   CONFIG
============================ */

const BASE_URL = "https://voterspheres.org";
const SITEMAP_LIMIT = 50000;
const PORT = process.env.PORT || 5000;

/* ============================
   DATABASE POOL (PRODUCTION OPTIMIZED)
============================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  max: 20, // connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/* ============================
   HEALTH CHECK
============================ */

app.get("/", (req, res) => {
  res.send("VoterSpheres Production Backend Running");
});

/* ============================
   API ROUTES
============================ */

/* Get candidates paginated */
app.get("/api/candidates", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(`
      SELECT id, full_name, slug, state, party, county, office, updated_at
      FROM candidates
      ORDER BY id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});


/* Get candidate by slug */
app.get("/api/candidate/:slug", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT *
      FROM candidates
      WHERE slug = $1
      LIMIT 1
    `, [req.params.slug]);

    if (!result.rows.length)
      return res.status(404).json({ error: "Not found" });

    res.json(result.rows[0]);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Database error" });

  }

});


/* ============================
   ROBOTS.TXT
============================ */

app.get("/robots.txt", (req, res) => {

  res.type("text/plain");

  res.send(`User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml`);

});


/* ============================
   XML HELPERS (STREAM SAFE)
============================ */

function writeXMLHeader(res) {

  res.write(`<?xml version="1.0" encoding="UTF-8"?>`);

}

function writeUrlSetOpen(res) {

  res.write(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);

}

function writeUrlSetClose(res) {

  res.write(`</urlset>`);

}

function writeSitemapIndexOpen(res) {

  res.write(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);

}

function writeSitemapIndexClose(res) {

  res.write(`</sitemapindex>`);

}

function writeURL(res, loc, lastmod) {

  res.write(`
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);

}

function writeSitemap(res, loc, lastmod) {

  res.write(`
  <sitemap>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`);

}


/* ============================
   SITEMAP INDEX (FAST)
============================ */

app.get("/sitemap.xml", async (req, res) => {

  try {

    res.header("Content-Type", "application/xml");

    writeXMLHeader(res);
    writeSitemapIndexOpen(res);

    const result = await pool.query(`
      SELECT COUNT(*) FROM candidates
    `);

    const total = parseInt(result.rows[0].count);

    const chunks = Math.ceil(total / SITEMAP_LIMIT);

    const now = new Date().toISOString();

    writeSitemap(res, `${BASE_URL}/sitemap-static.xml`, now);
    writeSitemap(res, `${BASE_URL}/sitemap-states.xml`, now);

    for (let i = 1; i <= chunks; i++) {

      writeSitemap(
        res,
        `${BASE_URL}/sitemap-candidates-${i}.xml`,
        now
      );

    }

    writeSitemapIndexClose(res);

    res.end();

  }
  catch (err) {

    console.error(err);
    res.status(500).end();

  }

});


/* ============================
   STATIC SITEMAP
============================ */

app.get("/sitemap-static.xml", (req, res) => {

  res.header("Content-Type", "application/xml");

  writeXMLHeader(res);
  writeUrlSetOpen(res);

  const now = new Date().toISOString();

  writeURL(res, `${BASE_URL}/`, now);
  writeURL(res, `${BASE_URL}/states`, now);

  writeUrlSetClose(res);

  res.end();

});


/* ============================
   STATE SITEMAP (STREAM SAFE)
============================ */

app.get("/sitemap-states.xml", async (req, res) => {

  try {

    res.header("Content-Type", "application/xml");

    writeXMLHeader(res);
    writeUrlSetOpen(res);

    const result = await pool.query(`
      SELECT DISTINCT state
      FROM candidates
      ORDER BY state
    `);

    const now = new Date().toISOString();

    for (const row of result.rows) {

      writeURL(
        res,
        `${BASE_URL}/state/${row.state.toLowerCase()}`,
        now
      );

    }

    writeUrlSetClose(res);

    res.end();

  }
  catch (err) {

    console.error(err);
    res.status(500).end();

  }

});


/* ============================
   CANDIDATE SITEMAP (STREAMED)
============================ */

app.get("/sitemap-candidates-:page.xml", async (req, res) => {

  const page = parseInt(req.params.page);

  if (!page || page < 1)
    return res.status(400).end();

  const offset = (page - 1) * SITEMAP_LIMIT;

  try {

    res.header("Content-Type", "application/xml");

    writeXMLHeader(res);
    writeUrlSetOpen(res);

    const result = await pool.query(`
      SELECT slug, updated_at
      FROM candidates
      ORDER BY id
      LIMIT $1 OFFSET $2
    `, [SITEMAP_LIMIT, offset]);

    for (const row of result.rows) {

      writeURL(
        res,
        `${BASE_URL}/candidate/${row.slug}`,
        row.updated_at
          ? new Date(row.updated_at).toISOString()
          : new Date().toISOString()
      );

    }

    writeUrlSetClose(res);

    res.end();

  }
  catch (err) {

    console.error(err);
    res.status(500).end();

  }

});


/* ============================
   PRODUCTION PERFORMANCE ENDPOINT
============================ */

app.get("/api/stats", async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT COUNT(*) AS total_candidates
      FROM candidates
    `);

    res.json({
      total_candidates: result.rows[0].total_candidates,
      status: "healthy"
    });

  }
  catch (err) {

    res.status(500).json({ error: "Database error" });

  }

});


/* ============================
   START SERVER
============================ */

app.listen(PORT, () => {

  console.log(`Production server running on port ${PORT}`);

});
