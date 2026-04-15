import { pool } from "../db/pool.js";

function mapProfilePayload(payload = {}) {
  return {
    campaign_website: String(payload.campaign_website || "").trim() || null,
    official_website: String(payload.official_website || "").trim() || null,
    office_address: String(payload.office_address || "").trim() || null,
    campaign_address: String(payload.campaign_address || "").trim() || null,
    phone: String(payload.phone || "").trim() || null,
    email: String(payload.email || "").trim() || null,
    chief_of_staff_name: String(payload.chief_of_staff_name || "").trim() || null,
    campaign_manager_name: String(payload.campaign_manager_name || "").trim() || null,
    finance_director_name: String(payload.finance_director_name || "").trim() || null,
    political_director_name: String(payload.political_director_name || "").trim() || null,
    press_contact_name: String(payload.press_contact_name || "").trim() || null,
    press_contact_email: String(payload.press_contact_email || "").trim() || null,
    source_label: String(payload.source_label || "").trim() || "manual_enrichment",
    notes: String(payload.notes || "").trim() || null
  };
}

export async function findCandidateProfileByCandidateId(candidateId) {
  const result = await pool.query(
    `
      SELECT
        id,
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
        notes,
        created_at,
        updated_at
      FROM candidate_profiles
      WHERE candidate_id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  return result.rows?.[0] || null;
}

export async function upsertCandidateProfile(candidateId, payload) {
  const profile = mapProfilePayload(payload);

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
        notes
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
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
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING
        id,
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
        notes,
        created_at,
        updated_at
    `,
    [
      candidateId,
      profile.campaign_website,
      profile.official_website,
      profile.office_address,
      profile.campaign_address,
      profile.phone,
      profile.email,
      profile.chief_of_staff_name,
      profile.campaign_manager_name,
      profile.finance_director_name,
      profile.political_director_name,
      profile.press_contact_name,
      profile.press_contact_email,
      profile.source_label,
      profile.notes
    ]
  );

  return result.rows?.[0] || null;
}

export async function deleteCandidateProfile(candidateId) {
  const result = await pool.query(
    `
      DELETE FROM candidate_profiles
      WHERE candidate_id = $1
      RETURNING id, candidate_id
    `,
    [candidateId]
  );

  return result.rows?.[0] || null;
}

export async function findCandidateAdminDirectory({ q = "", page = 1, limit = 25 }) {
  const safePage = Number(page) > 0 ? Number(page) : 1;
  const safeLimit = Number(limit) > 0 ? Math.min(Number(limit), 100) : 25;
  const offset = (safePage - 1) * safeLimit;
  const query = String(q || "").trim();

  const rowsResult = await pool.query(
    `
      SELECT
        c.id,
        c.full_name,
        c.first_name,
        c.last_name,
        c.state,
        c.office,
        c.party,
        c.website,
        c.election_name,
        c.status,
        COALESCE(c.incumbent, false) AS incumbent,
        cp.updated_at AS profile_updated_at,
        CASE WHEN cp.id IS NULL THEN false ELSE true END AS has_profile
      FROM candidates c
      LEFT JOIN candidate_profiles cp
        ON cp.candidate_id = c.id
      WHERE (
        $1 = ''
        OR COALESCE(c.full_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.first_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.last_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.state, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.office, '') ILIKE '%' || $1 || '%'
      )
      ORDER BY COALESCE(c.last_name, c.full_name, 'zzz') ASC
      LIMIT $2 OFFSET $3
    `,
    [query, safeLimit, offset]
  );

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM candidates c
      WHERE (
        $1 = ''
        OR COALESCE(c.full_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.first_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.last_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.state, '') ILIKE '%' || $1 || '%'
        OR COALESCE(c.office, '') ILIKE '%' || $1 || '%'
      )
    `,
    [query]
  );

  return {
    total: Number(countResult.rows?.[0]?.total || 0),
    results: rowsResult.rows || [],
    page: safePage,
    limit: safeLimit
  };
}
