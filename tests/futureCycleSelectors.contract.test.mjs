import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {financeElectionCycle} from '../utils/financeElectionCycle.js';
import {configuredFederalElectionCycle} from '../utils/electionCycle.js';
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
 const api=load('../routes/donors.routes.js',{process:{env:{FEC_API_KEY:"test-only"}},financeElectionCycle,requirePlatformOperator(){},express:{Router:()=>router},pool:{connect:async()=>client,query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}},fetch:async()=>({ok:true,text:async()=>JSON.stringify({results:rows})})},['refreshFecDonors','handleDonorNetwork']);
 return {api,queries};
}
test('donor list and all aggregates scope to cycle',async()=>{
 const {api,queries}=donorApi();let report;await api.handleDonorNetwork({query:{cycle:'2030'}},{json:r=>report=r});
 assert.equal(report.cycle,2030);assert.equal(report.results.length,0);
 assert.equal(queries.length,4);for(const q of queries){assert.ok(q.sql.includes('cycle = $4'));assert.equal(q.params[3],2030);}
});
test('donor refresh replaces only requested cycle and rolls back insert failure',async()=>{
 const row={contributor_name:'Test Donor',contributor_state:'CA',contribution_receipt_amount:10,two_year_transaction_period:2030};
 const {api,queries}=donorApi({rows:[row]});await api.refreshFecDonors({query:{cycle:2030}});
 const deletion=queries.find(q=>q.sql.includes('DELETE FROM donors'));
 assert.ok(deletion.sql.includes('AND cycle = $2'));assert.equal(deletion.params[1],2030);
 const insert=queries.find(q=>q.sql.includes('INSERT INTO donors'));assert.equal(insert.params[25],2030);
 assert.ok(queries.some(q=>q.sql==='COMMIT'));assert.equal(queries.at(-1).sql,'RELEASE');
 const broken=donorApi({rows:[row],failInsert:true});await assert.rejects(broken.api.refreshFecDonors({query:{cycle:2030}}));
 assert.ok(broken.queries.some(q=>q.sql==='ROLLBACK'));assert.ok(!broken.queries.some(q=>q.sql==='COMMIT'));
});
test('provider mismatch aborts before replacement writes',async()=>{
 const {api,queries}=donorApi({rows:[{two_year_transaction_period:2026}]});
 await assert.rejects(api.refreshFecDonors({query:{cycle:2030}}));assert.equal(queries.length,0);
});
