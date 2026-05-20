import pool from "../config/database.js";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeState(value) {
  return clean(value).toUpperCase();
}

function normalizeCategory(purpose = "") {
  const lower = String(purpose).toLowerCase();

  if (lower.includes("media")) return "Media";
  if (lower.includes("poll")) return "Polling";
  if (lower.includes("mail")) return "Direct Mail";
  if (lower.includes("digital")) return "Digital";
  if (lower.includes("field")) return "Field Operations";
  if (lower.includes("strategy")) return "Strategy";
  if (lower.includes("consult")) return "General Consulting";

  return "Political Consulting";
}

export async function ensureConsultantImportTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_import_runs (
      id SERIAL PRIMARY KEY,
      cycle INTEGER,
      imported_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      source TEXT DEFAULT 'fec_disbursements',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE consultants
    ADD COLUMN IF NOT EXISTS fec_vendor_name TEXT
  `);

  await pool.query(`
    ALTER TABLE consultants
    ADD COLUMN IF NOT EXISTS source_candidate TEXT
  `);

  await pool.query(`
    ALTER TABLE consultants
    ADD COLUMN IF NOT EXISTS source_committee TEXT
  `);

  await pool.query(`
    ALTER TABLE consultants
    ADD COLUMN IF NOT EXISTS total_fec_disbursements NUMERIC DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE consultants
    ADD COLUMN IF NOT EXISTS clients_count INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE consultants
    ADD COLUMN IF NOT EXISTS last_fec_activity TIMESTAMP
  `);
}

export async function importDemoConsultants() {
  await ensureConsultantImportTables();

  const consultants = [
    {
      name: "Axiom Strategies",
      category: "General Consulting",
      state: "TX",
      website: "https://axiomstrategies.com",
      services: "Campaign strategy and voter targeting",
      total: 2450000,
    },
    {
      name: "Targeted Victory",
      category: "Digital",
      state: "VA",
      website: "https://targetedvictory.com",
      services: "Digital persuasion and fundraising",
      total: 5120000,
    },
    {
      name: "Medium Buying LLC",
      category: "Media",
      state: "DC",
      website: "https://mediabuying.com",
      services: "Political ad placement",
      total: 3980000,
    },
  ];

  let imported = 0;

  for (const consultant of consultants) {
    await pool.query(
      `
        INSERT INTO consultants (
          name,
          firm_name,
          category,
          state,
          website,
          status,
          services,
          source,
          total_fec_disbursements,
          source_updated_at,
          created_at,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,'active',$6,'fec_import',$7,NOW(),NOW(),NOW()
        )
        ON CONFLICT DO NOTHING
      `,
      [
        consultant.name,
        consultant.name,
        consultant.category,
        consultant.state,
        consultant.website,
        consultant.services,
        consultant.total,
      ]
    );

    imported += 1;
  }

  await pool.query(
    `
      INSERT INTO consultant_import_runs (
        cycle,
        imported_count,
        skipped_count
      )
      VALUES ($1,$2,$3)
    `,
    [2026, imported, 0]
  );

  return {
    ok: true,
    imported,
  };
}
