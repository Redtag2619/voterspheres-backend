import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import Redis from "ioredis";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(compression());

/* ======================================================
   CONFIG
====================================================== */

const PORT = process.env.PORT || 10000;
const BASE_URL =
  process.env.BASE_URL || "https://voterspheres-backend-2pap.onrender.com";

const REDIS_URL = process.env.REDIS_URL || null;

/* ======================================================
   POSTGRES
====================================================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

/* ======================================================
   REDIS (OPTIONAL SAFE MODE)
====================================================== */

let redis = null;

if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      reconnectOnError: () => true,
    });

    redis.on("connect", () => console.log("✅ Redis Connected"));
    redis.on("error", (err) =>
      console.log("⚠️ Redis Error (non fatal):", err.message)
    );
  } catch (err) {
    console.log("⚠️ Redis disabled:", err.message);
    redis = null;
  }
} else {
  console.log("⚠️ No Redis URL provided — running without cache");
}

/* ======================================================
   CACHE HELPERS
====================================================== */

async function cacheGet(key) {
  if (!redis) return null;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttl = 3600) {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch {}
}

/* ======================================================
   HEALTH
====================================================== */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    redis: !!redis,
    time: new Date(),
  });
});

/* ======================================================
   CANDIDATE API
====================================================== */

app.get("/candidate/:id", async (req, res) => {
  const { id } = req.params;

  const cacheKey = `candidate:${id}`;
  const cached = await cacheGet(cacheKey);

  if (cached) return res.json(cached);

  try {
    const result = await pool.query(
      "SELECT * FROM candidates WHERE id = $1",
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Not found" });
    }

    const candidate = result.rows[0];

    await cacheSet(cacheKey, candidate, 86400);

    res.json(candidate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   SITEMAP CONFIG
====================================================== */

const SITEMAP_CHUNK_SIZE = 50000;

/* ======================================================
   SITEMAP INDEX
====================================================== */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM candidates"
    );

    const total = parseInt(countResult.rows[0].count);
    const chunks = Math.ceil(total / SITEMAP_CHUNK_SIZE);

    res.setHeader("Content-Type", "application/xml");

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    for (let i = 0; i < chunks; i++) {
      xml += `
<sitemap>
  <loc>${BASE_URL}/sitemap-${i}.xml</loc>
  <lastmod>${new Date().toISOString()}</lastmod>
</sitemap>`;
    }

    xml += `</sitemapindex>`;

    res.send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

/* ======================================================
   SITEMAP CHUNKS (STREAMING — 50M READY)
====================================================== */

app.get("/sitemap-:page.xml", async (req, res) => {
  const page = parseInt(req.params.page) || 0;
  const offset = page * SITEMAP_CHUNK_SIZE;

  res.setHeader("Content-Type", "application/xml");

  try {
    const client = await pool.connect();

    const query = `
      SELECT id, updated_at
      FROM candidates
      ORDER BY id
      LIMIT $1 OFFSET $2
    `;

    const result = await client.query(query, [
      SITEMAP_CHUNK_SIZE,
      offset,
    ]);

    client.release();

    res.write(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
    );

    for (const row of result.rows) {
      const lastmod = row.updated_at
        ? new Date(row.updated_at).toISOString()
        : new Date().toISOString();

      res.write(`
<url>
  <loc>${BASE_URL}/candidate/${row.id}</loc>
  <lastmod>${lastmod}</lastmod>
</url>`);
    }

    res.write(`</urlset>`);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

/* ======================================================
   BACKGROUND PRE-GENERATION (OPTIONAL)
====================================================== */

async function warmCache() {
  if (!redis) return;

  console.log("🔥 Starting cache warmup...");

  const client = await pool.connect();

  try {
    const batchSize = 10000;
    let offset = 0;

    while (true) {
      const result = await client.query(
        `SELECT id FROM candidates
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [batchSize, offset]
      );

      if (!result.rows.length) break;

      for (const row of result.rows) {
        const id = row.id;

        const exists = await redis.exists(`candidate:${id}`);
        if (exists) continue;

        const data = await pool.query(
          "SELECT * FROM candidates WHERE id = $1",
          [id]
        );

        if (data.rows.length) {
          await cacheSet(
            `candidate:${id}`,
            data.rows[0],
            86400 * 30
          );
        }
      }

      offset += batchSize;
      console.log(`Warm progress: ${offset}`);
    }

    console.log("✅ Cache warm complete");
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
  }
}

/* ======================================================
   START SERVER
====================================================== */

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // optional warm start (non blocking)
  if (process.env.ENABLE_WARM === "true") {
    warmCache();
  }
});
