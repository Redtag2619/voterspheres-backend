import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import { createClient } from "redis";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const { Pool } = pkg;

const app = express();

app.use(cors());
app.use(express.json());

/* ============================================
   PATH SETUP
============================================ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================
   DATABASE CONNECTION
============================================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

pool.connect()
  .then(() => console.log("PostgreSQL connected"))
  .catch(err => console.log("PostgreSQL error:", err.message));

/* ============================================
   REDIS SETUP (SAFE + OPTIONAL)
============================================ */

let redis = null;

if (process.env.REDIS_URL) {

  redis = createClient({
    url: process.env.REDIS_URL,
  });

  redis.on("error", err =>
    console.log("Redis error:", err.message)
  );

  redis.connect()
    .then(() => console.log("Redis connected"))
    .catch(err =>
      console.log("Redis failed:", err.message)
    );

} else {

  console.log("Redis not configured, using memory cache");

}

/* ============================================
   MEMORY CACHE FALLBACK
============================================ */

const memoryCache = new Map();

function setMemoryCache(key, value, ttlSeconds) {

  memoryCache.set(key, {
    value,
    expire: Date.now() + ttlSeconds * 1000,
  });

}

function getMemoryCache(key) {

  const item = memoryCache.get(key);

  if (!item) return null;

  if (Date.now() > item.expire) {

    memoryCache.delete(key);
    return null;

  }

  return item.value;

}

/* ============================================
   CACHE HELPERS
============================================ */

async function getCache(key) {

  try {

    if (redis) {

      const data = await redis.get(key);

      if (data) return JSON.parse(data);

    }

  } catch {}

  return getMemoryCache(key);

}

async function setCache(key, data, ttl = 3600) {

  try {

    if (redis) {

      await redis.setEx(
        key,
        ttl,
        JSON.stringify(data)
      );

    }

  } catch {}

  setMemoryCache(key, data, ttl);

}

/* ============================================
   HEALTH CHECK
============================================ */

app.get("/health", (req, res) => {

  res.json({
    status: "ok",
    database: "connected",
    redis: redis ? "enabled" : "memory",
  });

});

/* ============================================
   GET CANDIDATES LIST
============================================ */

app.get("/api/candidates", async (req, res) => {

  try {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const offset = (page - 1) * limit;

    const cacheKey =
      `candidates:${page}:${limit}`;

    const cached = await getCache(cacheKey);

    if (cached)
      return res.json(cached);

    const result = await pool.query(
      `
      SELECT
        id,
        full_name,
        slug,
        state,
        party,
        county,
        office,
        photo
      FROM candidate
      ORDER BY id
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    const countResult =
      await pool.query(
        `SELECT COUNT(*) FROM candidate`
      );

    const response = {

      page,
      limit,

      total: parseInt(
        countResult.rows[0].count
      ),

      candidates: result.rows,

    };

    await setCache(cacheKey, response, 300);

    res.json(response);

  } catch (err) {

    console.log(err);
    res.status(500).json({
      error: "Server error",
    });

  }

});

/* ============================================
   GET SINGLE CANDIDATE BY SLUG
============================================ */

app.get("/api/candidate/:slug", async (req, res) => {

  try {

    const { slug } = req.params;

    const cacheKey =
      `candidate:${slug}`;

    const cached =
      await getCache(cacheKey);

    if (cached)
      return res.json(cached);

    const result =
      await pool.query(
        `
        SELECT
          id,
          full_name,
          slug,
          state,
          party,
          county,
          office,
          photo
        FROM candidate
        WHERE slug = $1
        LIMIT 1
        `,
        [slug]
      );

    if (!result.rows.length)
      return res
        .status(404)
        .json({
          error: "Not found",
        });

    const candidate =
      result.rows[0];

    await setCache(
      cacheKey,
      candidate,
      3600
    );

    res.json(candidate);

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: "Server error",
    });

  }

});

/* ============================================
   SITEMAP AUTO GENERATE
============================================ */

app.get("/sitemap.xml", async (req, res) => {

  try {

    const cacheKey = "sitemap";

    const cached =
      await getCache(cacheKey);

    if (cached) {

      res.header(
        "Content-Type",
        "application/xml"
      );

      return res.send(cached);

    }

    const result =
      await pool.query(
        `
        SELECT slug, updated_at
        FROM candidate
        ORDER BY id
        LIMIT 50000
        `
      );

    const urls =
      result.rows
        .map(row => {

          return `
          <url>
            <loc>
              https://voterspheres.org/candidate/${row.slug}
            </loc>
            <lastmod>
              ${row.updated_at?.toISOString() || ""}
            </lastmod>
          </url>
          `;

        })
        .join("");

    const xml = `
    <?xml version="1.0" encoding="UTF-8"?>
    <urlset
      xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${urls}
    </urlset>
    `;

    await setCache(cacheKey, xml, 3600);

    res.header(
      "Content-Type",
      "application/xml"
    );

    res.send(xml);

  } catch (err) {

    console.log(err);

    res.status(500).send("");

  }

});

/* ============================================
   ROBOTS.TXT
============================================ */

app.get("/robots.txt", (req, res) => {

  res.type("text/plain");

  res.send(`
User-agent: *
Allow: /

Sitemap: https://voterspheres.org/sitemap.xml
`);

});

/* ============================================
   SERVE FRONTEND
============================================ */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* ============================================
   FRONTEND ROUTING SUPPORT
============================================ */

app.get("*", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});

/* ============================================
   START SERVER
============================================ */

const PORT =
  process.env.PORT || 10000;

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

});
