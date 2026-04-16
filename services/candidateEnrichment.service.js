import pool from "../config/database.js";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_FOLLOW_PAGES = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; VoterSpheresBot/1.0; +https://voterspheres.org)";

const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || "";

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
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE candidate_profiles
    ADD COLUMN IF NOT EXISTS admin_locked BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS locked_fields JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS contact_confidence NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS scraped_pages JSONB DEFAULT '[]'::jsonb
  `);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).replace(/\s+/g, " ").trim();
  return str ? str : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeEmail(value) {
  const raw = clean(value);
  return raw ? raw.toLowerCase() : null;
}

function normalizePhone(value) {
  const raw = clean(value);
  return raw ? raw.replace(/\s+/g, " ").trim() : null;
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

function safeWebsite(value) {
  const website = clean(value);
  if (!website) return null;
  if (/^https?:\/\//i.test(website)) return website;
  return `https://${website}`;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function stripTags(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractEmails(html) {
  const mailtoMatches = [
    ...html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/gi)
  ].map((m) => normalizeEmail(m[1]));

  const textMatches = [
    ...html.matchAll(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})\b/gi)
  ].map((m) => normalizeEmail(m[1]));

  return unique([...mailtoMatches, ...textMatches]);
}

function extractPhones(text) {
  const matches = [
    ...text.matchAll(
      /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g
    )
  ].map((m) => normalizePhone(m[0]));

  return unique(matches);
}

