import fs from 'node:fs/promises';import path from 'node:path';
import baseline from './lib/testTaskArchiveBaseline.json' with {type:'json'};
import {boundedRead,taskCandidateSql} from './lib/legacyReadAudit.mjs';
import {buildProposal} from './lib/testTaskArchiveProposal.mjs';
let pool,client;
try{
 let firmId='',output='diagnostics/test-task-archive-preview.json';
 for(const arg of process.argv.slice(2)){if(arg.startsWith('--firm-id='))firmId=arg.slice(10);else if(arg.startsWith('--output='))output=arg.slice(9);else throw Object.assign(new Error(),{code:'PREVIEW_ONLY_OPTION_REJECTED'});}
 if(firmId!==baseline.firm_id)throw Object.assign(new Error(),{code:'REVIEWED_FIRM_REQUIRED'});
 await import('dotenv/config');({pool}=await import('../db/pool.js'));pool.on('error',()=>{});if(!pool.options.connectionTimeoutMillis)pool.options.connectionTimeoutMillis=10000;
 client=await pool.connect();client.on('error',()=>{});await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='5s'");await client.query("SET LOCAL lock_timeout='1s'");
 const ids=baseline.records.map(row=>row.task_id);
 const prefix=taskCandidateSql.slice(0,taskCandidateSql.indexOf("WHERE to_jsonb(t)->>'firm_id'"));
 if(!prefix)throw Object.assign(new Error(),{code:'REVIEW_QUERY_INVALID'});
 const live=await boundedRead(client,prefix+" WHERE to_jsonb(t)->>'firm_id'=$1 AND t.id::text=ANY($2::text[]) ORDER BY t.id",[firmId,ids]);
 if(!live.ok)throw Object.assign(new Error(),{code:live.code});
 const refs=await boundedRead(client,"SELECT ns.nspname AS schema_name,c.relname AS referencing_table,f.conname,pg_get_constraintdef(f.oid) AS definition FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE f.contype='f' AND f.confrelid='public.tasks'::regclass ORDER BY 1,2,3");
 if(!refs.ok)throw Object.assign(new Error(),{code:refs.code});
 const dependencies={};
 for(const table of ['task_activity','task_comments','task_assignment_audit']){
  const result=await boundedRead(client,`SELECT r.task_id::text AS task_id,COUNT(*)::text AS rows FROM public.${table} r JOIN public.tasks t ON t.id::text=r.task_id::text WHERE to_jsonb(t)->>'firm_id'=$1 AND t.id::text=ANY($2::text[]) GROUP BY r.task_id`,[firmId,ids]);
  dependencies[table]=result.ok?{ok:true,counts:result.rows}:{ok:false,code:result.code};
 }
 const proposal={checked_at:new Date().toISOString(),...buildProposal(baseline,live.rows,refs.rows,dependencies)};
 await client.query('ROLLBACK');client.release();client=null;
 const target=path.resolve(output);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(proposal,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({ok:true,mode:proposal.mode,output:target,exact_task_ids:ids,ready_for_manual_review:proposal.ready_for_manual_review,drift:proposal.drift,unknown_foreign_keys:proposal.unknown_foreign_keys,dependency_read_errors:proposal.dependency_read_errors,plan_sha256:proposal.plan_sha256,policy:'No archive registry created; no tasks hidden, updated, archived or deleted.'},null,2));
}catch(error){console.error(JSON.stringify({ok:false,code:String(error.code||'ARCHIVE_PREVIEW_FAILED')}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}if(pool)await pool.end().catch(()=>{});}
