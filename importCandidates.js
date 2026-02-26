import pkg from "pg";
import fs from "fs";
import csv from "csv-parser";
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

const FILE_PATH = "./data/candidates.csv"; // change if needed
const BATCH_SIZE = 1000;

/* =========================
   INSERT BATCH
========================= */

async function insertBatch(batch) {

  if (batch.length === 0) return;

  const values = [];
  const placeholders = [];

  batch.forEach((c, i) => {
    const base = i * 5;

    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
    );

    values.push(
      c.name || null,
      c.office || null,
      c.state || null,
      c.party || null,
      c.source || "import"
    );
  });

  const query = `
    INSERT INTO candidate (name, office, state, party, source)
    VALUES ${placeholders.join(",")}
  `;

  await pool.query(query, values);
}

/* =========================
   IMPORT
========================= */

async function runImport() {

  console.log("Starting import...");

  let batch = [];
  let total = 0;

  return new Promise((resolve, reject) => {

    fs.createReadStream(FILE_PATH)
      .pipe(csv())
      .on("data", async (row) => {

        batch.push({
          name: row.name,
          office: row.office,
          state: row.state,
          party: row.party,
          source: "csv"
        });

        if (batch.length >= BATCH_SIZE) {

          try {
            await insertBatch(batch);
            total += batch.length;

            console.log(`Imported ${total}`);

            batch = [];

          } catch (err) {
            console.error(err);
          }
        }
      })
      .on("end", async () => {

        if (batch.length > 0) {
          await insertBatch(batch);
          total += batch.length;
        }

        console.log(`✅ Import complete: ${total}`);
        resolve();

      })
      .on("error", reject);
  });
}

runImport().then(() => process.exit());
