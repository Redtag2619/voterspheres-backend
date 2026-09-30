import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MONITOR_VERSION = '2.8.0';
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function ageCheck(report, label, now, maxAgeHours, alerts) {
  const time = Date.parse(report.generated_at);
  requireValue(Number.isFinite(time), `${label}: invalid generated_at`);
  if (time > now + 300_000) alerts.push({ code: 'future_evidence', source: label });
  if (now - time > maxAgeHours * 3_600_000) alerts.push({ code: 'stale_evidence', source: label });
}
export function quarantineSnapshot(report) {
  requireValue(report?.closeout_version === '2.7.0' && report.mode === 'diagnostic_only', 'Expected Phase 2.7 diagnostic report');
  const s = report.summary;
  requireValue(s && Array.isArray(report.decisions) && Array.isArray(report.mapping), 'Incomplete closeout report');
  const fields = ['unresolved_records', 'unresolved_groups', 'deterministic_records', 'deterministic_groups', 'quarantined_records', 'quarantined_groups'];
  for (const field of fields) requireValue(integer(s[field]), `Invalid summary.${field}`);
  const records = [];
  const groups = new Set();
  let deterministicRecords = 0;
  let deterministicGroups = 0;
  const deterministicIds = new Set();
  for (const group of report.decisions) {
    requireValue(typeof group.group_key === 'string' && !groups.has(group.group_key), 'Invalid or duplicate group_key');
    groups.add(group.group_key);
    requireValue(['deterministic', 'quarantined'].includes(group.decision), 'Invalid group decision');
    requireValue(Array.isArray(group.record_ids) && group.record_ids.length > 0 && group.answer_rows === group.record_ids.length, 'Incomplete poll group');
    if (group.decision === 'deterministic') {
      deterministicGroups++;
      deterministicRecords += group.record_ids.length;
    }
    for (const id of group.record_ids) {
      requireValue(typeof id === 'string' && /^\d+$/.test(id), 'Invalid record ID');
      if (group.decision === 'deterministic') deterministicIds.add(id);
      records.push({ id, group_key: group.group_key, decision: group.decision, issue_code: group.issue_code ?? null });
    }
  }
  requireValue(new Set(records.map(r => r.id)).size === records.length, 'Duplicate record IDs');
  requireValue(s.unresolved_records === records.length && s.unresolved_groups === groups.size, 'Closeout totals mismatch');
  requireValue(s.deterministic_records === deterministicRecords && s.deterministic_groups === deterministicGroups, 'Deterministic totals mismatch');
  requireValue(s.quarantined_records === records.length - deterministicRecords && s.quarantined_groups === groups.size - deterministicGroups, 'Quarantine totals mismatch');
  const expectedStatus = records.length === 0 ? 'complete' : deterministicRecords > 0 ? 'deterministic_correction_available' : 'ambiguous_records_remain_quarantined';
  requireValue(report.closeout_status === expectedStatus, 'Closeout status mismatch');
  const mappedIds = new Set();
  for (const item of report.mapping) {
    requireValue(deterministicIds.has(item.polling_result_id) && !mappedIds.has(item.polling_result_id), 'Invalid mapping record');
    mappedIds.add(item.polling_result_id);
    const group = report.decisions.find(g => g.group_key === item.group_key);
    requireValue(group?.record_ids.includes(item.polling_result_id) && group.proposed_temporal_scope === item.temporal_scope && group.proposed_cycle === item.cycle, 'Mapping differs from decision');
    requireValue((item.temporal_scope === 'continuous_tracking' && item.cycle === null) || (item.temporal_scope === 'election_cycle' && integer(item.cycle) && item.cycle > 0), 'Invalid mapping scope/cycle');
  }
  requireValue(mappedIds.size === deterministicRecords, 'Incomplete deterministic mapping');
  const canonical = report.mapping.map(item => ({ polling_result_id: String(item.polling_result_id), temporal_scope: item.temporal_scope, cycle: item.cycle === null ? null : Number(item.cycle), group_key: item.group_key })).sort((a,b) => a.polling_result_id.localeCompare(b.polling_result_id));
  requireValue(hash(canonical) === report.mapping_sha256, 'Mapping hash mismatch');
  return records.sort((a,b) => a.id.localeCompare(b.id));
}

