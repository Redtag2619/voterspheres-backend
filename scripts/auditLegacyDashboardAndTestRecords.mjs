import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {optionsFromArgs,boundedRead,safeTiming,classifyRecord,taskCandidateSql,benchmarkQueries} from './lib/legacyReadAudit.mjs';
let pool,client;
try{
  // Parse before importing credentials or connecting. --apply is deliberately unsupported.
  const options=optionsFromArgs(process.argv.slice(2));
  await import('dotenv/config');
  ({pool}=await import('../db/pool.js'));
  pool.on('error',()=>{});
  if(!pool.options.connectionTimeoutMillis)pool.options.connectionTimeoutMillis=10000;
  client=await pool.connect();client.on('error',()=>{});
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout='5s'");
  await client.query("SET LOCAL lock_timeout='1s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
  const firms=await boundedRead(client,options.firmId?'SELECT id::text AS id,name FROM public.firms WHERE id::text=$1':'SELECT id::text AS id,name FROM public.firms WHERE LOWER(name)=LOWER($1)',[options.firmId||options.firmName]);
  if(!firms.ok||firms.rows.length!==1)throw Object.assign(new Error(),{code:firms.code||'FIRM_NOT_FOUND_OR_AMBIGUOUS'});
  const firm=firms.rows[0];
  const report={checked_at:new Date().toISOString(),mode:'read_only',firm,cycle:options.cycle,statement_timeout_ms:5000,benchmarks:[],task_review:{},limitations:[
    'Benchmarks are sequential standalone database reads. They do not measure authenticated HTTP latency, pool contention, browser rendering, or the complete dashboard request.',
    'SQL mirrors the supplied November 2 service paths; current service SHA is recorded to support comparison.',
    'The source dashboard repeats fundraising reads four times and donor/feed/vendor/consultant reads twice. Measurements are needed before naming the timeout cause.',
    'Acceptance/smoke wording only identifies candidates for review. No deletion, hiding, status change, provider call, remediation, migration, VACUUM or authorization bypass test is performed.',
    'Foreign-key inventory plus the known task_assignment_audit table does not establish that every application-level reference has been found.',
    'Descriptions, full metadata, contacts, credentials, provider payloads and benchmark result rows are omitted from the report.'
  ]};
  try{const source=await fs.readFile('services/intelligence.service.js');report.intelligence_service_sha256=createHash('sha256').update(source).digest('hex');}catch{report.intelligence_service_sha256=null;}
  for(const probe of benchmarkQueries(options.cycle)){
    const result=await boundedRead(client,probe.sql,probe.params);
    report.benchmarks.push(safeTiming(probe.name,result,probe.sql));
  }
  const candidates=await boundedRead(client,taskCandidateSql,[firm.id,options.limit+1]);
  report.task_review=candidates.ok?{ok:true,limit:options.limit,truncated:candidates.rows.length>options.limit,records:candidates.rows.slice(0,options.limit).map(classifyRecord)}:{ok:false,code:candidates.code};
  const refs=await boundedRead(client,`SELECT ns.nspname AS schema_name,c.relname AS referencing_table,f.conname,pg_get_constraintdef(f.oid) AS definition FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE f.contype='f' AND f.confrelid='public.tasks'::regclass ORDER BY ns.nspname,c.relname,f.conname`);
  report.task_foreign_key_references=refs.ok?refs.rows:{ok:false,code:refs.code};
  const ids=report.task_review.records?.map(row=>row.task_id)||[];
  if(ids.length){
    const audit=await boundedRead(client,'SELECT task_id::text AS task_id,COUNT(*)::text AS assignment_audit_rows FROM public.task_assignment_audit WHERE firm_id::text=$1 AND task_id::text=ANY($2::text[]) GROUP BY task_id',[firm.id,ids]);
    report.known_assignment_audit_references=audit.ok?audit.rows:{ok:false,code:audit.code};
  }
  await client.query('ROLLBACK');client.release();client=null;
  const output=path.resolve(options.output||path.join('diagnostics','legacy-dashboard-'+Date.now()+'.json'));
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({ok:true,mode:'read_only',output,benchmarks:report.benchmarks,review_records:report.task_review.records?.length||0,truncated:report.task_review.truncated||false,task_review_ok:report.task_review.ok,policy:'No database records changed. Individual query errors are retained in the report for investigation.'},null,2));
  if(!report.task_review.ok)process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,code:String(error.code||'LEGACY_READ_AUDIT_FAILED')}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}if(pool)await pool.end().catch(()=>{});}