function extractAddresses(text) {
  const matches = [
    ...text.matchAll(
      /\b\d{1,6}\s+[A-Za-z0-9.#'\- ]+\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Highway|Hwy|Parkway|Pkwy|Suite|Ste|Unit)\b[\s,.\-A-Za-z0-9#]*?(?:,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/gi
    )
  ].map((m) => clean(m[0]));

  return unique(matches);
}

function extractNamedContact(text, labels = []) {
  for (const label of labels) {
    const re = new RegExp(
      `${label}\\s*[:\\-–]?\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z.'-]+){0,4})`,
      "i"
    );
    const match = text.match(re);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    const href = clean(match[1]);
    const label = clean(stripTags(match[2] || ""));

    if (!href) continue;

    try {
      const url = new URL(href, baseUrl);
      links.push({
        href: url.toString(),
        label: label || ""
      });
    } catch {
      // ignore
    }
  }

  return links;
}

function sameHost(urlA, urlB) {
  try {
    return new URL(urlA).hostname === new URL(urlB).hostname;
  } catch {
    return false;
  }
}

function scorePage(link) {
  const text = `${link.href} ${link.label}`.toLowerCase();
  let score = 0;

  if (text.includes("contact")) score += 7;
  if (text.includes("about")) score += 5;
  if (text.includes("team")) score += 5;
  if (text.includes("staff")) score += 5;
  if (text.includes("press")) score += 6;
  if (text.includes("media")) score += 6;
  if (text.includes("leadership")) score += 4;
  if (text.includes("official")) score += 4;
  if (text.includes("meet")) score += 2;
  if (text.includes("donate")) score -= 8;
  if (text.includes("volunteer")) score -= 4;

  return score;
}

function scoreSearchResult(candidate, url, title = "", description = "") {
  const text = `${url} ${title} ${description}`.toLowerCase();
  const name = String(candidate.full_name || candidate.name || "").toLowerCase();
  const office = String(candidate.office || "").toLowerCase();
  const state = String(candidate.state || candidate.state_code || "").toLowerCase();

  let score = 0;

  if (name && text.includes(name.split(",")[0].trim())) score += 8;
  if (office && text.includes(office)) score += 4;
  if (state && text.includes(state)) score += 4;

  if (text.includes("for congress")) score += 5;
  if (text.includes("for senate")) score += 5;
  if (text.includes("for governor")) score += 5;
  if (text.includes("campaign")) score += 5;
  if (text.includes("official")) score += 4;
  if (text.includes("vote")) score += 3;
  if (text.includes("elect")) score += 3;

  if (/\.gov(\/|$)/i.test(url)) score += 4;
  if (/\.us(\/|$)/i.test(url)) score += 3;

  if (
    text.includes("facebook.com") ||
    text.includes("instagram.com") ||
    text.includes("x.com") ||
    text.includes("twitter.com") ||
    text.includes("linkedin.com") ||
    text.includes("youtube.com") ||
    text.includes("ballotpedia.org") ||
    text.includes("wikipedia.org")
  ) {
    score -= 10;
  }

  return score;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache"
      }
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html")) {
      return null;
    }

    const html = await response.text();
    return {
      url: response.url || url,
      html
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function headCheckUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT
      }
    });

    const finalUrl = response.url || url;
    const host = (() => {
      try {
        return new URL(finalUrl).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();

    if (!response.ok) return null;
    if (
      host.includes("google.") ||
      host.includes("facebook.com") ||
      host.includes("instagram.com") ||
      host.includes("x.com") ||
      host.includes("twitter.com") ||
      host.includes("linkedin.com") ||
      host.includes("youtube.com") ||
      host.includes("ballotpedia.org") ||
      host.includes("wikipedia.org")
    ) {
      return null;
    }

    return finalUrl;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function generateWebsiteGuesses(candidate) {
  const name = clean(candidate.full_name || candidate.name);
  if (!name) return [];

  const compact = slugify(name);
  const firstLast = slugify(
    name
      .split(",")
      .reverse()
      .join(" ")
      .replace(/\b(jr|sr|ii|iii|iv|dr|mr|mrs|ms)\b/gi, "")
  );

  const state = String(candidate.state_code || candidate.state || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  const office = String(candidate.office || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  const guesses = [
    `https://${compact}.com`,
    `https://www.${compact}.com`,
    `https://${firstLast}.com`,
    `https://www.${firstLast}.com`,
    state ? `https://${compact}for${state}.com` : null,
    state ? `https://www.${compact}for${state}.com` : null,
    office ? `https://${compact}for${office}.com` : null,
    office ? `https://www.${compact}for${office}.com` : null,
    state && office ? `https://${compact}for${state}${office}.com` : null,
    state && office ? `https://www.${compact}for${state}${office}.com` : null
  ];

  return unique(guesses.filter(Boolean));
}

function buildDiscoveryQuery(candidate) {
  const name = clean(candidate.full_name || candidate.name) || "";
  const office = clean(candidate.office) || "";
  const state = clean(candidate.state || candidate.state_code) || "";
  return [name, office, state, "campaign website"].filter(Boolean).join(" ");
}

async function braveSearchDiscovery(query) {
  if (!BRAVE_SEARCH_API_KEY) return [];

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "10");
    url.searchParams.set("country", "us");
    url.searchParams.set("search_lang", "en");
    url.searchParams.set("safesearch", "moderate");

    const response = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": BRAVE_SEARCH_API_KEY,
        Accept: "application/json",
        "User-Agent": USER_AGENT
      }
    });

    if (!response.ok) return [];
    const data = await response.json();

    const results = Array.isArray(data?.web?.results) ? data.web.results : [];
    return results.map((item) => ({
      url: clean(item.url),
      title: clean(item.title),
      description: clean(item.description),
      source: "brave_search"
    }));
  } catch {
    return [];
  }
}

async function serpApiDiscovery(query) {
  if (!SERPAPI_API_KEY) return [];

  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", SERPAPI_API_KEY);
    url.searchParams.set("num", "10");
    url.searchParams.set("hl", "en");
    url.searchParams.set("gl", "us");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT
      }
    });

    if (!response.ok) return [];
    const data = await response.json();

    const results = Array.isArray(data?.organic_results) ? data.organic_results : [];
    return results.map((item) => ({
      url: clean(item.link),
      title: clean(item.title),
      description: clean(item.snippet),
      source: "serpapi"
    }));
  } catch {
    return [];
  }
}

