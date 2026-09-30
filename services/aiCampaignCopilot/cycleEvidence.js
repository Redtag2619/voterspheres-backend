const CYCLE_KEYS = ['cycle', 'cycle_year', 'election_cycle', 'election_year'];
const SECTION_KEYS = {
  mission: ['mission_items', 'critical_signals', 'open_tasks', 'rapid_responses', 'crm_followups', 'workspace_health', 'vendor_gaps'],
  advisor: ['recommendations', 'risks', 'opportunities'],
  warRoom: ['threats', 'queue', 'signals', 'command_cards'],
};
export function explicitEvidenceCycle(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const values = CYCLE_KEYS.filter(key => row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '').map(key => Number(row[key]));
  if (!values.length || values.some(year => !Number.isInteger(year) || year < 2026 || year > 2200)) return null;
  return new Set(values).size === 1 ? values[0] : null;
}
export function isolateCampaignCycleEvidence(context = {}, temporalScope = {}) {
  if (!temporalScope.strict_temporal) return context;
  const cycle = Number(temporalScope.cycle_year);
  if (!Number.isInteger(cycle) || cycle < 2026 || cycle > 2200) throw new Error('A resolved campaign cycle is required for evidence isolation.');
  const coverage = { cycle, matched_records: 0, excluded_records: 0, excluded_unscoped_records: 0, excluded_other_cycle_records: 0 };
  const keep = row => {
    const recordedCycle = explicitEvidenceCycle(row);
    const protectedScope = [row?.temporal_scope, row?.cycle_resolution_status].some(value => ['unresolved', 'legacy_unresolved', 'continuous_tracking'].includes(String(value || '').trim().toLowerCase()));
    if (recordedCycle === cycle && !protectedScope) { coverage.matched_records++; return true; }
    coverage.excluded_records++;
    if (recordedCycle === null || protectedScope) coverage.excluded_unscoped_records++;
    else coverage.excluded_other_cycle_records++;
    return false;
  };
  const next = { ...context };
  for (const [section, keys] of Object.entries(SECTION_KEYS)) {
    next[section] = { ...(context[section] || {}) };
    for (const key of keys) next[section][key] = (Array.isArray(context[section]?.[key]) ? context[section][key] : []).filter(keep);
    // Source summaries may describe all cycles; do not carry those totals forward.
    next[section].summary = { cycle, cycle_filtered: true };
  }
  next.reports = (Array.isArray(context.reports) ? context.reports : []).filter(keep);
  next.workspace = context.workspace && keep(context.workspace) ? context.workspace : null;
  next.scope = { ...(context.scope || {}), cycle: String(cycle), cycle_year: cycle, cycle_evidence: coverage,
    evidence_policy: 'Only explicit matching-cycle records support this campaign. Donors, vendors and CRM are shared operational context, not verified cycle-specific evidence. Missing or conflicting cycle metadata is excluded; record dates never infer a cycle.',
    cycle_evidence_status: coverage.matched_records ? 'matching_cycle_context_available' : 'no_verified_cycle_context' };
  return next;
}
