require("dotenv").config();

const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const cors = require("cors");
const { Pool } = require("pg");
const Redis = require("ioredis");

const app = express();

/* ======================================================
   CONFIG
====================================================== */

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || "https://www.votersphere.com";

const REDIS_URL = process.env.REDIS_URL || null;

/* ======================================================
   POSTGRES POOL (ENTERPRISE)
====================================================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  max: 50, // connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

/* ======================================================
   REDIS (OPTIONAL BUT RECOMMENDED)
====================================================== */

let redis = null;

if (REDIS_URL) {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true
  });

  redis.connect().then(() => {
    console.log("✅ Redis connected");
  }).catch(() => {
    console.log("⚠️ Redis unavailable (continuing without)");
  });
}

/* ======================================================
   MIDDLEWARE
====================================================== */

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());

/* ======================================================
   CACHE HELPERS
====================================================== */

async function cacheGet(key) {
  if (!redis) return null;

  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

async function cacheSet(key, value, ttl = 3600) {
  if (!redis) return;

  await redis.set(key, JSON.stringify(value), "EX", ttl);
}

/* ======================================================
   HEALTH CHECKS
====================================================== */

app.get("/health", async (req, res) => {
  res.json({ status: "ok" });
});

app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(500).json({ status: "not ready" });
  }
});

/* ======================================================
   DATABASE HELPERS
====================================================== */

async function getCandidateBySlug(slug) {

  const cacheKey = `cand:${slug}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const result = await pool.query(
    `SELECT *
     FROM candidates
     WHERE slug = $1
     LIMIT 1`,
    [slug]
  );

  const candidate = result.rows[0] || null;

  if (candidate) await cacheSet(cacheKey, candidate, 86400);

  return candidate;
}

async function getCandidatesByState(state) {

  const cacheKey = `state:${state}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const result = await pool.query(
    `SELECT *
     FROM candidates
     WHERE state = $1
     ORDER BY name ASC
     LIMIT 1000`,
    [state.toUpperCase()]
  );

  const rows = result.rows || [];

  await cacheSet(cacheKey, rows, 3600);

  return rows;
}

/* ======================================================
   SCHEMA BUILDERS
====================================================== */

function candidateSchema(candidate) {
  return {
    "@context": "https://schema.org",
    "@type": "PoliticalCandidate",
    name: candidate.name,
    url: `${BASE_URL}/candidate/${candidate.slug}`,
    image: candidate.photo || "",
    party: candidate.party || "",
    description: candidate.bio || ""
  };
}

function stateSchema(state, candidates) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Candidates in ${state}`,
    url: `${BASE_URL}/state/${state}`,
    about: candidates.slice(0, 10).map(c => ({
      "@type": "PoliticalCandidate",
      name: c.name,
      url: `${BASE_URL}/candidate/${c.slug}`
    }))
  };
}

/* ======================================================
   CANDIDATE PAGE
====================================================== */

app.get("/candidate/:slug", async (req, res) => {

  try {

    const slug = req.params.slug;

    const candidate = await getCandidateBySlug(slug);

    if (!candidate) return res.status(404).send("Not found");

    const schema = candidateSchema(candidate);

    res.send(`
<!DOCTYPE html>
<html>
<head>

<title>${candidate.name} | VoterSphere</title>

<meta name="description" content="${candidate.bio || ""}" />
<link rel="canonical" href="${BASE_URL}/candidate/${slug}" />

<script type="application/ld+json">
${JSON.stringify(schema)}
</script>

</head>
<body>

<h1>${candidate.name}</h1>

<p>${candidate.bio || ""}</p>
<p>Party: ${candidate.party || ""}</p>
<p>State: ${candidate.state || ""}</p>

</body>
</html>
`);

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }

});

/* ======================================================
   STATE PAGE
====================================================== */

app.get("/state/:state", async (req, res) => {

  try {

    const state = req.params.state.toUpperCase();

    const candidates = await getCandidatesByState(state);

    const listHTML = candidates
      .map(c => `<li><a href="${BASE_URL}/candidate/${c.slug}">${c.name}</a></li>`)
      .join("");

    const schema = stateSchema(state, candidates);

    res.send(`
<!DOCTYPE html>
<html>
<head>

<title>${state} Candidates | VoterSphere</title>

<meta name="description" content="Browse political candidates in ${state}" />
<link rel="canonical" href="${BASE_URL}/state/${state}" />

<script type="application/ld+json">
${JSON.stringify(schema)}
</script>

</head>
<body>

<h1>${state} Candidates</h1>

<ul>
${listHTML}
</ul>

</body>
</html>
`);

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }

});

/* ======================================================
   API
====================================================== */

app.get("/api/candidate/:slug", async (req, res) => {

  try {

    const candidate = await getCandidateBySlug(req.params.slug);

    if (!candidate) return res.status(404).json({ error: "Not found" });

    res.json(candidate);

  } catch {
    res.status(500).json({ error: "Server error" });
  }

});

app.get("/api/state/:state", async (req, res) => {

  try {

    const data = await getCandidatesByState(req.params.state);

    res.json(data);

  } catch {
    res.status(500).json({ error: "Server error" });
  }

});

/* ======================================================
   SITEMAP SYSTEM (ENTERPRISE SCALE)
====================================================== */

const SITEMAP_CHUNK = 50000;

/*
   Sitemap Index
*/

app.get("/sitemap.xml", async (req, res) => {

  const countResult = await pool.query(
    "SELECT COUNT(*) FROM candidates"
  );

  const total = parseInt(countResult.rows[0].count);
  const chunks = Math.ceil(total / SITEMAP_CHUNK);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  for (let i = 0; i < chunks; i++) {
    xml += `
<sitemap>
<loc>${BASE_URL}/sitemap-${i}.xml</loc>
</sitemap>`;
  }

  xml += `</sitemapindex>`;

  res.header("Content-Type", "application/xml");
  res.send(xml);

});

/*
   Individual Sitemap Chunk
*/

app.get("/sitemap-:page.xml", async (req, res) => {

  const page = parseInt(req.params.page);

  const offset = page * SITEMAP_CHUNK;

  const result = await pool.query(
    `SELECT slug, updated_at
     FROM candidates
     ORDER BY id
     LIMIT $1 OFFSET $2`,
    [SITEMAP_CHUNK, offset]
  );

  const urls = result.rows.map(c => `
<url>
<loc>${BASE_URL}/candidate/${c.slug}</loc>
<lastmod>${new Date(c.updated_at).toISOString()}</lastmod>
</url>`).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  res.header("Content-Type", "application/xml");
  res.send(xml);

});

/* ======================================================
   CACHE WARMER (BACKGROUND)
====================================================== */

async function warmCache() {

  console.log("🔥 Cache warming started");

  try {

    const result = await pool.query(
      `SELECT slug FROM candidates
       ORDER BY updated_at DESC
       LIMIT 1000`
    );

    for (const row of result.rows) {
      await getCandidateBySlug(row.slug);
    }

    console.log("✅ Cache warmed");

  } catch (err) {
    console.log("Cache warm failed", err.message);
  }

}

setTimeout(warmCache, 10000);

/* ======================================================
   ROOT
====================================================== */

app.get("/", (req, res) => {
  res.send("VoterSphere Enterprise Backend Running");
});

/* ======================================================
   START SERVER
====================================================== */

app.listen(PORT, async () => {

  console.log("🚀 Server running on port", PORT);

  try {
    await pool.query("SELECT 1");
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ DB ERROR:", err.message);
  }

});
