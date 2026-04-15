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
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (!raw) return null;
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeEmail(value) {
  const raw = clean(value);
  if (!raw) return null;
  return raw.toLowerCase();
}

function chooseBestEmail(emails = [], preferredKeywords = []) {
  const list = unique(emails.map(normalizeEmail));
  if (!list.length) return null;

  for (const keyword of preferredKeywords) {
    const hit = list.find((item) => item.includes(keyword));
    if (hit) return hit;
  }

  const publicHit = list.find(
    (item) =>
      !item.includes("noreply") &&
      !item.includes("no-reply") &&
      !item.includes("donotreply")
  );

  return publicHit || list[0];
}

function chooseBestPhone(phones = []) {
  const list = unique(phones.map(normalizePhone));
  return list[0] || null;
}

function chooseBestAddress(addresses = []) {
  const list = unique(addresses.map(clean));
  return list[0] || null;
}

function chooseOfficialWebsite(urls = []) {
  const list = unique(urls.map(safeWebsite));
  const gov = list.find((url) => /\.gov(\/|$)/i.test(url));
  if (gov) return gov;

  const edu = list.find((url) => /\.us(\/|$)/i.test(url));
  if (edu) return edu;

  const officialWord = list.find((url) => /official/i.test(url));
  return officialWord || list[0] || null;
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
    ...html.matchAll(
      /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})\b/gi
    )
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

function extractCandidateName(candidate) {
  return firstNonEmpty(
    candidate?.full_name,
    [candidate?.first_name, candidate?.last_name].filter(Boolean).join(" ")
  );
}

