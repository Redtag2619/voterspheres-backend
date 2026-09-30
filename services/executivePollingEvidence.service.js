const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const cycleOf = value => /^\d{4}$/.test(text(value)) ? Number(value) : null;
const scopes = new Set(['election_cycle', 'continuous_tracking']);
const trackingTypes = new Set(['approval', 'favorability']);
export const EXECUTIVE_POLLING_EVIDENCE_VERSION = '2.9.0';

function surveyDate(record) {
  // Never substitute ingestion/cache update times for survey freshness.
  const value = record.field_end || record.end_date || record.poll_date || record.published_at || record.publishedAt;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
function recordKey(record) {
  if (record.id !== undefined && record.id !== null) return `id:${record.id}`;
  return JSON.stringify([record.source,record.poll_id,record.candidate_id,record.candidate_name,record.answer,record.choice,record.pct,record.temporal_scope,record.cycle,record.field_end,record.pollster]);
}
function unique(records) {
  const seen = new Set();
  return records.filter(r => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    const key = recordKey(r);if (seen.has(key)) return false;seen.add(key);return true;
  });
}
export function buildExecutivePollingEvidence(polling = {}, context = {}, { now = Date.now(), staleAfterDays = 30 } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(staleAfterDays) || staleAfterDays <= 0) throw new Error('Invalid freshness configuration');
  const requestedCycle = cycleOf(context.cycle);
  const buckets = {
    direct: unique([...list(polling.direct_records),...list(polling.direct_race_records)]),
    candidate: unique(list(polling.candidate_context_records)),
    state: unique(list(polling.state_context_records)),
  };
  // Unbucketed provider output remains context, never promoted to a direct race.
  const bucketIds = new Set(Object.values(buckets).flat().map(recordKey));
  buckets.candidate.push(...unique(list(polling.records)).filter(r => !bucketIds.has(recordKey(r))));
  const excluded = { unresolved_or_missing_scope: 0, cycle_mismatch_or_missing: 0, inconsistent_tracking_cycle: 0, invalid_date_or_future: 0, modeled_or_estimated_records: 0 };
  const accepted = { direct: [], candidate: [], state: [], continuous: [] };
  const seen = new Set();
  for (const [bucket, records] of Object.entries(buckets)) {
    for (const record of records) {
      const key = recordKey(record);if (seen.has(key)) continue;seen.add(key);
      if (record.is_estimate === true || record.is_estimate === 'true' || (record.record_type && record.record_type !== 'measured_poll')) {excluded.modeled_or_estimated_records++;continue;}
      const scope = text(record.temporal_scope).toLowerCase();
      if (!scopes.has(scope)) {excluded.unresolved_or_missing_scope++;continue;}
      if (scope === 'continuous_tracking' && text(record.cycle)) {excluded.inconsistent_tracking_cycle++;continue;}
      if (scope === 'election_cycle' && (!requestedCycle || cycleOf(record.cycle) !== requestedCycle)) {excluded.cycle_mismatch_or_missing++;continue;}
      const date = surveyDate(record);
      if (date !== null && date > now + 300000) {excluded.invalid_date_or_future++;continue;}
      if (scope === 'continuous_tracking') {accepted.continuous.push(record);continue;}
      // Approval/favorability can never support a direct election-race claim.
      const target = bucket === 'direct' && trackingTypes.has(text(record.poll_type).toLowerCase()) ? 'candidate' : bucket;
      accepted[target].push(record);
    }
  }
  const records = accepted.direct.length ? accepted.direct : accepted.candidate.length ? accepted.candidate : accepted.state;
  const contextCount = accepted.candidate.length + accepted.state.length + accepted.continuous.length;
  const dates = records.map(surveyDate).filter(d => d !== null);
  const newest = dates.length ? Math.max(...dates) : null;
  const ageDays = newest === null ? null : Math.max(0, Math.floor((now - newest) / 86400000));
  const freshness = {
    status: records.length === 0 ? 'unavailable' : newest === null ? 'unknown' : ageDays > staleAfterDays ? 'stale' : 'current',
    newest_survey_date: newest === null ? null : new Date(newest).toISOString(),
    age_days: ageDays, threshold_days: staleAfterDays,
    undated_records: records.length - dates.length,
  };
  const status = accepted.direct.length ? 'direct_race_available' : accepted.candidate.length ? 'candidate_context_available' : accepted.state.length ? 'state_context_available' : accepted.continuous.length ? 'continuous_context_available' : polling.status === 'provider_error' ? 'provider_error' : 'no_polling_available';
  const limitations = [];
  if (!accepted.direct.length) limitations.push('No verified election-cycle polling for the requested direct race is available. Context is not a race estimate.');
  if (!requestedCycle) limitations.push('Requested election cycle is missing or invalid; election polling was excluded.');
  if (freshness.status === 'stale') limitations.push(`Selected election polling is ${ageDays} days old; the freshness threshold is ${staleAfterDays} days.`);
  if (freshness.undated_records) limitations.push('Some selected polling records have no usable survey/publication date.');
  if (Object.values(excluded).some(n=>n>0)) limitations.push('Records with unsupported scope, incompatible cycle, future survey dates or modeled estimates were excluded.');
  if (polling.degraded || status === 'provider_error') limitations.push('Polling provider coverage is degraded.');
  const executiveSummary = `Polling coverage: ${accepted.direct.length} direct race records for cycle ${requestedCycle ?? 'unspecified'}; ${contextCount} contextual records, including ${accepted.continuous.length} continuous tracking records. Selected election polling freshness: ${freshness.status}${ageDays === null ? '' : ` (${ageDays} days old)`}. ${limitations.join(' ')}`.trim();
  // Do not retain raw provider payloads that can bypass the filtered buckets.
  return {
    evidence_version: EXECUTIVE_POLLING_EVIDENCE_VERSION, status,
    query_type: accepted.direct.length ? 'direct_race' : accepted.candidate.length ? 'candidate_context' : accepted.state.length ? 'state_context' : null,
    records, direct_records: accepted.direct, direct_race_records: accepted.direct,
    candidate_context_records: accepted.candidate, state_context_records: accepted.state,
    continuous_tracking_records: accepted.continuous,
    direct_count: accepted.direct.length, candidate_context_count: accepted.candidate.length,
    state_context_count: accepted.state.length, continuous_tracking_count: accepted.continuous.length,
    context_count: contextCount, raw_record_count: seen.size,
    direct_race_available: accepted.direct.length > 0,
    candidate_context_available: accepted.candidate.length > 0,
    state_context_available: accepted.state.length > 0,
    requested_race: { candidate: context.candidate ?? null, state: context.state ?? null, office: context.office ?? null, district: context.district ?? null, cycle: requestedCycle },
    temporal_scope: 'election_cycle', freshness, excluded_record_counts: excluded,
    coverage: { direct_race: accepted.direct.length > 0, candidate_context: accepted.candidate.length > 0, state_context: accepted.state.length > 0, continuous_tracking: accepted.continuous.length > 0 },
    limitations, executive_summary: executiveSummary, degraded: Boolean(polling.degraded || status === 'provider_error'),
  };
}
export function appendExecutivePollingSummary(bundle) {
  const summary = bundle?.data?.polling?.executive_summary || bundle?.polling?.executive_summary;
  if (!summary) return bundle;
  return { ...bundle, summary: `${text(bundle.summary)}\n\n${summary}`.trim(), executive_polling_summary: summary };
}
