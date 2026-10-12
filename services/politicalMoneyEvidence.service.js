import { readMoneyImportCoverage } from "./moneyImportCoverage.js";
import { financeElectionCycle } from "../utils/financeElectionCycle.js";
import { collectMoneyPages, withMoneyImportLock } from "./moneyImportIntegrity.js";
import crypto from "node:crypto";
import pool from "../config/database.js";

export const POLITICAL_MONEY_BUILD = "7.1.0-political-money-evidence";
export const POLITICAL_MONEY_MODEL = "vs-pme-1";

const clean = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bounded = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, number(value, minimum)));
const normalizeName = (value = "") => clean(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function sourceId(prefix, row = {}) {
  const direct = clean(row.sub_id || row.transaction_id || row.image_number || row.filing_id);
  if (direct) return `${prefix}:${direct}`;
  return `${prefix}:${crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex")}`;
}

function officialFecUrl(row = {}) {
  const committeeId = clean(row.committee_id);
  return committeeId ? `https://www.fec.gov/data/committee/${encodeURIComponent(committeeId)}/` : "https://www.fec.gov/data/independent-expenditures/";
}

async function beginRun({ provider, jobType, cycle, metadata = {} }) {
  const result = await pool.query(
    `INSERT INTO political_money_ingestion_runs
      (provider, job_type, cycle, metadata)
     VALUES ($1,$2,$3,$4::jsonb)
     RETURNING *`,
    [provider, jobType, cycle || null, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

async function finishRun(id, values = {}) {
  const result = await pool.query(
    `UPDATE political_money_ingestion_runs
        SET status = $2,
            pages_requested = $3,
            records_fetched = $4,
            records_stored = $5,
            records_failed = $6,
            error_message = $7,
            metadata = metadata || $8::jsonb,
            completed_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      id,
      values.status || "completed",
      number(values.pagesRequested),
      number(values.recordsFetched),
      number(values.recordsStored),
      number(values.recordsFailed),
      clean(values.errorMessage) || null,
      JSON.stringify(values.metadata || {}),
    ]
  );
  return result.rows[0];
}

export async function upsertPoliticalMoneyOrganization(input = {}, db = pool) {
  const provider = clean(input.provider || "manual");
  const identifierType = clean(input.identifierType || input.identifier_type);
  const identifierValue = clean(input.identifierValue || input.identifier_value);
  const canonicalName = clean(input.name || input.canonical_name || identifierValue || "Unknown organization");
  const normalizedName = normalizeName(canonicalName);

  if (identifierType && identifierValue) {
    const existing = await db.query(
      `SELECT o.*
         FROM political_money_identifiers i
         JOIN political_money_organizations o ON o.id = i.organization_id
        WHERE i.provider = $1 AND i.identifier_type = $2 AND i.identifier_value = $3
        LIMIT 1`,
      [provider, identifierType, identifierValue]
    );
    if (existing.rows[0]) return existing.rows[0];
  }

  const sameName = provider === "openfec" && identifierType === "fec_committee_id" ? { rows: [] } : await db.query(
    `SELECT * FROM political_money_organizations
      WHERE normalized_name = $1
        AND COALESCE(state, '') = COALESCE($2, '')
      ORDER BY id
      LIMIT 1`,
    [normalizedName, clean(input.state).toUpperCase().slice(0, 2) || null]
  );

  let organization = sameName.rows[0];
  if (!organization) {
    const created = await db.query(
      `INSERT INTO political_money_organizations
        (canonical_name, normalized_name, organization_type, tax_exempt_subsection,
         state, city, address, website, formation_date, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING *`,
      [
        canonicalName,
        normalizedName,
        clean(input.organizationType || input.organization_type || "unknown"),
        clean(input.taxExemptSubsection || input.tax_exempt_subsection) || null,
        clean(input.state).toUpperCase().slice(0, 2) || null,
        clean(input.city) || null,
        clean(input.address) || null,
        clean(input.website) || null,
        input.formationDate || input.formation_date || null,
        JSON.stringify(input.metadata || {}),
      input.cycle != null || input.metadata?.cycle != null ? financeElectionCycle(input.cycle ?? input.metadata.cycle) : null,
      ]
    );
    organization = created.rows[0];
  }

  if (identifierType && identifierValue) {
    await db.query(
      `INSERT INTO political_money_identifiers
        (organization_id, provider, identifier_type, identifier_value, confidence_score, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (provider, identifier_type, identifier_value)
       DO UPDATE SET organization_id = EXCLUDED.organization_id,
                     confidence_score = GREATEST(political_money_identifiers.confidence_score, EXCLUDED.confidence_score),
                     metadata = political_money_identifiers.metadata || EXCLUDED.metadata,
                     updated_at = NOW()`,
      [organization.id, provider, identifierType, identifierValue, bounded(input.confidenceScore || 100, 0, 100), JSON.stringify(input.metadata || {})]
    );
  }

  return organization;
}

export async function storePoliticalMoneyEvidence(input = {}, db = pool) {
  if (!input.organizationId && !input.organization_id) throw new Error("organizationId is required");
  const organizationId = input.organizationId || input.organization_id;
  const provider = clean(input.provider || "manual_review");
  const evidenceType = clean(input.evidenceType || input.evidence_type);
  if (!evidenceType) throw new Error("evidenceType is required");
  const recordId = clean(input.sourceRecordId || input.source_record_id) ||
    crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");

  const result = await db.query(
    `INSERT INTO political_money_evidence
      (organization_id, provider, evidence_type, source_record_id, title, description,
       amount, observed_at, source_url, confidence_score, reviewed, reviewed_by,
       reviewed_at, metadata, cycle, money_scan_id, money_committee_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             CASE WHEN $11 THEN NOW() ELSE NULL END,$13::jsonb,$14,$15,$16)
     ON CONFLICT (provider, evidence_type, source_record_id, (COALESCE(cycle,0)))
     DO UPDATE SET organization_id = EXCLUDED.organization_id,
                   title = EXCLUDED.title,
                   description = EXCLUDED.description,
                   amount = EXCLUDED.amount,
                   observed_at = EXCLUDED.observed_at,
                   source_url = EXCLUDED.source_url,
                   confidence_score = EXCLUDED.confidence_score,
                   reviewed = EXCLUDED.reviewed,
                   reviewed_by = EXCLUDED.reviewed_by,
                   reviewed_at = CASE WHEN EXCLUDED.reviewed THEN NOW() ELSE political_money_evidence.reviewed_at END,
                   metadata = political_money_evidence.metadata || EXCLUDED.metadata,
                   money_scan_id = EXCLUDED.money_scan_id, money_committee_id = EXCLUDED.money_committee_id, updated_at = NOW()
     RETURNING *`,
    [
      organizationId, provider, evidenceType, recordId,
      clean(input.title) || null, clean(input.description) || null,
      input.exactAmount ?? number(input.amount), input.observedAt || input.observed_at || null,
      clean(input.sourceUrl || input.source_url) || null,
      bounded(input.confidenceScore || input.confidence_score || 50, 0, 100),
      Boolean(input.reviewed), input.reviewedBy || input.reviewed_by || null,
      JSON.stringify(input.metadata || {}),
      input.cycle != null || input.metadata?.cycle != null ? financeElectionCycle(input.cycle ?? input.metadata.cycle) : null,
      input.moneyScanId || null, input.moneyCommitteeId || null,
    ]
  );
  return result.rows[0];
}

async function storeIndependentExpenditure(row, cycle, db = pool, scope = null) {
  const committeeId = clean(row.committee_id);
  const committeeName = clean(row.committee_name || row.payee_name || committeeId || "Independent expenditure filer");
  const organization = await upsertPoliticalMoneyOrganization({
    provider: "openfec",
    identifierType: "fec_committee_id",
    identifierValue: committeeId || sourceId("fec-org", row),
    name: committeeName,
    organizationType: clean(row.committee_type) || "political_committee",
    state: row.committee_state,
    metadata: { filing_frequency: row.filing_frequency || null },
  }, db);
  const recordId = scope ? `schedule-e:${scope.scanId}:${row.sub_id}` : sourceId("schedule-e", row);
  const amount = scope ? String(row.expenditure_amount) : number(row.expenditure_amount || row.disbursement_amount);

  await db.query(
    `INSERT INTO political_money_transactions
      (provider, source_record_id, transaction_type, cycle, source_organization_id,
       fec_committee_id, fec_candidate_id, candidate_name, support_oppose_indicator,
       amount, transaction_date, dissemination_date, purpose, source_url, filing_id, raw_payload, money_scan_id)
     VALUES ('openfec',$1,'independent_expenditure',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
     ON CONFLICT (provider, source_record_id, (COALESCE(cycle,0)))
     DO UPDATE SET amount = EXCLUDED.amount,
                   transaction_date = EXCLUDED.transaction_date,
                   dissemination_date = EXCLUDED.dissemination_date,
                   purpose = EXCLUDED.purpose,
                   raw_payload = EXCLUDED.raw_payload, money_scan_id = EXCLUDED.money_scan_id,
                   updated_at = NOW()`,
    [
      recordId, cycle, organization.id, committeeId || null,
      clean(row.candidate_id) || null, clean(row.candidate_name) || null,
      clean(row.support_oppose_indicator) || null, amount,
      row.expenditure_date || null, row.dissemination_date || null,
      clean(row.expenditure_description || row.purpose) || null,
      officialFecUrl(row), clean(row.image_number || row.filing_id) || null,
      JSON.stringify(row), scope?.scanId || null,
    ]
  );

  await storePoliticalMoneyEvidence({
    organizationId: organization.id,
    provider: "openfec",
    evidenceType: "independent_expenditure",
    sourceRecordId: recordId,
    title: `${committeeName} independent expenditure`,
    description: [row.support_oppose_indicator, row.candidate_name, row.expenditure_description].filter(Boolean).join(" • "),
    amount, exactAmount: scope ? amount : undefined, moneyScanId: scope?.scanId, moneyCommitteeId: row.committee_id,
    observedAt: row.dissemination_date || row.expenditure_date || null,
    sourceUrl: officialFecUrl(row),
    confidenceScore: 97,
    reviewed: true,
    metadata: { cycle, candidate_id: row.candidate_id || null, support_oppose_indicator: row.support_oppose_indicator || null },
  }, db);
}

async function syncFecIndependentExpendituresUnlocked(options = {}) {
  const apiKey = clean(process.env.FEC_API_KEY || process.env.OPENFEC_API_KEY);
  if (!apiKey) throw new Error("FEC_API_KEY or OPENFEC_API_KEY is required");
  const cycle = financeElectionCycle(options.cycle);
  const maxPages = bounded(options.maxPages || options.max_pages || process.env.POLITICAL_MONEY_FEC_MAX_PAGES || 3, 1, 25);
  const perPage = bounded(options.perPage || options.per_page || 100, 1, 100);
  const pauseMs = bounded(options.pauseMs || options.pause_ms || 350, 0, 5000);
  const run = await beginRun({ provider: "openfec", jobType: "independent_expenditures", cycle, metadata: { max_pages: maxPages, per_page: perPage } });
  let fetched = 0;
  let stored = 0;
  let failed = 0;
  let pagesRequested = 0;

  try {
    const pages = await collectMoneyPages({ cycle, maxPages, perPage, apiKey, pauseMs });
    pagesRequested = pages.pages;
    fetched = pages.rows.length;
    if (!pages.rows.length) return await finishRun(run.id, { status: "no_data", pagesRequested, recordsFetched: 0, recordsStored: 0, recordsFailed: 0 });
    for (const row of pages.rows) {
      await storeIndependentExpenditure(row, cycle);
      stored += 1;
    }
    await rebuildPoliticalMoneyScoresUnlocked({ cycle });
    return await finishRun(run.id, { status: "completed", pagesRequested, recordsFetched: fetched, recordsStored: stored, recordsFailed: failed });
  } catch (error) {
    await finishRun(run.id, { status: "failed", pagesRequested, recordsFetched: fetched, recordsStored: stored, recordsFailed: failed, errorMessage: error.message });
    throw error;
  }
}

async function importReviewedPoliticalMoneyEvidenceUnlocked(records = [], context = {}) {
  if (!Array.isArray(records)) throw new Error("records must be an array");
  const safeRecords = records.slice(0, 1000);
  let stored = 0;
  const errors = [];
  for (let index = 0; index < safeRecords.length; index += 1) {
    const row = safeRecords[index] || {};
    try {
      const organization = await upsertPoliticalMoneyOrganization({
        provider: clean(row.identifier_provider || row.provider || "reviewed_upload"),
        identifierType: clean(row.identifier_type || "source_id"),
        identifierValue: clean(row.identifier_value || row.organization_id || sourceId("upload-org", row)),
        name: row.organization_name || row.name,
        organizationType: row.organization_type,
        taxExemptSubsection: row.tax_exempt_subsection,
        state: row.state,
        city: row.city,
        address: row.address,
        website: row.website,
        formationDate: row.formation_date,
        confidenceScore: row.identity_confidence || 80,
        metadata: row.organization_metadata || {},
      });
      await storePoliticalMoneyEvidence({
        organizationId: organization.id,
        provider: clean(row.evidence_provider || row.provider || "reviewed_upload"),
        evidenceType: row.evidence_type,
        sourceRecordId: row.source_record_id || sourceId("upload-evidence", row),
        title: row.title,
        description: row.description,
        amount: row.amount,
        observedAt: row.observed_at,
        sourceUrl: row.source_url,
        confidenceScore: row.confidence_score || 70,
        reviewed: true,
        reviewedBy: context.userId || null,
        metadata: row.metadata || {},
        cycle: row.cycle ?? context.cycle,
      });
      stored += 1;
    } catch (error) {
      errors.push({ index, error: error.message });
    }
  }
  await rebuildPoliticalMoneyScoresUnlocked({ cycle: context.cycle });
  return { ok: errors.length === 0, received: safeRecords.length, stored, failed: errors.length, errors: errors.slice(0, 50) };
}

function scoreFor(type, summary) {
  const amount = number(summary.amount);
  const count = number(summary.count);
  if (type === "disclosure_gap") return bounded(Math.round(number(summary.max_score) || Math.min(30, count * 8 + Math.log10(Math.max(1, amount)) * 2)), 0, 30);
  if (type === "nonprofit_spending") return bounded(Math.round(Math.min(20, count * 4 + Math.log10(Math.max(1, amount)) * 2)), 0, 20);
  if (type === "independent_expenditure") return bounded(Math.round(Math.min(20, count * 2 + Math.log10(Math.max(1, amount)) * 2)), 0, 20);
  if (type === "organization_transfer") return bounded(Math.round(Math.min(15, count * 3 + Math.log10(Math.max(1, amount)))), 0, 15);
  if (type === "shell_organization") return bounded(Math.round(number(summary.max_score) || Math.min(15, count * 5)), 0, 15);
  return 0;
}

async function rebuildPoliticalMoneyScoresUnlocked(options = {}, borrowedClient = null) {
  const cycle = financeElectionCycle(options.cycle);
  const client = borrowedClient || await pool.connect();
  try {
  await client.query('BEGIN');
  await client.query('UPDATE political_money_scores SET cycle_scoped_verified=FALSE WHERE cycle=$1', [cycle]);
  const result = await client.query(
    `SELECT o.id AS organization_id,
            e.evidence_type,
            COUNT(*)::int AS count,
            COALESCE(SUM(e.amount),0)::numeric AS amount,
            MAX(COALESCE((e.metadata->>'indicator_score')::numeric,0))::numeric AS max_score
       FROM political_money_organizations o
       JOIN political_money_evidence_read e ON e.organization_id = o.id
      WHERE e.cycle = $1 AND (e.reviewed = TRUE OR e.confidence_score >= 80)
      GROUP BY o.id, e.evidence_type`, [cycle]
  );
  const grouped = new Map();
  for (const row of result.rows) {
    if (!grouped.has(row.organization_id)) grouped.set(row.organization_id, {});
    grouped.get(row.organization_id)[row.evidence_type] = row;
  }
  let updated = 0;
  for (const [organizationId, evidence] of grouped.entries()) {
    const scores = {
      disclosure_gap: scoreFor("disclosure_gap", evidence.disclosure_gap || {}),
      nonprofit_spending: scoreFor("nonprofit_spending", evidence.nonprofit_spending || {}),
      independent_expenditure: scoreFor("independent_expenditure", evidence.independent_expenditure || {}),
      organization_transfer: scoreFor("organization_transfer", evidence.organization_transfer || {}),
      shell_organization: scoreFor("shell_organization", evidence.shell_organization || {}),
    };
    const darkMoneyScore = Object.values(scores).reduce((sum, value) => sum + value, 0);
    const indicatorCount = Object.values(scores).filter((value) => value > 0).length;
    const tier = darkMoneyScore >= 80 && indicatorCount >= 2 ? "critical_review" :
      darkMoneyScore >= 60 && indicatorCount >= 2 ? "elevated_indicators" :
      darkMoneyScore >= 30 ? "disclosure_review" : "standard";
    const reasons = Object.entries(scores).filter(([, value]) => value > 0).map(([type, value]) => ({ type, score: value }));
    await client.query(
      `INSERT INTO political_money_scores
        (organization_id, model_version, cycle, disclosure_gap_score,
         nonprofit_spending_score, independent_expenditure_score,
         organization_transfer_score, shell_organization_score,
         dark_money_score, indicator_count, review_tier,
         human_review_required, reasons, evidence_summary, cycle_scoped_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,TRUE)
       ON CONFLICT (organization_id, (COALESCE(cycle,0)))
       DO UPDATE SET cycle_scoped_verified = TRUE, model_version = EXCLUDED.model_version,
                     cycle = EXCLUDED.cycle,
                     disclosure_gap_score = EXCLUDED.disclosure_gap_score,
                     nonprofit_spending_score = EXCLUDED.nonprofit_spending_score,
                     independent_expenditure_score = EXCLUDED.independent_expenditure_score,
                     organization_transfer_score = EXCLUDED.organization_transfer_score,
                     shell_organization_score = EXCLUDED.shell_organization_score,
                     dark_money_score = EXCLUDED.dark_money_score,
                     indicator_count = EXCLUDED.indicator_count,
                     review_tier = EXCLUDED.review_tier,
                     human_review_required = EXCLUDED.human_review_required,
                     reasons = EXCLUDED.reasons,
                     evidence_summary = EXCLUDED.evidence_summary,
                     calculated_at = NOW(), updated_at = NOW()`,
      [organizationId, POLITICAL_MONEY_MODEL, cycle, scores.disclosure_gap, scores.nonprofit_spending,
       scores.independent_expenditure, scores.organization_transfer, scores.shell_organization,
       darkMoneyScore, indicatorCount, tier, darkMoneyScore >= 60 && indicatorCount >= 2,
       JSON.stringify(reasons), JSON.stringify(evidence)]
    );
    updated += 1;
  }
  await client.query('COMMIT');
  return { ok: true, build: POLITICAL_MONEY_BUILD, model_version: POLITICAL_MONEY_MODEL, cycle, organizations_scored: updated };
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { if (!borrowedClient) client.release(); }
}

export async function getPoliticalMoneyProviderHealth() {
  const result = await pool.query(
    `SELECT DISTINCT ON (provider, job_type, cycle)
            provider, job_type, status, cycle, records_fetched, records_stored,
            records_failed, error_message, started_at, completed_at
       FROM political_money_ingestion_runs
      ORDER BY provider, job_type, cycle, started_at DESC`
  );
  const progress=await pool.query(`SELECT c.cycle,c.scope_key,c.published_at,c.needs_scores,s.status,s.pages,s.records,s.last_error,s.cutoff::text FROM money_import_checkpoints c LEFT JOIN money_import_scans s ON s.id=c.active_scan_id WHERE c.lane='political-money' ORDER BY c.cycle,c.scope_key`);
  return { ok: true, build: POLITICAL_MONEY_BUILD, providers: result.rows, import_progress:progress.rows, generated_at: new Date().toISOString() };
}

export async function getPoliticalMoneyEvidenceProfile(organizationId, options = {}) {
  const limit = bounded(options.limit || 250, 1, 500);
  const cycle = financeElectionCycle(options.cycle);
  const organization = await pool.query(
    `SELECT o.*, s.*
       FROM political_money_organizations o
       LEFT JOIN political_money_scores s ON s.organization_id = o.id AND s.cycle = $2 AND s.cycle_scoped_verified = TRUE
      WHERE o.id = $1`,
    [organizationId, cycle]
  );
  if (!organization.rows[0]) return null;
  const evidence = await pool.query(
    `SELECT * FROM political_money_evidence_read
      WHERE organization_id = $1 AND cycle = $3
      ORDER BY COALESCE(observed_at, created_at) DESC
      LIMIT $2`,
    [organizationId, limit, cycle]
  );
  const transactions = await pool.query(
    `SELECT * FROM political_money_transactions_read
      WHERE (source_organization_id = $1 OR target_organization_id = $1) AND cycle = $3
      ORDER BY COALESCE(dissemination_date, transaction_date) DESC NULLS LAST
      LIMIT $2`,
    [organizationId, limit, cycle]
  );
  return { ok: true, build: POLITICAL_MONEY_BUILD, organization: organization.rows[0], evidence: evidence.rows, transactions: transactions.rows, import_coverage: await readMoneyImportCoverage(pool,"political-money",cycle) };
}

export default {
  syncFecIndependentExpenditures,
  importReviewedPoliticalMoneyEvidence,
  rebuildPoliticalMoneyScores,
  getPoliticalMoneyProviderHealth,
  getPoliticalMoneyEvidenceProfile,
  upsertPoliticalMoneyOrganization,
  storePoliticalMoneyEvidence,
};

export async function syncFecIndependentExpenditures() { throw Object.assign(new Error("Use the resumable import coordinator with an explicit scope."), {code:"RESUMABLE_IMPORT_REQUIRED",statusCode:409}); }

export async function rebuildPoliticalMoneyScores(options = {}) { return withMoneyImportLock(pool, () => rebuildPoliticalMoneyScoresUnlocked(options)); }

export async function importReviewedPoliticalMoneyEvidence(records = [], context = {}) { return withMoneyImportLock(pool, () => importReviewedPoliticalMoneyEvidenceUnlocked(records, context)); }

export async function promoteResumablePoliticalRecord(row,cycle,client,scope) { return storeIndependentExpenditure(row,cycle,client,scope); }
export async function rebuildResumableMoneyScores(options,client) { if(!client)throw new Error("Borrowed transaction client required"); return rebuildPoliticalMoneyScoresUnlocked(options,client); }
