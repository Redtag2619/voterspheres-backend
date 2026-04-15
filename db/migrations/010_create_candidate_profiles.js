export const id = "010_create_candidate_profiles";

export async function up(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id BIGSERIAL PRIMARY KEY,
      candidate_id BIGINT NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      campaign_website TEXT,
      official_website TEXT,
      office_address TEXT,
      campaign_address TEXT,
      phone TEXT,
      email TEXT,
      chief_of_staff_name TEXT,
      campaign_manager_name TEXT,
      finance_director_name TEXT,
      political_director_name TEXT,
      press_contact_name TEXT,
      press_contact_email TEXT,
      source_label TEXT DEFAULT 'manual_enrichment',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidate_profiles_candidate_id
    ON candidate_profiles(candidate_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_candidate_profiles_source_label
    ON candidate_profiles(source_label);
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION set_candidate_profiles_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_candidate_profiles_updated_at
    ON candidate_profiles;
  `);

  await pool.query(`
    CREATE TRIGGER trg_candidate_profiles_updated_at
    BEFORE UPDATE ON candidate_profiles
    FOR EACH ROW
    EXECUTE FUNCTION set_candidate_profiles_updated_at();
  `);
}

export async function down(pool) {
  await pool.query(`
    DROP TRIGGER IF EXISTS trg_candidate_profiles_updated_at
    ON candidate_profiles;
  `);

  await pool.query(`
    DROP FUNCTION IF EXISTS set_candidate_profiles_updated_at;
  `);

  await pool.query(`
    DROP TABLE IF EXISTS candidate_profiles;
  `);
}
