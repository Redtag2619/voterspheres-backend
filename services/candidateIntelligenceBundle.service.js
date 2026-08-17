import { executeExecutiveVoiceTool } from "./executiveVoiceTools.service.js";

import {

  UNIVERSAL_CANDIDATE_BUILD,

  normalizeOfficeLevel,

  resolveUniversalCandidate,

  storeCandidateEvidence,

} from "./universalCandidateRegistry.service.js";

 

const now = () => new Date().toISOString();

const clean = (value = "") => String(value ?? "").replace(/\s+/g, " ").trim();

const array = (value) => (Array.isArray(value) ? value : []);

const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const limitOf = (value) => Math.max(1, Math.min(Number(value) || 12, 25));

 

async function safeTool(name, argumentsValue, user) {

  try {

    return await executeExecutiveVoiceTool({ name, arguments: argumentsValue, user });

  } catch (error) {

    return { ok: false, usable: false, degraded: true, tool: name, error: error?.message || String(error), records: [], sources: [], warnings: [] };

  }

}

 

function recordsFrom(result) {

  const data = object(result?.data);

  return array(result?.records).length

    ? array(result.records)

    : array(data.records).length

      ? array(data.records)

      : array(data.results).length

        ? array(data.results)

        : array(result?.results);

}

 

function sourcesFrom(...results) {

  const seen = new Set();

  const sources = [];

  for (const result of results) {

    for (const source of array(result?.sources)) {

      const normalized = typeof source === "string" ? { label: source } : object(source);

      const key = clean(normalized.url || normalized.source_url || normalized.label || normalized.name || JSON.stringify(normalized));

      if (!key || seen.has(key)) continue;

      seen.add(key);

      sources.push(normalized);

    }

  }

  return sources.slice(0, 50);

}

 

function identityFromRegistry(resolution, requested) {

  const rows = resolution.matches.length ? resolution.matches : [];

  return rows.map((row) => ({

    candidate_id: row.identifier_type === "fec_candidate_id" ? row.identifier_value : null,

    universal_candidate_id: row.id,

    candidacy_id: row.candidacy_id || null,

    name: row.canonical_name || requested,

    state: row.state || row.home_state || null,

    office: row.office_name || null,

    office_level: row.office_level || null,

    district: row.district || null,

    cycle: row.cycle || null,

    party: row.party || null,

    ballot_status: row.ballot_status || null,

    confidence: row.match_score,

    provider: row.provider || "voterspheres_registry",

    verified: Boolean(row.identifier_value || row.verification_status === "provider_verified"),

  }));

}

 

function identitiesFromStatistics(statistics, requested) {

  const data = object(statistics?.data);

  const candidates = array(data.candidates).length ? array(data.candidates) : recordsFrom(statistics);

  return candidates.map((row) => ({

    candidate_id: row.candidate_id || row.fec_candidate_id || row.id || null,

    name: row.name || row.full_name || row.candidate_name || requested,

    state: row.state || row.state_code || null,

    office: row.office || row.office_full || null,

    office_level: normalizeOfficeLevel({ office: row.office || row.office_full }),

    district: row.district || row.district_number || null,

    cycle: row.cycle || row.election_year || null,

    party: row.party || row.party_full || null,

    committee_id: row.committee_id || row.principal_committee_id || null,

    provider: "openfec_or_stored_candidates",

    verified: Boolean(row.candidate_id || row.fec_candidate_id),

    record: row,

  }));

}

 

