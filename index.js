import express from "express";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(express.json());

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   HEALTH
========================= */

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  res.send("VoterSpheres Backend Running");
});

/* =========================
   TABLE INIT (RESET SAFE)
========================= */

async function ensureTable() {

  // Drop old broken table if exists
  await pool.query(`DROP TABLE IF EXISTS candidate;`);

  // Create correct schema
  await pool.query(`
    CREATE TABLE candidate (
      id SERIAL PRIMARY KEY,
      name TEXT,
      office TEXT,
      state TEXT,
      party TEXT,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ Candidate table ready");
}

/* =========================
   DATA GENERATOR
========================= */

const firstNames = [
  "James","Mary","John","Patricia","Robert","Jennifer",
  "Michael","Linda","William","Elizabeth","David","Barbara"
];

const lastNames = [
  "Smith","Johnson","Williams","Brown","Jones",
  "Garcia","Miller","Davis","Rodriguez","Martinez"
];

const offices = [
  "Mayor",
  "City Council",
  "Governor",
  "State Senate",
  "State House",
  "Attorney General",
  "County Commissioner"
];

const parties = ["Democrat", "Republican", "Independent"];

const states = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
];

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCandidate() {
  return {
    name: `${random(firstNames)} ${random(lastNames)}`,
    office: random(offices),
    state: random(states),
    party: random(parties),
    source: "placeholder"
  };
}

/* =========================
   FAST BULK INSERT
========================= */

async function insertBatch(batchSize = 1000) {

  const values = [];
  const params = [];

  for (let i = 0; i < batchSize; i++) {
    const c = generateCandidate();

    const index = i * 5;

    values.push(
      `($${index+1},$${index+2},$${index+3},$${index+4},$${index+5})`
    );

    params.push(
      c.name,
      c.office,
      c.state,
      c.party,
      c.source
    );
  }

  const query = `
    INSERT INTO candidate (name, office, state, party, source)
    VALUES ${values.join(",")}
  `;

  await pool.query(query, params);
}

/* =========================
   MASS IMPORT
========================= */

async function massiveImport(total = 500000) {

  console.log(`🚀 Starting import: ${total}`);

  const batchSize = 1000;
  const loops = Math.ceil(total / batchSize);

  for (let i = 0; i < loops; i++) {
    await insertBatch(batchSize);
    console.log(`Imported batch ${i + 1} / ${loops}`);
  }

  console.log("✅ Import complete");
}

/* =========================
   ADMIN IMPORT ROUTE
========================= */

app.get("/admin/import", async (req, res) => {

  res.json({ status: "Import started" });

  massiveImport(2000000).catch(console.error);

});

/* =========================
   GET CANDIDATES
========================= */

app.get("/candidate", async (req, res) => {

  const { rows } = await pool.query(
    "SELECT * FROM candidate ORDER BY id DESC LIMIT 100"
  );

  res.json(rows);
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 10000;

ensureTable().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
});
