import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "../db/pool.js";

const DATA_DIR = path.resolve(process.cwd(), "data", "usps");

const FILES = [
  "master.csv"
];

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && insideQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

function clean(value) {
  return String(value || "").trim();
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mailops_postal_facilities (
      id SERIAL PRIMARY KEY,
      facility_type TEXT NOT NULL,
      facility_name TEXT NOT NULL,
      facility_address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      source TEXT DEFAULT 'usps_import',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mailops_postal_facilities_unique
    ON mailops_postal_facilities (
      facility_type,
      facility_name,
      facility_address
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mailops_postal_facilities_type
    ON mailops_postal_facilities(facility_type)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mailops_postal_facilities_state
    ON mailops_postal_facilities(state)
  `);
}

async function importRow(row, fileName) {

  // USPS-native column mapping
  const facilityType =
    clean(
      row.facility_type ||
      row["FACILITY T"] ||
      row["FACILITY TYPE"]
    ).toUpperCase();

  const facilityName =
    clean(
      row.facility_name ||
      row["FACILITY N"] ||
      row["FACILITY NAME"]
    );

  const facilityAddress =
    clean(
      row.facility_address ||
      row["FACILITY A"] ||
      row["ADDRESS"]
    );

  const city =
    clean(
      row.city ||
      row["FACILITY C"] ||
      row["CITY"]
    );

  const state =
    clean(
      row.state ||
      row["FACILITY S"] ||
      row["STATE"]
    ).toUpperCase();

  const zip =
    clean(
      row.zip ||
      row["ZIP"] ||
      row["ZIP CODE"]
    );

  const bmeuIndicator =
    clean(
      row["BMEU INDICATOR"]
    ).toUpperCase();

  // Infer facility type when USPS does not provide it cleanly
  let normalizedFacilityType = facilityType;

  if (!normalizedFacilityType) {
    if (bmeuIndicator === "Y") {
      normalizedFacilityType = "BMEU";
    } else if (
      facilityName.includes("NDC")
    ) {
      normalizedFacilityType = "NDC";
    } else if (
      facilityName.includes("SCF")
    ) {
      normalizedFacilityType = "SCF";
    } else {
      normalizedFacilityType = "DDU";
    }
  }

  const source =
    clean(row.source) ||
    `usps_${fileName}`;

  const isActive =
    clean(row.is_active).toLowerCase() === "false"
      ? false
      : true;

  if (
    !normalizedFacilityType ||
    !facilityName
  ) {
    return {
      skipped: true
    };
  }

  await pool.query(
    `
      INSERT INTO mailops_postal_facilities (
        facility_type,
        facility_name,
        facility_address,
        city,
        state,
        zip,
        source,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())

      ON CONFLICT (
        facility_type,
        facility_name,
        facility_address
      )

      DO UPDATE SET
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        source = EXCLUDED.source,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `,
    [
      normalizedFacilityType,
      facilityName,
      facilityAddress || null,
      city || null,
      state || null,
      zip || null,
      source,
      isActive,
    ]
  );

  return {
    skipped: false
  };
}

async function importFile(fileName) {
  const fullPath = path.join(DATA_DIR, fileName);

  if (!fs.existsSync(fullPath)) {
    return {
      file: fileName,
      ok: false,
      imported: 0,
      skipped: 0,
      error: `Missing file: ${fullPath}`,
    };
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const rows = parseCsv(content);

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = await importRow(row, fileName);

    if (result.skipped) skipped += 1;
    else imported += 1;
  }

  return {
    file: fileName,
    ok: true,
    imported,
    skipped,
  };
}

async function main() {
  await ensureTable();

  const results = [];

  for (const file of FILES) {
    const result = await importFile(file);
    results.push(result);
  }

  const summary = await pool.query(`
    SELECT facility_type, COUNT(*)::int AS total
    FROM mailops_postal_facilities
    WHERE is_active = true
    GROUP BY facility_type
    ORDER BY facility_type
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        imported_at: new Date().toISOString(),
        files: results,
        totals: summary.rows,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("USPS postal facility import failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
