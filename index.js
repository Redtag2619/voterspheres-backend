import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import slugify from "slugify";
import csv from "csv-parser";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ===============================
   DATABASE CONNECTION
================================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render")
    ? { rejectUnauthorized: false }
    : false,
});

async function testDB() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ Database connected");
  } catch (err) {
    console.error("❌ DB CONNECTION ERROR:", err);
  }
}

testDB();

/* ===============================
   HELPERS
================================ */

function createSlug(name, state, office) {
  return slugify(`${name}-${state}-${office}`, {
    lower: true,
    strict: true,
  });
}

/* ===============================
   HEALTH CHECK
================================ */

app.get("/", (req, res) => {
  res.send("🚀 VoterSpheres Backend Running");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date(),
  });
});

/* ===============================
   CANDIDATE ROUTES
================================ */

app.get("/candidate/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      "SELECT * FROM candidates WHERE slug = $1 LIMIT 1",
      [slug]
    );

    if (!result.rows.length) {
      return res.status(404).send("Candidate not found");
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ===============================
   STATE ROUTES
================================ */

app.get("/state/:state", async (req, res) => {
  try {
    const { state } = req.params;

    const result = await pool.query(
      "SELECT * FROM candidates WHERE state = $1 LIMIT 500",
      [state]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ===============================
   SITEMAP (BASIC)
================================ */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT slug, updated_at FROM candidates LIMIT 50000"
    );

    const baseUrl =
      process.env.BASE_URL || "https://voterspheres.org";

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

    result.rows.forEach((row) => {
      xml += `
  <url>
    <loc>${baseUrl}/candidate/${row.slug}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
  </url>`;
    });

    xml += "\n</urlset>";

    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send("Sitemap error");
  }
});

/* ===============================
   NATIONWIDE IMPORTER
================================ */

async function importNationwideCandidates(filePath) {
  console.log("🇺🇸 Starting nationwide import...");

  const BATCH_SIZE = 1000;
  let batch = [];
  let total = 0;

  async function insertBatch() {
    if (batch.length === 0) return;

    const values = [];
    const placeholders = [];

    batch.forEach((c, i) => {
      const idx = i * 8;

      placeholders.push(
        `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4},
          $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8})`
      );

      values.push(
        c.name,
        c.office,
        c.state,
        c.district,
        c.party,
        c.election_year,
        c.website,
        c.slug
      );
    });

    const query = `
      INSERT INTO candidates
      (name, office, state, district, party, election_year, website, slug)
      VALUES ${placeholders.join(",")}
      ON CONFLICT (slug) DO NOTHING
    `;

    await pool.query(query, values);

    total += batch.length;
    console.log(`✅ Imported: ${total}`);

    batch = [];
  }

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        try {
          const candidate = {
            name: row.name || row.Name,
            office: row.office || row.Office,
            state: row.state || row.State,
            district: row.district || "",
            party: row.party || "",
            election_year: parseInt(row.year || 2024),
            website: row.website || "",
          };

          candidate.slug = createSlug(
            candidate.name,
            candidate.state,
            candidate.office
          );

          batch.push(candidate);

          if (batch.length >= BATCH_SIZE) {
            insertBatch().catch(console.error);
          }
        } catch (err) {
          console.error("Row error:", err);
        }
      })
      .on("end", async () => {
        await insertBatch();
        console.log("🎉 Nationwide import complete:", total);
        resolve();
      })
      .on("error", reject);
  });
}

/* ===============================
   ADMIN IMPORT ROUTE
================================ */

app.get("/admin/import", async (req, res) => {
  try {
    const filePath = path.join(
      process.cwd(),
      "data",
      "candidates.csv"
    );

    if (!fs.existsSync(filePath)) {
      return res.status(400).send("CSV file not found");
    }

    await importNationwideCandidates(filePath);

    res.send("✅ Nationwide import complete");
  } catch (err) {
    console.error(err);
    res.status(500).send("Import failed");
  }
});

/* ===============================
   SERVER START
================================ */

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
