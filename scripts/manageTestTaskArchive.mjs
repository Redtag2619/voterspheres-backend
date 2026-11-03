import fs from 'node:fs/promises';import path from 'node:path';
import {collect,validatePlan,changeRegistry} from './lib/testTaskArchiveStore.mjs';
let client,pool;
try{
 let action='archive',output='diagnostics/test-task-archive-plan.json',apply=false,planFile='',reason='',firm='';
 for(const a of process.argv.slice(2)){
 if(a==='--apply')apply=true;
 else if(a.startsWith('--action='))action=a.slice(9);
 else if(a.startsWith('--firm-id='))firm=a.slice(10);
 else if(a.startsWith('--output='))output=a.slice(9);
 else if(a.startsWith('--plan-file='))planFile=a.slice(12);
 else if(a.startsWith('--reason='))reason=a.slice(9);
 else throw Object.assign(new Error(),{code:'INVALID_ARCHIVE_OPTION'});
 }
 if(firm!=='7'||!['archive','restore'].includes(action))throw Object.assign(new Error(),{code:'EXACT_FIRM_AND_ACTION_REQUIRED'});
 if(apply&&(!planFile||reason.trim().length<10))throw Object.assign(new Error(),{code:'REVIEWED_PLAN_AND_REASON_REQUIRED'});
 const reviewed=apply?JSON.parse(await fs.readFile(planFile,'utf8')):null;
 if(apply&&reviewed.action!==action)throw Object.assign(new Error(),{code:'PLAN_ACTION_MISMATCH'});
 await import('dotenv/config');({pool}=await import('../db/pool.js'));pool.on('error',()=>{});
 client=await pool.connect();client.on('error',()=>{});
 await client.query(apply?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='15s'");await client.query("SET LOCAL lock_timeout='3s'");
 if(apply){
 await client.query("SELECT pg_advisory_xact_lock(731103,7)");
 // Block writes to tasks, workspace protection fields and all reviewed history
 // until the protection check and registry writes commit together.
 await client.query('LOCK TABLE public.tasks,public.workspaces,public.task_activity,public.task_comments,public.task_assignment_audit IN SHARE ROW EXCLUSIVE MODE');
 const r=await client.query("SELECT to_regclass('public.test_task_archive_registry') IS NOT NULL AS present");
 if(r.rows[0].present)await client.query('LOCK TABLE public.test_task_archive_registry,public.test_task_archive_events IN SHARE ROW EXCLUSIVE MODE');
 }
 const plan=await collect(client,action);
 if(apply){
 validatePlan(plan,reviewed);await changeRegistry(client,plan,reason.trim());
 // Verify originals and every history byte remained unchanged by this operation.
 const after=await collect(client,action);
 if(after.registry.length!==12||after.registry.some(r=>r.active!==(action==='archive')))throw Object.assign(new Error(),{code:'REGISTRY_COUNT_MISMATCH'});
 if(JSON.stringify(after.fingerprints)!==JSON.stringify(plan.fingerprints))throw Object.assign(new Error(),{code:'HISTORY_CHANGED'});
 await client.query('COMMIT');console.log(JSON.stringify({ok:true,action,exact_task_ids:plan.exact_task_ids,history_preserved:true,policy:'Only archive registry and archive audit events changed. Operational view installed.'},null,2));
 }else{
 await client.query('ROLLBACK');const target=path.resolve(output);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({ok:plan.ready,mode:'preview',action,output:target,ready:plan.ready,plan_sha256:plan.plan_sha256,drift:plan.drift,unknown_foreign_keys:plan.unknown_foreign_keys,fingerprints:plan.fingerprints,policy:'No schema or data changed. Preview expires after 24 hours.'},null,2));if(!plan.ready)process.exitCode=1;
 }
}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({ok:false,code:e.code||'ARCHIVE_FAILED'}));process.exitCode=1;}
finally{client?.release();if(pool)await pool.end().catch(()=>{});}
