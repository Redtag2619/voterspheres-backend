import test from 'node:test';import assert from 'node:assert/strict';
import {dashboardDonorSql,donorReadRequest} from '../services/dashboardDonorRead.js';
import {dashboardReadQuery,withDashboardReads} from '../services/legacyDashboardReadScope.js';
test('optimized reads share one pending page per request and retain 8/25 slices and donor health',async()=>{
 let calls=0;const sql=dashboardDonorSql();
 const r=await withDashboardReads(async()=>{
 const query=async(s,p)=>{calls++;assert.equal(s,sql);assert.deepEqual(p,[2026,25]);return{rows:Array.from({length:25},(_,id)=>({id})),rowCount:25};};
 const [a,b]=await Promise.all([dashboardReadQuery(sql,[2026,8],query),dashboardReadQuery(sql,[2026,25],query)]);
 assert.equal(a.rows.length,8);assert.equal(b.rows.length,25);return{};});
 assert.equal(calls,1);assert.equal(r.data_status,'ready');assert.equal(r.source_status[0].source,'donors');
});
test('SQL uses bound cycle and limit, exact projection and matching inner/outer sort',()=>{
 const q=dashboardDonorSql();assert.equal((q.match(/LIMIT \$2/g)||[]).length,2);assert.ok(q.includes('p.cycle=$1'));assert.ok(q.includes("public.money_published_scan('donors',cycle,committee_id)"));assert.ok(q.includes('ORDER BY c.published_at DESC NULLS LAST,(-d.row_id) DESC'));assert.match(q,/ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT \$2$/);
});
test('explicit legacy setting returns original view query and invalid mode fails closed',()=>{
 assert.match(donorReadRequest(2028,8,'legacy').sql,/FROM public.donors_read WHERE cycle=\$1/);assert.deepEqual(donorReadRequest(2028,8,'legacy').params,[2028,8]);assert.equal(donorReadRequest(2030,25,'optimized').sql,dashboardDonorSql());assert.throws(()=>donorReadRequest(2026,25,'typo'),{code:'INVALID_DONOR_QUERY_MODE'});
});
test('optimized SQL errors remain visible; no silent legacy or empty fallback',async()=>{
 let calls=0;const r=await withDashboardReads(async()=>{await dashboardReadQuery(dashboardDonorSql(),[2026,25],async()=>{calls++;throw Object.assign(new Error('private SQL detail'),{code:'57014'});}).catch(()=>{});return{};});assert.equal(calls,1);assert.equal(r.data_status,'unavailable');assert.equal(r.source_status[0].code,'57014');assert.ok(!JSON.stringify(r).includes('private'));
});
test('cycles and separate requests stay isolated for optimized reads',async()=>{
 let calls=0;const q=async()=>{calls++;return{rows:[]};};
 await withDashboardReads(async()=>{await dashboardReadQuery(dashboardDonorSql(),[2026,8],q);await dashboardReadQuery(dashboardDonorSql(),[2028,8],q);return{};});
 await withDashboardReads(async()=>{await dashboardReadQuery(dashboardDonorSql(),[2026,8],q);return{};});assert.equal(calls,3);
});
test('live validation rejects mutation flags before credentials or connections',async()=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/validateDashboardDonorQuery.mjs',import.meta.url)),'--apply'],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/READ_ONLY_OPTIONS_REQUIRED/);
});