async function discoverCandidateWebsite(candidate, existingProfile = {}) {
  const existing = firstNonEmpty(
    existingProfile.campaign_website,
    candidate.website
  );
  if (existing) {
    return {
      website: safeWebsite(existing),
      source: "candidate_record"
    };
  }

  const query = buildDiscoveryQuery(candidate);
  const searchResults = [
    ...(await braveSearchDiscovery(query)),
    ...(await serpApiDiscovery(query))
  ];

  const scored = searchResults
    .filter((item) => item.url)
    .map((item) => ({
      ...item,
      score: scoreSearchResult(candidate, item.url, item.title, item.description)
    }))
    .sort((a, b) => b.score - a.score);

  for (const item of scored) {
    const checked = await headCheckUrl(item.url);
    if (checked) {
      return {
        website: checked,
        source: item.source
      };
    }
  }

  const guesses = generateWebsiteGuesses(candidate);
  for (const guess of guesses) {
    const found = await headCheckUrl(guess);
    if (found) {
      return {
        website: found,
        source: "domain_guess"
      };
    }
  }

  return {
    website: null,
    source: null
  };
}

function pickBestEmail(emails = [], preferred = []) {
  const list = unique(emails.map(normalizeEmail));
  if (!list.length) return null;

  for (const token of preferred) {
    const hit = list.find((email) => email.includes(token));
    if (hit) return hit;
  }

  return (
    list.find(
      (email) =>
        !email.includes("noreply") &&
        !email.includes("no-reply") &&
        !email.includes("donotreply")
    ) || list[0]
  );
}

function inferOfficialWebsite(links = []) {
  const urls = unique(links.map((link) => safeWebsite(link.href)));
  return (
    urls.find((url) => /\.gov(\/|$)/i.test(url)) ||
    urls.find((url) => /\.us(\/|$)/i.test(url)) ||
    urls.find((url) => /official/i.test(url)) ||
    null
  );
}

function extractSignals(html, pageUrl) {
  const text = stripTags(html);
  const links = extractLinks(html, pageUrl);
  const emails = extractEmails(html);
  const phones = extractPhones(text);
  const addresses = extractAddresses(text);

  return {
    page_url: pageUrl,
    emails,
    phones,
    addresses,
    official_website: inferOfficialWebsite(links),
    press_contact_email: pickBestEmail(emails, [
      "press@",
      "media@",
      "communications@",
      "comms@"
    ]),
    contact_email: pickBestEmail(emails, [
      "info@",
      "contact@",
      "hello@",
      "team@"
    ]),
    chief_of_staff_name: extractNamedContact(text, ["chief of staff"]),
    campaign_manager_name: extractNamedContact(text, ["campaign manager"]),
    finance_director_name: extractNamedContact(text, ["finance director"]),
    political_director_name: extractNamedContact(text, ["political director"]),
    press_contact_name: extractNamedContact(text, [
      "press contact",
      "media contact",
      "communications director",
      "press secretary"
    ]),
    links
  };
}