function extractAddresses(text) {
  const matches = [
    ...text.matchAll(
      /\b\d{1,6}\s+[A-Za-z0-9.#'\- ]+\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Highway|Hwy|Parkway|Pkwy|Suite|Ste|Unit)\b[\s,.\-A-Za-z0-9#]*?(?:,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/gi
    )
  ].map((m) => clean(m[0]));

  return unique(matches);
}

function extractNamedContact(text, labelPatterns = []) {
  for (const label of labelPatterns) {
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
  const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(hrefRegex)) {
    const href = clean(match[1]);
    const label = clean(stripTags(match[2] || ""));

    if (!href) continue;

    try {
      const url = new URL(href, baseUrl);
      links.push({
        href: url.toString(),
        label: label || "",
        raw: href
      });
    } catch {
      // ignore bad URLs
    }
  }

  return links;
}

function scoreContactPage(link) {
  const haystack = `${link.href} ${link.label}`.toLowerCase();

  let score = 0;
  if (haystack.includes("contact")) score += 6;
  if (haystack.includes("about")) score += 4;
  if (haystack.includes("team")) score += 4;
  if (haystack.includes("staff")) score += 4;
  if (haystack.includes("press")) score += 5;
  if (haystack.includes("media")) score += 5;
  if (haystack.includes("leadership")) score += 3;
  if (haystack.includes("meet")) score += 2;
  if (haystack.includes("official")) score += 3;
  if (haystack.includes("mailto:")) score -= 10;
  if (haystack.includes("donate")) score -= 6;
  if (haystack.includes("volunteer")) score -= 3;
  return score;
}

function sameHost(urlA, urlB) {
  try {
    return new URL(urlA).hostname === new URL(urlB).hostname;
  } catch {
    return false;
  }
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
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

function extractSiteSignals(html, pageUrl, candidate) {
  const text = stripTags(html);
  const links = extractLinks(html, pageUrl);
  const emails = extractEmails(html);
  const phones = extractPhones(text);
  const addresses = extractAddresses(text);

  const officialWebsiteCandidates = [
    ...links
      .filter(
        (link) =>
          /\.gov(\/|$)/i.test(link.href) ||
          /\.us(\/|$)/i.test(link.href) ||
          /official/i.test(`${link.label} ${link.href}`)
      )
      .map((link) => link.href)
  ];

  const title = extractTitle(html);
  const ogSite = extractMetaContent(html, ["og:site_name"]);
  const description = extractMetaContent(html, ["description", "og:description"]);

  const chiefOfStaff =
    extractNamedContact(text, [
      "chief of staff",
      "chief\\s+of\\s+staff"
    ]) || null;

  const campaignManager =
    extractNamedContact(text, [
      "campaign manager"
    ]) || null;

  const financeDirector =
    extractNamedContact(text, [
      "finance director"
    ]) || null;

  const politicalDirector =
    extractNamedContact(text, [
      "political director"
    ]) || null;

  const pressContactName =
    extractNamedContact(text, [
      "press contact",
      "media contact",
      "communications director",
      "press secretary"
    ]) || null;

  const pressContactEmail = chooseBestEmail(emails, [
    "press@",
    "media@",
    "communications@",
    "comms@"
  ]);

  const generalEmail = chooseBestEmail(emails, [
    "info@",
    "contact@",
    "hello@",
    "team@"
  ]);

  const candidateName = extractCandidateName(candidate);
  const campaignAddress = chooseBestAddress(addresses);

  return {
    page_url: pageUrl,
    page_title: title,
    site_name: ogSite,
    description,
    emails,
    phones,
    addresses,
    links,
    officialWebsiteCandidates,
    contact_email: generalEmail,
    press_contact_email: pressContactEmail,
    press_contact_name: pressContactName,
    chief_of_staff_name: chiefOfStaff,
    campaign_manager_name: campaignManager,
    finance_director_name: financeDirector,
    political_director_name: politicalDirector,
    campaign_address: campaignAddress,
    phone: chooseBestPhone(phones),
    candidate_name: candidateName
  };
}

async function crawlRelevantPages(startUrl, candidate) {
  const visited = new Set();
  const pages = [];
  const firstPage = await fetchHtml(startUrl);

  if (!firstPage) return pages;

  const queue = [firstPage];

  while (queue.length && pages.length < MAX_FOLLOW_PAGES) {
    const current = queue.shift();
    if (!current?.url || visited.has(current.url)) continue;

    visited.add(current.url);
    pages.push(extractSiteSignals(current.html, current.url, candidate));

    const links = extractLinks(current.html, current.url)
      .filter((link) => sameHost(link.href, current.url))
      .map((link) => ({ ...link, score: scoreContactPage(link) }))
      .filter((link) => link.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (const link of links) {
      if (visited.has(link.href)) continue;
      const nextPage = await fetchHtml(link.href);
      if (nextPage) queue.push(nextPage);
      if (pages.length + queue.length >= MAX_FOLLOW_PAGES) break;
    }
  }

  return pages;
}

function mergeExtractedSignals(candidate, existing = {}, pages = [], officialPages = []) {
  const allPages = [...pages, ...officialPages];

  const allEmails = unique(allPages.flatMap((page) => page.emails || []));
  const allPhones = unique(allPages.flatMap((page) => page.phones || []));
  const allAddresses = unique(allPages.flatMap((page) => page.addresses || []));
  const officialCandidates = unique(
    allPages.flatMap((page) => page.officialWebsiteCandidates || [])
  );

  const officialWebsite = firstNonEmpty(
    existing.official_website,
    chooseOfficialWebsite(officialCandidates)
  );

  const sourceParts = [];
  if (pages.length) sourceParts.push("campaign_site_live");
  if (officialPages.length) sourceParts.push("official_site_live");
  if (!sourceParts.length) sourceParts.push("candidate_record_seed");

  const officialAddress = chooseBestAddress(
    officialPages.map((page) => page.campaign_address).filter(Boolean)
  );

  return {
    campaign_website: firstNonEmpty(
      existing.campaign_website,
      safeWebsite(candidate.website)
    ),
    official_website: officialWebsite,
    office_address: firstNonEmpty(existing.office_address, officialAddress),
    campaign_address: firstNonEmpty(
      existing.campaign_address,
      chooseBestAddress(allPages.map((page) => page.campaign_address))
    ),
    phone: firstNonEmpty(existing.phone, chooseBestPhone(allPhones)),
    email: firstNonEmpty(
      existing.email,
      chooseBestEmail(allEmails, ["info@", "contact@", "hello@", "team@"])
    ),
    chief_of_staff_name: firstNonEmpty(
      existing.chief_of_staff_name,
      ...allPages.map((page) => page.chief_of_staff_name)
    ),
    campaign_manager_name: firstNonEmpty(
      existing.campaign_manager_name,
      ...allPages.map((page) => page.campaign_manager_name)
    ),
    finance_director_name: firstNonEmpty(
      existing.finance_director_name,
      ...allPages.map((page) => page.finance_director_name)
    ),
    political_director_name: firstNonEmpty(
      existing.political_director_name,
      ...allPages.map((page) => page.political_director_name)
    ),
    press_contact_name: firstNonEmpty(
      existing.press_contact_name,
      ...allPages.map((page) => page.press_contact_name)
    ),
    press_contact_email: firstNonEmpty(
      existing.press_contact_email,
      chooseBestEmail(allEmails, ["press@", "media@", "communications@", "comms@"])
    ),
    source_label: sourceParts.join("+")
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
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()
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
        source_label = COALESCE(EXCLUDED.source_label, candidate_profiles.source_label),
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
      clean(profile.source_label)
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
    campaignPages = await crawlRelevantPages(campaignWebsite, candidate);
  }

  const derivedOfficialWebsite = chooseOfficialWebsite(
    campaignPages.flatMap((page) => page.officialWebsiteCandidates || [])
  );

  const officialWebsite = firstNonEmpty(
    existing.official_website,
    derivedOfficialWebsite
  );

  let officialPages = [];
  if (officialWebsite && officialWebsite !== campaignWebsite) {
    officialPages = await crawlRelevantPages(officialWebsite, candidate);
  }

  const merged = mergeExtractedSignals(candidate, existing, campaignPages, officialPages);
  merged.campaign_website = firstNonEmpty(merged.campaign_website, campaignWebsite);
  merged.official_website = firstNonEmpty(merged.official_website, officialWebsite);

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
