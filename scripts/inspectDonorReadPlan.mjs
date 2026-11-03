import fs from 'node:fs/promises';import path from 'node:path';
import {boundedRead} from './lib/legacyReadAudit.mjs';
let pool,client;
try{
 let cycle=2026,analyze=false,output='diagnostics/donor-read-plan.json';
 for(const arg of process.argv.slice(2)){if(arg.startsWith('--cycle='))cycle=Number(arg.slice(8));else if(arg==='--analyze')analyze=true;else if(arg.startsWith('--output='))output=arg.slice(9);else throw Object.assign(new Error(),{code:'READ_PLAN_OPTION_REJECTED'});}
 if(!Number.isInteger(cycle)||cycle<2000||cycle>2200||cycle%2)throw Object.assign(new Error(),{code:'INVALID_CYCLE'});
 await import('dotenv/config');({pool}=await import('../db/pool.js'));pool.on('error',()=>{});if(!pool.options.connectionTimeoutMillis)pool.options.connectionTimeoutMillis=10000;
 client=await pool.connect();client.on('error',()=>{});await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='10s'");await client.query("SET LOCAL lock_timeout='1s'");
 const report={checked_at:new Date().toISOString(),mode:'read_only',cycle,analyze,statement_timeout_ms:10000};
 const queries={
  view_definition:["SELECT pg_get_viewdef('public.donors_read'::regclass,true) AS definition",[]],
  published_scan_function:["SELECT p.provolatile,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='money_published_scan' ORDER BY p.oid LIMIT 5",[]],
  supporting_indexes:["SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname",[['donors','money_donor_snapshots','money_import_scans','money_import_checkpoints']]],
  approximate_table_stats:["SELECT relname,n_live_tup,n_dead_tup,last_analyze,last_autoanalyze,pg_total_relation_size(relid)::text AS total_bytes FROM pg_stat_user_tables WHERE schemaname='public' AND relname=ANY($1::text[]) ORDER BY relname",[['donors','money_donor_snapshots','money_import_scans','money_import_checkpoints']]],
  plan:[`EXPLAIN (${analyze?'ANALYZE, BUFFERS, TIMING OFF, ':''}FORMAT JSON) SELECT * FROM public.donors_read WHERE cycle=$1 ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT 25`,[cycle]]
 };
 for(const [name,[sql,params]] of Object.entries(queries)){const result=await boundedRead(client,sql,params);report[name]=result.ok?{ok:true,elapsed_ms:result.elapsed_ms,rows:result.rows}:{ok:false,elapsed_ms:result.elapsed_ms,code:result.code};}
 report.limitations=['No migration, index creation, ANALYZE command, VACUUM, writes, provider calls or publication changes. EXPLAIN ANALYZE is an optional bounded execution of the SELECT, not the PostgreSQL ANALYZE maintenance command.','Plans are diagnostic evidence; no donor-view replacement is proposed before reviewing this output.'];
 await client.query('ROLLBACK');client.release();client=null;
 const target=path.resolve(output);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({ok:true,mode:'read_only',output:target,plan_ok:report.plan.ok,plan_code:report.plan.code||null,plan_elapsed_ms:report.plan.elapsed_ms,analyze,policy:'Database unchanged.'},null,2));
}catch(error){console.error(JSON.stringify({ok:false,code:String(error.code||'DONOR_PLAN_FAILED')}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}if(pool)await pool.end().catch(()=>{});}
