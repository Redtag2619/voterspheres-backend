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

/* ================================
   CONFIG
================================ */

const PORT = process.env.PORT || 3000;
const BASE_URL = "https://voterspheres.org";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

/* ================================
   DATABASE (POSTGRES)
================================ */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

/* ================================
   REDIS (PRODUCTION OPTIMIZED)
================================ */

let redis;
let redisEnabled = false;

try {
  if (REDIS_URL) {
    redis = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: retries => Math.min(retries * 50, 2000),
      },
    });

    redis.on("error", err => {
      console.log("Redis error:", err.message);
    });

    await redis.connect();
    redisEnabled = true;

    console.log("✅ Redis connected");
  } else {
    console.log("⚠️ Redis not configured — using memory cache");
  }
} catch (err) {
  console.log("Redis failed, using memory cache");
}

/* ================================
   MEMORY FALLBACK CACHE
================================ */

const memoryCache = new Map();

function memorySet(key, value, ttlSeconds) {
  memoryCache.set(key, {
    value,
    expire: Date.now() + ttlSeconds * 1000,
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

/* ================================
   CACHE HELPERS
================================ */

async function cacheSet(key, value, ttl = 3600) {
  try {
    const data = JSON.stringify(value);

    if (redisEnabled) {
      await redis.setEx(key, ttl, data);
    } else {
      memorySet(key, value, ttl);
    }
  } catch (err) {
    console.log("Cache set error:", err.message);
  }
}

async function cacheGet(key) {
  try {
    if (redisEnabled) {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } else {
      return memoryGet(key);
    }
  } catch (err) {
    return null;
  }
}

/* ================================
   UTILS
================================ */

function hashKey(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/gi, "")
    .replace(/\s+/g, "-");
}

/* ================================
   HEALTH CHECK
================================ */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected",
      redis: redisEnabled ? "enabled" : "memory",
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      error: err.message,
    });
  }
});

/* ================================
   API — SEARCH CANDIDATES
================================ */

app.get("/api/candidates", async (req, res) => {
  try {
    const { q = "", state = "", limit = 20, offset = 0 } = req.query;

    const cacheKey = "search:" + hashKey(JSON.stringify(req.query));
    const cached = await cacheGet(cacheKey);

    if (cached) return res.json(cached);

    const result = await pool.query(
      `
      SELECT id, name, office, state, party
      FROM candidates
      WHERE
        ($1 = '' OR name ILIKE '%' || $1 || '%')
        AND ($2 = '' OR state = $2)
      ORDER BY name
      LIMIT $3 OFFSET $4
      `,
      [q, state, limit, offset]
    );

    await cacheSet(cacheKey, result.rows, 600);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================================
   PUBLIC CANDIDATE PROFILE
================================ */

app.get("/candidate/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const cacheKey = "candidate:" + slug;
    const cached = await cacheGet(cacheKey);

    if (cached) return res.send(cached);

    const result = await pool.query(
      `
      SELECT *
      FROM candidates
      WHERE LOWER(REPLACE(name,' ','-')) = $1
      LIMIT 1
      `,
      [slug]
    );

    if (!result.rows.length) {
      return res.status(404).send("Candidate not found");
    }

    const c = result.rows[0];

    const html = `
<!DOCTYPE html>
<html>
<head>
<title>${c.name}</title>
<meta name="description" content="${c.name} running for ${c.office}">
</head>
<body>
<h1>${c.name}</h1>
<p>Office: ${c.office}</p>
<p>State: ${c.state}</p>
<p>Party: ${c.party}</p>
</body>
</html>
`;

    await cacheSet(cacheKey, html, 3600);

    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================================
   STATE PAGE
================================ */

app.get("/state/:state", async (req, res) => {
  try {
    const { state } = req.params;

    const cacheKey = "state:" + state;
    const cached = await cacheGet(cacheKey);

    if (cached) return res.send(cached);

    const result = await pool.query(
      `SELECT id, name, office FROM candidates WHERE state = $1 LIMIT 100`,
      [state.toUpperCase()]
    );

    let list = result.rows
      .map(
        c =>
          `<li><a href="/candidate/${slugify(c.name)}">${c.name} — ${c.office}</a></li>`
      )
      .join("");

    const html = `
<html>
<head>
<title>${state} Candidates</title>
</head>
<body>
<h1>${state} Candidates</h1>
<ul>${list}</ul>
</body>
</html>
`;

    await cacheSet(cacheKey, html, 3600);

    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================================
   SITEMAP (CACHED)
================================ */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const cacheKey = "sitemap";
    const cached = await cacheGet(cacheKey);

    if (cached) {
      res.header("Content-Type", "application/xml");
      return res.send(cached);
    }

    const result = await pool.query(
      `SELECT name FROM candidates LIMIT 50000`
    );

    const urls = result.rows
      .map(c => {
        const slug = slugify(c.name);
        return `<url><loc>${BASE_URL}/candidate/${slug}</loc></url>`;
      })
      .join("");

    const xml = `
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

    await cacheSet(cacheKey, xml, 86400);

    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================================
   ROBOTS
================================ */

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`
User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`);
});

/* ================================
   HOMEPAGE
================================ */

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>VoterSpheres</title>
</head>
<body>
<h1>VoterSpheres</h1>
<p>Candidate search platform</p>
</body>
</html>
`);
});

/* ================================
   SERVER START
================================ */

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
