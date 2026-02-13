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

/* =============================
   HEALTH CHECK
============================= */
app.get("/", (req, res) => {
  res.json({ status: "VoterSpheres API running" });
});

/* ======================================
   PUBLIC CANDIDATE PROFILE (ENHANCED SCHEMA)
====================================== */

app.get("/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { rows } = await pool.query(
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

    if (rows.length === 0) {
      return res.status(404).send("Candidate not found");
    }

    const c = rows[0];

    const candidateUrl = `https://voterspheres.org/${c.slug}`;
    const imageUrl = c.photo
      ? `https://voterspheres.org/uploads/${c.photo}`
      : "https://voterspheres.org/logo.png";

    /* ================================
       ENHANCED STRUCTURED DATA
    ================================= */

    const structuredData = {
      "@context": "https://schema.org",
      "@type": ["Person", "PoliticalCandidate"],
      "@id": candidateUrl,
      "name": c.full_name,
      "url": candidateUrl,
      "image": imageUrl,
      "jobTitle": c.office,
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": candidateUrl
      },
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
      "areaServed": {
        "@type": "AdministrativeArea",
        "name": `${c.county || ""}, ${c.state}`
      }
    };

    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": "https://voterspheres.org"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": c.full_name,
          "item": candidateUrl
        }
      ]
    };

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${c.full_name} | VoterSpheres</title>
        <meta name="description" content="${c.full_name} running for ${c.office} in ${c.state}. Political party: ${c.party}.">

        <meta property="og:title" content="${c.full_name} | VoterSpheres" />
        <meta property="og:description" content="${c.full_name} running for ${c.office} in ${c.state}." />
        <meta property="og:url" content="${candidateUrl}" />
        <meta property="og:type" content="profile" />
        <meta property="og:image" content="${imageUrl}" />

        <script type="application/ld+json">
        ${JSON.stringify(structuredData, null, 2)}
        </script>

        <script type="application/ld+json">
        ${JSON.stringify(breadcrumbSchema, null, 2)}
        </script>

      </head>
      <body style="font-family: Arial; margin: 40px;">
        <h1>${c.full_name}</h1>

        <p><strong>Office:</strong> ${c.office}</p>
        <p><strong>State:</strong> ${c.state}</p>
        <p><strong>Party:</strong> ${c.party}</p>
        <p><strong>County:</strong> ${c.county || ""}</p>

        ${
          c.photo
            ? `<img src="${imageUrl}" width="200" />`
            : ""
        }

        <p><a href="/">← Back to Home</a></p>

      </body>
      </html>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* =============================
   LIST ALL CANDIDATES (SEO)
============================= */
app.get("/api/candidates", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT full_name, slug, state, party, office
       FROM candidate
       ORDER BY full_name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
/* =============================
   DYNAMIC SITEMAP
============================= */
app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT slug FROM candidate WHERE slug IS NOT NULL`
    );

    const urls = result.rows
      .map(
        row => `
  <url>
    <loc>https://voterspheres.org/${row.slug}</loc>
  </url>`
      )
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://voterspheres.org/</loc>
  </url>
  ${urls}
</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating sitemap");
  }
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
