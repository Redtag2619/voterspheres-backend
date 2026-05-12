import pool from "../config/database.js";

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || "";

function clean(value) {
  if (value === undefined || value === null) return null;

  const next = String(value).trim();

  return next || null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeEmail(value) {
  const next = clean(value);
  return next ? next.toLowerCase() : null;
}

function normalizePhone(value) {
  return clean(value);
}

async function ensureCandidateProfilesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,

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

      facebook_url TEXT,
      x_url TEXT,
      instagram_url TEXT,
      youtube_url TEXT,
      linkedin_url TEXT,
      tiktok_url TEXT,

      contact_source_url TEXT,
      source_label TEXT DEFAULT 'campaign_site_live',

      admin_locked BOOLEAN DEFAULT false,
      locked_fields JSONB DEFAULT '{}'::jsonb,

      contact_confidence NUMERIC DEFAULT 0,

      scraped_pages JSONB DEFAULT '[]'::jsonb,

      is_verified BOOLEAN DEFAULT false,
      verified_by TEXT,
      verified_at TIMESTAMP,

      internal_notes TEXT,

      last_scraped_at TIMESTAMP,

      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

function extractEmails(html = "") {
  const matches = [
    ...html.matchAll(
      /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})\b/g
    ),
  ];

  return unique(
    matches.map((m) => normalizeEmail(m[1]))
  );
}

function extractPhones(text = "") {
  const matches = [
    ...text.matchAll(
      /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g
    ),
  ];

  return unique(
    matches.map((m) => normalizePhone(m[0]))
  );
}

function extractSocialLinks(html = "") {
  const socials = {
    facebook_url: null,
    x_url: null,
    instagram_url: null,
    youtube_url: null,
    linkedin_url: null,
    tiktok_url: null,
  };

  const links = [
    ...html.matchAll(/href=["']([^"']+)["']/gi),
  ].map((m) => m[1]);

  for (const link of links) {
    if (!socials.facebook_url && link.includes("facebook.com")) {
      socials.facebook_url = link;
    }

    if (
      !socials.x_url &&
      (link.includes("x.com") || link.includes("twitter.com"))
    ) {
      socials.x_url = link;
    }

    if (!socials.instagram_url && link.includes("instagram.com")) {
      socials.instagram_url = link;
    }

    if (
      !socials.youtube_url &&
      (link.includes("youtube.com") || link.includes("youtu.be"))
    ) {
      socials.youtube_url = link;
    }

    if (!socials.linkedin_url && link.includes("linkedin.com")) {
      socials.linkedin_url = link;
    }

    if (!socials.tiktok_url && link.includes("tiktok.com")) {
      socials.tiktok_url = link;
    }
  }

  return socials;
}

async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; VoterSpheresBot/1.0)",
      },
    });

    if (!response.ok) return null;

    return await response.text();
  } catch {
    return null;
  }
}

async function discoverWebsite(candidate) {
  if (candidate.website) {
    return candidate.website;
  }

  const query = encodeURIComponent(
    `${candidate.full_name} ${candidate.office || ""} campaign`
  );

  if (BRAVE_SEARCH_API_KEY) {
    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${query}`,
        {
          headers: {
            "X-Subscription-Token": BRAVE_SEARCH_API_KEY,
          },
        }
      );

      const data = await response.json();

      const result = data?.web?.results?.[0];

      if (result?.url) {
        return result.url;
      }
    } catch {}
  }

  if (SERPAPI_API_KEY) {
    try {
      const response = await fetch(
        `https://serpapi.com/search.json?q=${query}&api_key=${SERPAPI_API_KEY}`
      );

      const data = await response.json();

      const result = data?.organic_results?.[0];

      if (result?.link) {
        return result.link;
      }
    } catch {}
  }

  return null;
}

function calculateConfidence(profile) {
  let score = 0;

  if (profile.email) score += 0.2;
  if (profile.phone) score += 0.2;
  if (profile.campaign_website) score += 0.15;
  if (profile.office_address) score += 0.15;

  if (profile.facebook_url) score += 0.05;
  if (profile.x_url) score += 0.05;
  if (profile.instagram_url) score += 0.05;
  if (profile.youtube_url) score += 0.05;
  if (profile.linkedin_url) score += 0.05;
  if (profile.tiktok_url) score += 0.05;

  return Math.min(1, Number(score.toFixed(2)));
}

