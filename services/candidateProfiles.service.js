import pool from "../config/database.js";

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || "";

const BAD_DOMAINS = [
  "example.com",
  "fec.gov",
  "ballotpedia.org",
  "wikipedia.org",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "linkedin.com",
  "opensecrets.org",
  "votesmart.org",
];

function clean(value) {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next || null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function safeUrl(value) {
  const next = clean(value);
  if (!next) return null;
  if (next.startsWith("http://") || next.startsWith("https://")) return next;
  return `https://${next}`;
}

function normalizeEmail(value) {
  const next = clean(value);
  return next ? next.toLowerCase() : null;
}

function normalizePhone(value) {
  return clean(value);
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isBadDiscoveryUrl(url) {
  const domain = domainOf(url);
  if (!domain) return true;
  return BAD_DOMAINS.some((bad) => domain === bad || domain.endsWith(`.${bad}`));
}

function isLikelyCampaignUrl(url = "") {
  const lower = String(url).toLowerCase();

  if (isBadDiscoveryUrl(lower)) return false;

  return (
    lower.includes("for") ||
    lower.includes("campaign") ||
    lower.includes("vote") ||
    lower.includes("elect") ||
    lower.includes("committee") ||
    lower.includes("senate") ||
    lower.includes("congress") ||
    lower.includes("house") ||
    lower.includes("mayor") ||
    lower.includes("governor") ||
    lower.includes("sheriff") ||
    lower.includes("judge")
  );
}

async function ensureCandidateProfilesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE candidate_profiles
      ADD COLUMN IF NOT EXISTS campaign_website TEXT,
      ADD COLUMN IF NOT EXISTS official_website TEXT,
      ADD COLUMN IF NOT EXISTS office_address TEXT,
      ADD COLUMN IF NOT EXISTS campaign_address TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS chief_of_staff_name TEXT,
      ADD COLUMN IF NOT EXISTS campaign_manager_name TEXT,
      ADD COLUMN IF NOT EXISTS finance_director_name TEXT,
      ADD COLUMN IF NOT EXISTS political_director_name TEXT,
      ADD COLUMN IF NOT EXISTS press_contact_name TEXT,
      ADD COLUMN IF NOT EXISTS press_contact_email TEXT,
      ADD COLUMN IF NOT EXISTS facebook_url TEXT,
      ADD COLUMN IF NOT EXISTS x_url TEXT,
      ADD COLUMN IF NOT EXISTS instagram_url TEXT,
      ADD COLUMN IF NOT EXISTS youtube_url TEXT,
      ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
      ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
      ADD COLUMN IF NOT EXISTS contact_source_url TEXT,
      ADD COLUMN IF NOT EXISTS source_label TEXT DEFAULT 'campaign_site_live',
      ADD COLUMN IF NOT EXISTS admin_locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS locked_fields JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS contact_confidence NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS scraped_pages JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS verified_by TEXT,
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS internal_notes TEXT,
      ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP
  `);
}

function extractEmails(html = "") {
  const matches = [
    ...String(html).matchAll(
      /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})\b/g
    ),
  ];

  return unique(matches.map((m) => normalizeEmail(m[1]))).filter((email) => {
    if (!email) return false;
    return !email.includes("example.com");
  });
}

function extractPhones(text = "") {
  const matches = [
    ...String(text).matchAll(
      /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g
    ),
  ];

  return unique(matches.map((m) => normalizePhone(m[0])));
}

function absolutizeUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractLinks(html = "", baseUrl = "") {
  const links = [...String(html).matchAll(/href=["']([^"']+)["']/gi)].map((m) =>
    absolutizeUrl(baseUrl, m[1])
  );

  return unique(links).filter(Boolean);
}

function extractSocialLinks(html = "", baseUrl = "") {
  const socials = {
    facebook_url: null,
    x_url: null,
    instagram_url: null,
    youtube_url: null,
    linkedin_url: null,
    tiktok_url: null,
  };

  const links = extractLinks(html, baseUrl);

  for (const link of links) {
    const lower = link.toLowerCase();

    if (!socials.facebook_url && lower.includes("facebook.com")) {
      socials.facebook_url = link;
    }

    if (
      !socials.x_url &&
      (lower.includes("x.com") || lower.includes("twitter.com"))
    ) {
      socials.x_url = link;
    }

    if (!socials.instagram_url && lower.includes("instagram.com")) {
      socials.instagram_url = link;
    }

    if (
      !socials.youtube_url &&
      (lower.includes("youtube.com") || lower.includes("youtu.be"))
    ) {
      socials.youtube_url = link;
    }

    if (!socials.linkedin_url && lower.includes("linkedin.com")) {
      socials.linkedin_url = link;
    }

    if (!socials.tiktok_url && lower.includes("tiktok.com")) {
      socials.tiktok_url = link;
    }
  }

  return socials;
}

function pickImportantInternalPages(html = "", baseUrl = "", maxPages = 6) {
  const keywords = [
    "contact",
    "about",
    "team",
    "staff",
    "press",
    "media",
    "connect",
    "volunteer",
    "donate",
  ];

  return extractLinks(html, baseUrl)
    .filter((link) => {
      try {
        const base = new URL(baseUrl);
        const next = new URL(link);
        if (base.hostname !== next.hostname) return false;
        const lower = next.pathname.toLowerCase();
        return keywords.some((keyword) => lower.includes(keyword));
      } catch {
        return false;
      }
    })
    .slice(0, maxPages);
}

async function fetchHtml(url) {
  const nextUrl = safeUrl(url);
  if (!nextUrl) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(nextUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VoterSpheresBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function buildSearchQueries(candidate) {
  const name = candidate.full_name || candidate.name || "";
  const state = candidate.state || candidate.state_code || "";
  const office = candidate.office || "";
  const district = candidate.district || "";

  return unique([
    `${name} ${state} ${office} campaign website`,
    `${name} ${office} ${state} official campaign`,
    `${name} for ${office} ${state}`,
    `${name} campaign contact`,
    district ? `${name} ${state} district ${district} campaign` : null,
  ]);
}

async function braveSearch(query) {
  if (!BRAVE_SEARCH_API_KEY) return [];

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
      {
        headers: {
          "X-Subscription-Token": BRAVE_SEARCH_API_KEY,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) return [];

    const data = await response.json();

    return (data?.web?.results || [])
      .map((item) => ({
        url: item.url,
        title: item.title,
        description: item.description,
        source: "brave",
        query,
      }))
      .filter((item) => item.url);
  } catch {
    return [];
  }
}

async function serpSearch(query) {
  if (!SERPAPI_API_KEY) return [];

  try {
    const response = await fetch(
      `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERPAPI_API_KEY}`
    );

    if (!response.ok) return [];

    const data = await response.json();

    return (data?.organic_results || [])
      .map((item) => ({
        url: item.link,
        title: item.title,
        description: item.snippet,
        source: "serpapi",
        query,
      }))
      .filter((item) => item.url);
  } catch {
    return [];
  }
}

function scoreSearchResult(item, candidate) {
  const url = safeUrl(item.url);
  if (!url) return -100;

  const lower = `${url} ${item.title || ""} ${item.description || ""}`.toLowerCase();
  const name = String(candidate.full_name || candidate.name || "").toLowerCase();
  const lastName = name.split(/\s+/).filter(Boolean).at(-1) || "";

  let score = 0;

  if (isBadDiscoveryUrl(url)) score -= 50;
  if (isLikelyCampaignUrl(url)) score += 30;
  if (lastName && lower.includes(lastName)) score += 15;
  if (lower.includes("campaign")) score += 12;
  if (lower.includes("official")) score += 10;
  if (lower.includes("for ")) score += 8;
  if (lower.includes("donate")) score += 5;
  if (lower.includes("contact")) score += 5;
  if (lower.includes("facebook.com") || lower.includes("twitter.com")) score -= 10;
  if (lower.includes("ballotpedia") || lower.includes("wikipedia")) score -= 20;

  return score;
}

async function discoverWebsite(candidate) {
  const direct =
    candidate.website ||
    candidate.campaign_website ||
    candidate.official_website ||
    candidate.url;

  if (direct && !isBadDiscoveryUrl(direct)) {
    return {
      website: safeUrl(direct),
      attempts: [{ type: "direct", url: safeUrl(direct), accepted: true }],
    };
  }

  const attempts = [];
  const queries = buildSearchQueries(candidate);

  for (const query of queries) {
    const results = [
      ...(await braveSearch(query)),
      ...(await serpSearch(query)),
    ];

    const ranked = results
      .map((item) => ({
        ...item,
        url: safeUrl(item.url),
        score: scoreSearchResult(item, candidate),
      }))
      .filter((item) => item.url)
      .sort((a, b) => b.score - a.score);

    attempts.push({
      query,
      results: ranked.slice(0, 5).map((item) => ({
        url: item.url,
        score: item.score,
        title: item.title || null,
        source: item.source,
      })),
    });

    const best = ranked.find((item) => item.score >= 20 && !isBadDiscoveryUrl(item.url));

    if (best?.url) {
      return {
        website: best.url,
        attempts,
      };
    }
  }

  return {
    website: null,
    attempts,
  };
}

function candidateAddress(candidate) {
  return (
    [
      candidate.address_line1,
      candidate.address_line2,
      candidate.city,
      candidate.state || candidate.state_code,
      candidate.postal_code,
    ]
      .filter(Boolean)
      .join(", ") || null
  );
}

function calculateConfidence(profile) {
  let score = 0;

  if (profile.email) score += 0.2;
  if (profile.press_contact_email) score += 0.1;
  if (profile.phone) score += 0.2;
  if (profile.campaign_website) score += 0.15;
  if (profile.office_address || profile.campaign_address) score += 0.15;

  if (profile.facebook_url) score += 0.04;
  if (profile.x_url) score += 0.04;
  if (profile.instagram_url) score += 0.04;
  if (profile.youtube_url) score += 0.03;
  if (profile.linkedin_url) score += 0.03;
  if (profile.tiktok_url) score += 0.02;

  return Math.min(1, Number(score.toFixed(2)));
}

function mergeUnlocked(existing = {}, incoming = {}) {
  const lockedFields = existing.locked_fields || {};
  const adminLocked = Boolean(existing.admin_locked);

  const merged = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "candidate_id") continue;
    if (adminLocked || lockedFields?.[key]) continue;

    const valid =
      value !== undefined &&
      value !== null &&
      !(typeof value === "string" && value.trim() === "");

    if (valid) merged[key] = value;
  }

  return merged;
}

async function getExistingProfile(candidateId) {
  const result = await pool.query(
    `SELECT * FROM candidate_profiles WHERE candidate_id = $1 LIMIT 1`,
    [candidateId]
  );

  return result.rows[0] || {};
}

export async function enrichCandidateProfile(candidateId) {
  await ensureCandidateProfilesTable();

  const candidateResult = await pool.query(
    `SELECT * FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );

  const candidate = candidateResult.rows[0];
  if (!candidate) return null;

  const existing = await getExistingProfile(candidateId);
  const discovery = await discoverWebsite(candidate);
  const website = discovery.website;

  const scrapedPages = [];
  let combinedHtml = "";

  if (website) {
    const homeHtml = (await fetchHtml(website)) || "";
    combinedHtml += homeHtml;

    scrapedPages.push({
      url: website,
      type: "home",
      found: Boolean(homeHtml),
    });

    const extraPages = pickImportantInternalPages(
      homeHtml,
      website,
      Number(process.env.CANDIDATE_ENRICH_MAX_PAGES || 6)
    );

    for (const pageUrl of extraPages) {
      const html = (await fetchHtml(pageUrl)) || "";
      combinedHtml += "\n" + html;

      scrapedPages.push({
        url: pageUrl,
        type: "internal",
        found: Boolean(html),
      });
    }
  }

  const emails = extractEmails(combinedHtml);
  const phones = extractPhones(combinedHtml);
  const socials = extractSocialLinks(combinedHtml, website || "");

  const fallbackAddress = candidateAddress(candidate);

  const incoming = {
    candidate_id: candidateId,
    campaign_website: website || candidate.website || null,
    official_website: null,
    office_address: fallbackAddress,
    campaign_address: fallbackAddress,
    phone: phones[0] || candidate.phone || null,
    email: emails[0] || candidate.contact_email || candidate.press_email || null,
    press_contact_email: emails[1] || candidate.press_email || null,
    chief_of_staff_name: null,
    campaign_manager_name: null,
    finance_director_name: null,
    political_director_name: null,
    press_contact_name: null,
    ...socials,
    contact_source_url: website,
    source_label: website ? "campaign_site_live" : "discovery_failed",
    scraped_pages: [
      ...scrapedPages,
      {
        type: "discovery",
        website,
        brave_enabled: Boolean(BRAVE_SEARCH_API_KEY),
        serpapi_enabled: Boolean(SERPAPI_API_KEY),
        attempts: discovery.attempts || [],
      },
    ],
    last_scraped_at: new Date(),
  };

  const profile = mergeUnlocked(existing, incoming);
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
        admin_locked,
        locked_fields,
        contact_confidence,
        scraped_pages,
        is_verified,
        verified_by,
        verified_at,
        internal_notes,
        last_scraped_at,
        updated_at,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,
        $27,$28,$29,NOW(),NOW(),NOW()
      )
      ON CONFLICT (candidate_id)
      DO UPDATE SET
        campaign_website = COALESCE(EXCLUDED.campaign_website, candidate_profiles.campaign_website),
        official_website = COALESCE(EXCLUDED.official_website, candidate_profiles.official_website),
        office_address = COALESCE(EXCLUDED.office_address, candidate_profiles.office_address),
        campaign_address = COALESCE(EXCLUDED.campaign_address, candidate_profiles.campaign_address),
        phone = COALESCE(EXCLUDED.phone, candidate_profiles.phone),
        email = COALESCE(EXCLUDED.email, candidate_profiles.email),
        chief_of_staff_name = COALESCE(EXCLUDED.chief_of_staff_name, candidate_profiles.chief_of_staff_name),
        campaign_manager_name = COALESCE(EXCLUDED.campaign_manager_name, candidate_profiles.campaign_manager_name),
        finance_director_name = COALESCE(EXCLUDED.finance_director_name, candidate_profiles.finance_director_name),
        political_director_name = COALESCE(EXCLUDED.political_director_name, candidate_profiles.political_director_name),
        press_contact_name = COALESCE(EXCLUDED.press_contact_name, candidate_profiles.press_contact_name),
        press_contact_email = COALESCE(EXCLUDED.press_contact_email, candidate_profiles.press_contact_email),
        facebook_url = COALESCE(EXCLUDED.facebook_url, candidate_profiles.facebook_url),
        x_url = COALESCE(EXCLUDED.x_url, candidate_profiles.x_url),
        instagram_url = COALESCE(EXCLUDED.instagram_url, candidate_profiles.instagram_url),
        youtube_url = COALESCE(EXCLUDED.youtube_url, candidate_profiles.youtube_url),
        linkedin_url = COALESCE(EXCLUDED.linkedin_url, candidate_profiles.linkedin_url),
        tiktok_url = COALESCE(EXCLUDED.tiktok_url, candidate_profiles.tiktok_url),
        contact_source_url = COALESCE(EXCLUDED.contact_source_url, candidate_profiles.contact_source_url),
        source_label = COALESCE(EXCLUDED.source_label, candidate_profiles.source_label),
        contact_confidence = GREATEST(COALESCE(EXCLUDED.contact_confidence, 0), COALESCE(candidate_profiles.contact_confidence, 0)),
        scraped_pages = COALESCE(EXCLUDED.scraped_pages, candidate_profiles.scraped_pages),
        last_scraped_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [
      candidateId,
      profile.campaign_website || null,
      profile.official_website || null,
      profile.office_address || null,
      profile.campaign_address || null,
      profile.phone || null,
      profile.email || null,
      profile.chief_of_staff_name || null,
      profile.campaign_manager_name || null,
      profile.finance_director_name || null,
      profile.political_director_name || null,
      profile.press_contact_name || null,
      profile.press_contact_email || null,
      profile.facebook_url || null,
      profile.x_url || null,
      profile.instagram_url || null,
      profile.youtube_url || null,
      profile.linkedin_url || null,
      profile.tiktok_url || null,
      profile.contact_source_url || null,
      profile.source_label || "campaign_site_live",
      Boolean(existing.admin_locked),
      JSON.stringify(existing.locked_fields || {}),
      profile.contact_confidence || 0,
      JSON.stringify(profile.scraped_pages || []),
      Boolean(existing.is_verified),
      existing.verified_by || null,
      existing.verified_at || null,
      existing.internal_notes || null,
    ]
  );

  return {
    candidate,
    profile: result.rows[0],
  };
}

