import pool from "../config/database.js";

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function nullable(value) {
  const next = clean(value);
  return next || null;
}

function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function bool(value) {
  if (typeof value === "boolean") return value;
  const next = String(value || "").toLowerCase();
  return ["1", "true", "yes", "y"].includes(next);
}

function normalizeWebsite(value) {
  const next = clean(value);
  if (!next) return "";
  if (next.startsWith("http://") || next.startsWith("https://")) return next;
  return `https://${next}`;
}

function normalizeEmail(value) {
  const next = clean(value).toLowerCase();
  if (!next) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next) ? next : "";
}

function normalizePhone(value) {
  const next = clean(value);
  if (!next) return "";
  return next;
}

function slugDomainName(name = "") {
  return clean(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(llc|inc|corp|corporation|company|co|ltd|limited|group|strategies|strategy|consulting|consultants|partners|partner|political|campaign|media|digital|communications)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function inferWebsiteFromName(name = "") {
  const slug = slugDomainName(name);
  if (!slug || slug.length < 4) return "";
  return `https://${slug}.com`;
}

function inferEmailFromWebsite(website = "") {
  const normalized = normalizeWebsite(website);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, "");
    if (!host || !host.includes(".")) return "";
    return `info@${host}`;
  } catch {
    return "";
  }
}

function confidenceForRecord({ website, email, phone, source = "" }) {
  let score = 0;

  if (website) score += 35;
  if (email) score += 35;
  if (phone) score += 20;
  if (String(source).includes("manual")) score += 10;
  if (String(source).includes("inferred")) score -= 15;

  return Math.max(0, Math.min(100, score));
}

