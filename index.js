import express from "express";
import compression from "compression";
import Redis from "ioredis";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(compression());
app.use(express.json());

/* =========================
   ENV
========================= */

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://voterspheres.org";
const DATABASE_URL = process.env.DATABASE_URL;

/* =========================
   POSTGRES
========================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   REDIS (SAFE CONNECTION)
========================= */

let redis;

if (process.env.REDIS_URL) {
  console.log("✅ Using REDIS_URL");

  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    reconnectOnError: () => true,
    lazyConnect: true,
  });
} else {
  console.log("⚠️ No REDIS_URL — using localhost");

  redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
  });
}

redis.on("connect", () => console.log("🚀 Redis Connected"));
redis.on("error", (err) => console.error("Redis Error:", err));

/* =========================
   SAFE REDIS HELPERS
========================= */

async function cacheGet(key) {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttl = 3600) {
  try {
    await redis.set(key, value, "EX", ttl);
  } catch {}
}

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    redis: !!process.env.REDIS_URL,
    db: !!DATABASE_URL,
  });
});

/* =========================
   HOME PAGE
========================= */

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>VoterSpheres</title>
      </head>
      <body>
        <h1>VoterSpheres API Running</h1>
        <p>System operational.</p>
      </body>
    </html>
  `);
});

/* =========================
   CANDIDATE PAGE
========================= */

app.get("/candidate/:slug", async (req, res) => {
  const slug = req.params.slug;
  const cacheKey = `candidate:${slug}`;

  try {
    const cached = await cacheGet(cacheKey);

    if (cached) {
      return res.send(cached);
    }

    const result = await pool.query(
      `SELECT * FROM candidates WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (!result.rows.length) {
      return res.status(404).send("Candidate not found");
    }

    const c = result.rows[0];

    const html = `
    <html>
      <head>
        <title>${c.name}</title>
        <meta name="description" content="${c.office || ""}" />

        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Person",
          "name": "${c.name}",
          "url": "${BASE_URL}/candidate/${slug}"
        }
        </script>

      </head>
      <body>
        <h1>${c.name}</h1>
        <p>${c.office || ""}</p>
      </body>
    </html>
    `;

    await cacheSet(cacheKey, html, 86400);

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* =========================
   ROBOTS.TXT
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
   SITEMAP INDEX
========================= */

const SITEMAP_CHUNK = 50000;

app.get("/sitemap.xml", async (req, res) => {
  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM candidates`
    );

    const total = parseInt(countResult.rows[0].count);
    const chunks = Math.ceil(total / SITEMAP_CHUNK);

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

    res.type("application/xml");
    res.send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send("Sitemap error");
  }
});

/* =========================
   SITEMAP CHUNKS
========================= */

app.get("/sitemap-:index.xml", async (req, res) => {
  const index = parseInt(req.params.index);

  try {
    const offset = index * SITEMAP_CHUNK;

    const result = await pool.query(
      `SELECT slug, updated_at
       FROM candidates
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [SITEMAP_CHUNK, offset]
    );

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    result.rows.forEach((row) => {
      xml += `
<url>
  <loc>${BASE_URL}/candidate/${row.slug}</loc>
  <lastmod>${row.updated_at?.toISOString() || new Date().toISOString()}</lastmod>
</url>`;
    });

    xml += `</urlset>`;

    res.type("application/xml");
    res.send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send("Chunk error");
  }
});

/* =========================
   BACKGROUND CACHE WARMER
========================= */

async function warmCache() {
  console.log("🔥 Starting cache warmer");

  try {
    const result = await pool.query(
      `SELECT slug FROM candidates LIMIT 1000`
    );

    for (const row of result.rows) {
      const key = `candidate:${row.slug}`;

      const exists = await cacheGet(key);
      if (exists) continue;

      const html = `<html><body><h1>${row.slug}</h1></body></html>`;
      await cacheSet(key, html, 86400);
    }

    console.log("✅ Cache warm complete");
  } catch (err) {
    console.error("Cache warm error", err);
  }
}

setTimeout(warmCache, 10000);

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
