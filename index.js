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

/* ==========================================
   HEALTH CHECK
========================================== */

app.get("/", (req, res) => {
  res.json({ status: "VoterSpheres API running" });
});

/* ==========================================
   API ROUTES
========================================== */

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

app.get("/api/candidate/:slug", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM candidate WHERE slug = $1 LIMIT 1`,
      [req.params.slug]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/* ==========================================
   STATE PAGE
========================================== */

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

    if (!rows.length) {
      return res.status(404).send("State not found");
    }

    const stateUrl = `${BASE_URL}/state/${req.params.stateSlug}`;

    const structuredGraph = {
      "@context": "https://schema.org",
      "@graph": [

        {
          "@type": "Organization",
          "@id": `${BASE_URL}#organization`,
          "name": "VoterSpheres",
          "url": BASE_URL
        },

        {
          "@type": "ElectionEvent",
          "@id": ELECTION_URL,
          "name": "2026 United States General Election",
          "startDate": "2026-11-03",
          "organizer": { "@id": `${BASE_URL}#organization` }
        },

        {
          "@type": "AdministrativeArea",
          "@id": stateUrl,
          "name": stateName,
          "url": stateUrl
        }

      ]
    };

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${stateName} Candidates | VoterSpheres</title>
        <meta name="description" content="Political candidates running in ${stateName} for the 2026 General Election.">

        <script type="application/ld+json">
        ${JSON.stringify(structuredGraph, null, 2)}
        </script>
      </head>

      <body style="font-family: Arial; margin: 40px;">
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
        <p><a href="/">← Back</a></p>
      </body>
      </html>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ==========================================
   GOVERNMENT OFFICE PAGE
========================================== */

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
      <!DOCTYPE html>
      <html>
      <head>
        <title>${officeName} Candidates | VoterSpheres</title>
      </head>
      <body style="font-family: Arial; margin: 40px;">
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
        <p><a href="/">← Back</a></p>
      </body>
      </html>
    `);

  } catch (err) {
    res.status(500).send("Server error");
  }
});

/* ==========================================
   CANDIDATE PAGE (FULL GRAPH)
========================================== */

app.get("/:slug", async (req, res, next) => {

  if (
    req.params.slug.startsWith("state") ||
    req.params.slug.startsWith("office") ||
    req.params.slug.startsWith("api") ||
    req.params.slug === "sitemap.xml"
  ) return next();

  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM candidate
      WHERE slug = $1
      LIMIT 1
      `,
      [req.params.slug]
    );

    if (!rows.length) return res.status(404).send("Not found");

    const c = rows[0];
    const candidateUrl = `${BASE_URL}/${c.slug}`;

    const structuredGraph = {
      "@context": "https://schema.org",
      "@graph": [

        {
          "@type": "Organization",
          "@id": `${BASE_URL}#organization`,
          "name": "VoterSpheres",
          "url": BASE_URL
        },

        {
          "@type": "ElectionEvent",
          "@id": ELECTION_URL,
          "name": "2026 United States General Election",
          "startDate": "2026-11-03",
          "organizer": { "@id": `${BASE_URL}#organization` }
        },

        {
          "@type": ["Person", "PoliticalCandidate"],
          "@id": candidateUrl,
          "name": c.full_name,
          "jobTitle": c.office,
          "affiliation": {
            "@type": "PoliticalParty",
            "name": c.party
          },
          "address": {
            "@type": "PostalAddress",
            "addressRegion": c.state,
            "addressLocality": c.county || ""
          },
          "memberOf": { "@id": ELECTION_URL }
        }

      ]
    };

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${c.full_name} | VoterSpheres</title>

        <script type="application/ld+json">
        ${JSON.stringify(structuredGraph, null, 2)}
        </script>
      </head>

      <body style="font-family: Arial; margin: 40px;">
        <h1>${c.full_name}</h1>
        <p><strong>Office:</strong> ${c.office}</p>
        <p><strong>State:</strong> ${c.state}</p>
        <p><strong>Party:</strong> ${c.party}</p>
        <p><a href="/">← Back</a></p>
      </body>
      </html>
    `);

  } catch (err) {
    res.status(500).send("Server error");
  }
});

/* ==========================================
   SITEMAP
========================================== */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug FROM candidate`
    );

    const urls = rows.map(r => `
      <url><loc>${BASE_URL}/${r.slug}</loc></url>
    `).join("");

    res.header("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${BASE_URL}</loc></url>
        ${urls}
      </urlset>
    `);

  } catch (err) {
    res.status(500).send("Error");
  }
});

/* ==========================================
   START SERVER
========================================== */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
