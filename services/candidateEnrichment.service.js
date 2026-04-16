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
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE candidate_profiles
    ADD COLUMN IF NOT EXISTS admin_locked BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS locked_fields JSONB DEFAULT '{}'::jsonb
  `);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).replace(/\s+/g, " ").trim();
  return str ? str : null;
}

function parseLockedFields(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isLocked(existing, fieldName) {
  if (existing?.admin_locked) return true;
  const lockedFields = parseLockedFields(existing?.locked_fields);
  return Boolean(lockedFields?.[fieldName]);
}

function preserveLocked(existing, fieldName, incoming, fallback = null) {
  if (isLocked(existing, fieldName)) {
    return clean(existing?.[fieldName]) ?? clean(fallback);
  }
  return clean(incoming) ?? clean(existing?.[fieldName]) ?? clean(fallback);
}

function buildAddress(candidate) {
  return (
    [
      candidate?.address_line1,
      candidate?.address_line2,
      candidate?.city,
      candidate?.state_code,
      candidate?.postal_code
    ]
      .filter(Boolean)
      .join(", ") || null
  );
}

async function getCandidate(candidateId) {
  const result = await pool.query(
    `
      SELECT
        id,
        full_name,
        name,
        state,
        state_code,
        office,
        district,
        party,
        incumbent,
        website,
        campaign_status,
        election,
        contact_email,
        press_email,
        phone,
        address_line1,
        address_line2,
        city,
        postal_code,
        contact_source,
        contact_verified,
        last_contact_update
      FROM candidates
      WHERE id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  return result.rows[0] || null;
}

async function getExistingProfile(candidateId) {
  const result = await pool.query(
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
        admin_locked,
        locked_fields,
        updated_at,
        created_at
      FROM candidate_profiles
      WHERE candidate_id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  return result.rows[0] || {};
}

async function upsertProfile(candidateId, profile) {
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
        admin_locked,
        locked_fields,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()
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
        admin_locked = COALESCE(EXCLUDED.admin_locked, candidate_profiles.admin_locked),
        locked_fields = COALESCE(EXCLUDED.locked_fields, candidate_profiles.locked_fields),
        updated_at = NOW()
      RETURNING *
    `,
    [
      candidateId,
      clean(profile.campaign_website),
      clean(profile.official_website),
      clean(profile.office_address),
      clean(profile.campaign_address),
      clean(profile.phone),
      clean(profile.email),
      clean(profile.chief_of_staff_name),
      clean(profile.campaign_manager_name),
      clean(profile.finance_director_name),
      clean(profile.political_director_name),
      clean(profile.press_contact_name),
      clean(profile.press_contact_email),
      clean(profile.source_label),
      Boolean(profile.admin_locked),
      JSON.stringify(profile.locked_fields || {})
    ]
  );

  return result.rows[0] || null;
}

export async function enrichCandidateProfile(candidateId) {
  await ensureCandidateProfilesTable();

  const candidate = await getCandidate(candidateId);
  if (!candidate) return null;

  const existing = await getExistingProfile(candidateId);
  const fallbackAddress = buildAddress(candidate);

  const merged = {
    campaign_website: preserveLocked(
      existing,
      "campaign_website",
      candidate.website,
      candidate.website
    ),
    official_website: preserveLocked(existing, "official_website", null),
    office_address: preserveLocked(
      existing,
      "office_address",
      fallbackAddress,
      fallbackAddress
    ),
    campaign_address: preserveLocked(
      existing,
      "campaign_address",
      fallbackAddress,
      fallbackAddress
    ),
    phone: preserveLocked(existing, "phone", candidate.phone, candidate.phone),
    email: preserveLocked(existing, "email", candidate.contact_email, candidate.contact_email),
    chief_of_staff_name: preserveLocked(existing, "chief_of_staff_name", null),
    campaign_manager_name: preserveLocked(existing, "campaign_manager_name", null),
    finance_director_name: preserveLocked(existing, "finance_director_name", null),
    political_director_name: preserveLocked(existing, "political_director_name", null),
    press_contact_name: preserveLocked(existing, "press_contact_name", null),
    press_contact_email: preserveLocked(
      existing,
      "press_contact_email",
      candidate.press_email,
      candidate.press_email
    ),
    source_label: clean(existing.source_label) || clean(candidate.contact_source) || "candidate_table",
    admin_locked: Boolean(existing.admin_locked),
    locked_fields: parseLockedFields(existing.locked_fields)
  };

  const profile = await upsertProfile(candidateId, merged);

  return {
    candidate,
    profile
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
      if (enriched?.candidate?.id) {
        candidate_ids.push(enriched.candidate.id);
      }
    } catch (error) {
      failures.push({
        candidate_id: row.id,
        error: error.message
      });
    }
  }

  return {
    refreshed: candidate_ids.length,
    candidate_ids,
    failures
  };
}
