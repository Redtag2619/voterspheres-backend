import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {dashboardReadQuery,withDashboardReads} from '../services/legacyDashboardReadScope.js';
const sql='SELECT * FROM donors_read WHERE cycle=$1 ORDER BY id DESC LIMIT $2';
test('one request shares pending donor read and preserves individual limits',async()=>{
 let calls=0;const query=async(_s,p)=>{calls++;await new Promise(r=>setTimeout(r,5));assert.deepEqual(p,[2026,25]);return{rows:Array.from({length:25},(_,id)=>({id})),rowCount:25};};
 const result=await withDashboardReads(async()=>{const [a,b]=await Promise.all([dashboardReadQuery(sql,[2026,8],query),dashboardReadQuery(sql,[2026,25],query)]);assert.equal(a.rows.length,8);assert.equal(b.rows.length,25);return{metrics:[]};});
 assert.equal(calls,1);assert.equal(result.data_status,'ready');
});
test('requests and different cycles cannot share results',async()=>{
 let calls=0;const query=async()=>{calls++;return{rows:[]};};
 await Promise.all([withDashboardReads(()=>dashboardReadQuery(sql,[2026,8],query)),withDashboardReads(()=>dashboardReadQuery(sql,[2026,8],query))]);
 assert.equal(calls,2);
 await withDashboardReads(async()=>{await dashboardReadQuery(sql,[2026,8],query);await dashboardReadQuery(sql,[2028,8],query);return{metrics:[]};});assert.equal(calls,4);
});
test('failure is reused, exposed safely and is distinct from successful empty reads',async()=>{
 const failed=await withDashboardReads(async()=>{await dashboardReadQuery(sql,[2026,8],async()=>{throw Object.assign(new Error('secret SQL connection detail'),{code:'57014'});}).catch(()=>{});return{metrics:[]};});
 assert.equal(failed.data_status,'unavailable');assert.equal(failed.ok,false);assert.ok(!JSON.stringify(failed).includes('secret'));
 const empty=await withDashboardReads(async()=>{await dashboardReadQuery(sql,[2026,8],async()=>({rows:[]}));return{metrics:[]};});assert.equal(empty.data_status,'empty');assert.equal(empty.ok,true);
});
async function serviceFixture(filename,calls,failDonors=false){
 let source=await fs.readFile(filename,'utf8');
 const pool={query:async(text,params)=>{calls.push({text,params});if(/FROM fundraising_live/.test(text))return{rows:Array.from({length:Math.min(params.at(-1),1000)},(_,i)=>({candidate_id:'H'+String(i).padStart(8,'0'),name:'Candidate '+i,state:i%2?'TX':'GA',office:'House',receipts:1000-i,cash_on_hand:500,source_payload:{pac_contributions:[{committee_name:'PAC '+(i%3),amount:10}]}}))};if(/donors_read/.test(text)&&failDonors)throw Object.assign(new Error('private detail'),{code:'57014'});return{rows:Array.from({length:Math.min(params.at(-1)||1,30)},(_,id)=>({id,title:'Event '+id,severity:'Low',created_at:'2026-01-01',state:'TX'}))};}};
 const poolUrl='data:text/javascript;base64,'+Buffer.from('export const pool=globalThis.__legacyPool;').toString('base64');
 source=source.replace(/import .*configuredFederalElectionCycle[^;]+;/,'const defaultDonorCycle=()=>2026;').replace(/import \{ normalizeFederalElectionCycle \}[^;]+;/,'const normalizeFederalElectionCycle=(v,o)=>Number(v||o.fallback);').replace(/import \{ pool \}[^;]+;/,`import {pool} from ${JSON.stringify(poolUrl)};`);
 if(source.includes('./legacyDashboardReadScope.js'))source=source.replace('"./legacyDashboardReadScope.js"',JSON.stringify(new URL('../services/legacyDashboardReadScope.js',import.meta.url).href));
 globalThis.__legacyPool=pool;
 // Inline the fixture pool to avoid the ESM module cache sharing a pool across fixtures.
 source=source.replace(`import {pool} from ${JSON.stringify(poolUrl)};`,'const pool=globalThis.__legacyPool;');
 return import('data:text/javascript;base64,'+Buffer.from(source+'\n// '+Math.random()).toString('base64'));
}
test('actual service preserves all original healthy response fields while reducing repeated reads',async()=>{
 const current=new URL('../services/intelligence.service.js',import.meta.url);const baseline=new URL('./fixtures/intelligence.before.js',import.meta.url);
 const oldCalls=[],newCalls=[];const old=await serviceFixture(baseline,oldCalls);const before=await old.getIntelligenceDashboard();const next=await serviceFixture(current,newCalls);const after=await next.getIntelligenceDashboard();
 const stable=o=>JSON.parse(JSON.stringify(o,(key,v)=>['generated_at','updated_at','time'].includes(key)?undefined:v));
 const {ok,degraded,data_status,source_status,...contract}=after;assert.deepEqual(stable(contract),stable(before));
 assert.equal(oldCalls.filter(c=>/FROM fundraising_live/.test(c.text)).length,4);assert.equal(newCalls.filter(c=>/FROM fundraising_live/.test(c.text)).length,1);
 assert.equal(newCalls.filter(c=>/donors_read/.test(c.text)).length,1);assert.ok(newCalls.length<oldCalls.length);
});
test('actual service returns partial data and donor source error without a healthy status',async()=>{
 const calls=[];const service=await serviceFixture(new URL('../services/intelligence.service.js',import.meta.url),calls,true);const result=await service.getIntelligenceDashboard();assert.equal(result.data_status,'degraded');assert.equal(result.degraded,true);assert.equal(result.leaderboard.length,25);assert.deepEqual(result.donors,[]);assert.equal(result.source_status.find(s=>s.source==='donors').code,'57014');
});

test('outside dashboard scope no superset or cached read changes other endpoints',async()=>{
 let seen=[];const query=async(_s,p)=>{seen.push(p.at(-1));return{rows:[{id:1}]};};
 await dashboardReadQuery(sql,[2026,8],query);await dashboardReadQuery(sql,[2026,8],query);assert.deepEqual(seen,[8,8]);
});
test('financial source failure is unavailable, not a healthy currency zero',async()=>{
 const result=await withDashboardReads(async()=>{await dashboardReadQuery('SELECT * FROM fundraising_live WHERE election_year=$1 LIMIT $2',[2026,25],async()=>{throw Object.assign(new Error('private connection detail'),{code:'57014'});}).catch(()=>{});return{metrics:[{label:'Receipts',value:'$0'}]};});
 assert.equal(result.data_status,'unavailable');assert.equal(result.metrics[0].value,'Unavailable');assert.equal(result.source_status[0].source,'fundraising');assert.ok(!JSON.stringify(result).includes('private'));
});
