import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../services/executiveIntelligenceOrchestrator.service.js',import.meta.url),'utf8');
const start=source.indexOf('function buildCandidateIntelligenceDataAnswer(');
const end=source.indexOf('function buildDataAnswer(',start);
assert.ok(start>=0 && end>start,'Candidate answer builder must exist');
const builder=source.slice(start,end);
function answer(polling,finance=false){
  const sandbox={candidateBundleRecords:()=>[],buildFinanceReport:()=>({verified:true}),appendFinanceReportLines:lines=>lines.push('Official finance fixture: $123'),context:{candidate:'Jasmine Crockett',office:'House',state:'TX'},results:[{tool:'get_candidate_intelligence_bundle',usable:true,data:{polling,identities:[],finance:{reports:finance?[{}]:[]},signals:[],strategy:{recommendations:[]}}}],sources:[]};
  return vm.runInNewContext(`${builder}\nbuildCandidateIntelligenceDataAnswer({context,results,sources});`,sandbox).answer;
}
const base={evidence_version:'2.9.0',status:'candidate_context_available',query_type:'candidate_context',direct_count:0,candidate_context_count:1,state_context_count:0,requested_race:{office:'House',state:'TX'},records:[{pollster:'Fixture Pollster',candidate_name:'Jasmine Crockett',pct:40,field_end:'2026-03-02'}],freshness:{status:'stale'},executive_summary:'Polling coverage: 0 direct race records for cycle 2026. Selected election polling freshness: stale (212 days old). Context is not a race estimate.'};
test('deterministic answer includes scope/freshness assessment',()=>{
 const result=answer(base);assert.match(result,/Polling evidence assessment:/);assert.match(result,/cycle 2026/);assert.match(result,/212 days old/);assert.match(result,/Context is not a race estimate/);
});
test('stale context is historical and never relabeled as a direct race',()=>{
 const result=answer(base);assert.match(result,/Historical candidate-context polling \(stale\):/);assert.match(result,/Direct House polling: 0/);assert.doesNotMatch(result,/Latest candidate-context/);
});
test('healthy zero-match does not require removed raw source_result',()=>{
 const result=answer({...base,status:'no_polling_available',query_type:null,records:[],candidate_context_count:0,freshness:{status:'unavailable'}});assert.doesNotMatch(result,/Polling intelligence: unavailable or degraded/);assert.match(result,/Direct House polling: 0/);
});
test('provider errors remain unavailable/degraded',()=>{
 const result=answer({...base,status:'provider_error',query_type:null,records:[],candidate_context_count:0,degraded:true});assert.match(result,/Polling intelligence: unavailable or degraded/);
});
test('continuous tracking is labeled separately and never listed as election polls',()=>{
 const result=answer({...base,status:'continuous_context_available',query_type:null,records:[],candidate_context_count:0,continuous_tracking_count:2,freshness:{status:'unavailable'}});assert.match(result,/Continuous tracking context: 2 records/);assert.doesNotMatch(result,/Latest polling:/);assert.match(result,/Direct House polling: 0/);
});
test('current evidence keeps current section and official finance remains intact',()=>{
 const result=answer({...base,freshness:{status:'current'},executive_summary:'Polling coverage: current'},true);assert.match(result,/Latest candidate-context polling:/);assert.match(result,/Official finance fixture: \$123/);assert.match(result,/News articles: 0/);
});
test('unknown freshness is explicit',()=>assert.match(answer({...base,freshness:{status:'unknown'}}),/freshness unknown/));