function buildStatus({ website, email, phone }) {
  if (website && email && phone) return "complete";
  if (website || email || phone) return "partial";
  return "missing";
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultant_contact_enrichment_history (
      id SERIAL PRIMARY KEY,
      consultant_id INTEGER REFERENCES consultants(id) ON DELETE CASCADE,
      previous_payload JSONB DEFAULT '{}'::jsonb,
      next_payload JSONB DEFAULT '{}'::jsonb,
      source TEXT DEFAULT 'system',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_contact_status ON consultants(contact_status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultants_contact_confidence ON consultants(contact_confidence)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_consultant_contact_history_consultant ON consultant_contact_enrichment_history(consultant_id)`);
}

export async function getConsultantContactEnrichmentStatus() {
  await ensureConsultantContactEnrichmentSchema();

  const [summary, runs] = await Promise.all([
    pool.query(`
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
    `),
    pool.query(`
      SELECT *
      FROM consultant_contact_enrichment_runs
      ORDER BY id DESC
      LIMIT 10
    `),
  ]);

  return {
    ok: true,
    summary: summary.rows[0] || {},
    recent_runs: runs.rows,
  };
}

export async function getConsultantsNeedingContactEnrichment(options = {}) {
  await ensureConsultantContactEnrichmentSchema();

  const limit = Math.min(Math.max(num(options.limit, 50), 1), 250);
  const state = clean(options.state).toUpperCase();

  const values = [limit];
  const where = [
    `(COALESCE(website, '') = '' OR COALESCE(email, '') = '' OR COALESCE(phone, '') = '' OR COALESCE(contact_confidence, 0) < 70)`,
  ];

  if (state) {
    values.push(state);
    where.push(`UPPER(COALESCE(state, '')) = $${values.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        id,
        name,
        firm_name,
        category,
        state,
        website,
        email,
        phone,
        linkedin_url,
        address,
        contact_status,
        contact_confidence,
        contact_source,
        contact_source_url,
        contact_verified_at,
        contact_enriched_at,
        total_fec_disbursements,
        clients_count,
        influence_score
      FROM consultants
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(total_fec_disbursements, 0) DESC, COALESCE(influence_score, 0) DESC, name ASC
      LIMIT $1
    `,
    values
  );

  return {
    ok: true,
    results: result.rows,
  };
}

function buildInferredPayload(consultant = {}) {
  const name = consultant.name || consultant.firm_name || consultant.fec_vendor_name || "";
  const existingWebsite = normalizeWebsite(consultant.website);
  const inferredWebsite = existingWebsite || inferWebsiteFromName(name);
  const existingEmail = normalizeEmail(consultant.email);
  const inferredEmail = existingEmail || inferEmailFromWebsite(inferredWebsite);
  const phone = normalizePhone(consultant.phone);

  const confidence = confidenceForRecord({
    website: inferredWebsite,
    email: inferredEmail,
    phone,
    source: existingWebsite || existingEmail || phone ? "existing_record" : "inferred_from_name",
  });

  return {
    website: inferredWebsite || null,
    email: inferredEmail || null,
    phone: phone || null,
    linkedin_url: nullable(consultant.linkedin_url),
    address: nullable(consultant.address),
    contact_source: existingWebsite || existingEmail || phone ? "existing_record" : "inferred_from_name",
    contact_source_url: inferredWebsite || null,
    contact_confidence: confidence,
    contact_status: buildStatus({ website: inferredWebsite, email: inferredEmail, phone }),
  };
}

export async function enrichConsultantContact(consultantId, payload = {}, options = {}) {
  await ensureConsultantContactEnrichmentSchema();

  const id = Number(consultantId);
  if (!Number.isFinite(id) || id <= 0) {
    const error = new Error("Invalid consultant id");
    error.statusCode = 400;
    throw error;
  }

  const existing = await pool.query(`SELECT * FROM consultants WHERE id = $1 LIMIT 1`, [id]);
  const consultant = existing.rows[0];

  if (!consultant) return null;

  const manualWebsite = normalizeWebsite(payload.website);
  const manualEmail = normalizeEmail(payload.email);
  const manualPhone = normalizePhone(payload.phone);
  const manualLinkedin = normalizeWebsite(payload.linkedin_url || payload.linkedin);
  const manualAddress = nullable(payload.address);
  const sourceUrl = normalizeWebsite(payload.source_url || payload.contact_source_url);
  const source = clean(payload.source || payload.contact_source || "manual_enrichment");
  const verified = bool(payload.verified || payload.contact_verified);

  const inferred = buildInferredPayload(consultant);

  const next = {
    website: manualWebsite || normalizeWebsite(consultant.website) || inferred.website,
    email: manualEmail || normalizeEmail(consultant.email) || inferred.email,
    phone: manualPhone || normalizePhone(consultant.phone) || inferred.phone,
    linkedin_url: manualLinkedin || nullable(consultant.linkedin_url),
    address: manualAddress || nullable(consultant.address),
    contact_source: source || inferred.contact_source,
    contact_source_url: sourceUrl || inferred.contact_source_url,
  };

  next.contact_confidence = confidenceForRecord({
    website: next.website,
    email: next.email,
    phone: next.phone,
    source: next.contact_source,
  });
  next.contact_status = buildStatus(next);

  if (verified) {
    next.contact_confidence = Math.max(next.contact_confidence, 90);
    next.contact_verified_at = new Date().toISOString();
  } else {
    next.contact_verified_at = consultant.contact_verified_at || null;
  }

  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      consultant,
      proposed: next,
    };
  }

  await pool.query(
    `
      INSERT INTO consultant_contact_enrichment_history (
        consultant_id,
        previous_payload,
        next_payload,
        source,
        created_at
      )
      VALUES ($1,$2,$3,$4,NOW())
    `,
    [id, JSON.stringify(consultant), JSON.stringify(next), next.contact_source]
  );

  const updated = await pool.query(
    `
      UPDATE consultants
      SET
        website = $2,
        email = $3,
        phone = $4,
        linkedin_url = $5,
        address = $6,
        contact_confidence = $7,
        contact_status = $8,
        contact_source = $9,
        contact_source_url = $10,
        contact_verified_at = COALESCE($11::timestamp, contact_verified_at),
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
      next.linkedin_url,
      next.address,
      next.contact_confidence,
      next.contact_status,
      next.contact_source,
      next.contact_source_url,
      next.contact_verified_at,
    ]
  );

  return {
    ok: true,
    consultant: updated.rows[0],
  };
}

export async function enrichConsultantContactsBatch(options = {}) {
  await ensureConsultantContactEnrichmentSchema();

  const limit = Math.min(Math.max(num(options.limit, 50), 1), 250);
  const dryRun = bool(options.dryRun);
  const state = clean(options.state).toUpperCase();
  const source = clean(options.source || "batch_inferred_enrichment");

  const needing = await getConsultantsNeedingContactEnrichment({ limit, state });

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
        { source },
        { dryRun }
      );

      if (dryRun) {
        preview.push(result?.proposed || null);
        updated += 1;
      } else if (result?.consultant) {
        updated += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failures.push({
        consultant_id: consultant.id,
        name: consultant.name,
        error: error?.message || "Unknown enrichment error",
      });
    }
  }

  await pool.query(
    `
      INSERT INTO consultant_contact_enrichment_runs (
        limit_count,
        dry_run,
        attempted,
        updated,
        skipped,
        source,
        failures,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `,
    [limit, dryRun, attempted, updated, skipped, source, JSON.stringify(failures.slice(0, 50))]
  );

  return {
    ok: true,
    dry_run: dryRun,
    attempted,
    updated,
    skipped,
    failures: failures.slice(0, 25),
    preview: preview.slice(0, 25),
  };
}

export async function getConsultantContactHistory(consultantId) {
  await ensureConsultantContactEnrichmentSchema();

  const id = Number(consultantId);
  if (!Number.isFinite(id) || id <= 0) {
    const error = new Error("Invalid consultant id");
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `
      SELECT *
      FROM consultant_contact_enrichment_history
      WHERE consultant_id = $1
      ORDER BY created_at DESC
      LIMIT 25
    `,
    [id]
  );

  return {
    ok: true,
    consultant_id: id,
    results: result.rows,
  };
}
