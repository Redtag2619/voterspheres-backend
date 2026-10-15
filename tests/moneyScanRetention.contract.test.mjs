import test from 'node:test';
import assert from 'node:assert/strict';
import {retentionOptions,retentionChildren,inspectRetentionDependencies,planMoneyRetention,applyMoneyRetention} from '../services/moneyScanRetention.js';
const now=new Date('2026-10-15T12:00:00Z');
const scan=(id,date,extra={})=>({id,lane:'donors',cycle:2026,scope_key:'test',status:'completed',completed_at:date,started_at:date,updated_at:date,...extra});
function database(scans,{badDependency=false,failDelete=false}={}){
 const events=[];
 return {events,query:async(sql,values)=>{
  events.push(sql);
  if(sql.includes('FROM pg_constraint'))return {rows:badDependency?[{parent_table:'money_import_records',child_schema:'public',child_table:'external_audit',child_columns:['record_id']}]:[]};
  if(sql.includes('FROM public.money_import_scans s'))return {rows:scans};
  if(sql.startsWith('SELECT COUNT'))return {rows:[{n:'3'}]};
  if(sql.startsWith('DELETE')){
   if(failDelete)throw Object.assign(new Error(),{code:'23503'});
   return {rowCount:sql.includes('public.money_import_scans ')?1:3};
  }
  return {rows:[],rowCount:0};
 }};
}
test('preview is default and apply requires reviewed plan and bounded budgets',()=>{
 assert.equal(retentionOptions([]).apply,false);
 assert.throws(()=>retentionOptions(['--apply']),{code:'PREVIEW_PLAN_REQUIRED'});
 for(const args of [['--max-scans=6'],['--max-rows=250001'],['--max-rows=NaN'],['--force'],['--apply=false']])assert.throws(()=>retentionOptions(args));
});
test('protects latest two per scope, references, unfinished and held scopes',async()=>{
 const scans=[scan('a','2026-07-01'),scan('b','2026-08-01'),scan('c','2026-09-01'),
 scan('d','2026-01-01',{is_active:true}),scan('e','2026-01-01',{is_published:true}),
 scan('f','2026-01-01',{status:'paused'}),scan('g','2026-01-01',{is_held:true}),scan('h','2026-10-01',{status:'no_data'})];
 const db=database(scans),plan=await planMoneyRetention(db,retentionOptions([]),now);
 assert.deepEqual(plan.selected.map(s=>s.id),['a']);
 assert.equal(plan.total_rows,19);
 assert.equal(plan.protected_scans.length,7);
 assert.ok(db.events.every(sql=>!sql.startsWith('DELETE')));
});
test('row budget skips whole scan rather than partly deleting its evidence',async()=>{
 const scans=[scan('a','2026-01-01',{status:'abandoned'})];
 const plan=await planMoneyRetention(database(scans),retentionOptions(['--max-rows=10']),now);
 assert.equal(plan.selected.length,0);assert.equal(plan.deferred[0].reason,'row_budget');
});
test('unknown foreign keys on any dependent table fail closed including cascades',async()=>{
 await assert.rejects(inspectRetentionDependencies(database([],{badDependency:true})),{code:'UNREVIEWED_RETENTION_DEPENDENCY'});
});
test('changed protection between preview and apply rolls back without deletes',async()=>{
 const old=scan('a','2020-01-01',{status:'abandoned'}),options=retentionOptions([]);
 const plan=await planMoneyRetention(database([old]),options);
 const db=database([{...old,is_published:true}]);
 await assert.rejects(applyMoneyRetention(db,{...options,apply:true,plan:plan.plan}),{code:'RETENTION_PLAN_CHANGED_RUN_PREVIEW_AGAIN'});
 assert.equal(db.events.at(-1),'ROLLBACK');assert.ok(!db.events.some(s=>s.startsWith('DELETE')));
});
test('atomic delete follows dependency order, verifies counts, and commits',async()=>{
 const db=database([scan('a','2020-01-01',{status:'abandoned'})]),options=retentionOptions([]);
 const plan=await planMoneyRetention(db,options);
 await applyMoneyRetention(db,{...options,apply:true,plan:plan.plan});
 const deletes=db.events.filter(s=>s.startsWith('DELETE'));
 assert.deepEqual(deletes.map(s=>s.split(' ')[2]),[...retentionChildren.map(([t])=>'public.'+t),'public.money_import_scans']);
 assert.equal(db.events.at(-1),'COMMIT');
 assert.ok(db.events.indexOf(db.events.find(s=>s.startsWith('LOCK TABLE')))<db.events.indexOf(deletes[0]));
});
test('dependent deletion failure rolls back entire cleanup',async()=>{
 const scans=[scan('a','2020-01-01',{status:'abandoned'})],options=retentionOptions([]);
 const plan=await planMoneyRetention(database(scans),options),db=database(scans,{failDelete:true});
 await assert.rejects(applyMoneyRetention(db,{...options,apply:true,plan:plan.plan}),{code:'23503'});
 assert.equal(db.events.at(-1),'ROLLBACK');assert.ok(!db.events.includes('COMMIT'));
});
