import pool from "../config/database.js";

async function ensureCandidateProfilesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
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
      admin_locked BOOLEAN DEFAULT false,
      locked_fields JSONB DEFAULT '{}'::jsonb,
      contact_confidence NUMERIC DEFAULT 0,
      scraped_pages JSONB DEFAULT '[]'::jsonb,
      is_verified BOOLEAN DEFAULT false,
      verified_by TEXT,
      verified_at TIMESTAMP,
      internal_notes TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getCandidate(candidateId) {
  const result = await pool.query(
    `
      SELECT
        id,
        full_name,
        full_name AS name,
        state,
        state AS state_code,
        office,
        district,
        party,
        incumbent_status AS incumbent,
        website,
        status AS campaign_status,
        election_year AS election,
        NULL::text AS contact_email,
        NULL::text AS press_email,
        NULL::text AS phone,
        NULL::text AS address_line1,
        NULL::text AS address_line2,
        NULL::text AS city,
        NULL::text AS postal_code,
        source AS contact_source,
        false AS contact_verified,
        updated_at AS last_contact_update
      FROM candidates
      WHERE CAST(id AS TEXT) = $1 OR COALESCE(external_id, '') = $1
      LIMIT 1
    `,
    [String(candidateId)]
  );

  return result.rows[0] || null;
}

export async function enrichCandidateProfile(candidateId) {
  await ensureCandidateProfilesTable();

  const candidate = await getCandidate(candidateId);
  if (!candidate) return null;

  const result = await pool.query(
    `
      INSERT INTO candidate_profiles (
        candidate_id,
        campaign_website,
        official_website,
        phone,
        email,
        source_label,
        contact_confidence,
        scraped_pages,
        updated_at,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      ON CONFLICT (candidate_id)
      DO UPDATE SET
        campaign_website = COALESCE(candidate_profiles.campaign_website, EXCLUDED.campaign_website),
        official_website = COALESCE(candidate_profiles.official_website, EXCLUDED.official_website),
        phone = COALESCE(candidate_profiles.phone, EXCLUDED.phone),
        email = COALESCE(candidate_profiles.email, EXCLUDED.email),
        source_label = EXCLUDED.source_label,
        updated_at = NOW()
      RETURNING *
    `,
    [
      candidate.id,
      candidate.website || null,
      null,
      candidate.phone || null,
      candidate.contact_email || null,
      "candidate_record_fallback",
      candidate.website ? 0.25 : 0,
      JSON.stringify([])
    ]
  );

  return {
    candidate,
    profile: result.rows[0]
  };
}

export async function enrichAllCandidateProfiles(limit = 100) {
  await ensureCandidateProfilesTable();

  const result = await pool.query(
    `
      SELECT id
      FROM candidates
      ORDER BY id DESC
      LIMIT $1
    `,
    [limit]
  );

  const candidate_ids = [];
  const failures = [];

  for (const row of result.rows || []) {
    try {
      const enriched = await enrichCandidateProfile(row.id);
      if (enriched?.candidate?.id) candidate_ids.push(enriched.candidate.id);
    } catch (error) {
      failures.push({ candidate_id: row.id, error: error.message });
    }
  }

  return {
    refreshed: candidate_ids.length,
    candidate_ids,
    failures
  };
}

export async function updateCandidateProfileManual(candidateId, payload = {}) {
  await ensureCandidateProfilesTable();

  const candidate = await getCandidate(candidateId);
  if (!candidate) return null;

  const result = await pool.query(
    `
      INSERT INTO candidate_profiles (
        candidate_id,
        campaign_website,
        official_website,
        office_address,
        campaign_address,
        phone,
        email,
        chief_of_staff_name,
        campaign_manager_name,
        finance_director_name,
        political_director_name,
        press_contact_name,
        press_contact_email,
        source_label,
        contact_confidence,
        updated_at,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual_edit',1,NOW(),NOW())
      ON CONFLICT (candidate_id)
      DO UPDATE SET
        campaign_website = EXCLUDED.campaign_website,
        official_website = EXCLUDED.official_website,
        office_address = EXCLUDED.office_address,
        campaign_address = EXCLUDED.campaign_address,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        chief_of_staff_name = EXCLUDED.chief_of_staff_name,
        campaign_manager_name = EXCLUDED.campaign_manager_name,
        finance_director_name = EXCLUDED.finance_director_name,
        political_director_name = EXCLUDED.political_director_name,
        press_contact_name = EXCLUDED.press_contact_name,
        press_contact_email = EXCLUDED.press_contact_email,
        source_label = 'manual_edit',
        contact_confidence = 1,
        updated_at = NOW()
      RETURNING *
    `,
    [
      candidate.id,
      payload.campaign_website || null,
      payload.official_website || null,
      payload.office_address || null,
      payload.campaign_address || null,
      payload.phone || null,
      payload.email || null,
      payload.chief_of_staff_name || null,
      payload.campaign_manager_name || null,
      payload.finance_director_name || null,
      payload.political_director_name || null,
      payload.press_contact_name || null,
      payload.press_contact_email || null
    ]
  );

  return {
    candidate,
    profile: result.rows[0]
  };
}

export async function updateCandidateProfileLocks(candidateId, payload = {}) {
  await ensureCandidateProfilesTable();

  const result = await pool.query(
    `
      UPDATE candidate_profiles
      SET
        admin_locked = COALESCE($2, admin_locked),
        locked_fields = COALESCE($3::jsonb, locked_fields),
        updated_at = NOW()
      WHERE candidate_id = $1
      RETURNING *
    `,
    [
      candidateId,
      payload.admin_locked ?? null,
      payload.locked_fields ? JSON.stringify(payload.locked_fields) : null
    ]
  );

  return result.rows[0] || null;
}

export async function updateCandidateVerification(candidateId, payload = {}) {
  await ensureCandidateProfilesTable();

  const result = await pool.query(
    `
      UPDATE candidate_profiles
      SET
        is_verified = $2,
        verified_by = $3,
        verified_at = CASE WHEN $2 = true THEN NOW() ELSE NULL END,
        internal_notes = $4,
        updated_at = NOW()
      WHERE candidate_id = $1
      RETURNING *
    `,
    [
      candidateId,
      Boolean(payload.is_verified),
      payload.verified_by || null,
      payload.internal_notes || null
    ]
  );

  return result.rows[0] || null;
}