export function assessPollingOperations({ validation, closeout, baseline = null, now = Date.now(), maxAgeHours = 24 }) {
  requireValue(Number.isFinite(now) && Number.isFinite(maxAgeHours) && maxAgeHours > 0, 'Invalid assessment time or max age');
  const alerts = [];
  requireValue(validation?.phase === '2.6' && validation.validator_version === '2.6.0' && validation.mode === 'read_only', 'Expected Phase 2.6 validation report');
  requireValue(typeof validation.base_url === 'string' && /^https?:\/\//.test(validation.base_url), 'Missing validation environment');
  requireValue(Array.isArray(validation.checks) && validation.checks.length >= 14 && validation.checks.every(c => typeof c.label === 'string' && typeof c.passed === 'boolean'), 'Incomplete validation checks');
  const failed = validation.checks.filter(c => !c.passed).map(c => c.label);
  requireValue(typeof validation.passed === 'boolean' && validation.passed === (failed.length === 0), 'Validation result mismatch');
  const requiredLabels = ['API health', 'Scopes reject anonymous access', 'User scope discovery', 'User receives only public scopes', 'dashboard defaults to election cycle', 'explicit election cycle', 'continuous tracking', 'continuous scope rejects cycle', 'user cannot read unresolved', 'user cannot read combined scope', 'records election scope', 'records continuous scope', 'Post-validation scope discovery', 'Polling scope counts unchanged'];
  requireValue(new Set(validation.checks.map(c => c.label)).size === validation.checks.length, 'Duplicate validation checks');
  requireValue(requiredLabels.every(label => validation.checks.some(c => c.label === label)), 'Missing critical validation checks');
  requireValue(typeof validation.operator_checks_run === 'boolean', 'Missing operator coverage flag');
  if (validation.operator_checks_run) requireValue(['Operator scope discovery','Operator receives protected scopes','Operator can read unresolved scope','Operator can read combined scope'].every(label => validation.checks.some(c => c.label === label)), 'Missing operator checks');
  if (failed.length) alerts.push({ code: 'validation_failed', checks: failed });
  ageCheck(validation, 'validation', now, maxAgeHours, alerts);
  ageCheck(closeout, 'closeout', now, maxAgeHours, alerts);
  const records = quarantineSnapshot(closeout);
  if (closeout.summary.deterministic_records > 0) alerts.push({ code: 'deterministic_correction_available', records: closeout.summary.deterministic_records });
  const coverageNotes = [];
  if (!validation.operator_checks_run) coverageNotes.push('Operator scope checks were not run.');
  let drift = null;
  if (baseline) {
    requireValue(baseline.monitor_version === MONITOR_VERSION && baseline.phase === '2.8' && baseline.passed === true && ['healthy','healthy_with_quarantine'].includes(baseline.status), 'Baseline must be a healthy Phase 2.8 report');
    requireValue(baseline.base_url === validation.base_url, 'Baseline belongs to a different API environment');
    requireValue(Array.isArray(baseline.snapshot) && hash(baseline.snapshot) === baseline.snapshot_sha256, 'Invalid baseline snapshot/hash');
    requireValue(baseline.snapshot.every(r => typeof r.id === 'string' && /^\d+$/.test(r.id) && typeof r.group_key === 'string' && ['quarantined', 'deterministic'].includes(r.decision)) && new Set(baseline.snapshot.map(r => r.id)).size === baseline.snapshot.length, 'Malformed baseline records');
    requireValue(Date.parse(baseline.generated_at) <= now + 300_000 && Number.isFinite(Date.parse(baseline.generated_at)), 'Invalid baseline date');
    const before = new Map(baseline.snapshot.map(r => [r.id, r]));
    const after = new Map(records.map(r => [r.id, r]));
    drift = {
      added_ids: records.filter(r => !before.has(r.id)).map(r => r.id),
      removed_ids: baseline.snapshot.filter(r => !after.has(r.id)).map(r => r.id),
      changed_ids: records.filter(r => before.has(r.id) && JSON.stringify(before.get(r.id)) !== JSON.stringify(r)).map(r => r.id),
    };
    if (Object.values(drift).some(ids => ids.length)) alerts.push({ code: 'quarantine_drift', ...drift });
  } else coverageNotes.push('First assessment: save and review this report as the baseline for subsequent comparisons.');
  return {
    phase: '2.8', monitor_version: MONITOR_VERSION, generated_at: new Date(now).toISOString(),
    mode: 'report_only', base_url: validation.base_url,
    status: alerts.length ? 'attention_required' : records.length ? 'healthy_with_quarantine' : 'healthy',
    passed: alerts.length === 0, alerts, coverage_notes: coverageNotes,
    evidence: { validation_generated_at: validation.generated_at, closeout_generated_at: closeout.generated_at, baseline_generated_at: baseline?.generated_at ?? null },
    summary: closeout.summary, closeout_status: closeout.closeout_status,
    snapshot: records, snapshot_sha256: hash(records), drift,
    policy: 'Reads saved reports only. No database access, cycle assignments, remediation, deployments, or automatic baseline replacement.',
  };
}
export function parseArgs(argv) {
  const args = {};
  const allowed = new Set(['validation', 'closeout', 'baseline', 'output', 'max-age-hours']);
  for (const argument of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    requireValue(match && allowed.has(match[1]) && !Object.hasOwn(args, match[1]), `Invalid argument: ${argument}`);
    args[match[1]] = match[2];
  }
  requireValue(args.validation && args.closeout, 'Required: --validation=FILE --closeout=FILE');
  return args;
}
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, ''));
  const report = assessPollingOperations({ validation: read(args.validation), closeout: read(args.closeout), baseline: args.baseline ? read(args.baseline) : null, maxAgeHours: args['max-age-hours'] === undefined ? 24 : Number(args['max-age-hours']) });
  const directory = path.resolve(args.output || './diagnostics/phase-2-8');
  fs.mkdirSync(directory, { recursive: true });
  const outputPath = path.join(directory, `polling-operations-${report.generated_at.replace(/[:.]/g, '-')}-${createHash('sha256').update(String(Math.random())).digest('hex').slice(0,8)}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ phase: report.phase, status: report.status, alerts: report.alerts, coverage_notes: report.coverage_notes, output_path: outputPath }, null, 2));
  return report.passed ? 0 : 2;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
