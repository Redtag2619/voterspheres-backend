import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pollingDateKey, comparePollingDates } from '../services/pollingDate.js';
const source = fs.readFileSync(new URL('../services/executivePollingIntelligence.service.js', import.meta.url), 'utf8');
const NOW = '2026-10-02T17:00:00Z';
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return Date.parse(NOW); } }
function context(pool = {}) {
  const ctx = { Date: Clock, pollingDateKey, comparePollingDates, pool };
  vm.createContext(ctx);
  vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace(/export default/g, 'const defaultExport =').replace(/export /g, '') + ';this.api={surveyFreshness,isFuturePoll,boundedRows,groupPolls,getExecutivePollingDashboard,summarize};', ctx);
  return ctx.api;
}
const row = (id, date, extra = {}) => ({ id, poll_id: String(id), pollster: 'Test', poll_type: 'generic-ballot', start_date: date, end_date: date, poll_date: date, choice: 'Dem', pct: 45, sample_size: 1000, freshness_score: 100, ...extra });
test('stored freshness cannot keep August surveys fresh in October', () => {
  const api = context(); const p = api.groupPolls([row(1, '2026-08-04')])[0];
  assert.equal(p.freshness_score, 58); assert.equal(p.survey_age_days, 59);
  assert.equal(api.surveyFreshness('2026-08-04', new Date('2027-10-02')).freshness_score, 28);
});
test('every freshness threshold uses survey calendar age', () => {
  const api = context();
  for (const [age, score] of [[0,100],[3,100],[4,92],[7,92],[8,84],[14,84],[15,72],[30,72],[31,58],[90,58],[91,44],[365,44],[366,28]]) {
    const date = new Date(Date.parse('2026-10-02T00:00:00Z') - age * 86400000);
    assert.equal(api.surveyFreshness(date).freshness_score, score);
  }
});
test('future dates are flagged with unknown score instead of 100%', () => {
  const api = context(); const p = api.groupPolls([row(1, '2026-10-10')])[0];
  assert.equal(p.future_dated, true); assert.equal(p.freshness_status, 'future'); assert.equal(p.freshness_score, null);
  assert.match(p.date_warning, /excluded/);
});
test('publication and ingestion cannot substitute for missing survey freshness', () => {
  const api = context(); const p = api.groupPolls([row(1, null, { poll_date: '2026-10-01', updated_at: NOW })])[0];
  assert.equal(p.freshness_score, null); assert.equal(api.summarize([p]).average_freshness, null);
  assert.doesNotMatch(source, /COALESCE\(field_end, published_at::date, updated_at::date\)/);
});
test('cap removes a poll whose answers straddle the boundary without mutating rows', () => {
  const api = context(); const rows = [row(1,'2026-09-30'),row(2,'2026-09-29'),row(2,'2026-09-29',{choice:'Rep'})].map(r=>({...r,matching_answer_count:5}));
  const result = api.boundedRows(rows,2);
  assert.equal(result.rows.length,1); assert.equal(rows.length,3);
  assert.equal(result.coverage.capped,true); assert.equal(result.coverage.incomplete_boundary_answers_excluded,1);
});
test('exact cap with no omitted answers is not reported as truncated', () => {
  const result = context().boundedRows([row(1,'2026-09-30',{matching_answer_count:1})],1);
  assert.equal(result.coverage.capped,false);
});
test('actual dashboard excludes future polls from every current metric and reports cap', async () => {
  const queries=[];
  const api=context({query:async(sql,params=[])=>{
    queries.push({sql,params});
    if(sql.includes('information_schema.tables')) return {rows:[{exists:true}]};
    if(sql.includes('COUNT(*) OVER ()')) {
      assert.equal(params.at(-1),'2026-10-02');
      return {rows:sql.includes('NOT (COALESCE')
        ? [row(1,'2026-09-30',{matching_answer_count:4}),row(2,'2026-09-29',{matching_answer_count:4}),row(3,'2026-09-28',{matching_answer_count:4})]
        : [row(4,'2026-10-10',{matching_answer_count:1})]};
    }
    return {rows:[]};
  }});
  const result=await api.getExecutivePollingDashboard({query:{cycle:2026,limit:2}});
  assert.equal(result.summary.latest_poll_date,'2026-09-30'); assert.equal(result.summary.poll_count,2);
  assert.equal(result.summary.average_freshness,100); assert.equal(result.result_coverage.capped,true);
  assert.equal(result.result_coverage.matching_answer_count,4); assert.equal(result.result_coverage.returned_answer_count,2);
  assert.equal(result.future_dated_polls[0].poll_date,'2026-10-10'); assert.equal(result.future_dated_answer_count,1);
  assert.equal(result.averages[0].polls,2); assert.equal(result.recent_polls.length,2);
  assert.ok(result.trend.every(p=>p.date<='2026-10-02')); assert.equal(result.pollsters[0].latest_date,'2026-09-30');
  assert.ok(queries.some(q=>q.sql.includes('LIMIT 3')));
});
test('scope authorization remains enforced before database access', async()=>{
  const api=context({query:()=>{throw Error('should not query');}});
  await assert.rejects(api.getExecutivePollingDashboard({query:{temporal_scope:'all'}}),e=>e.code==='POLLING_SCOPE_FORBIDDEN');
});
test('future survey start or publication is flagged even with a past field end',()=>{
  const api=context();
  for(const extra of [{start_date:'2026-10-10'},{publication_date:'2026-10-10'}])assert.equal(api.groupPolls([row(1,'2026-09-30',extra)])[0].future_dated,true);
});
test('empty coverage remains uncapped with no fabricated total',()=>{
  const result=context().boundedRows([],3000);assert.equal(result.coverage.capped,false);assert.equal(result.coverage.matching_answer_count,0);
});
