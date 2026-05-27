import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "../db/pool.js";

const DATA_DIR = path.resolve(process.cwd(), "data", "usps");

const FILES = [
  "facilityReport1.csv",
  "facilityReport2.csv",
  "facilityReport3.csv",
  "facilityReport4.csv",
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

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findHeaderLineIndex(lines) {
  return lines.findIndex((line) => {
    const normalized = line.toLowerCase();
    return (
      normalized.includes("facility name") &&
      normalized.includes("facility type") &&
      normalized.includes("address") &&
      normalized.includes("zip")
    );
  });
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);

  if (!lines.length) return [];

  const headerLineIndex = findHeaderLineIndex(lines);

  if (headerLineIndex < 0) {
    return [];
  }

  const rawHeaders = parseCsvLine(lines[headerLineIndex]);
  const headers = rawHeaders.map(normalizeHeader);

  return lines.slice(headerLineIndex + 1).map((line) => {
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

function pick(row, keys) {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (row[normalized]) return clean(row[normalized]);
  }

  return "";
}

function inferFacilityType(row, fileName) {
  const rawType = pick(row, [
    "Facility Type",
    "facility_type",
    "facility type",
  ]).toUpperCase();

  const bmeu = pick(row, [
    "BMEU",
    "BMEU Indicator",
    "bmeu",
  ]).toUpperCase();

  const name = pick(row, [
    "Facility Name",
    "facility_name",
  ]).toUpperCase();

  const file = fileName.toLowerCase();

  if (file.includes("1")) return "BMEU";
  if (file.includes("2")) return "SCF";
  if (file.includes("3")) return "NDC";
  if (file.includes("4")) return "DDU";

  if (rawType.includes("NDC") || rawType.includes("RPDC")) return "NDC";
  if (rawType.includes("SCF")) return "SCF";
  if (rawType.includes("DDU")) return "DDU";
  if (bmeu === "YES" || bmeu === "Y") return "BMEU";
  if (name.includes("NDC") || name.includes("RPDC")) return "NDC";
  if (name.includes("SCF")) return "SCF";
  if (name.includes("DDU")) return "DDU";

  return "BMEU";
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
  const facilityType = inferFacilityType(row, fileName);

  const facilityName = pick(row, [
    "Facility Name",
    "facility_name",
    "Name",
  ]);

  const facilityAddress = pick(row, [
    "Address",
    "Facility Address",
    "facility_address",
  ]);

  const city = pick(row, [
    "City",
  ]);

  const state = pick(row, [
    "State",
  ]).toUpperCase();

  const zip = pick(row, [
    "ZIP Code",
    "Zip",
    "ZIP",
  ]);

  if (!facilityType || !facilityName) {
    return { skipped: true };
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW())
      ON CONFLICT (facility_type, facility_name, facility_address)
      DO UPDATE SET
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        source = EXCLUDED.source,
        is_active = true,
        updated_at = NOW()
    `,
    [
      facilityType,
      facilityName,
      facilityAddress || null,
      city || null,
      state || null,
      zip || null,
      `usps_${fileName}`,
    ]
  );

  return { skipped: false };
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

  const rows = parseCsv(fs.readFileSync(fullPath, "utf8"));

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

  const importedFiles = [];

  for (const file of FILES) {
    importedFiles.push(await importFile(file));
  }

  const totals = await pool.query(`
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
        files: importedFiles,
        totals: totals.rows,
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