async function crawlRelevantPages(startUrl) {
  const first = await fetchHtml(startUrl);
  if (!first) return [];

  const visited = new Set();
  const queue = [first];
  const pages = [];

  while (queue.length && pages.length < MAX_FOLLOW_PAGES) {
    const current = queue.shift();
    if (!current?.url || visited.has(current.url)) continue;

    visited.add(current.url);

    const pageSignals = extractSignals(current.html, current.url);
    pages.push(pageSignals);

    const nextLinks = pageSignals.links
      .filter((link) => sameHost(link.href, current.url))
      .map((link) => ({ ...link, score: scorePage(link) }))
      .filter((link) => link.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    for (const link of nextLinks) {
      if (visited.has(link.href)) continue;
      const fetched = await fetchHtml(link.href);
      if (fetched) queue.push(fetched);
      if (pages.length + queue.length >= MAX_FOLLOW_PAGES) break;
    }
  }

  return pages;
}

function calculateConfidence(profile) {
  let score = 0;

  if (profile.email) score += 0.3;
  if (profile.press_contact_email) score += 0.2;
  if (profile.phone) score += 0.2;
  if (profile.campaign_website) score += 0.1;
  if (profile.office_address || profile.campaign_address) score += 0.1;
  if (
    profile.chief_of_staff_name ||
    profile.campaign_manager_name ||
    profile.finance_director_name ||
    profile.political_director_name ||
    profile.press_contact_name
  ) {
    score += 0.1;
  }

  return Math.min(1, Number(score.toFixed(2)));
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
        contact_confidence,
        scraped_pages,
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
        contact_confidence,
        scraped_pages,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()
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
        contact_confidence = EXCLUDED.contact_confidence,
        scraped_pages = EXCLUDED.scraped_pages,
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
      JSON.stringify(profile.locked_fields || {}),
      Number(profile.contact_confidence || 0),
      JSON.stringify(profile.scraped_pages || [])
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

  const discovery = await discoverCandidateWebsite(candidate, existing);
  const campaignWebsite = firstNonEmpty(
    existing.campaign_website,
    discovery.website,
    safeWebsite(candidate.website)
  );

  let pages = [];
  if (campaignWebsite) {
    pages = await crawlRelevantPages(campaignWebsite);
  }

  const allEmails = unique(pages.flatMap((page) => page.emails || []));
  const allPhones = unique(pages.flatMap((page) => page.phones || []));
  const allAddresses = unique(pages.flatMap((page) => page.addresses || []));
  const officialWebsite = firstNonEmpty(
    existing.official_website,
    ...pages.map((page) => page.official_website)
  );

  const merged = {
    campaign_website: preserveLocked(
      existing,
      "campaign_website",
      campaignWebsite,
      candidate.website
    ),
    official_website: preserveLocked(existing, "official_website", officialWebsite),
    office_address: preserveLocked(
      existing,
      "office_address",
      firstNonEmpty(...allAddresses, fallbackAddress),
      fallbackAddress
    ),
    campaign_address: preserveLocked(
      existing,
      "campaign_address",
      firstNonEmpty(...allAddresses, fallbackAddress),
      fallbackAddress
    ),
    phone: preserveLocked(
      existing,
      "phone",
      firstNonEmpty(allPhones[0], candidate.phone),
      candidate.phone
    ),
    email: preserveLocked(
      existing,
      "email",
      firstNonEmpty(
        pickBestEmail(allEmails, ["info@", "contact@", "hello@", "team@"]),
        candidate.contact_email
      ),
      candidate.contact_email
    ),
    chief_of_staff_name: preserveLocked(
      existing,
      "chief_of_staff_name",
      firstNonEmpty(...pages.map((page) => page.chief_of_staff_name))
    ),
    campaign_manager_name: preserveLocked(
      existing,
      "campaign_manager_name",
      firstNonEmpty(...pages.map((page) => page.campaign_manager_name))
    ),
    finance_director_name: preserveLocked(
      existing,
      "finance_director_name",
      firstNonEmpty(...pages.map((page) => page.finance_director_name))
    ),
    political_director_name: preserveLocked(
      existing,
      "political_director_name",
      firstNonEmpty(...pages.map((page) => page.political_director_name))
    ),
    press_contact_name: preserveLocked(
      existing,
      "press_contact_name",
      firstNonEmpty(...pages.map((page) => page.press_contact_name))
    ),
    press_contact_email: preserveLocked(
      existing,
      "press_contact_email",
      firstNonEmpty(
        pickBestEmail(allEmails, [
          "press@",
          "media@",
          "communications@",
          "comms@"
        ]),
        candidate.press_email
      ),
      candidate.press_email
    ),
    source_label: pages.length
      ? "campaign_site_live"
      : discovery.website
        ? discovery.source || "website_discovery"
        : clean(existing.source_label) || clean(candidate.contact_source) || "candidate_table",
    admin_locked: Boolean(existing.admin_locked),
    locked_fields: parseLockedFields(existing.locked_fields),
    scraped_pages: pages.map((page) => ({
      page_url: page.page_url,
      emails: page.emails || [],
      phones: page.phones || [],
      addresses: page.addresses || []
    }))
  };

  merged.contact_confidence = calculateConfidence(merged);

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
