import pool from "../config/database.js";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeWebsite(value) {
  const next = clean(value);
  if (!next) return "";
  if (next.startsWith("http://") || next.startsWith("https://")) return next;
  return `https://${next}`;
}

function normalizeEmail(value) {
  const next = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) ? next : "";
}

function inferWebsiteFromName(name = "") {
  const slug = clean(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(llc|inc|corp|corporation|company|co|ltd|group|strategies|strategy|consulting|consultants|partners|political|campaign|media|digital|communications)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  if (!slug || slug.length < 4) return "";
  return `https://${slug}.com`;
}

function inferEmailFromWebsite(website = "") {
  try {
    const url = new URL(normalizeWebsite(website));
    const host = url.hostname.replace(/^www\./, "");
    return host ? `info@${host}` : "";
  } catch {
    return "";
  }
}

function contactStatus({ website, email, phone }) {
  if (website && email && phone) return "complete";
  if (website || email || phone) return "partial";
  return "missing";
}

function confidence({ website, email, phone }) {
  let score = 0;
  if (website) score += 35;
  if (email) score += 35;
  if (phone) score += 20;
  return Math.min(100, score);
}

export async function ensureConsultantContactEnrichmentSchema() {
  await pool.query(`
    ALTER TABLE consultants
      ADD COLUMN IF NOT EXISTS contact_confidence NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS contact_source TEXT,
      ADD COLUMN IF NOT EXISTS contact_source_url TEXT,
      ADD COLUMN IF NOT EXISTS contact_verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS contact_enriched_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS contact_status TEXT DEFAULT 'missing'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_contact_enrichment_runs (
      id SERIAL PRIMARY KEY,
      limit_count INTEGER DEFAULT 0,
      dry_run BOOLEAN DEFAULT FALSE,
      attempted INTEGER DEFAULT 0,
      updated INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      source TEXT DEFAULT 'system',
      failures JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function getConsultantContactEnrichmentStatus() {
  await ensureConsultantContactEnrichmentSchema();

  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total_consultants,
      COUNT(*) FILTER (WHERE COALESCE(website, '') <> '')::int AS with_website,
      COUNT(*) FILTER (WHERE COALESCE(email, '') <> '')::int AS with_email,
      COUNT(*) FILTER (WHERE COALESCE(phone, '') <> '')::int AS with_phone,
      COUNT(*) FILTER (WHERE contact_status = 'complete')::int AS complete_contacts,
      COUNT(*) FILTER (WHERE contact_status = 'partial')::int AS partial_contacts,
      COUNT(*) FILTER (WHERE contact_status = 'missing' OR contact_status IS NULL)::int AS missing_contacts,
      ROUND(AVG(COALESCE(contact_confidence, 0))::numeric, 2) AS avg_contact_confidence,
      MAX(contact_enriched_at) AS last_enriched_at
    FROM consultants
  `);

  return { ok: true, summary: summary.rows[0] || {} };
}

export async function getConsultantsNeedingContactEnrichment(options = {}) {
  await ensureConsultantContactEnrichmentSchema();

  const limit = Math.min(Math.max(num(options.limit, 50), 1), 250);

  const result = await pool.query(
    `
      SELECT *
      FROM consultants
      WHERE COALESCE(contact_status, 'missing') <> 'complete'
         OR COALESCE(contact_confidence, 0) < 80
      ORDER BY COALESCE(total_fec_disbursements, 0) DESC, name ASC
      LIMIT $1
    `,
    [limit]
  );

  return { ok: true, results: result.rows };
}

export async function enrichConsultantContact(consultantId, payload = {}, options = {}) {
  await ensureConsultantContactEnrichmentSchema();

  const id = Number(consultantId);
  const found = await pool.query(`SELECT * FROM consultants WHERE id = $1 LIMIT 1`, [id]);
  const consultant = found.rows[0];

  if (!consultant) return null;

  const website =
    normalizeWebsite(payload.website) ||
    normalizeWebsite(consultant.website) ||
    inferWebsiteFromName(consultant.name || consultant.firm_name || consultant.fec_vendor_name);

  const email =
    normalizeEmail(payload.email) ||
    normalizeEmail(consultant.email) ||
    inferEmailFromWebsite(website);

  const phone = clean(payload.phone || consultant.phone);
  const status = contactStatus({ website, email, phone });
  const contactConfidence = confidence({ website, email, phone });

  const next = {
    website: website || null,
    email: email || null,
    phone: phone || null,
    contact_status: status,
    contact_confidence: contactConfidence,
    contact_source: payload.source || "inferred_from_name",
    contact_source_url: website || null,
  };

  if (options.dryRun) {
    return { ok: true, dry_run: true, consultant, proposed: next };
  }

  const updated = await pool.query(
    `
      UPDATE consultants
      SET
        website = $2,
        email = $3,
        phone = $4,
        contact_status = $5,
        contact_confidence = $6,
        contact_source = $7,
        contact_source_url = $8,
        contact_enriched_at = NOW(),
        source_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      next.website,
      next.email,
      next.phone,
      next.contact_status,
      next.contact_confidence,
      next.contact_source,
      next.contact_source_url,
    ]
  );

  return { ok: true, consultant: updated.rows[0] };
}

export async function enrichConsultantContactsBatch(options = {}) {
  await ensureConsultantContactEnrichmentSchema();

  const limit = Math.min(Math.max(num(options.limit, 50), 1), 250);
  const dryRun = String(options.dryRun || "").toLowerCase() === "true" || options.dryRun === true;

  const needing = await getConsultantsNeedingContactEnrichment({ limit });

  let attempted = 0;
  let updated = 0;
  let skipped = 0;
  const failures = [];
  const preview = [];

  for (const consultant of needing.results) {
    attempted += 1;

    try {
      const result = await enrichConsultantContact(
        consultant.id,
        { source: options.source || "batch_inferred_enrichment" },
        { dryRun }
      );

      if (dryRun) preview.push(result?.proposed);
      if (result) updated += 1;
      else skipped += 1;
    } catch (error) {
      failures.push({
        consultant_id: consultant.id,
        error: error.message,
      });
    }
  }

  await pool.query(
    `
      INSERT INTO consultant_contact_enrichment_runs (
        limit_count, dry_run, attempted, updated, skipped, source, failures, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `,
    [
      limit,
      dryRun,
      attempted,
      updated,
      skipped,
      options.source || "batch_inferred_enrichment",
      JSON.stringify(failures.slice(0, 50)),
    ]
  );

  return {
    ok: true,
    dry_run: dryRun,
    attempted,
    updated,
    skipped,
    failures,
    preview: preview.slice(0, 25),
  };
}
