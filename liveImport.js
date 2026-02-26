import pkg from "pg";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   CONFIG
========================= */

const FEC_API_KEY = process.env.FEC_API_KEY; // get from api.data.gov
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // optional

/* =========================
   DB INSERT
========================= */

async function insertCandidate(c) {

  const query = `
    INSERT INTO candidate (name, office, state, party, source)
    VALUES ($1, $2, $3, $4, $5)
  `;

  await pool.query(query, [
    c.name,
    c.office,
    c.state,
    c.party,
    c.source
  ]);
}

/* =========================
   FEC FEDERAL IMPORT
========================= */

async function importFEC() {

  console.log("Importing FEC candidates...");

  const url = `https://api.open.fec.gov/v1/candidates/?api_key=${FEC_API_KEY}&per_page=100`;

  const res = await axios.get(url);

  for (const c of res.data.results) {

    await insertCandidate({
      name: c.name,
      office: c.office_full || c.office,
      state: c.state,
      party: c.party_full || c.party,
      source: "FEC"
    });
  }

  console.log("FEC import complete");
}

/* =========================
   GOOGLE CIVIC IMPORT
========================= */

async function importGoogleCivic() {

  if (!GOOGLE_API_KEY) return;

  console.log("Importing Google Civic candidates...");

  const url = `https://www.googleapis.com/civicinfo/v2/elections?key=${GOOGLE_API_KEY}`;

  const res = await axios.get(url);

  for (const election of res.data.elections) {

    await insertCandidate({
      name: election.name,
      office: "Election",
      state: "US",
      party: null,
      source: "GoogleCivic"
    });
  }

  console.log("Google import complete");
}

/* =========================
   MASTER IMPORT
========================= */

async function run() {

  try {

    await importFEC();
    await importGoogleCivic();

    console.log("✅ LIVE IMPORT COMPLETE");

  } catch (err) {
    console.error(err);
  }

  process.exit();
}

run();
