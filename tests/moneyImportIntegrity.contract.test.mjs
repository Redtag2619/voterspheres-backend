import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {financeElectionCycle} from '../utils/financeElectionCycle.js';
import {collectMoneyPages,withMoneyImportLock} from '../services/moneyImportIntegrity.js';
const collect=(request,extra={})=>collectMoneyPages({cycle:2028,apiKey:'private-test-key',request,...extra});
test('valid multi-page evidence is returned only after all pages',async()=>{
 let calls=0;
 const r=await collect(async url=>{calls++;assert.equal(url.searchParams.get('cycle'),'2028');return {results:[{cycle:2028}],pagination:{pages:2}};});
 assert.equal(calls,2);assert.equal(r.rows.length,2);
});
test('cap cannot report complete evidence',async()=>{
 await assert.rejects(collect(async()=>({results:[{}],pagination:{pages:4}})),{code:'FEC_PAGE_CAP_REACHED'});
});
test('malformed payload, pagination and cross-cycle rows fail',async()=>{
 for(const [data,code] of [[{},'FEC_INVALID_PAYLOAD'],[{results:[],pagination:{}},'FEC_INVALID_PAGINATION'],[{results:[{}],pagination:{pages:0}},'FEC_INVALID_PAGINATION'],[{results:[{cycle:2030}],pagination:{pages:1}},'FEC_CYCLE_MISMATCH']])await assert.rejects(collect(async()=>data),{code});
});
test('empty complete response is distinguishable from incomplete pagination',async()=>{
 assert.equal((await collect(async()=>({results:[],pagination:{pages:0}}))).rows.length,0);
 await assert.rejects(collect(async()=>({results:[],pagination:{pages:2}})),{code:'FEC_INCOMPLETE_PAGINATION'});
});
test('odd cycles and invalid page limits make no requests',async()=>{
 let calls=0;const request=async()=>{calls++;};
 await assert.rejects(collect(request,{cycle:2029}),{code:'INVALID_ELECTION_CYCLE'});
 await assert.rejects(collect(request,{maxPages:26}),{code:'INVALID_PAGE_CAP'});
 assert.equal(calls,0);
});
test('busy shared FEC lock prevents work and releases connection',async()=>{
 let work=false,released=false;
 const client={query:async()=>({rows:[{acquired:false}]}),release:()=>released=true};
 await assert.rejects(withMoneyImportLock({connect:async()=>client},async()=>{work=true;}),{code:'IMPORT_LOCK_BUSY'});
 assert.equal(work,false);assert.equal(released,true);
});
test('failed work unlocks and releases the shared lock',async()=>{
 const sql=[];let released=false;
 const client={query:async s=>{sql.push(s);return {rows:[{acquired:true}]};},release:()=>released=true};
 await assert.rejects(withMoneyImportLock({connect:async()=>client},async()=>{throw new Error('worker failed');}),/worker failed/);
 assert.ok(sql.some(s=>s.includes('pg_advisory_unlock')));assert.equal(released,true);
});
function sandbox(query){
 let source=fs.readFileSync(new URL('../services/politicalMoneyEvidence.service.js',import.meta.url),'utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/^import .*\n/gm,'').replace(/export default \{[\s\S]*?\};/,'').replace(/\bexport /g,'');
 const client={query,release:()=>{}};
 const context=vm.createContext({pool:{query,connect:async()=>client},financeElectionCycle,withMoneyImportLock:async(_pool,fn)=>fn(),collectMoneyPages:async()=>{throw Object.assign(new Error(),{code:'FEC_PAGE_CAP_REACHED'});},process:{env:{FEC_API_KEY:'test'}},console,crypto:{createHash:()=>({update:()=>({digest:()=> 'hash'})})},setTimeout});
 vm.runInContext(source,context);return context;
}
test('actual score rebuild filters one cycle and uses a composite conflict key',async()=>{
 const queries=[];const c=sandbox(async(sql,values)=>{queries.push({sql,values});return {rows:sql.includes('COUNT(*)::int AS count')?[{organization_id:1,evidence_type:'independent_expenditure',count:1,amount:100}]:[]};});
 await c.rebuildPoliticalMoneyScores({cycle:2028});
 const read=queries.find(q=>q.sql.includes('COUNT(*)::int AS count'));
 assert.match(read.sql,/e.cycle = \$1/);assert.equal(read.values[0],2028);
 const write=queries.find(q=>q.sql.includes('INSERT INTO political_money_scores'));
 assert.match(write.sql,/ON CONFLICT \(organization_id, \(COALESCE\(cycle,0\)\)\)/);assert.equal(write.values[2],2028);
 assert.ok(queries.some(q=>q.sql==='COMMIT'));
});
test('actual evidence writer preserves unknown cycles and scopes explicit cycles',async()=>{
 const values=[];const c=sandbox(async(sql,args)=>{values.push({sql,args});return {rows:[{}]};});
 await c.storePoliticalMoneyEvidence({organizationId:1,sourceRecordId:'test',evidenceType:'independent_expenditure',cycle:2030});
 await c.storePoliticalMoneyEvidence({organizationId:1,sourceRecordId:'untagged',evidenceType:'disclosure_gap'});
 assert.equal(values[0].args[13],2030);assert.equal(values[1].args[13],null);
 assert.match(values[0].sql,/COALESCE\(cycle,0\)/);
});
test('actual capped sync stores no provider records and records failure',async()=>{
 const queries=[];const c=sandbox(async(sql)=>{queries.push(sql);return {rows:[{id:1}]};});
 await assert.rejects(c.syncFecIndependentExpenditures({cycle:2028}),{code:'FEC_PAGE_CAP_REACHED'});
 assert.ok(!queries.some(q=>q.includes('INSERT INTO political_money_transactions')||q.includes('INSERT INTO political_money_evidence')));
});
test('actual donor and vendor writer guards refuse destructive refresh',async()=>{
 for(const [file,name] of [['donors','refreshFecDonors'],['vendorFec','syncFecVendorSpend']]){
  const s=fs.readFileSync(new URL(`../routes/${file}.routes.js`,import.meta.url),'utf8');
  const start=s.indexOf(`async function ${name}(req) {`),end=s.indexOf('\n}',start)+2;
  const ctx=vm.createContext({});vm.runInContext(s.slice(start,end),ctx);
  await assert.rejects(ctx[name]({}),{code:'MONEY_IMPORT_RECONCILIATION_REQUIRED'});
  assert.ok(!/await (refreshFecDonors|syncFecVendorSpend)\(req\);/.test(s.slice(s.indexOf('router.get("/network/public"')>=0?s.indexOf('router.get("/network/public"'):s.indexOf('router.get("/spend"'))));
 }
});
test('score write failure rolls back verification changes',async()=>{
 const queries=[];const c=sandbox(async(sql)=>{queries.push(sql);if(sql.includes('INSERT INTO political_money_scores'))throw new Error('write failed');return {rows:sql.includes('COUNT(*)::int AS count')?[{organization_id:1,evidence_type:'independent_expenditure',count:1,amount:100}]:[]};});
 await assert.rejects(c.rebuildPoliticalMoneyScores({cycle:2030}),/write failed/);
 assert.ok(queries.includes('ROLLBACK'));assert.ok(!queries.includes('COMMIT'));
});
