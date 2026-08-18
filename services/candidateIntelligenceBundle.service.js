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
        : array(data.articles).length
          ? array(data.articles)
          : array(result?.articles).length
            ? array(result.articles)
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

function normalizePollingText(value = "") {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedDistrict(value = "") {
  const normalized = normalizePollingText(value);

  if (!normalized) return "";

  if (
    normalized === "statewide" ||
    normalized === "at large" ||
    normalized === "atlarge"
  ) {
    return "statewide";
  }

  const numeric = normalized.match(/\d+/)?.[0];

  return numeric
    ? String(Number(numeric))
    : normalized;
}

function pollingRecordText(record = {}) {
  return normalizePollingText(
    [
      record.candidate_name,
      record.candidate,
      record.name,
      record.answer,
      record.subject,
      record.race_name,
      record.question,
      record.poll_question,
      record.ballot_question,
      record.office,
      record.state,
      record.district,
      JSON.stringify(record.candidates || []),
      JSON.stringify(record.choices || []),
      JSON.stringify(record.answers || []),
      JSON.stringify(record.source_payload || {}),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function pollingRecordCandidateIds(record = {}) {
  return [
    record.candidate_id,
    record.fec_candidate_id,
    record.answer_candidate_id,
    record.subject_candidate_id,
    record.candidate_fec_id,
  ]
    .map((value) => clean(value).toUpperCase())
    .filter(Boolean);
}

function candidateMatchesPollingRecord(
  record = {},
  candidateName = "",
  candidateIds = []
) {
  const requestedIds = candidateIds
    .map((value) => clean(value).toUpperCase())
    .filter(Boolean);

  const recordIds = pollingRecordCandidateIds(record);

  if (
    requestedIds.length &&
    recordIds.some((candidateId) =>
      requestedIds.includes(candidateId)
    )
  ) {
    return true;
  }

  const candidateTokens = normalizePollingText(candidateName)
    .split(" ")
    .filter((token) => token.length > 1);

  if (!candidateTokens.length) {
    return false;
  }

  const recordText = pollingRecordText(record);

  return candidateTokens.every((token) =>
    recordText.split(" ").includes(token)
  );
}

function pollingRaceMatches(record = {}, context = {}) {
  const requestedState = clean(context.state).toUpperCase();
  const requestedOffice = normalizePollingText(context.office);
  const requestedDistrict = normalizedDistrict(context.district);

  const recordState = clean(
    record.state ||
    record.state_code ||
    record.jurisdiction
  ).toUpperCase();

  const recordOffice = normalizePollingText(
    record.office ||
    record.office_name ||
    record.race_office
  );

  const recordDistrict = normalizedDistrict(
    record.district ||
    record.district_number ||
    record.congressional_district
  );

  /*
   * A record cannot be classified as direct-race evidence
   * when the requested geographic fields are absent from it.
   */
  if (requestedState) {
    if (!recordState || recordState !== requestedState) {
      return false;
    }
  }

  if (requestedOffice) {
    if (
      !recordOffice ||
      !(
        recordOffice === requestedOffice ||
        recordOffice.includes(requestedOffice) ||
        requestedOffice.includes(recordOffice)
      )
    ) {
      return false;
    }
  }

  if (requestedDistrict) {
    if (
      !recordDistrict ||
      recordDistrict !== requestedDistrict
    ) {
      return false;
    }
  }

  return true;
}

function uniquePollingRecords(records = []) {
  const seen = new Set();

  return records.filter((record) => {
    const key = clean(
      record.dedupe_key ||
      record.poll_id ||
      [
        record.pollster,
        record.candidate_name,
        record.answer,
        record.pct,
        record.field_end,
        record.published_at,
        record.state,
        record.office,
        record.district,
      ].join("|")
    ).toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function pollingGroups(
  result,
  context = {},
  identities = [],
  limit = 12
) {
  const data = object(result?.data);
  const maximumRecords = Math.max(
    1,
    Math.min(Number(limit) || 12, 50)
  );

  const requestedCandidate = clean(
    context.candidate ||
    context.candidate_name ||
    identities[0]?.name ||
    identities[0]?.canonical_name
  );

  const requestedCandidateIds = [
    context.candidate_id,
    context.fec_candidate_id,
    ...identities.map((identity) =>
      identity.candidate_id ||
      identity.fec_candidate_id ||
      identity.identifier_value
    ),
  ].filter(Boolean);

  const suppliedRecords = uniquePollingRecords([
    ...array(data.direct_records),
    ...array(data.direct_race_records),
    ...array(result?.direct_records),
    ...array(result?.direct_race_records),
    ...array(data.candidate_context_records),
    ...array(result?.candidate_context_records),
    ...array(data.state_context_records),
    ...array(result?.state_context_records),
    ...recordsFrom(result),
  ]);

  const directMatches = [];
  const candidateContextMatches = [];
  const stateContextMatches = [];

  const requestedState = clean(context.state).toUpperCase();

  for (const record of suppliedRecords) {
    const candidateMatch = candidateMatchesPollingRecord(
      record,
      requestedCandidate,
      requestedCandidateIds
    );

    if (
      candidateMatch &&
      pollingRaceMatches(record, context)
    ) {
      directMatches.push(record);
      continue;
    }

    if (candidateMatch) {
      candidateContextMatches.push(record);
      continue;
    }

    const recordState = clean(
      record.state ||
      record.state_code ||
      record.jurisdiction
    ).toUpperCase();

    if (
      requestedState &&
      recordState === requestedState
    ) {
      stateContextMatches.push(record);
    }
  }

  const directRecords =
    directMatches.slice(0, maximumRecords);

  const candidateContextRecords =
    candidateContextMatches.slice(0, maximumRecords);

  const stateContextRecords =
    stateContextMatches.slice(0, maximumRecords);

  const status = directRecords.length
    ? "direct_race_available"
    : candidateContextRecords.length
      ? "candidate_context_available"
      : stateContextRecords.length
        ? "state_context_available"
        : result?.ok
          ? "no_polling_available"
          : "provider_error";

  const queryType =
    status === "direct_race_available"
      ? "direct_race"
      : status === "candidate_context_available"
        ? "candidate_context"
        : status === "state_context_available"
          ? "state_context"
          : null;

  const selectedRecords =
    queryType === "direct_race"
      ? directRecords
      : queryType === "candidate_context"
        ? candidateContextRecords
        : queryType === "state_context"
          ? stateContextRecords
          : [];

  return {
    status,
    query_type: queryType,
    records: selectedRecords,
    direct_records: directRecords,
    direct_race_records: directRecords,
    candidate_context_records:
      candidateContextRecords,
    state_context_records: stateContextRecords,
    direct_count: directRecords.length,
    candidate_context_count:
      candidateContextRecords.length,
    state_context_count:
      stateContextRecords.length,
    requested_race: {
      candidate: requestedCandidate,
      candidate_ids: requestedCandidateIds,
      state: clean(context.state),
      office: clean(context.office),
      district: clean(context.district),
      cycle: context.cycle || null,
    },
    raw_record_count: suppliedRecords.length,
    source_result: result,
    degraded: Boolean(
      result?.degraded ||
      !result?.ok
    ),
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

const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX",
  "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

function recordText(record = {}) {
  return clean([
    record.title,
    record.headline,
    record.name,
    record.label,
    record.subject,
    record.candidate,
    record.candidate_name,
    record.summary,
    record.detail,
    record.description,
    record.rationale,
  ].filter(Boolean).join(" "));
}

function filterContextualRecords(records, context = {}) {
  const requestedState = clean(context.state).toUpperCase();
  if (!requestedState) return array(records);

  const candidateTokens = clean(context.candidate)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  return array(records).filter((record) => {
    const explicitState = clean(
      record.state || record.state_code || record.jurisdiction
    ).toUpperCase();

    if (explicitState && STATE_CODES.has(explicitState)) {
      return explicitState === requestedState;
    }

    const text = recordText(record);
    const upperText = text.toUpperCase();
    const mentionedStates = [...upperText.matchAll(/\b[A-Z]{2}\b/g)]
      .map((match) => match[0])
      .filter((code) => STATE_CODES.has(code));

    if (mentionedStates.length) {
      return mentionedStates.includes(requestedState);
    }

    const lowerText = text.toLowerCase();
    const candidateSpecific = candidateTokens.some((token) =>
      lowerText.includes(token)
    );

    // Preserve candidate-specific and state-neutral records. Explicitly
    // out-of-state records are rejected above.
    return candidateSpecific || !mentionedStates.length;
  });
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

  /*
   * The request may contain only a natural-language candidate name. Once the
   * registry resolves that name, propagate the verified race geography and
   * identifier to every downstream provider. Without this step, polling can
   * fall back to broad context and signals/strategy can become firm-wide.
   */
  const selectedIdentity = object(resolution?.selected);
  const resolvedOffice = clean(
    context.office || selectedIdentity.office_name || selectedIdentity.office
  );
  const resolvedLocality = clean(
    context.locality || selectedIdentity.locality
  );
  const resolvedCounty = clean(
    context.county || selectedIdentity.county
  );
  const resolvedContext = {
    ...context,
    candidate: clean(
      requestedCandidate ||
      selectedIdentity.canonical_name ||
      selectedIdentity.name
    ),
    candidate_id: clean(
      requestedCandidateId ||
      selectedIdentity.identifier_value ||
      selectedIdentity.fec_candidate_id ||
      selectedIdentity.candidate_id
    ),
    state: clean(
      context.state || selectedIdentity.state || selectedIdentity.home_state
    ).toUpperCase(),
    office: resolvedOffice,
    office_level: normalizeOfficeLevel({
      office: resolvedOffice,
      locality: resolvedLocality,
      county: resolvedCounty,
    }),
    cycle: Number(context.cycle || selectedIdentity.cycle) ||
      new Date().getFullYear(),
    locality: resolvedLocality,
    county: resolvedCounty,
    district: clean(context.district || selectedIdentity.district),
  };

  diagnostics.context = resolvedContext;
  diagnostics.requested_context = context;

  const statistics = await safeTool(
    "get_candidate_statistics",
    resolvedContext,
    user
  );
  const registryIdentities = identityFromRegistry(resolution, requestedCandidate);
  const statisticsIdentities = identitiesFromStatistics(statistics, requestedCandidate);
  const identities = uniqueIdentities(
    registryIdentities,
    statisticsIdentities
  ).filter(
    (identity) =>
      Boolean(identity.candidate_id || identity.candidacy_id)
  );

  const finance = [];
  const federalIdentities = identities.filter((row) => /^[PHS][A-Z0-9]{8}$/i.test(clean(row.candidate_id)));
  for (const identity of federalIdentities.slice(0, 4)) {
    const result = await safeTool("get_fec_finance", {
      ...resolvedContext,
      candidate: identity.name || requestedCandidate,
      candidate_id: identity.candidate_id,
      committee_id: identity.committee_id || "",
    }, user);
    finance.push({ identity, result });
  }

  const [pollingResult, newsResult, unifiedResult] = await Promise.all([
    safeTool("get_latest_polling", resolvedContext, user),
    safeTool("search_live_news", {
      ...resolvedContext,
      query: resolvedContext.candidate,
      candidate: resolvedContext.candidate,
    }, user),
    safeTool("get_unified_executive_intelligence", resolvedContext, user),
  ]);

  const polling = pollingGroups(
  pollingResult,
  resolvedContext,
  identities,
  normalizedLimit
);
  const news = recordsFrom(newsResult).slice(0, normalizedLimit);
  const unifiedData = object(unifiedResult?.data);
  const unifiedBriefing = object(unifiedData.briefing);
  const unifiedIntelligence = object(unifiedData.intelligence);

  const signals = filterContextualRecords((
    array(unifiedData.political_signals).length
      ? array(unifiedData.political_signals)
      : array(unifiedData.signals).length
        ? array(unifiedData.signals)
        : array(unifiedIntelligence.signals).length
          ? array(unifiedIntelligence.signals)
          : array(unifiedBriefing.signals)
  ), resolvedContext).slice(0, 20);

  const strategy = filterContextualRecords((
    array(unifiedData.strategy_recommendations).length
      ? array(unifiedData.strategy_recommendations)
      : array(unifiedData.recommendations).length
        ? array(unifiedData.recommendations)
        : array(unifiedData.actions).length
          ? array(unifiedData.actions)
          : array(unifiedBriefing.strategy_recommendations).length
            ? array(unifiedBriefing.strategy_recommendations)
            : array(unifiedBriefing.recommendations).length
              ? array(unifiedBriefing.recommendations)
              : array(unifiedBriefing.recommended_actions)
  ), resolvedContext).slice(0, 20);

  const operations = object(
    unifiedData.operations ||
    unifiedBriefing.operations ||
    unifiedResult?.operations
  );

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
  if (!finance.length && resolvedContext.office_level === "federal") warnings.push("No verified FEC candidate identifier was resolved; federal finance was not requested.");
  if (!polling.records.length) warnings.push("No candidate-specific polling was available. This is a data gap, not a zero result.");

  const bundleData = {
    candidate: requestedCandidate || identities[0]?.name || requestedCandidateId,
    requested_context: resolvedContext,
    input_context: context,
    resolved_context: resolvedContext,
    resolution,
    identities,
    profile: object(statistics?.data?.profile || unifiedData.profile),
    finance: {
      reports: finance,
      count: finance.length,
    },
    polling,
    news,
    signals,
    strategy: {
      recommendations: strategy,
      count: strategy.length,
    },
    operations,
    coverage: {
      evidence_status: evidenceStatus,
      confidence,
      usable_tools: usableTools.length,
      attempted_tools: 4 + finance.length,
      source_count: sources.length,
      identity_status: resolution.status,
      office_level: resolvedContext.office_level,
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
