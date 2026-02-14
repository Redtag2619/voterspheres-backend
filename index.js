import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import pkg from "pg";
import { createClient } from "redis";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* ============================
   CONFIG
============================ */

const BASE_URL = "https://voterspheres.org";
const PORT = process.env.PORT || 5000;
const SITEMAP_LIMIT = 50000;

/* ============================
   POSTGRES POOL
============================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

/* ============================
   REDIS CLIENT (PRODUCTION SAFE)
============================ */

const redis = createClient({
  url: process.env.REDIS_URL
});

redis.on("error", (err) =>
  console.error("Redis error:", err)
);

await redis.connect();

console.log("Redis connected");


/* ============================
   CACHE HELPERS
============================ */

async function cacheGet(key) {

  try {

    const data = await redis.get(key);

    if (!data) return null;

    return JSON.parse(data);

  } catch {

    return null;

  }

}

async function cacheSet(key, data, ttl = 3600) {

  try {

    await redis.setEx(
      key,
      ttl,
      JSON.stringify(data)
    );

  } catch {}

}


/* ============================
   XML HELPERS
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
   HEALTH CHECK
============================ */

app.get("/", (req, res) => {

  res.send("Production backend with Redis running");

});


/* ============================
   CACHED CANDIDATE BY SLUG
============================ */

app.get("/api/candidate/:slug", async (req, res) => {

  const slug = req.params.slug;

  const cacheKey = `candidate:${slug}`;

  const cached = await cacheGet(cacheKey);

  if (cached) {

    return res.json(cached);

  }

  try {

    const result = await pool.query(`
      SELECT *
      FROM candidates
      WHERE slug = $1
      LIMIT 1
    `, [slug]);

    if (!result.rows.length)
      return res.status(404).json({ error: "Not found" });

    const candidate = result.rows[0];

    await cacheSet(cacheKey, candidate, 86400);

    res.json(candidate);

  }
  catch (err) {

    console.error(err);
    res.status(500).json({ error: "Database error" });

  }

});


/* ============================
   CACHED CANDIDATE LIST
============================ */

app.get("/api/candidates", async (req, res) => {

  const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
  const offset = parseInt(req.query.offset) || 0;

  const cacheKey = `candidates:${limit}:${offset}`;

  const cached = await cacheGet(cacheKey);

  if (cached)
    return res.json(cached);

  try {

    const result = await pool.query(`
      SELECT id, full_name, slug, state, party, county, office, updated_at
      FROM candidates
      ORDER BY id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    await cacheSet(cacheKey, result.rows, 3600);

    res.json(result.rows);

  }
  catch {

    res.status(500).json({ error: "Database error" });

  }

});


/* ============================
   ROBOTS.TXT (CACHED)
============================ */

app.get("/robots.txt", async (req, res) => {

  const cacheKey = "robots";

  const cached = await cacheGet(cacheKey);

  if (cached) {

    res.type("text/plain").send(cached);
    return;

  }

  const robots = `User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml`;

  await cacheSet(cacheKey, robots, 86400);

  res.type("text/plain").send(robots);

});


/* ============================
   SITEMAP INDEX (CACHED)
============================ */

app.get("/sitemap.xml", async (req, res) => {

  const cacheKey = "sitemap:index";

  const cached = await cacheGet(cacheKey);

  if (cached) {

    res.header("Content-Type", "application/xml");
    res.send(cached);
    return;

  }

  try {

    const result = await pool.query(`
      SELECT COUNT(*) FROM candidates
    `);

    const total = parseInt(result.rows[0].count);

    const chunks = Math.ceil(total / SITEMAP_LIMIT);

    const now = new Date().toISOString();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>`;
    xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    xml += `
<sitemap>
<loc>${BASE_URL}/sitemap-static.xml</loc>
<lastmod>${now}</lastmod>
</sitemap>`;

    xml += `
<sitemap>
<loc>${BASE_URL}/sitemap-states.xml</loc>
<lastmod>${now}</lastmod>
</sitemap>`;

    for (let i = 1; i <= chunks; i++) {

      xml += `
<sitemap>
<loc>${BASE_URL}/sitemap-candidates-${i}.xml</loc>
<lastmod>${now}</lastmod>
</sitemap>`;

    }

    xml += `</sitemapindex>`;

    await cacheSet(cacheKey, xml, 3600);

    res.header("Content-Type", "application/xml");
    res.send(xml);

  }
  catch {

    res.status(500).end();

  }

});


/* ============================
   CANDIDATE SITEMAP (CACHED)
============================ */

app.get("/sitemap-candidates-:page.xml", async (req, res) => {

  const page = parseInt(req.params.page);

  const cacheKey = `sitemap:candidates:${page}`;

  const cached = await cacheGet(cacheKey);

  if (cached) {

    res.header("Content-Type", "application/xml");
    res.send(cached);
    return;

  }

  const offset = (page - 1) * SITEMAP_LIMIT;

  try {

    const result = await pool.query(`
      SELECT slug, updated_at
      FROM candidates
      ORDER BY id
      LIMIT $1 OFFSET $2
    `, [SITEMAP_LIMIT, offset]);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    for (const row of result.rows) {

      xml += `
<url>
<loc>${BASE_URL}/candidate/${row.slug}</loc>
<lastmod>${new Date(row.updated_at).toISOString()}</lastmod>
</url>`;

    }

    xml += `</urlset>`;

    await cacheSet(cacheKey, xml, 86400);

    res.header("Content-Type", "application/xml");
    res.send(xml);

  }
  catch {

    res.status(500).end();

  }

});


/* ============================
   START SERVER
============================ */

app.listen(PORT, () => {

  console.log(`Server running on port ${PORT}`);

});
