import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../services/fec.service.js', import.meta.url), 'utf8');
function load({ fetch, pool } = {}) {
  const context = vm.createContext({
    process: { env: { FEC_API_KEY: 'test-only', FEC_PAC_SYNC_LIMIT: '1' } },
    console: { warn() {} }, URL, Date, Map, Set, Buffer, fetch,
    pool, configuredFederalElectionCycle: () => 2026,
    normalizeFederalElectionCycle: value => Number(value),
  });
  const code = source.replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, '').replace(/export\s+/g, '');
  vm.runInContext(code + '\nglobalThis.api = { preserveSkippedPacEvidence, normalizeFundraisingRows, replaceFundraisingLive, syncFundraisingFromFec, fetchCandidateCommitteesForCandidate, fetchScheduleAForCommittee, fetchPacContributionsForCandidate };', context);
  return context.api;
}
const row = { candidate_id: 'H2TX30178', name: 'TEST', office: 'H', state: 'TX', receipts: 10 };
test('429 stops normalization and makes no database writes', async () => {
  let requests = 0;
  const api = load({ fetch: async () => { requests++; return { ok: false, status: 429, text: async () => 'OVER_RATE_LIMIT' }; }, pool: { connect() { throw Error('Unexpected write'); } } });
  await assert.rejects(api.normalizeFundraisingRows([row, { ...row, candidate_id: 'H2TX30179' }], 2026, { pacSyncLimit: 2 }), /429/);
  assert.equal(requests, 1);
});
test('committee and Schedule A errors propagate instead of returning empty data', async () => {
  const api = load({ fetch: async () => { throw Error('provider unavailable'); } });
  await assert.rejects(api.fetchCandidateCommitteesForCandidate({ candidateId: row.candidate_id, cycle: 2026 }), /provider unavailable/);
  await assert.rejects(api.fetchScheduleAForCommittee({ committeeId: 'C00000001', cycle: 2026 }), /provider unavailable/);
  await assert.rejects(api.fetchPacContributionsForCandidate({ candidateId: row.candidate_id, cycle: 2026 }), /provider unavailable/);
});
test('successful empty lookup remains empty and reports limited evidence', async () => {
  const api = load({ fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }) });
  const rows = await api.normalizeFundraisingRows([row], 2026);
  assert.equal(rows[0].source_payload.pac_contributions.length, 0);
  assert.equal(rows[0].source_payload.pac_evidence_status, 'retrieved_limited');
});
test('skipped lookup preserves prior PAC amount and evidence time without input mutation', () => {
  const api = load();
  const payload = { pac_evidence_status: 'skipped_limit', last_imported: 'new' };
  const previous = { pac_contributions: [{ amount: 55 }], pac_contributions_total: 55, pac_evidence_updated_at: 'old' };
  const next = api.preserveSkippedPacEvidence(payload, previous);
  assert.equal(next.pac_contributions_total, 55);
  assert.equal(next.pac_evidence_updated_at, 'old');
  assert.equal(next.pac_evidence_status, 'preserved_not_refreshed');
  assert.equal(payload.pac_contributions, undefined);
});
test('skipped lookup with no previous evidence never becomes a zero', () => {
  const next = load().preserveSkippedPacEvidence({ pac_evidence_status: 'skipped_limit', pac_contributions: [], pac_contributions_total: 0 }, null);
  assert.equal(Object.hasOwn(next, 'pac_contributions_total'), false);
  assert.equal(Object.hasOwn(next, 'pac_contributions'), false);
});
test('replacement locks prior evidence before delete and persists preserved payload', async () => {
  const calls = [];
  const api = load({ pool: { connect: async () => ({ query: async (sql, args) => {
    calls.push([sql, args]);
    if (sql.startsWith('SELECT candidate_id')) return { rows: [{ candidate_id: row.candidate_id, source_payload: { pac_contributions: [{ amount: 70 }], pac_contributions_total: 70 } }] };
    return { rows: [] };
  }, release() {} }), query: async () => ({ rows: [] }) } });
  await api.replaceFundraisingLive([{ ...row, source_payload: { pac_evidence_status: 'skipped_limit' } }], 2026);
  const select = calls.findIndex(([sql]) => sql.startsWith('SELECT candidate_id'));
  const del = calls.findIndex(([sql]) => sql.startsWith('DELETE'));
  assert.ok(select >= 0 && del > select);
  const insert = calls.find(([sql]) => sql.includes('INSERT INTO fundraising_live'));
  assert.equal(JSON.parse(insert[1][12]).pac_contributions_total, 70);
});
test('snapshot failure rolls back without deleting rows', async () => {
  const calls = [];
  const api = load({ pool: { query: async () => ({ rows: [] }), connect: async () => ({ query: async sql => {
    calls.push(sql); if (sql.startsWith('SELECT candidate_id')) throw Error('snapshot failed'); return { rows: [] };
  }, release() {} }) } });
  await assert.rejects(api.replaceFundraisingLive([], 2026), /snapshot failed/);
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some(sql => sql.startsWith('DELETE')), false);
});
test('full sync aborts before all database calls when PAC lookup fails', async () => {
  let requests = 0; let writes = 0;
  const api = load({ fetch: async url => {
    requests++;
    if (String(url).includes('/candidates/totals/')) return { ok: true, json: async () => ({ results: [row], pagination: { pages: 1 } }) };
    return { ok: false, status: 429, text: async () => 'rate limited' };
  }, pool: { query() { writes++; throw Error('Unexpected DB call'); }, connect() { writes++; throw Error('Unexpected DB call'); } } });
  await assert.rejects(api.syncFundraisingFromFec({ cycle: 2026 }), /429/);
  assert.equal(requests, 2); assert.equal(writes, 0);
});
test('limit zero does not request PAC data or create fabricated zero evidence', async () => {
  const api = load({ fetch() { throw Error('Unexpected request'); } });
  const rows = await api.normalizeFundraisingRows([row], 2026, { pacSyncLimit: 0 });
  assert.equal(rows[0].source_payload.pac_evidence_status, 'skipped_limit');
  assert.equal(Object.hasOwn(rows[0].source_payload, 'pac_contributions_total'), false);
});
test('fresh retrieved evidence replaces prior evidence without mutating its input', () => {
  const api = load();
  const payload = { pac_evidence_status: 'retrieved_limited', pac_contributions: [], pac_contributions_total: 0 };
  const next = api.preserveSkippedPacEvidence(payload, { pac_contributions: [{ amount: 70 }], pac_contributions_total: 70 });
  assert.equal(next.pac_contributions_total, 0);
  assert.equal(next.pac_evidence_status, 'retrieved_limited');
  assert.notEqual(next, payload);
});
