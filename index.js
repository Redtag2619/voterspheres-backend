import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import slugify from "slugify";
import axios from "axios";
import fs from "fs";
import path from "path";
import csv from "csv-parser";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ===============================
   DATABASE
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
    console.error("❌ DB ERROR:", err);
  }
}
testDB();

/* ===============================
   HELPERS
================================ */

function slug(name, state, office) {
  return slugify(`${name}-${state}-${office}`, {
    lower: true,
    strict: true,
  });
}

async function insertCandidatesBatch(batch) {
  if (!batch.length) return;

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
}

/* ===============================
   HEALTH
================================ */

app.get("/", (req, res) => {
  res.send("🚀 VoterSpheres Live Backend Running");
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

    if (!result.rows.length)
      return res.status(404).send("Not found");

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
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
    res.status(500).send("Error");
  }
});

/* ===============================
   SITEMAP
================================ */

app.get("/sitemap.xml", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT slug FROM candidates LIMIT 50000"
    );

    const base = process.env.BASE_URL;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    result.rows.forEach((row) => {
      xml += `
<url>
  <loc>${base}/candidate/${row.slug}</loc>
</url>`;
    });

    xml += "</urlset>";

    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    res.status(500).send("Error");
  }
});

/* ===============================
   🇺🇸 LIVE FEC IMPORT
   Federal Candidates
================================ */

async function importFEC() {
  console.log("🇺🇸 Importing FEC candidates...");

  const apiKey = process.env.FEC_API_KEY;
  const batch = [];

  let page = 1;
  let totalImported = 0;

  while (page <= 20) {
    const url = `https://api.open.fec.gov/v1/candidates/?page=${page}&per_page=100&api_key=${apiKey}`;

    const response = await axios.get(url);

    const candidates = response.data.results;

    for (const c of candidates) {
      const candidate = {
        name: c.name,
        office: c.office_full || c.office,
        state: c.state || "",
        district: c.district || "",
        party: c.party_full || "",
        election_year: 2024,
        website: "",
      };

      candidate.slug = slug(
        candidate.name,
        candidate.state,
        candidate.office
      );

      batch.push(candidate);

      if (batch.length >= 500) {
        await insertCandidatesBatch(batch);
        totalImported += batch.length;
        batch.length = 0;
      }
    }

    console.log(`Page ${page} complete`);
    page++;
  }

  if (batch.length) {
    await insertCandidatesBatch(batch);
    totalImported += batch.length;
  }

  console.log(`✅ FEC Import Complete: ${totalImported}`);
}

/* ===============================
   📊 CSV IMPORT (STATE / LOCAL)
================================ */

async function importCSV(filePath) {
  console.log("📂 Importing CSV...");

  const batch = [];
  let total = 0;

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", async (row) => {
        const candidate = {
          name: row.name,
          office: row.office,
          state: row.state,
          district: row.district || "",
          party: row.party || "",
          election_year: row.year || 2024,
          website: row.website || "",
        };

        candidate.slug = slug(
          candidate.name,
          candidate.state,
          candidate.office
        );

        batch.push(candidate);

        if (batch.length >= 500) {
          await insertCandidatesBatch(batch);
          total += batch.length;
          batch.length = 0;
        }
      })
      .on("end", async () => {
        if (batch.length) {
          await insertCandidatesBatch(batch);
          total += batch.length;
        }

        console.log("✅ CSV Import:", total);
        resolve();
      })
      .on("error", reject);
  });
}

/* ===============================
   ADMIN ROUTES
================================ */

app.get("/admin/sync/fec", async (req, res) => {
  try {
    await importFEC();
    res.send("✅ FEC Sync Complete");
  } catch (err) {
    console.error(err);
    res.status(500).send("Sync failed");
  }
});

app.get("/admin/sync/csv", async (req, res) => {
  try {
    const filePath = path.join(
      process.cwd(),
      "data",
      "candidates.csv"
    );

    await importCSV(filePath);

    res.send("✅ CSV Import Complete");
  } catch (err) {
    console.error(err);
    res.status(500).send("Import failed");
  }
});

/* ===============================
   AUTO NIGHTLY SYNC
================================ */

async function nightlySync() {
  try {
    await importFEC();
    console.log("🌙 Nightly sync complete");
  } catch (err) {
    console.error("Nightly sync error", err);
  }
}

// every 24 hours
setInterval(nightlySync, 24 * 60 * 60 * 1000);

/* ===============================
   SERVER
================================ */

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