function pollingGroups(result) {

  const data = object(result?.data);

  const direct = array(data.direct_race_records).length ? array(data.direct_race_records) : array(result?.direct_race_records);

  const candidateContext = array(data.candidate_context_records).length ? array(data.candidate_context_records) : array(result?.candidate_context_records);

  const stateContext = array(data.state_context_records).length ? array(data.state_context_records) : array(result?.state_context_records);

  const records = recordsFrom(result);

  return {

    status: result?.status || data.status || (direct.length ? "direct_race_available" : records.length ? "context_available" : "unavailable"),

    records,

    direct_race_records: direct.length ? direct : records,

    candidate_context_records: candidateContext,

    state_context_records: stateContext,

    direct_count: direct.length || Number(result?.direct_count || data.direct_count || records.length || 0),

    candidate_context_count: candidateContext.length || Number(result?.candidate_context_count || data.candidate_context_count || 0),

    state_context_count: stateContext.length || Number(result?.state_context_count || data.state_context_count || 0),

    degraded: Boolean(result?.degraded || !result?.ok),

  };

}

 

function uniqueIdentities(...groups) {

  const seen = new Set();

  return groups.flat().filter((row) => {

    const key = clean(row.candidate_id || row.universal_candidate_id || `${row.name}|${row.state}|${row.office}|${row.district}`).toLowerCase();

    if (!key || seen.has(key)) return false;

    seen.add(key);

    return true;

  });

}

 

function useful(result) {

  return Boolean(result?.ok && (recordsFrom(result).length || result?.data || result?.summary));

}

 

async function persistNews(resolution, newsRecords) {

  const selected = resolution.selected;

  if (!selected?.id) return;

  await Promise.allSettled(newsRecords.slice(0, 10).map((record) =>

    storeCandidateEvidence({

      candidateEntityId: selected.id,

      candidacyId: selected.candidacy_id || null,

      providerKey: clean(record.provider || record.source || "live_news"),

      evidenceType: "news",

      title: record.title || record.headline,

      summary: record.summary || record.description || record.snippet,

      sourceName: record.publisher || record.source_name || record.source,

      sourceUrl: record.url || record.source_url || record.link,

      sourceRecordId: record.id || record.guid,

      publishedAt: record.published_at || record.publishedAt || record.date,

      confidenceScore: record.confidence || 75,

      payload: record,

    })

  ));

}

 

