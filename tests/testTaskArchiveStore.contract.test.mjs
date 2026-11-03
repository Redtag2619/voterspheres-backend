import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {validatePlan,changeRegistry,ids,schemaSql} from '../scripts/lib/testTaskArchiveStore.mjs';
const now=Date.now(),p={ready:true,checked_at:new Date(now).toISOString(),plan_sha256:'reviewed',action:'archive'};
test('fresh check rejects changed records, history, references or registry state via hash and expires plans',()=>{
 validatePlan(p,p,now);assert.throws(()=>validatePlan({...p,ready:false},p,now),/./);assert.throws(()=>validatePlan({...p,plan_sha256:'changed'},p,now),/./);assert.throws(()=>validatePlan(p,{...p,checked_at:new Date(now-86400001).toISOString()},now),/./);
});
test('archive changes exactly twelve registry records and audit events, never tasks or dependent history',async()=>{
 const calls=[];await changeRegistry({query:async(sql,args)=>{calls.push({sql,args});return{rowCount:1};}},p,'Reviewed acceptance fixtures');
 assert.equal(calls.length,25);assert.deepEqual(calls.filter(c=>c.sql.startsWith('INSERT INTO public.test_task_archive_registry')).map(c=>c.args[0]),ids);
 assert.ok(!calls.some(c=>/\b(?:DELETE FROM|UPDATE) public\.(?:tasks|task_activity|task_comments|task_assignment_audit)\b/i.test(c.sql)));
 assert.match(schemaSql,/security_invoker=true/);assert.match(schemaSql,/a.firm_id=t.firm_id AND a.task_id=t.id::text AND a.active/);
});
test('restore preserves archive events, requires exactly one active registry row per ID',async()=>{
 let updates=0,events=0;await changeRegistry({query:async(sql)=>{if(sql.startsWith('UPDATE'))updates++;if(sql.startsWith('INSERT INTO public.test_task_archive_events'))events++;return{rowCount:1};}},{...p,action:'restore'},'Restore reviewed fixtures');assert.equal(updates,12);assert.equal(events,12);
 await assert.rejects(changeRegistry({query:async()=>({rowCount:0})},{...p,action:'restore'},'Restore reviewed fixtures'),{code:'RESTORE_COUNT_MISMATCH'});
});
test('apply rejects missing review and wrong firm before loading credentials',()=>{
 const cli=fileURLToPath(new URL('../scripts/manageTestTaskArchive.mjs',import.meta.url));
 for(const args of [['--firm-id=7','--apply'],['--firm-id=8']]){const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(r.status,1);assert.doesNotMatch(r.stderr,/ERR_MODULE_NOT_FOUND/);}
});
test('apply rechecks inside write-blocking transaction and verifies history before commit',async()=>{
 const s=await fs.readFile(new URL('../scripts/manageTestTaskArchive.mjs',import.meta.url),'utf8');
 assert.ok(s.indexOf('LOCK TABLE public.tasks')<s.indexOf('const plan=await collect'));
 assert.ok(s.indexOf('validatePlan(plan,reviewed)')<s.indexOf('await changeRegistry'));
 assert.ok(s.indexOf('HISTORY_CHANGED')<s.indexOf("await client.query('COMMIT')"));assert.match(s,/ROLLBACK/);
});
test('real collector detects full-row/history edits and refuses an unknown inbound reference',async()=>{
 const {collect}=await import('../scripts/lib/testTaskArchiveStore.mjs');
 const baseline=JSON.parse(await fs.readFile(new URL('../scripts/lib/testTaskArchiveBaseline.json',import.meta.url),'utf8'));
 function fake({history='original',unknown=false,active=false}={}){return{query:async(sql)=>{
 if(sql.includes('LEFT(COALESCE'))return{rows:baseline.records};
 if(sql.includes('pg_constraint'))return{rows:unknown?[{schema_name:'public',referencing_table:'new_history'}]:[]};
 if(sql.includes('to_regclass'))return{rows:[{present:active}]};
 if(sql.startsWith('SELECT task_id,active'))return{rows:ids.map(task_id=>({task_id,active:true,plan_sha256:'old'}))};
 if(sql.includes('to_jsonb(r)::text AS row'))return{rows:[{row:sql.includes('public.task_activity')?history:'unchanged'}]};
 throw new Error('Unexpected query');}};}
 const a=await collect(fake(),'archive'),b=await collect(fake({history:'edited'}),'archive');assert.equal(a.ready,true);assert.notEqual(a.plan_sha256,b.plan_sha256);assert.throws(()=>validatePlan(b,a),{code:'PREVIEW_DRIFT'});
 assert.equal((await collect(fake({unknown:true}),'archive')).ready,false);
 assert.equal((await collect(fake({active:true}),'archive')).ready,false);
 assert.equal((await collect(fake({active:true}),'restore')).ready,true);
});
