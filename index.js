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

/* ======================
   CONFIG
====================== */

const PORT = process.env.PORT || 3000;
const BASE_URL = "https://voterspheres.org";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const PREGEN_BATCH = 500;
const PREGEN_DELAY = 2000;

/* ======================
   DATABASE
====================== */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

/* ======================
   REDIS
====================== */

let redis;
let redisEnabled = false;

if (REDIS_URL) {
  redis = createClient({
    url: REDIS_URL,
    socket: {
      reconnectStrategy: retries => Math.min(retries * 50, 2000),
    },
  });

  redis.on("error", err => console.log("Redis:", err.message));

  await redis.connect();
  redisEnabled = true;

  console.log("✅ Redis connected");
}

/* ======================
   MEMORY CACHE
====================== */

const memory = new Map();

function memSet(key, value, ttl) {
  memory.set(key, {
    value,
    expire: Date.now() + ttl * 1000,
  });
}

function memGet(key) {
  const item = memory.get(key);
  if (!item) return null;

  if (Date.now() > item.expire) {
    memory.delete(key);
    return null;
  }

  return item.value;
}

/* ======================
   CACHE HELPERS
====================== */

async function cacheGet(key) {
  try {
    if (redisEnabled) return await redis.get(key);
    return memGet(key);
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttl = 86400) {
  try {
    if (redisEnabled) {
      await redis.setEx(key, ttl, value);
    } else {
      memSet(key, value, ttl);
    }
  } catch {}
}

/* ======================
   UTILS
====================== */

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/gi, "")
    .replace(/\s+/g, "-");
}

function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

/* ======================
   HTML GENERATOR
====================== */

function buildCandidateHTML(c) {
  const slug = slugify(c.full_name);

  return `
<!DOCTYPE html>
<html>
<head>

<title>${c.full_name} | VoterSpheres</title>

<meta name="description" content="${c.full_name} running for ${c.office} in ${c.state}">

<link rel="canonical" href="${BASE_URL}/candidate/${slug}" />

<meta name="robots" content="index, follow">

</head>

<body>

<h1>${c.full_name}</h1>

<p><strong>Office:</strong> ${c.office}</p>
<p><strong>State:</strong> ${c.state}</p>
<p><strong>Party:</strong> ${c.party || "Unknown"}</p>

</body>
</html>
`;
}

/* ======================
   PAGE ENGINE
====================== */

async function getCandidatePage(slug) {
  const key = `page:candidate:${slug}`;

  let cached = await cacheGet(key);
  if (cached) return cached;

  const result = await pool.query(
    `
    SELECT *
    FROM public.candidate
    WHERE LOWER(REPLACE(full_name,' ','-')) = $1
    LIMIT 1
    `,
    [slug]
  );

  if (!result.rows.length) return null;

  const html = buildCandidateHTML(result.rows[0]);

  await cacheSet(key, html, 86400);

  return html;
}

/* ======================
   BACKGROUND PRE-GENERATION
====================== */

async function pregenerate() {
  console.log("🚀 Starting background pre-generation");

  let offset = 0;

  while (true) {
    try {
      const result = await pool.query(
        `
        SELECT full_name, office, state, party
        FROM public.candidate
        ORDER BY id
        LIMIT $1 OFFSET $2
        `,
        [PREGEN_BATCH, offset]
      );

      if (!result.rows.length) {
        console.log("✅ Pre-generation complete");
        break;
      }

      for (const c of result.rows) {
        const slug = slugify(c.full_name);
        const key = `page:candidate:${slug}`;

        const exists = await cacheGet(key);
        if (!exists) {
          const html = buildCandidateHTML(c);
          await cacheSet(key, html, 86400);
        }
      }

      offset += PREGEN_BATCH;

      console.log("Generated:", offset);

      await new Promise(r => setTimeout(r, PREGEN_DELAY));
    } catch (err) {
      console.log("Pre-gen error:", err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

/* ======================
   ROUTES
====================== */

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

app.get("/api/candidate", async (req, res) => {
  try {
    const { q = "", limit = 20 } = req.query;

    const cacheKey = "search:" + hash(JSON.stringify(req.query));

    const cached = await cacheGet(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pool.query(
      `
      SELECT full_name, office, state, party
      FROM public.candidate
      WHERE full_name ILIKE '%' || $1 || '%'
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

/* ======================
   SITEMAP
====================== */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT full_name FROM public.candidate LIMIT 50000`
    );

    const urls = result.rows
      .map(r => {
        const slug = slugify(r.full_name);

        return `
<url>
<loc>${BASE_URL}/candidate/${slug}</loc>
<lastmod>${new Date().toISOString()}</lastmod>
</url>`;
      })
      .join("");

    res.type("application/xml");

    res.send(`
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ======================
   ROBOTS
====================== */

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");

  res.send(`
User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`);
});

/* ======================
   HEALTH
====================== */

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

/* ======================
   HOME
====================== */

app.get("/", (req, res) => {
  res.send("<h1>VoterSpheres Backend Running</h1>");
});

/* ======================
   START SERVER
====================== */

app.listen(PORT, async () => {
  console.log("🚀 Server running on port", PORT);

  pregenerate(); // background job
});
