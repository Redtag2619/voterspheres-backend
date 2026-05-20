export const id = "020_create_consultant_import_engine";

export async function up(pool) {
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

export async function down(pool) {
  await pool.query(`DROP TABLE IF EXISTS consultant_import_runs`);
}
