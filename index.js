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
  ssl: { rejectUnauthorized: false }
});

/* ======================================================
   MIDDLEWARE
====================================================== */

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());

/* ======================================================
   MEMORY CACHE (FAST + FREE)
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
  const cached = cacheGet(slug);
  if (cached) return cached;

  const result = await pool.query(
    "SELECT * FROM candidates WHERE slug = $1 LIMIT 1",
    [slug]
  );

  const candidate = result.rows[0] || null;

  if (candidate) cacheSet(slug, candidate);

  return candidate;
}

/* ======================================================
   SCHEMA GENERATOR
====================================================== */

function buildSchema(candidate) {
  return {
    "@context": "https://schema.org",
    "@type": "PoliticalCandidate",
    name: candidate.name,
    url: `${BASE_URL}/candidate/${candidate.slug}`,
    image: candidate.photo || "",
    party: candidate.party || "",
    description: candidate.bio || "",
    election: {
      "@type": "Election",
      name: candidate.election || "General Election",
      electionDate: candidate.election_date || ""
    },
    worksFor: {
      "@type": "Organization",
      name: "VoterSphere",
      url: BASE_URL
    }
  };
}

/* ======================================================
   CANDIDATE PAGE (SEO SSR)
====================================================== */

app.get("/candidate/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;

    const candidate = await getCandidateBySlug(slug);

    if (!candidate) {
      return res.status(404).send("Candidate not found");
    }

    const schema = buildSchema(candidate);

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

</body>
</html>
`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ======================================================
   API ROUTE
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

/* ======================================================
   SITEMAP (AUTO)
====================================================== */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT slug, updated_at FROM candidates LIMIT 50000"
    );

    const urls = result.rows
      .map(
        c => `
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
   SERVER START
====================================================== */

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
