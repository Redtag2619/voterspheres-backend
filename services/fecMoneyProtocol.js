import crypto from 'node:crypto';
import { financeElectionCycle } from '../utils/financeElectionCycle.js';

export const LANES = {
  donors: { endpoint: 'schedule_a', date: 'contribution_receipt_date', amount: 'contribution_receipt_amount', cursorDate: 'last_contribution_receipt_date' },
  vendors: { endpoint: 'schedule_b', date: 'disbursement_date', amount: 'disbursement_amount', cursorDate: 'last_disbursement_date' },
  'political-money': { endpoint: 'schedule_e', date: 'expenditure_date', amount: 'expenditure_amount' },
};
export function importError(code, statusCode = 502) {
  return Object.assign(new Error(code), { code, statusCode });
}
// Tokenize outside quoted strings before JSON.parse. Financial decimal tokens and
// provider identifiers remain exact strings; booleans/null retain their JSON types.
export function parseFecMoneyJson(raw) {
  let output = '', i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      const start = i++;
      while (i < raw.length) { if (raw[i] === '\\') { i += 2; continue; } if (raw[i++] === '"') break; }
      output += raw.slice(start, i);
    } else if (raw[i] === '-' || /[0-9]/.test(raw[i])) {
      const match = raw.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) throw importError('INVALID_PROVIDER_JSON');
      output += JSON.stringify(match[0]); i += match[0].length;
    } else output += raw[i++];
  }
  try { return JSON.parse(output); } catch { throw importError('INVALID_PROVIDER_JSON'); }
}
export function scopeConfig({ lane, cycle, committees, national = false, perPage = 100 } = {}) {
  if (!LANES[lane]) throw importError('INVALID_IMPORT_LANE', 400);
  cycle = financeElectionCycle(cycle);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw importError('INVALID_PAGE_SIZE', 400);
  const ids = [...new Set((Array.isArray(committees) ? committees : String(committees || '').split(',')).map(s => String(s).trim()).filter(Boolean))].sort();
  if (ids.some(id => !/^C\d{8}$/.test(id)) || ids.length > 20 || (national && ids.length) || (!national && !ids.length)) throw importError('EXPLICIT_IMPORT_SCOPE_REQUIRED', 400);
  const key = national ? 'national' : `committees:${ids.join(',')}`;
  return { lane, cycle, committees: ids, national, perPage, key, protocol: 1 };
}
export function pageUrl(config, state, apiKey) {
  const rule = LANES[config.lane];
  const url = new URL(`https://api.open.fec.gov/v1/schedules/${rule.endpoint}/`);
  const params = { api_key: apiKey, per_page: config.perPage, sort: `-${rule.date}`, max_date: state.cutoff };
  if (config.lane === 'political-money') { params.cycle = config.cycle; params.page = state.cursor?.page || 1; }
  else { params.two_year_transaction_period = config.cycle; params.sort_nulls_last = 'true'; params.sort_hide_null = 'false'; Object.assign(params, state.cursor || {}); }
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  for (const id of config.committees) url.searchParams.append('committee_id', id);
  return url;
}
function integer(value) { return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }
function exactId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw importError('UNSAFE_PROVIDER_IDENTIFIER');
  const id = String(value ?? '');
  if (!/^\d+$/.test(id)) throw importError('MISSING_PROVIDER_SUB_ID');
  return id;
}
export function validatePage(config, state, data) {
  if (!Array.isArray(data?.results) || !data.pagination || typeof data.pagination !== 'object') throw importError('INVALID_PROVIDER_PAGE');
  const rows = data.results;
  if (rows.length > config.perPage) throw importError('INVALID_PROVIDER_PAGE_SIZE');
  const declaredPages = integer(data.pagination.pages);
  if (declaredPages == null || (declaredPages === 0 && rows.length)) throw importError('INVALID_PROVIDER_PAGINATION');
  const rule = LANES[config.lane];
  const seen = new Set();
  const records = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw importError('INVALID_PROVIDER_ROW');
    const id = exactId(row.sub_id);
    if (seen.has(id)) throw importError('DUPLICATE_SUB_ID_IN_PAGE'); seen.add(id);
    if (typeof row.committee_id !== 'string' || !/^C\d{8}$/.test(row.committee_id) || (config.committees.length && !config.committees.includes(row.committee_id))) throw importError('PROVIDER_SCOPE_MISMATCH');
    const suppliedCycle = row.two_year_transaction_period ?? row.cycle;
    if (suppliedCycle != null && Number(suppliedCycle) !== config.cycle) throw importError('PROVIDER_CYCLE_MISMATCH');
    const amount = String(row[rule.amount] ?? '');
    if (!/^-?\d{1,16}(?:\.\d{1,2})?$/.test(amount)) throw importError('INVALID_PROVIDER_AMOUNT');
    const date = row[rule.date];
    if (date != null && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(date)) || !Number.isFinite(Date.parse(date)) || new Date(String(date).slice(0,10)).toISOString().slice(0,10)!==String(date).slice(0,10))) throw importError('INVALID_PROVIDER_DATE');
    if (date != null && String(date).slice(0,10)>state.cutoff) throw importError('PROVIDER_CUTOFF_MISMATCH');
    return { id, payload: { ...row, sub_id: id }, digest: crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex') };
  });
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(records.map(r => [r.id, r.digest]))).digest('hex');
  if (!rows.length) return { records, fingerprint, complete: true, cursor: state.cursor };
  let cursor;
  if (config.lane === 'political-money') {
    const pages = integer(data.pagination.pages), page = integer(state.cursor?.page || 1);
    if (pages == null || page == null || pages < page) throw importError('INVALID_PROVIDER_PAGINATION');
    // Continue through a terminal empty page; counts alone do not certify coverage.
    cursor = { page: page + 1 };
  } else {
    const indexes = data.pagination.last_indexes;
    if (!indexes || typeof indexes !== 'object' || indexes.last_index == null || !(rule.cursorDate in indexes)) throw importError('MISSING_PROVIDER_CURSOR');
    if (indexes[rule.cursorDate] == null) throw importError('NULL_DATE_CURSOR_REQUIRES_REVIEW');
    cursor = { last_index: exactId(indexes.last_index), [rule.cursorDate]: indexes[rule.cursorDate] };
    if (JSON.stringify(cursor) === JSON.stringify(state.cursor)) throw importError('PROVIDER_CURSOR_DID_NOT_ADVANCE');
  }
  return { records, fingerprint, complete: false, cursor };
}