export async function getCandidateIntelligenceBundle({

  candidate = "",

  candidateId = "",

  state = "",

  office = "",

  cycle = "",

  locality = "",

  county = "",

  district = "",

  workspaceId = 1,

  workspace_id,

  limit = 12,

  user = {},

} = {}) {

  const requestedCandidate = clean(candidate);

  const requestedCandidateId = clean(candidateId);

  const normalizedLimit = limitOf(limit);

  const context = {

    candidate: requestedCandidate,

    candidate_id: requestedCandidateId,

    state: clean(state).toUpperCase(),

    office: clean(office),

    office_level: normalizeOfficeLevel({ office, locality, county }),

    cycle: Number(cycle) || new Date().getFullYear(),

    locality: clean(locality),

    county: clean(county),

    district: clean(district),

    workspace_id: Number(workspaceId || workspace_id || 1),

    limit: normalizedLimit,

  };

 

  const warnings = [];

  const diagnostics = { build: UNIVERSAL_CANDIDATE_BUILD, context, providers: [] };

 

  let resolution = { status: "unavailable", confidence: 0, selected: null, matches: [] };

  try {

    resolution = await resolveUniversalCandidate(context);

  } catch (error) {

    warnings.push(`Universal registry lookup was unavailable: ${error.message}`);

  }

 

  const statistics = await safeTool("get_candidate_statistics", context, user);

  const registryIdentities = identityFromRegistry(resolution, requestedCandidate);

  const statisticsIdentities = identitiesFromStatistics(statistics, requestedCandidate);

  const identities = uniqueIdentities(registryIdentities, statisticsIdentities);

 

  const finance = [];

  const federalIdentities = identities.filter((row) => /^[PHS][A-Z0-9]{8}$/i.test(clean(row.candidate_id)));

  for (const identity of federalIdentities.slice(0, 4)) {

    const result = await safeTool("get_fec_finance", {

      ...context,

      candidate: identity.name || requestedCandidate,

      candidate_id: identity.candidate_id,

      committee_id: identity.committee_id || "",

    }, user);

    finance.push({ identity, result });

  }

 

  const [pollingResult, newsResult, unifiedResult] = await Promise.all([

    safeTool("get_latest_polling", context, user),

    safeTool("search_live_news", { ...context, query: requestedCandidate, candidate: requestedCandidate }, user),

    safeTool("get_candidate_live_intelligence", context, user),

  ]);

 

  const polling = pollingGroups(pollingResult);

  const news = recordsFrom(newsResult).slice(0, normalizedLimit);

  const unifiedData = object(unifiedResult?.data);

  const signals = (array(unifiedData.signals).length ? array(unifiedData.signals) : array(unifiedResult?.signals)).slice(0, 20);

  const strategy = (array(unifiedData.strategy).length ? array(unifiedData.strategy) : array(unifiedResult?.strategy)).slice(0, 20);

  const operations = object(unifiedData.operations || unifiedResult?.operations);

 

  await persistNews(resolution, news);

 

  const usableTools = [statistics, ...finance.map((entry) => entry.result), pollingResult, newsResult, unifiedResult].filter(useful);

  const sources = sourcesFrom(statistics, ...finance.map((entry) => entry.result), pollingResult, newsResult, unifiedResult);

  const evidenceCount = identities.length + finance.filter((entry) => useful(entry.result)).length + polling.records.length + news.length + signals.length;

  const usable = evidenceCount > 0;

  const evidenceStatus = usableTools.length >= 3 ? "live" : usableTools.length ? "partial" : "unavailable";

  const confidence = usable ? Math.min(100, Math.round(45 + Math.min(25, evidenceCount) * 2 + Math.min(5, sources.length))) : 0;

 

  for (const [name, result] of [["candidate_statistics", statistics], ["polling", pollingResult], ["news", newsResult], ["candidate_live_intelligence", unifiedResult]]) {

    diagnostics.providers.push({ name, ok: Boolean(result?.ok), degraded: Boolean(result?.degraded), error: result?.error || null, record_count: recordsFrom(result).length });

    if (!result?.ok && result?.error) warnings.push(`${name}: ${result.error}`);

  }

  if (!finance.length && context.office_level === "federal") warnings.push("No verified FEC candidate identifier was resolved; federal finance was not requested.");

  if (!polling.records.length) warnings.push("No candidate-specific polling was available. This is a data gap, not a zero result.");

 

  const bundleData = {

    candidate: requestedCandidate || identities[0]?.name || requestedCandidateId,

    requested_context: context,

    resolution,

    identities,

    profile: object(statistics?.data?.profile || unifiedData.profile),

    finance,

    polling,

    news,

    signals,

    strategy,

    operations,

    coverage: {

      evidence_status: evidenceStatus,

      confidence,

      usable_tools: usableTools.length,

      attempted_tools: 4 + finance.length,

      source_count: sources.length,

      identity_status: resolution.status,

      office_level: context.office_level,

      limitations: warnings,

    },

    generated_at: now(),

  };

 

  return {

    ok: usable,

    build: UNIVERSAL_CANDIDATE_BUILD,

    provider: "voterspheres_universal_candidate_intelligence",

    summary: usable

      ? `Retrieved evidence-backed intelligence for ${bundleData.candidate}: ${identities.length} candidate identities, ${finance.filter((entry) => useful(entry.result)).length} official finance reports, ${polling.direct_count} direct polling records, ${news.length} current reports, ${signals.length} political signals, and ${strategy.length} strategy recommendations.`

      : `No verified evidence was retrieved for ${bundleData.candidate}. The system did not substitute generic model knowledge.`,

    data: bundleData,

    records: identities,

    count: evidenceCount,

    sources,

    warnings,

    diagnostics,

    degraded: evidenceStatus !== "live",

    evidence_status: evidenceStatus,

    confidence,

    ...bundleData,

  };

}

 

export default { getCandidateIntelligenceBundle };

 
