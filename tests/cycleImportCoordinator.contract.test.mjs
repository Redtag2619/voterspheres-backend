import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseImportCycles,runCycleImports} from '../services/cycleImportCoordinator.js';
const calls=[];
const client={query:async(sql,args)=>{calls.push([sql,args]);return {rows:[{id:calls.length}]};}};
test('cycle configuration is bounded, ordered and deduplicated',()=>{
 assert.deepEqual(parseImportCycles('2030,2026,2028,2028'),[2026,2028,2030]);
 for(const value of ['2027','2028,','banana','2024','2202'])assert.throws(()=>parseImportCycles(value));
});
test('imports run serially and retain per-cycle telemetry',async()=>{
 calls.length=0;let active=0;const seen=[];
 const result=await runCycleImports({cycles:[2026,2028],client,sync:async({cycle,syncContacts})=>{
  assert.equal(syncContacts,false);assert.equal(active++,0);await Promise.resolve();active--;seen.push(cycle);
  return {ok:true,status:'completed_with_skipped_pac',fetched:10,fundraising_stored:10,pac_skipped_candidates:5};
 }});
 assert.deepEqual(seen,[2026,2028]);assert.equal(result.length,2);
 const updates=calls.filter(([s])=>s.startsWith('UPDATE'));
 assert.deepEqual(updates.map(([,a])=>JSON.parse(a[2]).cycle),[2026,2028]);
});
test('empty evidence is a warning outcome; failed cycle stops remaining requests',async()=>{
 calls.length=0;
 const empty=await runCycleImports({cycles:[2028],client,sync:async()=>({ok:true,status:'no_data',fetched:0,fundraising_stored:0,preserved_existing:true})});
 assert.equal(empty[0].preserved_existing,true);
 let count=0;await assert.rejects(runCycleImports({cycles:[2026,2028],client,sync:async()=>{count++;throw Object.assign(new Error('quota'),{code:'QUOTA'});}}));
 assert.equal(count,1);assert.ok(calls.some(([s])=>s.includes("status='failed'")));
});
function loader(pages,maxPages=2){
 const source=fs.readFileSync(new URL('../services/fec.service.js',import.meta.url),'utf8');
 const start=source.indexOf('export async function fetchAllCandidateTotals');
 const end=source.indexOf('export async function normalizeFundraisingRows',start);
 const ctx=vm.createContext({getFecApiConfig:()=>({perPage:100,maxPages}),fetchCandidateTotalsPage:async({page})=>pages[page-1]});
 vm.runInContext(source.slice(start,end).replace('export ','')+';globalThis.run=fetchAllCandidateTotals',ctx);return ctx.run;
}
test('page cap and malformed pagination fail before returning replacement input',async()=>{
 await assert.rejects(loader([{results:[{}],pagination:{pages:3}},{results:[{}],pagination:{pages:3}}])({cycle:2028}),e=>e.code==='FEC_PAGE_CAP_REACHED');
 await assert.rejects(loader([{results:[{}]}])({cycle:2028}),e=>e.code==='FEC_INVALID_PAGINATION');
 await assert.rejects(loader([{pagination:{pages:1}}])({cycle:2028}),e=>e.code==='FEC_INVALID_PAYLOAD');
 assert.equal((await loader([{results:[{}],pagination:{pages:1}}])({cycle:2028})).length,1);
});
test('replacement uses a composite cycle key and retains same-cycle PAC snapshot',()=>{
 const source=fs.readFileSync(new URL('../services/fec.service.js',import.meta.url),'utf8');
 const a=source.indexOf('export async function replaceFundraisingLive'),b=source.indexOf('export async function upsertCandidatesFromFec',a);
 const replacement=source.slice(a,b);assert.match(replacement,/ON CONFLICT \(candidate_id, election_year\)/);
 assert.match(replacement,/DELETE FROM fundraising_live WHERE election_year = \$1/);
 assert.match(source.slice(b),/ON CONFLICT \(fec_candidate_id, election_year\)/);
});