export async function enrichCandidateProfile(candidateId) {
  await ensureCandidateProfilesTable();

  const candidateResult = await pool.query(
    `
      SELECT *
      FROM candidates
      WHERE id = $1
      LIMIT 1
    `,
    [candidateId]
  );

  const candidate = candidateResult.rows[0];

  if (!candidate) return null;

  const website = await discoverWebsite(candidate);

  let html = "";

  if (website) {
    html = (await fetchHtml(website)) || "";
  }

  const emails = extractEmails(html);
  const phones = extractPhones(html);

  const socials = extractSocialLinks(html);

  const officeAddress =
    [
      candidate.address_line1,
      candidate.address_line2,
      candidate.city,
      candidate.state,
      candidate.postal_code,
    ]
      .filter(Boolean)
      .join(", ") || null;

  const profile = {
    campaign_website: website,
    official_website: null,

    office_address: officeAddress,
    campaign_address: officeAddress,

    phone: phones[0] || candidate.phone || null,

    email:
      emails[0] ||
      candidate.contact_email ||
      candidate.press_email ||
      null,

    chief_of_staff_name: null,
    campaign_manager_name: null,
    finance_director_name: null,
    political_director_name: null,
    press_contact_name: null,

    press_contact_email: null,

    ...socials,

    contact_source_url: website,
    source_label: "campaign_site_live",

    scraped_pages: JSON.stringify([
      {
        url: website,
        emails,
        phones,
      },
    ]),

    last_scraped_at: new Date(),
  };

  profile.contact_confidence = calculateConfidence(profile);

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
        facebook_url,
        x_url,
        instagram_url,
        youtube_url,
        linkedin_url,
        tiktok_url,
        contact_source_url,
        source_label,
        contact_confidence,
        scraped_pages,
        last_scraped_at,
        updated_at,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,NOW(),NOW(),NOW()
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
        facebook_url = EXCLUDED.facebook_url,
        x_url = EXCLUDED.x_url,
        instagram_url = EXCLUDED.instagram_url,
        youtube_url = EXCLUDED.youtube_url,
        linkedin_url = EXCLUDED.linkedin_url,
        tiktok_url = EXCLUDED.tiktok_url,
        contact_source_url = EXCLUDED.contact_source_url,
        source_label = EXCLUDED.source_label,
        contact_confidence = EXCLUDED.contact_confidence,
        scraped_pages = EXCLUDED.scraped_pages,
        last_scraped_at = NOW(),
        updated_at = NOW()
      RETURNING *
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
      profile.facebook_url,
      profile.x_url,
      profile.instagram_url,
      profile.youtube_url,
      profile.linkedin_url,
      profile.tiktok_url,
      profile.contact_source_url,
      profile.source_label,
      profile.contact_confidence,
      profile.scraped_pages,
    ]
  );

  return {
    candidate,
    profile: result.rows[0],
  };
}

export async function enrichAllCandidateProfiles(limit = 100) {
  await ensureCandidateProfilesTable();

  const result = await pool.query(
    `
      SELECT id
      FROM candidates
      ORDER BY id ASC
      LIMIT $1
    `,
    [limit]
  );

  const refreshed = [];

  for (const row of result.rows) {
    try {
      const enriched = await enrichCandidateProfile(row.id);

      if (enriched?.candidate?.id) {
        refreshed.push(enriched.candidate.id);
      }
    } catch (error) {
      console.error(
        "Candidate enrichment failed:",
        row.id,
        error.message
      );
    }
  }

  return {
    refreshed: refreshed.length,
    candidate_ids: refreshed,
  };
}

