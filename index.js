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
const ELECTION_URL = `${BASE_URL}/elections/2026-general-election`;

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/", (req, res) => {
  res.json({ status: "VoterSpheres API running" });
});

/* =====================================================
   API ROUTES
===================================================== */

app.get("/api/candidates", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT full_name, slug, state, party, office
      FROM candidate
      ORDER BY full_name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   STATE PAGE
===================================================== */

app.get("/state/:stateSlug", async (req, res) => {
  try {
    const stateName = req.params.stateSlug.replace(/-/g, " ");

    const { rows } = await pool.query(
      `
      SELECT full_name, slug, party, office
      FROM candidate
      WHERE LOWER(state) = LOWER($1)
      ORDER BY office, full_name
      `,
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

  } catch (err) {
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
      `
      SELECT full_name, slug, state, party
      FROM candidate
      WHERE LOWER(office) = LOWER($1)
      ORDER BY full_name
      `,
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

  } catch (err) {
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
    req.params.slug === "sitemap.xml"
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

  } catch (err) {
    res.status(500).send("Server error");
  }
});

/* =====================================================
   AUTO-GENERATED SITEMAP
===================================================== */

app.get("/sitemap.xml", async (req, res) => {
  try {

    const candidates = await pool.query(
      `SELECT slug FROM candidate WHERE slug IS NOT NULL`
    );

    const states = await pool.query(
      `SELECT DISTINCT state FROM candidate WHERE state IS NOT NULL`
    );

    const offices = await pool.query(
      `SELECT DISTINCT office FROM candidate WHERE office IS NOT NULL`
    );

    const stateUrls = states.rows.map(row => {
      const slug = row.state.toLowerCase().replace(/\s+/g, "-");
      return `<url><loc>${BASE_URL}/state/${slug}</loc></url>`;
    }).join("");

    const officeUrls = offices.rows.map(row => {
      const slug = row.office.toLowerCase().replace(/\s+/g, "-");
      return `<url><loc>${BASE_URL}/office/${slug}</loc></url>`;
    }).join("");

    const candidateUrls = candidates.rows.map(row => `
      <url><loc>${BASE_URL}/${row.slug}</loc></url>
    `).join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE_URL}</loc></url>
  ${stateUrls}
  ${officeUrls}
  ${candidateUrls}
</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);

  } catch (err) {
    console.error(err);
    res.status(500).send("Sitemap generation error");
  }
});

/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