export async function enrichAllCandidateProfiles(limit = 100, options = {}) {
  await ensureCandidateProfilesTable();

  const batchLimit = Math.min(Math.max(Number(limit || 100), 1), 5000);
  const offset = Math.max(Number(options.offset || 0), 0);
  const params = [];
  const where = [];

  if (options.state) {
    params.push(String(options.state));
    where.push(`COALESCE(c.state, c.state_code, '') = $${params.length}`);
  }

  if (options.office) {
    params.push(String(options.office));
    where.push(`COALESCE(c.office, '') = $${params.length}`);
  }

  if (options.onlyMissing !== false) {
    where.push(`
      (
        cp.candidate_id IS NULL
        OR COALESCE(cp.email, c.contact_email, '') = ''
        OR COALESCE(cp.phone, c.phone, '') = ''
        OR COALESCE(cp.campaign_website, c.website, '') = ''
      )
    `);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const queryLimit = options.full ? 5000 : batchLimit;

  params.push(queryLimit);
  const limitParam = params.length;

  params.push(offset);
  const offsetParam = params.length;

  const result = await pool.query(
    `
      SELECT c.id
      FROM candidates c
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      ${whereSql}
      ORDER BY c.id ASC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    params
  );

  const refreshed = [];
  const failed = [];

  for (const row of result.rows) {
    try {
      const enriched = await enrichCandidateProfile(row.id);

      if (enriched?.candidate?.id) {
        refreshed.push(enriched.candidate.id);
      }
    } catch (error) {
      failed.push({
        candidate_id: row.id,
        error: error?.message || "Unknown enrichment error",
      });

      console.error("Candidate enrichment failed:", row.id, error?.message || error);
    }
  }

  return {
    refreshed: refreshed.length,
    failed: failed.length,
    candidate_ids: refreshed,
    failures: failed.slice(0, 25),
    offset,
    limit: queryLimit,
  };
}

export async function getCandidateContactCoverage(filters = {}) {
  await ensureCandidateProfilesTable();

  const params = [];
  const where = [];

  if (filters.state) {
    params.push(String(filters.state));
    where.push(`COALESCE(c.state, c.state_code, '') = $${params.length}`);
  }

  if (filters.office) {
    params.push(String(filters.office));
    where.push(`COALESCE(c.office, '') = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.campaign_website, cp.official_website, c.website, '') <> ''
        )::int AS with_website,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.email, c.contact_email, cp.press_contact_email, c.press_email, '') <> ''
        )::int AS with_email,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.phone, c.phone, '') <> ''
        )::int AS with_phone,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.campaign_address, cp.office_address, c.address_line1, '') <> ''
        )::int AS with_address,
        COUNT(*) FILTER (
          WHERE COALESCE(cp.facebook_url, cp.x_url, cp.instagram_url, cp.youtube_url, cp.linkedin_url, cp.tiktok_url, '') <> ''
        )::int AS with_social,
        COUNT(*) FILTER (
          WHERE cp.is_verified = true OR c.contact_verified = true
        )::int AS verified,
        COUNT(*) FILTER (
          WHERE cp.source_label = 'discovery_failed'
        )::int AS discovery_failed,
        ROUND(AVG(COALESCE(cp.contact_confidence, 0))::numeric, 2) AS avg_confidence
      FROM candidates c
      LEFT JOIN candidate_profiles cp ON cp.candidate_id = c.id
      ${whereSql}
    `,
    params
  );

  return result.rows[0] || {
    total: 0,
    with_website: 0,
    with_email: 0,
    with_phone: 0,
    with_address: 0,
    with_social: 0,
    verified: 0,
    discovery_failed: 0,
    avg_confidence: 0,
  };
}

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
