export const id = "020_create_consultant_import_engine";

export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_import_runs (
      id SERIAL PRIMARY KEY,
      cycle INTEGER,
      candidate_limit INTEGER,
      candidate_offset INTEGER DEFAULT 0,
      max_pages INTEGER,
      dry_run BOOLEAN DEFAULT false,
      candidates_checked INTEGER DEFAULT 0,
      committees_checked INTEGER DEFAULT 0,
      disbursements_checked INTEGER DEFAULT 0,
      consultants_imported INTEGER DEFAULT 0,
      relationships_imported INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      failures JSONB DEFAULT '[]'::jsonb,
      source TEXT DEFAULT 'fec_schedule_b',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_candidate_relationships (
      id SERIAL PRIMARY KEY,
      consultant_id INTEGER REFERENCES consultants(id) ON DELETE CASCADE,
      candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
      committee_id TEXT,
      committee_name TEXT,
      candidate_name TEXT,
      candidate_state TEXT,
      candidate_office TEXT,
      candidate_party TEXT,
      cycle INTEGER,
      category TEXT,
      purpose TEXT,
      total_amount NUMERIC DEFAULT 0,
      transaction_count INTEGER DEFAULT 0,
      first_disbursement_date DATE,
      last_disbursement_date DATE,
      confidence NUMERIC DEFAULT 0,
      source TEXT DEFAULT 'fec_schedule_b',
      source_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (consultant_id, candidate_id, committee_id, cycle, category)
    )
  `);

  await pool.query(`
    ALTER TABLE consultants
      ADD COLUMN IF NOT EXISTS fec_vendor_name TEXT,
      ADD COLUMN IF NOT EXISTS total_fec_disbursements NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS clients_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_fec_activity TIMESTAMP,
      ADD COLUMN IF NOT EXISTS influence_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS battleground_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS overlap_score NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS exposure_score NUMERIC DEFAULT 0
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultant_relationship_candidate ON consultant_candidate_relationships(candidate_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultant_relationship_consultant ON consultant_candidate_relationships(consultant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultant_relationship_cycle ON consultant_candidate_relationships(cycle)`);
}

export async function down(pool) {
  await pool.query(`DROP TABLE IF EXISTS consultant_candidate_relationships`);
  await pool.query(`DROP TABLE IF EXISTS consultant_import_runs`);
}
