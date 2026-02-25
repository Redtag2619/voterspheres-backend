import express from "express";
import pkg from "pg";
import axios from "axios";
import dotenv from "dotenv";
import slugify from "slugify";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(express.json());

/* =========================
   ENV
========================= */

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const FEC_API_KEY = process.env.FEC_API_KEY;

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/* =========================
   HELPERS
========================= */

function createSlug(name, state, office, year) {
  return slugify(`${name}-${state}-${office}-${year}`, {
    lower: true,
    strict: true,
  });
}

/* =========================
   DB INIT
========================= */

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidates (
        id BIGSERIAL PRIMARY KEY,
        slug TEXT UNIQUE,
        name TEXT,
        party TEXT,
        state TEXT,
        office TEXT,
        district TEXT,
        election_year INT,
        source TEXT,
        source_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ Database ready");
}

/* =========================
   UPSERT CANDIDATE
========================= */

async function upsertCandidate(candidate) {
  const query = `
    INSERT INTO candidates (
      slug, name, party, state, office,
      district, election_year, source, source_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (slug)
    DO UPDATE SET
      name = EXCLUDED.name,
      party = EXCLUDED.party,
      state = EXCLUDED.state,
      office = EXCLUDED.office,
      district = EXCLUDED.district,
      election_year = EXCLUDED.election_year,
      updated_at = NOW()
  `;

  await pool.query(query, [
    candidate.slug,
    candidate.name,
    candidate.party,
    candidate.state,
    candidate.office,
    candidate.district,
    candidate.year,
    candidate.source,
    candidate.source_id,
  ]);
}

/* =========================
   FEC IMPORTER
========================= */

async function importFECCandidates(year = 2024) {
  console.log("🚀 Starting FEC Import");

  let page = 1;
  let totalImported = 0;
  let hasMore = true;

  while (hasMore) {
    console.log(`📦 Fetching page ${page}`);

    const url = `https://api.open.fec.gov/v1/candidates/search/?api_key=${FEC_API_KEY}&page=${page}&per_page=100&election_year=${year}`;

    const response = await axios.get(url);

    const results = response.data.results;

    if (!results || results.length === 0) {
      hasMore = false;
      break;
    }

    for (const c of results) {
      const name = c.name || "Unknown";

      const officeMap = {
        H: "House",
        S: "Senate",
        P: "President",
      };

      const office = officeMap[c.office] || "Federal";

      const slug = createSlug(
        name,
        c.state || "US",
        office,
        year
      );

      const candidate = {
        slug,
        name,
        party: c.party_full || "",
        state: c.state || "",
        office,
        district: c.district || "",
        year,
        source: "FEC",
        source_id: c.candidate_id,
      };

      try {
        await upsertCandidate(candidate);
        totalImported++;
      } catch (err) {
        console.error("UPSERT ERROR", err.message);
      }
    }

    page++;

    if (page > response.data.pagination.pages) {
      hasMore = false;
    }
  }

  console.log(`✅ Import Complete: ${totalImported} candidates`);
  return totalImported;
}

/* =========================
   ADMIN IMPORT ROUTE
========================= */

app.get("/admin/import/fec", async (req, res) => {
  try {
    const year = req.query.year || 2024;

    const count = await importFECCandidates(year);

    res.json({
      success: true,
      imported: count,
      year,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

/* =========================
   API ROUTES
========================= */

app.get("/", (req, res) => {
  res.send("VoterSphere Backend Running");
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      db: "connected",
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      error: err.message,
    });
  }
});

/* =========================
   START SERVER
========================= */

async function start() {
  try {
    await initDB();

    app.listen(PORT, () => {
      console.log(`🚀 Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error("START ERROR", err);
  }
}

start();
