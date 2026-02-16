require("dotenv").config();

const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

/* ======================================================
   CONFIG
====================================================== */

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || "https://www.votersphere.com";

/* ======================================================
   DATABASE
====================================================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/* ======================================================
   TEST DB CONNECTION
====================================================== */

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
}

testDB();

/* ======================================================
   MIDDLEWARE
====================================================== */

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());

/* ======================================================
   MEMORY CACHE
====================================================== */

const cache = new Map();

function cacheGet(key) {
  return cache.get(key) || null;
}

function cacheSet(key, value, ttl = 300) {
  cache.set(key, value);
  setTimeout(() => cache.delete(key), ttl * 1000);
}

/* ======================================================
   HEALTH CHECK
====================================================== */

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ======================================================
   DATABASE HELPERS
====================================================== */

async function getCandidateBySlug(slug) {
  const cached = cacheGet("cand_" + slug);
  if (cached) return cached;

  const result = await pool.query(
    "SELECT * FROM candidates WHERE slug = $1 LIMIT 1",
    [slug]
  );

  const candidate = result.rows[0] || null;

  if (candidate) cacheSet("cand_" + slug, candidate);

  return candidate;
}

async function getCandidatesByState(state) {
  const cached = cacheGet("state_" + state);
  if (cached) return cached;

  const result = await pool.query(
    "SELECT * FROM candidates WHERE state = $1 ORDER BY name ASC LIMIT 500",
    [state.toUpperCase()]
  );

  const candidates = result.rows || [];

  cacheSet("state_" + state, candidates, 600);

  return candidates;
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
    description: candidate.bio || "",
  };
}

function stateSchema(state, candidates) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Candidates in ${state}`,
    url: `${BASE_URL}/state/${state}`,
    about: candidates.slice(0, 10).map((c) => ({
      "@type": "PoliticalCandidate",
      name: c.name,
      url: `${BASE_URL}/candidate/${c.slug}`,
    })),
  };
}

/* ======================================================
   CANDIDATE PAGE (SEO)
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
   STATE PAGE (SEO)
====================================================== */

app.get("/state/:state", async (req, res) => {
  try {
    const state = req.params.state.toUpperCase();

    const candidates = await getCandidatesByState(state);

    const listHTML = candidates
      .map(
        (c) =>
          `<li><a href="${BASE_URL}/candidate/${c.slug}">${c.name}</a> (${c.party || ""})</li>`
      )
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
   API ROUTES
====================================================== */

app.get("/api/candidate/:slug", async (req, res) => {
  try {
    const candidate = await getCandidateBySlug(req.params.slug);

    if (!candidate) return res.status(404).json({ error: "Not found" });

    res.json(candidate);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/state/:state", async (req, res) => {
  try {
    const data = await getCandidatesByState(req.params.state);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   SITEMAP
====================================================== */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT slug, updated_at FROM candidates LIMIT 50000"
    );

    const urls = result.rows
      .map(
        (c) => `
<url>
<loc>${BASE_URL}/candidate/${c.slug}</loc>
<lastmod>${new Date(c.updated_at).toISOString()}</lastmod>
</url>`
      )
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    res.status(500).send("Error generating sitemap");
  }
});

/* ======================================================
   ROOT
====================================================== */

app.get("/", (req, res) => {
  res.send("VoterSphere Backend Running");
});

/* ======================================================
   START SERVER
====================================================== */

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
