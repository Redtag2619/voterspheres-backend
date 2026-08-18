import crypto from "node:crypto";
import { pool } from "../db/pool.js";

export const UNIVERSAL_CANDIDATE_BUILD = "6.0.0-universal-candidate-intelligence";

const clean = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();
const upper = (value = "") => clean(value).toUpperCase();

export function normalizeCandidateName(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOfficeLevel({ office = "", locality = "", county = "" } = {}) {
  const value = clean(office).toLowerCase();
  if (/president|vice president|u\.?s\.? senate|united states senate|u\.?s\.? house|congress/.test(value)) return "federal";
  if (/governor|lieutenant governor|attorney general|secretary of state|state senate|state house|assembly|legislature/.test(value)) return "state";
  if (/county|sheriff|district attorney|prosecutor/.test(value) || clean(county)) return "county";
  if (/mayor|city council|alder|municipal|town|village/.test(value) || clean(locality)) return "municipal";
  if (/judge|justice|court/.test(value)) return "judicial";
  if (/school|board of education/.test(value)) return "school_board";
  return "unknown";
}

function identityScore(row, context) {
  const requested = normalizeCandidateName(context.candidate);
  const candidate = normalizeCandidateName(row.canonical_name);
  const requestedTokens = requested.split(/\s+/).filter(Boolean).sort().join(" ");
  const candidateTokens = candidate.split(/\s+/).filter(Boolean).sort().join(" ");
  const samePersonTokens = requestedTokens && candidateTokens && requestedTokens === candidateTokens;
  let score = requested && candidate === requested ? 70 : samePersonTokens ? 68 : 0;
  if (requested && candidate.includes(requested)) score = Math.max(score, 55);
  if (requested && requested.includes(candidate)) score = Math.max(score, 50);
  if (context.state && upper(row.home_state) === upper(context.state)) score += 12;
  if (context.office && clean(row.office_name).toLowerCase().includes(clean(context.office).toLowerCase())) score += 10;
  if (context.district && clean(row.district).toLowerCase() === clean(context.district).toLowerCase()) score += 5;
  if (context.locality && clean(row.locality).toLowerCase() === clean(context.locality).toLowerCase()) score += 5;
  if (context.cycle && Number(row.cycle) === Number(context.cycle)) score += 3;
  if (row.identifier_value) score += 3;
  return Math.min(100, score);
}

export async function resolveUniversalCandidate(context = {}) {
  const candidate = clean(context.candidate || context.name);
  if (!candidate) {
    return { status: "missing_candidate", confidence: 0, matches: [], selected: null };
  }

  const normalized = normalizeCandidateName(candidate);
  const params = [normalized];
  const clauses = [
    `(u.normalized_name = $1 OR u.normalized_name ILIKE '%' || $1 || '%' OR EXISTS (
       SELECT 1 FROM universal_candidate_aliases a
       WHERE a.candidate_entity_id = u.id
         AND (a.normalized_alias = $1 OR a.normalized_alias ILIKE '%' || $1 || '%')
     ))`,
  ];

  if (clean(context.state)) {
    params.push(upper(context.state).slice(0, 2));
    clauses.push(`(u.home_state IS NULL OR UPPER(u.home_state) = $${params.length})`);
  }

  const result = await pool.query(
    `SELECT u.*, c.id AS candidacy_id, c.office_level, c.office_name, c.state,
            c.county, c.locality, c.district, c.cycle, c.ballot_status,
            i.provider, i.identifier_type, i.identifier_value
       FROM universal_candidate_entities u
       LEFT JOIN universal_candidacies c ON c.candidate_entity_id = u.id
       LEFT JOIN universal_candidate_identifiers i
         ON i.candidate_entity_id = u.id
        AND (
          c.id IS NULL
          OR NULLIF(c.metadata->>'fec_candidate_id', '') IS NULL
          OR i.identifier_value = c.metadata->>'fec_candidate_id'
        )
      WHERE ${clauses.join(" AND ")}
      ORDER BY u.confidence_score DESC, c.cycle DESC NULLS LAST
      LIMIT 25`,
    params
  );

  const matches = result.rows
    .map((row) => ({ ...row, match_score: identityScore(row, { ...context, candidate }) }))
    .filter((row) => row.match_score >= 45)
    .sort((a, b) => b.match_score - a.match_score);

  const selected = matches[0] || null;
  const second = matches.find(
    (row) =>
      row.id !== selected?.id &&
      (
        row.normalized_name !== selected?.normalized_name ||
        upper(row.home_state) !== upper(selected?.home_state)
      )
  ) || null;
  const ambiguous = Boolean(selected && second && selected.match_score - second.match_score < 8);

  return {
    status: !selected ? "unresolved" : ambiguous ? "ambiguous" : "resolved",
    confidence: selected?.match_score || 0,
    selected,
    matches: matches.slice(0, 10),
    requested: { ...context, candidate },
  };
}

export async function storeCandidateEvidence({
  candidateEntityId = null,
  candidacyId = null,
  providerKey,
  evidenceType,
  title = "",
  summary = "",
  sourceName = "",
  sourceUrl = "",
  sourceRecordId = "",
  publishedAt = null,
  confidenceScore = 50,
  payload = {},
} = {}) {
  const dedupeKey = crypto
    .createHash("sha256")
    .update([providerKey, evidenceType, sourceRecordId, sourceUrl, title].map(clean).join("|"))
    .digest("hex");

  const result = await pool.query(
    `INSERT INTO universal_candidate_evidence (
       candidate_entity_id, candidacy_id, provider_key, evidence_type, title,
       summary, source_name, source_url, source_record_id, published_at,
       confidence_score, payload, dedupe_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     ON CONFLICT (dedupe_key) DO UPDATE SET
       summary = EXCLUDED.summary,
       published_at = EXCLUDED.published_at,
       retrieved_at = NOW(),
       confidence_score = EXCLUDED.confidence_score,
       payload = EXCLUDED.payload
     RETURNING *`,
    [candidateEntityId, candidacyId, clean(providerKey), clean(evidenceType), clean(title) || null,
      clean(summary) || null, clean(sourceName) || null, clean(sourceUrl) || null,
      clean(sourceRecordId) || null, publishedAt || null, Number(confidenceScore) || 50,
      JSON.stringify(payload || {}), dedupeKey]
  );
  return result.rows[0];
}

export async function listCandidateEvidence({ candidateEntityId, evidenceType = "", limit = 50 } = {}) {
  const params = [candidateEntityId];
  const conditions = ["candidate_entity_id = $1"];
  if (clean(evidenceType)) {
    params.push(clean(evidenceType));
    conditions.push(`evidence_type = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT * FROM universal_candidate_evidence
      WHERE ${conditions.join(" AND ")}
      ORDER BY COALESCE(published_at, retrieved_at) DESC
      LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 250))}`,
    params
  );
  return result.rows;
}

export async function listUniversalCandidates({
  q = "",
  state = "",
  office = "",
  cycle = "",
  party = "",
  ballotStatus = "active",
  page = 1,
  limit = 25,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
  const offset = (safePage - 1) * safeLimit;
  const params = [];
  const conditions = ["c.id IS NOT NULL"];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const search = clean(q);
  if (search) {
    const normalizedSearch = normalizeCandidateName(search);
    const rawParam = push(`%${search}%`);
    const normalizedParam = push(`%${normalizedSearch}%`);
    conditions.push(`(
      u.canonical_name ILIKE ${rawParam}
      OR u.normalized_name ILIKE ${normalizedParam}
      OR EXISTS (
        SELECT 1
        FROM universal_candidate_aliases alias
        WHERE alias.candidate_entity_id = u.id
          AND (
            alias.alias ILIKE ${rawParam}
            OR alias.normalized_alias ILIKE ${normalizedParam}
          )
      )
    )`);
  }

  if (clean(state)) {
    conditions.push(`UPPER(COALESCE(c.state, u.home_state, '')) = ${push(upper(state).slice(0, 2))}`);
  }
  if (clean(office)) {
    conditions.push(`COALESCE(c.office_name, '') ILIKE ${push(`%${clean(office)}%`)}`);
  }
  if (Number(cycle)) {
    conditions.push(`c.cycle = ${push(Number(cycle))}`);
  }
  if (clean(party)) {
    conditions.push(`COALESCE(u.party, '') ILIKE ${push(`%${clean(party)}%`)}`);
  }
  if (clean(ballotStatus) && clean(ballotStatus).toLowerCase() !== "all") {
    conditions.push(`LOWER(COALESCE(c.ballot_status, 'active')) = ${push(clean(ballotStatus).toLowerCase())}`);
  }

  const rowsResult = await pool.query(
    `SELECT
       u.id AS candidate_entity_id,
       c.id AS candidacy_id,
       u.canonical_name,
       u.normalized_name,
       u.first_name,
       u.middle_name,
       u.last_name,
       u.suffix,
       u.party,
       u.home_state,
       u.website,
       u.photo_url,
       u.verification_status,
       u.confidence_score,
       c.office_level,
       c.office_name,
       COALESCE(c.state, u.home_state) AS state,
       c.county,
       c.locality,
       c.district,
       c.cycle,
       c.ballot_status,
       identifier.provider,
       identifier.identifier_type,
       identifier.identifier_value AS candidate_id,
       COUNT(*) OVER()::integer AS total_count
     FROM universal_candidate_entities u
     JOIN universal_candidacies c ON c.candidate_entity_id = u.id
     LEFT JOIN LATERAL (
       SELECT i.provider, i.identifier_type, i.identifier_value
       FROM universal_candidate_identifiers i
       WHERE i.candidate_entity_id = u.id
         AND (
           NULLIF(c.metadata->>'fec_candidate_id', '') IS NULL
           OR i.identifier_value = c.metadata->>'fec_candidate_id'
         )
       ORDER BY
         (i.identifier_value = c.metadata->>'fec_candidate_id') DESC,
         (i.identifier_type = 'fec_candidate_id') DESC,
         i.id DESC
       LIMIT 1
     ) identifier ON TRUE
     WHERE ${conditions.join(" AND ")}
     ORDER BY
       CASE WHEN LOWER(COALESCE(c.ballot_status, '')) = 'active' THEN 0 ELSE 1 END,
       u.canonical_name ASC,
       c.cycle DESC NULLS LAST,
       c.office_name ASC
     LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );

  const total = Number(rowsResult.rows[0]?.total_count || 0);
  const candidates = rowsResult.rows.map(({ total_count: _totalCount, ...row }) => ({
    ...row,
    name: row.canonical_name,
  }));

  return {
    ok: true,
    build: UNIVERSAL_CANDIDATE_BUILD,
    total,
    page: safePage,
    limit: safeLimit,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
    candidates,
    generated_at: new Date().toISOString(),
  };
}

export async function getUniversalProviderHealth() {
  const result = await pool.query(
    `SELECT provider_key, provider_name, provider_type, jurisdiction_level, state,
            enabled, priority, capabilities, freshness_minutes, last_success_at,
            last_failure_at, last_error
       FROM universal_candidate_providers
      ORDER BY priority DESC, provider_name ASC`
  );
  return {
    ok: true,
    build: UNIVERSAL_CANDIDATE_BUILD,
    providers: result.rows,
    generated_at: new Date().toISOString(),
  };
}

export default {
  resolveUniversalCandidate,
  listUniversalCandidates,
  storeCandidateEvidence,
  listCandidateEvidence,
  getUniversalProviderHealth,
};
