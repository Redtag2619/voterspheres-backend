import fs from 'node:fs/promises';import path from 'node:path';import {dashboardDonorSql} from '../services/dashboardDonorRead.js';
import {boundedRead} from './lib/legacyReadAudit.mjs';
import baseline from '../tools/donor-query-tests/production-view-baseline.json' with {type:'json'};
let client,pool;
try{
 let cycle=2026,output='diagnostics/dashboard-donor-validation.json';
 for(const a of process.argv.slice(2)){if(/^--cycle=\d{4}$/.test(a))cycle=Number(a.slice(8));else if(a.startsWith('--output='))output=a.slice(9);else throw Object.assign(new Error(),{code:'READ_ONLY_OPTIONS_REQUIRED'});}
 if(cycle<2000||cycle>2200||cycle%2)throw Object.assign(new Error(),{code:'INVALID_CYCLE'});
 await import('dotenv/config');({pool}=await import('../db/pool.js'));pool.on('error',()=>{});client=await pool.connect();client.on('error',()=>{});
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='30s'");await client.query("SET LOCAL lock_timeout='1s'");
 const normalize=s=>s.replace(/\s+/g,' ').trim();
 const view=await client.query("SELECT pg_get_viewdef('public.donors_read'::regclass,true) AS definition");
 const fn=await client.query("SELECT pg_get_functiondef('public.money_published_scan(text,integer,text)'::regprocedure) AS definition");
 if(normalize(view.rows[0].definition)!==normalize(baseline.view)||normalize(fn.rows[0].definition)!==normalize(baseline.winner_function))throw Object.assign(new Error(),{code:'PUBLICATION_RULES_CHANGED'});
 const report={checked_at:new Date().toISOString(),mode:'read_only',cycle,publication_rules_match:true,parity:[],runs:[]};
 for(const limit of [2147483647,8,25]){
 const original=`SELECT * FROM public.donors_read WHERE cycle=$1 ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT $2`;
 const sql=`WITH a AS MATERIALIZED (${original}),b AS MATERIALIZED (${dashboardDonorSql()})
 SELECT (SELECT COUNT(*)::text FROM a) AS original_rows,(SELECT COUNT(*)::text FROM b) AS optimized_rows,
 (SELECT COUNT(*)::text FROM(TABLE a EXCEPT ALL TABLE b) x) AS original_only,
 (SELECT COUNT(*)::text FROM(TABLE b EXCEPT ALL TABLE a) x) AS optimized_only`;
 const r=await boundedRead(client,sql,[cycle,limit]);report.parity.push({limit:limit===2147483647?'full':limit,ok:r.ok,...(r.ok?{...r.rows[0],equal:r.rows[0].original_only==='0'&&r.rows[0].optimized_only==='0'}:{code:r.code})});
 }
 for(const mode of ['legacy','optimized','optimized','legacy']){
 const sql=mode==='legacy'?'SELECT * FROM public.donors_read WHERE cycle=$1 ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT $2':dashboardDonorSql();
 const r=await boundedRead(client,'EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+sql,[cycle,25]);report.runs.push({mode,ok:r.ok,elapsed_ms:r.elapsed_ms,...(r.ok?{plan:r.rows[0]['QUERY PLAN']}:{code:r.code})});
 }
 report.passed=report.parity.every(r=>r.ok&&r.equal)&&report.runs.every(r=>r.ok);
 report.limitations=['No data/schema/index/application/environment/deployment changes.','Current snapshot only; plans do not measure end-to-end HTTP latency.'];
 await client.query('ROLLBACK');client.release();client=null;const target=path.resolve(output);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.passed,output:target,parity:report.parity,runs:report.runs.map(r=>({mode:r.mode,ok:r.ok,elapsed_ms:r.elapsed_ms})),policy:'Database unchanged.'},null,2));if(!report.passed)process.exitCode=1;
}catch(e){console.error(JSON.stringify({ok:false,code:e.code||'DONOR_VALIDATION_FAILED'}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}if(pool)await pool.end().catch(()=>{});}
