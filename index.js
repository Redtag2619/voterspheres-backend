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

/* ===============================
   PUBLIC CANDIDATE PROFILE
================================ */

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

    const candidate = rows[0];

    const structuredData = {
      "@context": "https://schema.org",
      "@type": ["Person", "PoliticalCandidate"],
      "name": candidate.full_name,
      "image": candidate.photo
        ? `https://voterspheres.org/uploads/${candidate.photo}`
        : null,
      "url": `https://voterspheres.org/${candidate.slug}`,
      "jobTitle": candidate.office,
      "affiliation": {
        "@type": "PoliticalParty",
        "name": candidate.party
      },
      "address": {
        "@type": "PostalAddress",
        "addressRegion": candidate.state,
        "addressLocality": candidate.county || ""
      }
    };

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${candidate.full_name} | VoterSpheres</title>
        <meta name="description" content="${candidate.full_name} running for ${candidate.office} in ${candidate.state}.">

        <script type="application/ld+json">
        ${JSON.stringify(structuredData, null, 2)}
        </script>
      </head>
      <body>
        <h1>${candidate.full_name}</h1>
        <p><strong>Office:</strong> ${candidate.office}</p>
        <p><strong>State:</strong> ${candidate.state}</p>
        <p><strong>Party:</strong> ${candidate.party}</p>
        <p><strong>County:</strong> ${candidate.county || ""}</p>

        ${
          candidate.photo
            ? `<img src="/uploads/${candidate.photo}" width="200" />`
            : ""
        }

        <p><a href="/">← Back</a></p>
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
