import fs from 'node:fs/promises';import path from 'node:path';
import {boundedRead} from './lib/legacyReadAudit.mjs';
import {originalDonors,candidateDonors,ordered25,paritySql} from './lib/donorBenchmarkSql.mjs';
let pool,client;
try {
 let cycle=2026,output='diagnostics/donor-benchmark.json';
 for(const arg of process.argv.slice(2)){
 if(/^--cycle=\d{4}$/.test(arg))cycle=Number(arg.slice(8));
 else if(arg.startsWith('--output='))output=arg.slice(9);
 else throw Object.assign(new Error(),{code:'READ_ONLY_OPTION_REQUIRED'});
 }
 if(cycle%2||cycle<2000||cycle>2200)throw Object.assign(new Error(),{code:'INVALID_CYCLE'});
 await import('dotenv/config');({pool}=await import('../db/pool.js'));pool.on('error',()=>{});
 client=await pool.connect();client.on('error',()=>{});
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='30s'");await client.query("SET LOCAL lock_timeout='1s'");
 const report={checked_at:new Date().toISOString(),cycle,mode:'read_only',full_parity:null,top25_parity:null,runs:[]};
 for(const [key,a,b] of [['full_parity',originalDonors,candidateDonors()],['top25_parity',ordered25(originalDonors),ordered25(candidateDonors(true))]]){
 const r=await boundedRead(client,paritySql(a,b),[cycle]);
 report[key]=r.ok?{ok:true,...r.rows[0],equal:r.rows[0].original_only==='0'&&r.rows[0].candidate_only==='0'}:{ok:false,code:r.code};
 }
 // Alternate order to reduce a simple cold-cache ordering bias; not a load test.
 for(const name of ['original','candidate','candidate','original']){
 const sql=ordered25(name==='original'?originalDonors:candidateDonors(true));
 const r=await boundedRead(client,'EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+sql,[cycle]);
 report.runs.push({name,ok:r.ok,elapsed_ms:r.elapsed_ms,...(r.ok?{plan:r.rows[0]['QUERY PLAN']}:{code:r.code})});
 }
 report.passed=report.full_parity.equal===true&&report.top25_parity.equal===true&&report.runs.every(r=>r.ok);
 report.limitations=['Current-cycle, current-snapshot parity only; no database or application query changed.','No index created. A (scan_id,committee_id) index remains a separate measured option.','30-second statement budget per read; alternating runs do not establish production HTTP latency.'];
 await client.query('ROLLBACK');client.release();client=null;
 const target=path.resolve(output);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.passed,output:target,full_parity:report.full_parity,top25_parity:report.top25_parity,runs:report.runs.map(({name,ok,elapsed_ms,code})=>({name,ok,elapsed_ms,code})),policy:'Read only; no donor records emitted.'},null,2));
 if(!report.passed)process.exitCode=1;
}catch(e){console.error(JSON.stringify({ok:false,code:e.code||'DONOR_BENCHMARK_FAILED'}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}if(pool)await pool.end().catch(()=>{});}
