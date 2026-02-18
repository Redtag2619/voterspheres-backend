import fs from "fs";
import csv from "csv-parser";
import slugify from "slugify";

export async function importNationwideCandidates(pool, filePath) {
  console.log("🇺🇸 Starting nationwide import...");

  const BATCH_SIZE = 1000;
  let batch = [];
  let total = 0;

  function createSlug(name, state, office) {
    return slugify(`${name}-${state}-${office}`, {
      lower: true,
      strict: true,
    });
  }

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
      .on("data", async (row) => {
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
            fs.createReadStream("").pause();
            insertBatch()
              .then(() => {})
              .catch(console.error);
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
