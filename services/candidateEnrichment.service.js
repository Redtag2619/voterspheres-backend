import pool from "../config/database.js";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_FOLLOW_PAGES = 4;
const USER_AGENT =
  "Mozilla/5.0 (compatible; VoterSpheresBot/1.0; +https://voterspheres.org)";

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

function safeWebsite(value) {
  const website = clean(value);
  if (!website) return null;
  if (/^https?:\/\//i.test(website)) return website;
  return `https://${website}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizePhone(value) {
  const raw = clean(value);
  return raw ? raw.replace(/\s+/g, " ").trim() : null;
}

function normalizeEmail(value) {
  const raw = clean(value);
  return raw ? raw.toLowerCase() : null;
}

function chooseBestEmail(emails = [], preferredKeywords = []) {
  const list = unique(emails.map(normalizeEmail));
  if (!list.length) return null;

  for (const keyword of preferredKeywords) {
    const hit = list.find((item) => item.includes(keyword));
    if (hit) return hit;
  }

  return (
    list.find(
      (item) =>
        !item.includes("noreply") &&
        !item.includes("no-reply") &&
        !item.includes("donotreply")
    ) || list[0]
  );
}

function chooseBestPhone(phones = []) {
  return unique(phones.map(normalizePhone))[0] || null;
}

function chooseBestAddress(addresses = []) {
  return unique(addresses.map(clean))[0] || null;
}

function chooseOfficialWebsite(urls = []) {
  const list = unique(urls.map(safeWebsite));
  return (
    list.find((url) => /\.gov(\/|$)/i.test(url)) ||
    list.find((url) => /\.us(\/|$)/i.test(url)) ||
    list.find((url) => /official/i.test(url)) ||
    list[0] ||
    null
  );
}

function extractMetaContent(html, names = []) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${escapeRegExp(
        name
      )}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const match = html.match(re);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return clean(stripTags(match?.[1] || ""));
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
      `${label}\\s*[:\\-–]?\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z.'-]+){0,3})`,
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

function scoreContactPage(link) {
  const text = `${link.href} ${link.label}`.toLowerCase();

  let score = 0;
  if (text.includes("contact")) score += 6;
  if (text.includes("about")) score += 4;
  if (text.includes("team")) score += 4;
  if (text.includes("staff")) score += 4;
  if (text.includes("press")) score += 5;
  if (text.includes("media")) score += 5;
  if (text.includes("leadership")) score += 3;
  if (text.includes("official")) score += 3;
  if (text.includes("donate")) score -= 6;
  if (text.includes("volunteer")) score -= 3;
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
    return { url: response.url || url, html };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractSignals(html, pageUrl) {
  const text = stripTags(html);
  const links = extractLinks(html, pageUrl);
  const emails = extractEmails(html);
  const phones = extractPhones(text);
  const addresses = extractAddresses(text);

  return {
    page_url: pageUrl,
    page_title: extractTitle(html),
    description: extractMetaContent(html, ["description", "og:description"]),
    emails,
    phones,
    addresses,
    links,
    officialWebsiteCandidates: links
      .filter(
        (link) =>
          /\.gov(\/|$)/i.test(link.href) ||
          /\.us(\/|$)/i.test(link.href) ||
          /official/i.test(`${link.label} ${link.href}`)
      )
      .map((link) => link.href),
    campaign_address: chooseBestAddress(addresses),
    phone: chooseBestPhone(phones),
    email: chooseBestEmail(emails, ["info@", "contact@", "hello@", "team@"]),
    press_contact_email: chooseBestEmail(emails, [
      "press@",
      "media@",
      "communications@",
      "comms@"
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
    ])
  };
}

async function crawlRelevantPages(startUrl) {
  const visited = new Set();
  const pages = [];
  const first = await fetchHtml(startUrl);
  if (!first) return pages;

  const queue = [first];

  while (queue.length && pages.length < MAX_FOLLOW_PAGES) {
    const current = queue.shift();
    if (!current?.url || visited.has(current.url)) continue;

    visited.add(current.url);
    pages.push(extractSignals(current.html, current.url));

    const links = extractLinks(current.html, current.url)
      .filter((link) => sameHost(link.href, current.url))
      .map((link) => ({ ...link, score: scoreContactPage(link) }))
      .filter((link) => link.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (const link of links) {
      if (visited.has(link.href)) continue;
      const next = await fetchHtml(link.href);
      if (next) queue.push(next);
      if (pages.length + queue.length >= MAX_FOLLOW_PAGES) break;
    }
  }

  return pages;
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

function isFieldLocked(existingProfile, fieldName) {
  if (existingProfile?.admin_locked) return true;
  const lockedFields = parseLockedFields(existingProfile?.locked_fields);
  return Boolean(lockedFields?.[fieldName]);
}

function applyLockAwareValue(existingProfile, fieldName, incomingValue, existingValue) {
  if (isFieldLocked(existingProfile, fieldName)) {
    return existingValue ?? null;
  }
  return clean(incomingValue) ?? clean(existingValue) ?? null;
}

function mergeExtractedSignals(existing = {}, campaignPages = [], officialPages = [], candidate = {}) {
  const allPages = [...campaignPages, ...officialPages];
  const allEmails = unique(allPages.flatMap((page) => page.emails || []));
  const allPhones = unique(allPages.flatMap((page) => page.phones || []));
  const allAddresses = unique(allPages.flatMap((page) => page.addresses || []));
  const officialCandidates = unique(
    allPages.flatMap((page) => page.officialWebsiteCandidates || [])
  );

  const derived = {
    campaign_website: firstNonEmpty(existing.campaign_website, safeWebsite(candidate.website)),
    official_website: firstNonEmpty(existing.official_website, chooseOfficialWebsite(officialCandidates)),
    office_address: firstNonEmpty(
      chooseBestAddress(officialPages.map((page) => page.campaign_address)),
      existing.office_address
    ),
    campaign_address: firstNonEmpty(
      chooseBestAddress(allPages.map((page) => page.campaign_address)),
      existing.campaign_address
    ),
    phone: firstNonEmpty(chooseBestPhone(allPhones), existing.phone),
    email: firstNonEmpty(
      chooseBestEmail(allEmails, ["info@", "contact@", "hello@", "team@"]),
      existing.email
    ),
    chief_of_staff_name: firstNonEmpty(
      ...allPages.map((page) => page.chief_of_staff_name),
      existing.chief_of_staff_name
    ),
    campaign_manager_name: firstNonEmpty(
      ...allPages.map((page) => page.campaign_manager_name),
      existing.campaign_manager_name
    ),
    finance_director_name: firstNonEmpty(
      ...allPages.map((page) => page.finance_director_name),
      existing.finance_director_name
    ),
    political_director_name: firstNonEmpty(
      ...allPages.map((page) => page.political_director_name),
      existing.political_director_name
    ),
    press_contact_name: firstNonEmpty(
      ...allPages.map((page) => page.press_contact_name),
      existing.press_contact_name
    ),
    press_contact_email: firstNonEmpty(
      chooseBestEmail(allEmails, ["press@", "media@", "communications@", "comms@"]),
      existing.press_contact_email
    ),
    source_label:
      campaignPages.length || officialPages.length
        ? [
            campaignPages.length ? "campaign_site_live" : null,
            officialPages.length ? "official_site_live" : null
          ]
            .filter(Boolean)
            .join("+")
        : firstNonEmpty(existing.source_label, "candidate_record_seed")
  };

  return {
    campaign_website: applyLockAwareValue(
      existing,
      "campaign_website",
      derived.campaign_website,
      existing.campaign_website
    ),
    official_website: applyLockAwareValue(
      existing,
      "official_website",
      derived.official_website,
      existing.official_website
    ),
    office_address: applyLockAwareValue(
      existing,
      "office_address",
      derived.office_address,
      existing.office_address
    ),
    campaign_address: applyLockAwareValue(
      existing,
      "campaign_address",
      derived.campaign_address,
      existing.campaign_address
    ),
    phone: applyLockAwareValue(existing, "phone", derived.phone, existing.phone),
    email: applyLockAwareValue(existing, "email", derived.email, existing.email),
    chief_of_staff_name: applyLockAwareValue(
      existing,
      "chief_of_staff_name",
      derived.chief_of_staff_name,
      existing.chief_of_staff_name
    ),
    campaign_manager_name: applyLockAwareValue(
      existing,
      "campaign_manager_name",
      derived.campaign_manager_name,
      existing.campaign_manager_name
    ),
    finance_director_name: applyLockAwareValue(
      existing,
      "finance_director_name",
      derived.finance_director_name,
      existing.finance_director_name
    ),
    political_director_name: applyLockAwareValue(
      existing,
      "political_director_name",
      derived.political_director_name,
      existing.political_director_name
    ),
    press_contact_name: applyLockAwareValue(
      existing,
      "press_contact_name",
      derived.press_contact_name,
      existing.press_contact_name
    ),
    press_contact_email: applyLockAwareValue(
      existing,
      "press_contact_email",
      derived.press_contact_email,
      existing.press_contact_email
    ),
    source_label: clean(derived.source_label) || clean(existing.source_label) || "candidate_record_seed",
    admin_locked: Boolean(existing.admin_locked),
    locked_fields: parseLockedFields(existing.locked_fields)
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

async function getCandidate(candidateId) {
  const result = await pool.query(
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
        admin_locked,
        locked_fields,
        updated_at,
        created_at
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

  const campaignWebsite = firstNonEmpty(
    existing.campaign_website,
    safeWebsite(candidate.website)
  );

  let campaignPages = [];
  if (campaignWebsite) {
    campaignPages = await crawlRelevantPages(campaignWebsite);
  }

  const derivedOfficialWebsite = chooseOfficialWebsite(
    campaignPages.flatMap((page) => page.officialWebsiteCandidates || [])
  );

  const officialWebsite = firstNonEmpty(existing.official_website, derivedOfficialWebsite);

  let officialPages = [];
  if (officialWebsite && officialWebsite !== campaignWebsite) {
    officialPages = await crawlRelevantPages(officialWebsite);
  }

  const merged = mergeExtractedSignals(existing, campaignPages, officialPages, candidate);
  const profile = await upsertProfile(candidateId, merged);

  return { candidate, profile };
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
