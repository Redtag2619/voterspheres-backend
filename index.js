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

/* ===============================
   DATABASE CONNECTION
================================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const BASE_URL = "https://voterspheres.org";
const ELECTION_URL = `${BASE_URL}/elections/2026-general-election`;

/* ===============================
   HEALTH CHECK
================================ */

app.get("/", (req, res) => {
  res.json({ status: "VoterSpheres API running" });
});

/* ===============================
   API: LIST ALL CANDIDATES
================================ */

app.get("/api/candidates", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT full_name, slug, state, party, office
      FROM candidate
      ORDER BY full_name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===============================
   API: GET CANDIDATE BY SLUG
================================ */

app.get("/api/candidate/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM candidate WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ===============================
   PUBLIC CANDIDATE PAGE
   (FULL STRUCTURED GRAPH)
================================ */

app.get("/:slug", async (req, res, next) => {
  // prevent conflict with office route
  if (req.params.slug.startsWith("office")) return next();

  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
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

    if (!rows.length) {
      return res.status(404).send("Candidate not found");
    }

    const c = rows[0];
    const candidateUrl = `${BASE_URL}/${c.slug}`;
    const imageUrl = c.photo
      ? `${BASE_URL}/uploads/${c.photo}`
      : `${BASE_URL}/logo.png`;

    const structuredGraph = {
      "@context": "https://schema.org",
      "@graph": [

        /* ORGANIZATION */
        {
          "@type": "Organization",
          "@id": `${BASE_URL}#organization`,
          "name": "VoterSpheres",
          "url": BASE_URL
        },

        /* WEBSITE */
        {
          "@type": "WebSite",
          "@id": `${BASE_URL}#website`,
          "url": BASE_URL,
          "name": "VoterSpheres",
          "publisher": {
            "@id": `${BASE_URL}#organization`
          }
        },

        /* ELECTION */
        {
          "@type": "ElectionEvent",
          "@id": ELECTION_URL,
          "name": "2026 United States General Election",
          "startDate": "2026-11-03",
          "organizer": {
            "@id": `${BASE_URL}#organization`
          }
        },

        /* CANDIDATE */
        {
          "@type": ["Person", "PoliticalCandidate"],
          "@id": candidateUrl,
          "name": c.full_name,
          "url": candidateUrl,
          "image": imageUrl,
          "jobTitle": c.office,
          "affiliation": {
            "@type": "PoliticalParty",
            "name": c.party
          },
          "worksFor": {
            "@type": "GovernmentOrganization",
            "name": c.office
          },
          "address": {
            "@type": "PostalAddress",
            "addressRegion": c.state,
            "addressLocality": c.county || ""
          },
          "memberOf": {
            "@id": ELECTION_URL
          }
        }

      ]
    };

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${c.full_name} | VoterSpheres</title>
        <meta name="description" content="${c.full_name} running for ${c.office} in ${c.state}.">

        <script type="application/ld+json">
        ${JSON.stringify(structuredGraph, null, 2)}
        </script>
      </head>
      <body style="font-family: Arial; margin: 40px;">
        <h1>${c.full_name}</h1>
        <p><strong>Office:</strong> ${c.office}</p>
        <p><strong>State:</strong> ${c.state}</p>
        <p><strong>Party:</strong> ${c.party}</p>
        <p><strong>County:</strong> ${c.county || ""}</p>
        ${c.photo ? `<img src="${imageUrl}" width="200" />` : ""}
        <p><a href="/">← Back</a></p>
      </body>
      </html>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ===============================
   GOVERNMENT OFFICE PAGE
================================ */

app.get("/office/:officeSlug", async (req, res) => {
  try {
    const officeSlug = req.params.officeSlug.replace(/-/g, " ");

    const { rows } = await pool.query(
      `
      SELECT full_name, slug, state, party
      FROM candidate
      WHERE LOWER(office) = LOWER($1)
      ORDER BY full_name
      `,
      [officeSlug]
    );

    if (!rows.length) {
      return res.status(404).send("Office not found");
    }

    const officeUrl = `${BASE_URL}/office/${req.params.officeSlug}`;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${officeSlug} Candidates | VoterSpheres</title>
      </head>
      <body style="font-family: Arial; margin: 40px;">
        <h1>${officeSlug} Candidates</h1>
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
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ===============================
   DYNAMIC SITEMAP
================================ */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT slug FROM candidate WHERE slug IS NOT NULL
    `);

    const urls = rows.map(row => `
      <url>
        <loc>${BASE_URL}/${row.slug}</loc>
      </url>
    `).join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${BASE_URL}</loc></url>
        ${urls}
      </urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating sitemap");
  }
});

/* ===============================
   START SERVER
================================ */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
