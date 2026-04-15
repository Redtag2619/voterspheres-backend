import pool from "../config/database.js";

function clean(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function safeWebsite(value) {
  const website = clean(value);
  if (!website) return null;
  if (website.startsWith("http://") || website.startsWith("https://")) return website;
  return `https://${website}`;
}

function buildSeedProfile(candidate, existing = {}) {
  const website = safeWebsite(candidate?.website);

  return {
    campaign_website: firstNonEmpty(existing.campaign_website, website),
    official_website: firstNonEmpty(existing.official_website, null),
    office_address: firstNonEmpty(existing.office_address, null),
    campaign_address: firstNonEmpty(existing.campaign_address, null),
    phone: firstNonEmpty(existing.phone, null),
    email: firstNonEmpty(existing.email, null),
    chief_of_staff_name: firstNonEmpty(existing.chief_of_staff_name, null),
    campaign_manager_name: firstNonEmpty(existing.campaign_manager_name, null),
    finance_director_name: firstNonEmpty(existing.finance_director_name, null),
    political_director_name: firstNonEmpty(existing.political_director_name, null),
    press_contact_name: firstNonEmpty(existing.press_contact_name, null),
    press_contact_email: firstNonEmpty(existing.press_contact_email, null),
    source_label: firstNonEmpty(
      existing.source_label,
      website ? "candidate_record_seed" : "candidate_record_unseeded"
    )
  };
}

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
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function enrichCandidateProfile(candidateId) {
  await ensureCandidateProfilesTable();

  const candidateResult = await pool.query(
    `
      SELECT
        id,
        full_name,
        first_name,
        last_name,
        state,
        office,
        party,
        incumbent,
        website,
        status,
        election_name
      FROM candidates
      WHERE id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  const candidate = candidateResult.rows[0] || null;

  if (!candidate) {
    return null;
  }

  const existingProfileResult = await pool.query(
    `
      SELECT
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
        updated_at,
        created_at
      FROM candidate_profiles
      WHERE candidate_id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  const existing = existingProfileResult.rows[0] || {};
  const merged = buildSeedProfile(candidate, existing);

  const upsertResult = await pool.query(
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
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()
      )
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
        source_label = EXCLUDED.source_label,
        updated_at = NOW()
      RETURNING
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
        updated_at,
        created_at
    `,
    [
      candidateId,
      merged.campaign_website,
      merged.official_website,
      merged.office_address,
      merged.campaign_address,
      merged.phone,
      merged.email,
      merged.chief_of_staff_name,
      merged.campaign_manager_name,
      merged.finance_director_name,
      merged.political_director_name,
      merged.press_contact_name,
      merged.press_contact_email,
      merged.source_label
    ]
  );

  return {
    candidate,
    profile: upsertResult.rows[0] || null
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

  const rows = result.rows || [];
  const candidate_ids = [];

  for (const row of rows) {
    const item = await enrichCandidateProfile(row.id);
    if (item?.candidate?.id) {
      candidate_ids.push(item.candidate.id);
    }
  }

  return {
    refreshed: candidate_ids.length,
    candidate_ids
  };
}