export async function getCandidateContactCoverage() {
  await ensureCandidateProfilesTable();

  const result = await pool.query(`
    SELECT
      COUNT(*)::int AS total,

      COUNT(*) FILTER (
        WHERE COALESCE(email, '') <> ''
      )::int AS with_email,

      COUNT(*) FILTER (
        WHERE COALESCE(phone, '') <> ''
      )::int AS with_phone,

      COUNT(*) FILTER (
        WHERE COALESCE(campaign_website, '') <> ''
      )::int AS with_website,

      COUNT(*) FILTER (
        WHERE COALESCE(
          facebook_url,
          x_url,
          instagram_url,
          youtube_url,
          linkedin_url,
          tiktok_url,
          ''
        ) <> ''
      )::int AS with_social
    FROM candidate_profiles
  `);

 export async function updateCandidateProfileLocks(candidateId, payload = {}) {
  await ensureCandidateProfilesTable();

  const candidateCheck = await pool.query(
    `SELECT id FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );

  if (!candidateCheck.rows.length) return null;

  const result = await pool.query(
    `
      INSERT INTO candidate_profiles (
        candidate_id,
        admin_locked,
        locked_fields,
        updated_at,
        created_at
      )
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (candidate_id)
      DO UPDATE SET
        admin_locked = EXCLUDED.admin_locked,
        locked_fields = EXCLUDED.locked_fields,
        updated_at = NOW()
      RETURNING *
    `,
    [
      candidateId,
      Boolean(payload.admin_locked),
      JSON.stringify(payload.locked_fields || {}),
    ]
  );

  return result.rows[0] || null;
}

export async function updateCandidateProfileManual(
  candidateId,
  payload = {},
  options = {}
) {
  await ensureCandidateProfilesTable();

  const candidateCheck = await pool.query(
    `SELECT id FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );

  if (!candidateCheck.rows.length) return null;

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
        press_contact_email,
        facebook_url,
        x_url,
        instagram_url,
        youtube_url,
        linkedin_url,
        tiktok_url,
        source_label,
        admin_locked,
        locked_fields,
        updated_at,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,'manual_edit',$15,$16,NOW(),NOW()
      )
      ON CONFLICT (candidate_id)
      DO UPDATE SET
        campaign_website = COALESCE(EXCLUDED.campaign_website, candidate_profiles.campaign_website),
        official_website = COALESCE(EXCLUDED.official_website, candidate_profiles.official_website),
        office_address = COALESCE(EXCLUDED.office_address, candidate_profiles.office_address),
        campaign_address = COALESCE(EXCLUDED.campaign_address, candidate_profiles.campaign_address),
        phone = COALESCE(EXCLUDED.phone, candidate_profiles.phone),
        email = COALESCE(EXCLUDED.email, candidate_profiles.email),
        press_contact_email = COALESCE(EXCLUDED.press_contact_email, candidate_profiles.press_contact_email),
        facebook_url = COALESCE(EXCLUDED.facebook_url, candidate_profiles.facebook_url),
        x_url = COALESCE(EXCLUDED.x_url, candidate_profiles.x_url),
        instagram_url = COALESCE(EXCLUDED.instagram_url, candidate_profiles.instagram_url),
        youtube_url = COALESCE(EXCLUDED.youtube_url, candidate_profiles.youtube_url),
        linkedin_url = COALESCE(EXCLUDED.linkedin_url, candidate_profiles.linkedin_url),
        tiktok_url = COALESCE(EXCLUDED.tiktok_url, candidate_profiles.tiktok_url),
        source_label = 'manual_edit',
        admin_locked = EXCLUDED.admin_locked,
        locked_fields = EXCLUDED.locked_fields,
        updated_at = NOW()
      RETURNING *
    `,
    [
      candidateId,
      payload.campaign_website || null,
      payload.official_website || null,
      payload.office_address || null,
      payload.campaign_address || null,
      payload.phone || null,
      payload.email || null,
      payload.press_contact_email || null,
      payload.facebook_url || null,
      payload.x_url || null,
      payload.instagram_url || null,
      payload.youtube_url || null,
      payload.linkedin_url || null,
      payload.tiktok_url || null,
      Boolean(options.lock_edited_fields || payload.admin_locked),
      JSON.stringify(
        options.lock_edited_fields
          ? {
              campaign_website: true,
              official_website: true,
              office_address: true,
              campaign_address: true,
              phone: true,
              email: true,
              press_contact_email: true,
              facebook_url: true,
              x_url: true,
              instagram_url: true,
              youtube_url: true,
              linkedin_url: true,
              tiktok_url: true,
            }
          : payload.locked_fields || {}
      ),
    ]
  );

  return {
    profile: result.rows[0] || null,
  };
}

export async function updateCandidateVerification(candidateId, payload = {}) {
  await ensureCandidateProfilesTable();

  const candidateCheck = await pool.query(
    `SELECT id FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );

  if (!candidateCheck.rows.length) return null;

  const isVerified = Boolean(payload.is_verified);

  const result = await pool.query(
    `
      INSERT INTO candidate_profiles (
        candidate_id,
        is_verified,
        verified_by,
        verified_at,
        internal_notes,
        updated_at,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        CASE WHEN $2 = true THEN NOW() ELSE NULL END,
        $4,
        NOW(),
        NOW()
      )
      ON CONFLICT (candidate_id)
      DO UPDATE SET
        is_verified = EXCLUDED.is_verified,
        verified_by = EXCLUDED.verified_by,
        verified_at = EXCLUDED.verified_at,
        internal_notes = EXCLUDED.internal_notes,
        updated_at = NOW()
      RETURNING *
    `,
    [
      candidateId,
      isVerified,
      payload.verified_by || null,
      payload.internal_notes || null,
    ]
  );

  return {
    profile: result.rows[0] || null,
  };
}
