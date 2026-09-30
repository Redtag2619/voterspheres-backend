import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutivePollingEvidence, appendExecutivePollingSummary } from '../services/executivePollingEvidence.service.js';
const now=Date.parse('2026-09-30T15:00:00Z');
const context={candidate:'Candidate A',state:'TX',office:'House',district:'30',cycle:2026};
const row=(id,extra={})=>({id,temporal_scope:'election_cycle',cycle:2026,field_end:'2026-09-25',poll_type:'us-representative',...extra});
const build=(polling,ctx=context)=>buildExecutivePollingEvidence(polling,ctx,{now});
test('direct election evidence preserves contract and dates',()=>{
  const r=build({direct_records:[row(1)]});assert.equal(r.direct_count,1);assert.equal(r.freshness.status,'current');assert.equal(r.records.length,1);assert.equal(r.requested_race.cycle,2026);
});
test('continuous tracking is separate from direct race and election records',()=>{
  const r=build({direct_records:[row(1,{temporal_scope:'continuous_tracking',cycle:null,poll_type:'approval'})]});
  assert.equal(r.direct_count,0);assert.equal(r.records.length,0);assert.equal(r.continuous_tracking_count,1);assert.equal(r.status,'continuous_context_available');
});
test('unresolved and missing scope never escape through raw provider fields',()=>{
  const r=build({direct_records:[row(1,{temporal_scope:'unresolved'}),row(2,{temporal_scope:undefined})],source_result:{records:[row(1)]}});
  assert.equal(r.direct_count,0);assert.equal(r.excluded_record_counts.unresolved_or_missing_scope,2);assert.equal(r.source_result,undefined);
});
test('wrong and missing cycles are excluded, never inferred from dates',()=>{
  const r=build({direct_records:[row(1,{cycle:2024}),row(2,{cycle:null})]});assert.equal(r.direct_count,0);assert.equal(r.excluded_record_counts.cycle_mismatch_or_missing,2);
});
test('missing requested cycle fails closed for election records',()=>assert.equal(build({direct_records:[row(1)]},{...context,cycle:null}).direct_count,0));
test('continuous records with a fabricated cycle are excluded',()=>assert.equal(build({candidate_context_records:[row(1,{temporal_scope:'continuous_tracking',cycle:2026})]}).continuous_tracking_count,0));
test('context remains context and unbucketed records are not promoted',()=>{
  const r=build({records:[row(1)],state_context_records:[row(2)]});assert.equal(r.direct_count,0);assert.equal(r.candidate_context_count,1);assert.equal(r.state_context_count,1);assert.match(r.executive_summary,/not a race estimate/);
});
test('duplicate aliases do not inflate record counts',()=>{
  const a=row(1);assert.equal(build({records:[a],direct_records:[a],direct_race_records:[a]}).direct_count,1);
});
test('stale polling uses survey time and cannot be refreshed by ingestion timestamp',()=>{
  const r=build({direct_records:[row(1,{field_end:'2026-03-02',updated_at:'2026-09-30',ingested_at:'2026-09-30'})]});assert.equal(r.freshness.status,'stale');assert.match(r.executive_summary,/stale/);
});
test('undated evidence is unknown and future dates are excluded',()=>{
  const r=build({direct_records:[row(1,{field_end:null,updated_at:'2026-09-30'}),row(2,{field_end:'2027-01-01'})]});assert.equal(r.freshness.status,'unknown');assert.equal(r.freshness.undated_records,1);assert.equal(r.excluded_record_counts.invalid_date_or_future,1);
});
test('approval is not counted as direct election race even if mislabeled',()=>assert.equal(build({direct_records:[row(1,{poll_type:'approval'})]}).direct_count,0));
test('modeled estimates are excluded from measured polling coverage',()=>{
  const r=build({direct_records:[row(1,{is_estimate:true}),row(2,{record_type:'forecast'})]});assert.equal(r.direct_count,0);assert.equal(r.excluded_record_counts.modeled_or_estimated_records,2);
});
test('provider error and degraded coverage remain visible',()=>{
  const r=build({status:'provider_error',degraded:true});assert.equal(r.status,'provider_error');assert.equal(r.degraded,true);assert.match(r.executive_summary,/degraded/);
});
test('summary decorator carries scope and freshness into candidate bundle prose',()=>{
  const polling=build({direct_records:[row(1)]});const r=appendExecutivePollingSummary({summary:'Candidate briefing',data:{polling}});assert.match(r.summary,/Candidate briefing/);assert.match(r.summary,/Polling coverage/);assert.match(r.summary,/cycle 2026/);assert.equal(r.executive_polling_summary,polling.executive_summary);
});
test('input is immutable and invalid freshness settings fail',()=>{
  const input={direct_records:[row(1)]};const original=JSON.stringify(input);build(input);assert.equal(JSON.stringify(input),original);assert.throws(()=>buildExecutivePollingEvidence(input,context,{staleAfterDays:0}));
});
