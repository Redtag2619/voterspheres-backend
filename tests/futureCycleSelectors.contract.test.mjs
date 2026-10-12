import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {financeElectionCycle} from '../utils/financeElectionCycle.js';
import {configuredFederalElectionCycle} from '../utils/electionCycle.js';
import {scopeConfig,validatePage} from '../services/fecMoneyProtocol.js';
function source(path) {return fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');}
function load(path, injected, exports) {
 const text=source(path).replace(/^import[\s\S]*?;\n/gm,'').replace(/export default[^;]+;/g,'').replace(/export /g,'');
 const context=vm.createContext({process:{env:{}},console,URL,Map,Set,...injected});
 vm.runInContext(text+'\n globalThis.api={'+exports.join(',')+'};',context);return context.api;
}
test('finance cycles retain history and future years without invalid fallback',()=>{
 for(const year of [2020,2026,2028,2030,2040])assert.equal(financeElectionCycle(String(year)),year);
 for(const value of [2029,0,'garbage','2028.5',true,[],2202])assert.throws(()=>financeElectionCycle(value),{statusCode:400});
});
test('candidate scoring queries the requested year',async()=>{
 for(const cycle of [2028,2030]) {
  const queries=[];const api=load('../services/candidateIntelligence.service.js',{configuredFederalElectionCycle,publishRealtimeEvent(){},pool:{query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}}},['getCandidateIntelligenceSummary']);
  await api.getCandidateIntelligenceSummary({cycle});
  assert.ok(queries.some(q=>q.sql.includes('c.election_year = $1')&&q.params[0]===cycle));
 }
});
function donorApi({rows=[],failInsert=false}={}) {
 const queries=[];const client={query:async(sql,params)=>{queries.push({sql,params});if(failInsert&&sql.includes('INSERT INTO donors'))throw Error('injected');return {rows:[]};},release(){queries.push({sql:'RELEASE'});}};
 const router={get(){},post(){}};
 const delegated=[];
 const api=load('../routes/donors.routes.js',{process:{env:{FEC_API_KEY:"test-only"}},financeElectionCycle,requirePlatformOperator(){},readMoneyImportCoverage:async()=>({scopes:[]}),runResumableMoneyImports:async(_pool,opts)=>{
  delegated.push(opts);
  const config=scopeConfig({lane:opts.lanes,cycle:opts.cycle,committees:opts.committees});
  validatePage(config,{cutoff:'2026-10-12',cursor:{}},{results:rows,pagination:{pages:rows.length?1:0,last_indexes:{last_index:'1',last_contribution_receipt_date:'2026-01-01'}}});
  return {ok:true,results:[]};
 },express:{Router:()=>router},pool:{connect:async()=>client,query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}},fetch:async()=>({ok:true,text:async()=>JSON.stringify({results:rows})})},['refreshFecDonors','handleDonorNetwork']);
 return {api,queries,delegated};
}
test('donor list and all aggregates scope to cycle',async()=>{
 const {api,queries}=donorApi();let report;await api.handleDonorNetwork({query:{cycle:'2030'}},{json:r=>report=r});
 assert.equal(report.cycle,2030);assert.equal(report.results.length,0);
 assert.equal(queries.length,4);for(const q of queries){assert.ok(q.sql.includes('cycle = $4'));assert.ok(q.sql.includes('FROM donors_read'));assert.equal(q.params[3],2030);}
});
test('donor refresh delegates requested cycle and scope without legacy replacement',async()=>{
 const row={sub_id:'1',committee_id:'C00547349',contributor_name:'Test Donor',contributor_state:'CA',contribution_receipt_amount:10,two_year_transaction_period:2030};
 const {api,queries,delegated}=donorApi({rows:[row]});await api.refreshFecDonors({query:{cycle:2030,committees:'C00547349'}});
 assert.equal(delegated[0].cycle,2030);assert.equal(delegated[0].lanes,'donors');assert.equal(delegated[0].committees,'C00547349');assert.equal(queries.length,0);
});
test('provider mismatch aborts before replacement writes',async()=>{
 const {api,queries}=donorApi({rows:[{sub_id:'1',committee_id:'C00547349',two_year_transaction_period:2026}]});
 await assert.rejects(api.refreshFecDonors({query:{cycle:2030,committees:'C00547349'}}),{code:'PROVIDER_CYCLE_MISMATCH'});assert.equal(queries.length,0);
});
