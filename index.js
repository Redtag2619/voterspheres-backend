import express from "express";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(express.json());

/* ================================
   DATABASE
================================ */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/* ================================
   HEALTH CHECK
================================ */

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ================================
   ROOT
================================ */

app.get("/", (req, res) => {
  res.send("VoterSpheres Backend Running");
});

/* ================================
   TABLE INIT (SAFE)
================================ */

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidates (
      id SERIAL PRIMARY KEY,
      name TEXT,
      office TEXT,
      state TEXT,
      party TEXT,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

/* ================================
   PLACEHOLDER GENERATOR
================================ */

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

/* ================================
   BULK INSERT FUNCTION
================================ */

async function insertBatch(batchSize = 1000) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < batchSize; i++) {
      const c = generateCandidate();

      await client.query(
        `INSERT INTO candidates (name, office, state, party, source)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.name, c.office, c.state, c.party, c.source]
      );
    }

    await client.query("COMMIT");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
  } finally {
    client.release();
  }
}

/* ================================
   MASS IMPORT ENGINE
================================ */

async function massiveImport(total = 500000) {
  console.log(`Starting import of ${total} candidates`);

  const batchSize = 1000;
  const loops = Math.ceil(total / batchSize);

  for (let i = 0; i < loops; i++) {
    await insertBatch(batchSize);
    console.log(`Imported batch ${i + 1} / ${loops}`);
  }

  console.log("Import complete");
}

/* ================================
   ADMIN IMPORT ROUTE
================================ */

app.get("/admin/import", async (req, res) => {
  res.json({ status: "Import started" });

  // Run async so request returns immediately
  massiveImport(2000000).catch(console.error);
});

/* ================================
   LIST CANDIDATES
================================ */

app.get("/candidates", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM candidates ORDER BY id DESC LIMIT 100"
  );

  res.json(rows);
});

/* ================================
   SERVER START
================================ */

const PORT = process.env.PORT || 10000;

ensureTable().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
