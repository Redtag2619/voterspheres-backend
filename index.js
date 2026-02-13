import express from "express";
import pkg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const BASE_URL = "https://voterspheres.org";

/* =====================================================
   HELPER: FORMAT DATE FOR SITEMAP
===================================================== */

function formatDate(date) {
  if (!date) return new Date().toISOString();
  return new Date(date).toISOString();
}

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/", (req, res) => {
  res.json({ status: "VoterSpheres API running" });
});

/* =====================================================
   STATE PAGE
===================================================== */

app.get("/state/:stateSlug", async (req, res) => {
  try {
    const stateName = req.params.stateSlug.replace(/-/g, " ");

    const { rows } = await pool.query(
      `SELECT full_name, slug, party, office
       FROM candidate
       WHERE LOWER(state) = LOWER($1)
       ORDER BY office, full_name`,
      [stateName]
    );

    if (!rows.length) return res.status(404).send("State not found");

    res.send(`
      <html>
      <head>
        <title>${stateName} Candidates | VoterSpheres</title>
      </head>
      <body>
        <h1>${stateName} Candidates</h1>
        <ul>
          ${rows.map(c => `
            <li>
              <a href="/${c.slug}">
                ${c.full_name} — ${c.office} (${c.party})
              </a>
            </li>
          `).join("")}
        </ul>
      </body>
      </html>
    `);

  } catch {
    res.status(500).send("Server error");
  }
});

/* =====================================================
   OFFICE PAGE
===================================================== */

app.get("/office/:officeSlug", async (req, res) => {
  try {
    const officeName = req.params.officeSlug.replace(/-/g, " ");

    const { rows } = await pool.query(
      `SELECT full_name, slug, state, party
       FROM candidate
       WHERE LOWER(office) = LOWER($1)
       ORDER BY full_name`,
      [officeName]
    );

    if (!rows.length) return res.status(404).send("Office not found");

    res.send(`
      <html>
      <head>
        <title>${officeName} Candidates | VoterSpheres</title>
      </head>
      <body>
        <h1>${officeName} Candidates</h1>
        <ul>
          ${rows.map(c => `
            <li>
              <a href="/${c.slug}">
                ${c.full_name} — ${c.state} (${c.party})
              </a>
            </li>
          `).join("")}
        </ul>
      </body>
      </html>
    `);

  } catch {
    res.status(500).send("Server error");
  }
});

/* =====================================================
   CANDIDATE PAGE
===================================================== */

app.get("/:slug", async (req, res, next) => {

  if (
    req.params.slug.startsWith("state") ||
    req.params.slug.startsWith("office") ||
    req.params.slug.startsWith("api") ||
    req.params.slug.startsWith("sitemap")
  ) return next();

  try {
    const { rows } = await pool.query(
      `SELECT * FROM candidate WHERE slug = $1 LIMIT 1`,
      [req.params.slug]
    );

    if (!rows.length) return res.status(404).send("Not found");

    const c = rows[0];

    res.send(`
      <html>
      <head>
        <title>${c.full_name} | VoterSpheres</title>
      </head>
      <body>
        <h1>${c.full_name}</h1>
        <p>${c.office} — ${c.state}</p>
        <p>Party: ${c.party}</p>
      </body>
      </html>
    `);

  } catch {
    res.status(500).send("Server error");
  }
});

/* =====================================================
   SITEMAP INDEX
===================================================== */

app.get("/sitemap.xml", (req, res) => {

  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${BASE_URL}/sitemap-states.xml</loc>
    <lastmod>${formatDate()}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${BASE_URL}/sitemap-offices.xml</loc>
    <lastmod>${formatDate()}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${BASE_URL}/sitemap-candidates.xml</loc>
    <lastmod>${formatDate()}</lastmod>
  </sitemap>
</sitemapindex>`;

  res.header("Content-Type", "application/xml");
  res.send(sitemapIndex);
});

/* =====================================================
   STATES SITEMAP
===================================================== */

app.get("/sitemap-states.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT state, MAX(updated_at) as updated_at
       FROM candidate
       GROUP BY state`
    );

    const urls = rows.map(r => {
      const slug = r.state.toLowerCase().replace(/\s+/g, "-");
      return `
      <url>
        <loc>${BASE_URL}/state/${slug}</loc>
        <lastmod>${formatDate(r.updated_at)}</lastmod>
      </url>`;
    }).join("");

    res.header("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`);

  } catch {
    res.status(500).send("Error");
  }
});

/* =====================================================
   OFFICES SITEMAP
===================================================== */

app.get("/sitemap-offices.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT office, MAX(updated_at) as updated_at
       FROM candidate
       GROUP BY office`
    );

    const urls = rows.map(r => {
      const slug = r.office.toLowerCase().replace(/\s+/g, "-");
      return `
      <url>
        <loc>${BASE_URL}/office/${slug}</loc>
        <lastmod>${formatDate(r.updated_at)}</lastmod>
      </url>`;
    }).join("");

    res.header("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`);

  } catch {
    res.status(500).send("Error");
  }
});

/* =====================================================
   CANDIDATES SITEMAP
===================================================== */

app.get("/sitemap-candidates.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, updated_at FROM candidate`
    );

    const urls = rows.map(r => `
      <url>
        <loc>${BASE_URL}/${r.slug}</loc>
        <lastmod>${formatDate(r.updated_at)}</lastmod>
      </url>
    `).join("");

    res.header("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`);

  } catch {
    res.status(500).send("Error");
  }
});

/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
