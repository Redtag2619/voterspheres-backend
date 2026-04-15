import db from "../config/database.js";

function normalizeCandidateRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    full_name: row.full_name,
    office: row.office,
    state: row.state_code || row.state || null,
    district: row.district,
    party: row.party,
    incumbent: row.incumbent,
    election_year: row.election_year,
    election_type: row.election_type,
    campaign_status: row.campaign_status,
    website: row.website,
    photo_url: row.photo_url,
    bio: row.bio,
    contact: {
      campaign_email: row.contact_email,
      press_email: row.press_email,
      phone: row.phone,
      address: {
        line1: row.address_line1,
        line2: row.address_line2,
        city: row.city,
        state_code: row.state_code,
        postal_code: row.postal_code,
      },
      social: {
        facebook: row.facebook_url,
        x: row.x_url,
        instagram: row.instagram_url,
        youtube: row.youtube_url,
        linkedin: row.linkedin_url,
      },
      source: row.contact_source,
      verified: row.contact_verified,
      last_updated: row.last_contact_update,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildListWhereClause(filters = {}) {
  const clauses = [];
  const values = [];
  let index = 1;

  if (filters.state) {
    clauses.push(`UPPER(COALESCE(state_code, state)) = UPPER($${index++})`);
    values.push(filters.state);
  }

  if (filters.office) {
    clauses.push(`LOWER(COALESCE(office, '')) LIKE LOWER($${index++})`);
    values.push(`%${filters.office}%`);
  }

  if (filters.party) {
    clauses.push(`LOWER(COALESCE(party, '')) = LOWER($${index++})`);
    values.push(filters.party);
  }

  if (filters.election_year) {
    clauses.push(`election_year = $${index++}`);
    values.push(Number(filters.election_year));
  }

  if (filters.search) {
    clauses.push(`(
      LOWER(COALESCE(full_name, name, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(office, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(district, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(state_code, state, '')) LIKE LOWER($${index})
      OR LOWER(COALESCE(party, '')) LIKE LOWER($${index})
    )`);
    values.push(`%${filters.search}%`);
    index++;
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { whereClause, values };
}

export async function getCandidates(filters = {}) {
  const { whereClause, values } = buildListWhereClause(filters);

  const query = `
    SELECT
      id,
      slug,
      COALESCE(full_name, name) AS full_name,
      office,
      district,
      party,
      incumbent,
      election_year,
      election_type,
      campaign_status,
      website,
      photo_url,
      bio,
      contact_email,
      press_email,
      phone,
      address_line1,
      address_line2,
      city,
      state_code,
      postal_code,
      facebook_url,
      x_url,
      instagram_url,
      youtube_url,
      linkedin_url,
      contact_source,
      contact_verified,
      last_contact_update,
      created_at,
      updated_at,
      state
    FROM candidates
    ${whereClause}
    ORDER BY
      election_year DESC NULLS LAST,
      state_code ASC NULLS LAST,
      office ASC NULLS LAST,
      COALESCE(full_name, name) ASC
    LIMIT 500
  `;

  const result = await db.query(query, values);
  return result.rows.map(normalizeCandidateRow);
}

export async function getCandidateBySlug(slug) {
  const query = `
    SELECT
      id,
      slug,
      COALESCE(full_name, name) AS full_name,
      office,
      district,
      party,
      incumbent,
      election_year,
      election_type,
      campaign_status,
      website,
      photo_url,
      bio,
      contact_email,
      press_email,
      phone,
      address_line1,
      address_line2,
      city,
      state_code,
      postal_code,
      facebook_url,
      x_url,
      instagram_url,
      youtube_url,
      linkedin_url,
      contact_source,
      contact_verified,
      last_contact_update,
      created_at,
      updated_at,
      state
    FROM candidates
    WHERE slug = $1
    LIMIT 1
  `;

  const result = await db.query(query, [slug]);

  if (!result.rows.length) {
    return null;
  }

  return normalizeCandidateRow(result.rows[0]);
}

export async function updateCandidateContact(candidateId, payload) {
  const query = `
    UPDATE candidates
    SET
      contact_email = COALESCE($2, contact_email),
      press_email = COALESCE($3, press_email),
      phone = COALESCE($4, phone),
      address_line1 = COALESCE($5, address_line1),
      address_line2 = COALESCE($6, address_line2),
      city = COALESCE($7, city),
      state_code = COALESCE($8, state_code),
      postal_code = COALESCE($9, postal_code),
      facebook_url = COALESCE($10, facebook_url),
      x_url = COALESCE($11, x_url),
      instagram_url = COALESCE($12, instagram_url),
      youtube_url = COALESCE($13, youtube_url),
      linkedin_url = COALESCE($14, linkedin_url),
      contact_source = COALESCE($15, contact_source),
      contact_verified = COALESCE($16, contact_verified),
      last_contact_update = NOW(),
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id,
      slug,
      COALESCE(full_name, name) AS full_name,
      office,
      district,
      party,
      incumbent,
      election_year,
      election_type,
      campaign_status,
      website,
      photo_url,
      bio,
      contact_email,
      press_email,
      phone,
      address_line1,
      address_line2,
      city,
      state_code,
      postal_code,
      facebook_url,
      x_url,
      instagram_url,
      youtube_url,
      linkedin_url,
      contact_source,
      contact_verified,
      last_contact_update,
      created_at,
      updated_at,
      state
  `;

  const values = [
    candidateId,
    payload.contact_email ?? null,
    payload.press_email ?? null,
    payload.phone ?? null,
    payload.address_line1 ?? null,
    payload.address_line2 ?? null,
    payload.city ?? null,
    payload.state_code ?? null,
    payload.postal_code ?? null,
    payload.facebook_url ?? null,
    payload.x_url ?? null,
    payload.instagram_url ?? null,
    payload.youtube_url ?? null,
    payload.linkedin_url ?? null,
    payload.contact_source ?? null,
    typeof payload.contact_verified === "boolean" ? payload.contact_verified : null,
  ];

  const result = await db.query(query, values);

  if (!result.rows.length) {
    return null;
  }

  return normalizeCandidateRow(result.rows[0]);
}
