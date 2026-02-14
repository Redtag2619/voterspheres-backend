import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import crypto from "crypto";
import { createClient } from "redis";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 3000;
const BASE_URL = "https://voterspheres.org";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

/* =========================
   REDIS
========================= */

let redis;
let redisEnabled = false;

if (REDIS_URL) {
  redis = createClient({
    url: REDIS_URL,
    socket: {
      reconnectStrategy: retries => Math.min(retries * 50, 2000),
    },
  });

  redis.on("error", err => console.log("Redis error:", err.message));

  await redis.connect();
  redisEnabled = true;

  console.log("✅ Redis connected");
}

/* =========================
   MEMORY CACHE FALLBACK
========================= */

const memoryCache = new Map();

function memorySet(key, value, ttl) {
  memoryCache.set(key, {
    value,
    expire: Date.now() + ttl * 1000,
  });
}

function memoryGet(key) {
  const item = memoryCache.get(key);
  if (!item) return null;

  if (Date.now() > item.expire) {
    memoryCache.delete(key);
    return null;
  }

  return item.value;
}

/* =========================
   CACHE HELPERS
========================= */

async function cacheGet(key) {
  try {
    if (redisEnabled) {
      const data = await redis.get(key);
      return data ? data : null;
    }
    return memoryGet(key);
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttl = 86400) {
  try {
    if (redisEnabled) {
      await redis.setEx(key, ttl, value);
    } else {
      memorySet(key, value, ttl);
    }
  } catch {}
}

/* =========================
   UTILS
========================= */

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/gi, "")
    .replace(/\s+/g, "-");
}

function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

/* =========================
   HTML GENERATORS
========================= */

function generateCandidateHTML(c) {
  return `
<!DOCTYPE html>
<html>
<head>
<title>${c.name} | VoterSpheres</title>
<meta name="description" content="${c.name} running for ${c.office} in ${c.state}">
<link rel="canonical" href="${BASE_URL}/candidate/${slugify(c.name)}" />
</head>

<body>

<h1>${c.name}</h1>

<p><strong>Office:</strong> ${c.office}</p>
<p><strong>State:</strong> ${c.state}</p>
<p><strong>Party:</strong> ${c.party || "Unknown"}</p>

</body>
</html>
`;
}

function generateStateHTML(state, candidates) {
  const list = candidates
    .map(
      c =>
        `<li><a href="/candidate/${slugify(c.name)}">${c.name} — ${c.office}</a></li>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
<title>${state} Candidates | VoterSpheres</title>
</head>

<body>

<h1>${state} Candidates</h1>
<ul>${list}</ul>

</body>
</html>
`;
}

/* =========================
   PRE-GENERATED PAGE ENGINE
========================= */

async function getCandidatePage(slug) {
  const cacheKey = `page:candidate:${slug}`;

  let html = await cacheGet(cacheKey);
  if (html) return html;

  // DB lookup
  const result = await pool.query(
    `
    SELECT *
    FROM candidates
    WHERE LOWER(REPLACE(name,' ','-')) = $1
    LIMIT 1
    `,
    [slug]
  );

  if (!result.rows.length) return null;

  const candidate = result.rows[0];

  html = generateCandidateHTML(candidate);

  await cacheSet(cacheKey, html, 86400);

  return html;
}

async function getStatePage(state) {
  const cacheKey = `page:state:${state}`;

  let html = await cacheGet(cacheKey);
  if (html) return html;

  const result = await pool.query(
    `SELECT name, office FROM candidates WHERE state=$1 LIMIT 200`,
    [state.toUpperCase()]
  );

  html = generateStateHTML(state, result.rows);

  await cacheSet(cacheKey, html, 86400);

  return html;
}

/* =========================
   ROUTES
========================= */

app.get("/candidate/:slug", async (req, res) => {
  try {
    const html = await getCandidatePage(req.params.slug);

    if (!html) return res.status(404).send("Not found");

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "public, max-age=3600");

    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/state/:state", async (req, res) => {
  try {
    const html = await getStatePage(req.params.state);

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "public, max-age=3600");

    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* =========================
   API SEARCH (CACHED)
========================= */

app.get("/api/candidates", async (req, res) => {
  try {
    const cacheKey = "search:" + hash(JSON.stringify(req.query));

    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const { q = "", limit = 20 } = req.query;

    const result = await pool.query(
      `
      SELECT name, office, state
      FROM candidates
      WHERE name ILIKE '%' || $1 || '%'
      LIMIT $2
      `,
      [q, limit]
    );

    await cacheSet(cacheKey, JSON.stringify(result.rows), 600);

    res.json(result.rows);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* =========================
   MASSIVE SCALE SITEMAP
========================= */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const cacheKey = "sitemap";

    let xml = await cacheGet(cacheKey);
    if (xml) {
      res.type("application/xml");
      return res.send(xml);
    }

    const result = await pool.query(
      `SELECT name FROM candidates LIMIT 50000`
    );

    const urls = result.rows
      .map(row => {
        const slug = slugify(row.name);
        return `
<url>
<loc>${BASE_URL}/candidate/${slug}</loc>
<lastmod>${new Date().toISOString()}</lastmod>
</url>`;
      })
      .join("");

    xml = `
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

    await cacheSet(cacheKey, xml, 86400);

    res.type("application/xml");
    res.send(xml);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* =========================
   ROBOTS
========================= */

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`
User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`);
});

/* =========================
   HEALTH
========================= */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      redis: redisEnabled ? "connected" : "memory",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.send("<h1>VoterSpheres API Running</h1>");
});

/* =========================
   SERVER
========================= */

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
