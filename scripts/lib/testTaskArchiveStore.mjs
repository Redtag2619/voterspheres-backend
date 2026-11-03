import {createHash} from 'node:crypto';
import baseline from './testTaskArchiveBaseline.json' with {type:'json'};
import {taskCandidateSql} from './legacyReadAudit.mjs';
import {buildProposal} from './testTaskArchiveProposal.mjs';
export const ids=baseline.records.map(r=>r.task_id).sort((a,b)=>Number(a)-Number(b));
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error(),{code});};
export function validatePlan(live,reviewed,now=Date.now()){
 if(!live.ready||!reviewed.ready)fail('ARCHIVE_PROTECTION_FAILED');
 const age=now-Date.parse(reviewed.checked_at);
 if(!Number.isFinite(age)||age<0||age>86400000)fail('PREVIEW_EXPIRED');
 if(live.plan_sha256!==reviewed.plan_sha256)fail('PREVIEW_DRIFT');
}
export async function collect(client,action){
 const prefix=taskCandidateSql.slice(0,taskCandidateSql.indexOf("WHERE to_jsonb(t)->>'firm_id'"));
 const live=await client.query(prefix+" WHERE t.firm_id=7 AND t.id::text=ANY($1::text[]) ORDER BY t.id",[ids]);
 const refs=await client.query("SELECT ns.nspname AS schema_name,c.relname AS referencing_table,f.conname,pg_get_constraintdef(f.oid) AS definition FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE f.contype='f' AND f.confrelid='public.tasks'::regclass ORDER BY 1,2,3");
 const dependencies={},fingerprints={};
 for(const table of ['tasks','task_activity','task_comments','task_assignment_audit']){
 const where=table==='tasks'?'r.firm_id=7 AND r.id::text=ANY($1::text[])':"r.task_id::text=ANY($1::text[]) AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.id::text=r.task_id::text AND t.firm_id=7)";
 // Hash complete rows without writing task descriptions/history into the report.
 const r=await client.query(`SELECT to_jsonb(r)::text AS row FROM public.${table} r WHERE ${where} ORDER BY to_jsonb(r)::text`,[ids]);
 fingerprints[table]={rows:r.rows.length,sha256:digest(r.rows)};
 if(table!=='tasks')dependencies[table]={ok:true,counts:[]};
 }
 const proposal=buildProposal(baseline,live.rows,refs.rows,dependencies);
 const exists=await client.query("SELECT to_regclass('public.test_task_archive_registry') IS NOT NULL AS present");
 let registry=[];
 if(exists.rows[0].present)registry=(await client.query('SELECT task_id,active,plan_sha256 FROM public.test_task_archive_registry WHERE firm_id=7 AND task_id=ANY($1::text[]) ORDER BY task_id',[ids])).rows;
 const eligible=action==='archive'?registry.every(r=>!r.active):registry.length===ids.length&&registry.every(r=>r.active);
 const body={version:1,firm_id:'7',action,exact_task_ids:ids,ready:proposal.ready_for_manual_review&&eligible,drift:proposal.drift,unknown_foreign_keys:proposal.unknown_foreign_keys,fingerprints,registry};
 return {checked_at:new Date().toISOString(),...body,plan_sha256:digest(body)};
}
export const schemaSql=`
CREATE TABLE IF NOT EXISTS public.test_task_archive_registry (
 firm_id integer NOT NULL,task_id text NOT NULL,active boolean NOT NULL,
 plan_sha256 text NOT NULL,archived_at timestamptz NOT NULL DEFAULT now(),
 restored_at timestamptz,reason text NOT NULL,PRIMARY KEY(firm_id,task_id));
CREATE TABLE IF NOT EXISTS public.test_task_archive_events (
 id bigserial PRIMARY KEY,firm_id integer NOT NULL,task_id text NOT NULL,
 action text NOT NULL CHECK(action IN ('archive','restore')),plan_sha256 text NOT NULL,
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE VIEW public.operational_tasks WITH (security_invoker=true) AS SELECT t.* FROM public.tasks t
 WHERE NOT EXISTS(SELECT 1 FROM public.test_task_archive_registry a
 WHERE a.firm_id=t.firm_id AND a.task_id=t.id::text AND a.active);
CREATE OR REPLACE VIEW public.archived_test_tasks WITH (security_invoker=true) AS SELECT t.* FROM public.tasks t
 WHERE EXISTS(SELECT 1 FROM public.test_task_archive_registry a WHERE a.firm_id=t.firm_id AND a.task_id=t.id::text AND a.active);
`;
export async function changeRegistry(client,plan,reason){
 await client.query(schemaSql);
 for(const id of ids){
 if(plan.action==='archive')await client.query(`INSERT INTO public.test_task_archive_registry(firm_id,task_id,active,plan_sha256,reason)
 VALUES(7,$1,true,$2,$3) ON CONFLICT(firm_id,task_id) DO UPDATE SET active=true,plan_sha256=EXCLUDED.plan_sha256,archived_at=now(),restored_at=NULL,reason=EXCLUDED.reason`,[id,plan.plan_sha256,reason]);
 else {const r=await client.query('UPDATE public.test_task_archive_registry SET active=false,restored_at=now(),plan_sha256=$2 WHERE firm_id=7 AND task_id=$1 AND active RETURNING task_id',[id,plan.plan_sha256]);if(r.rowCount!==1)fail('RESTORE_COUNT_MISMATCH');}
 await client.query('INSERT INTO public.test_task_archive_events(firm_id,task_id,action,plan_sha256,reason) VALUES(7,$1,$2,$3,$4)',[id,plan.action,plan.plan_sha256,reason]);
 }
}
