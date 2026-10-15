import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readMoneyScopeHold,heldScopeWarning} from '../services/moneyScopeHold.js';
test('hold lookup is exact and read only',async()=>{
 const hold={held_at:'2026-10-15',reason:'National backfill deferred'};
 assert.equal(await readMoneyScopeHold({query:async(sql,values)=>{
   assert.match(sql,/^SELECT/);assert.deepEqual(values,['political-money',2026,'national']);return {rows:[hold]};
 }},{lane:'political-money',cycle:2026,key:'national'}),hold);
 assert.equal(await readMoneyScopeHold({query:async()=>({rows:[]})},{}),null);
});
test('actual monitor warns on held stale progress but retains genuine errors',async()=>{
 const source=fs.readFileSync(new URL('../scripts/monitorResumableMoneyImports.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 for(const last_error of [null,'REAL_ERROR']){
  let report;
  const client={query:async sql=>({rows:sql.startsWith('SELECT')?[{lane:'political-money',cycle:2026,scope_key:'national',status:'paused',updated_at:'2026-01-01',held_at:'today',hold_reason:'Deferred',last_error}]:[]}),release(){}};
  const context=vm.createContext({heldScopeWarning,moneyRefreshIntervals:()=>({}),moneyRefreshDecision:()=>({}),pool:{connect:async()=>client,end:async()=>{}},Date,process:{exitCode:0},console:{log:v=>report=JSON.parse(v),error(){}}});
  await vm.runInContext('(async()=>{'+source+'})()',context);
  assert.equal(report.alerts.length,last_error?1:0);
  assert.match(report.warnings[0],/intentionally held/);
  assert.equal(report.scopes[0].next_due_at,null);
  assert.equal(context.process.exitCode,last_error?1:0);
 }
});
test('held scope is explicit in monitoring',()=>{
 assert.equal(heldScopeWarning({}),null);
 assert.match(heldScopeWarning({lane:'political-money',cycle:2026,scope_key:'national',held_at:'today',hold_reason:'Deferred'}),/intentionally held.*Deferred.*no automatic resume/);
});
test('held imports skip before restart, requests and score publication',()=>{
 const source=fs.readFileSync(new URL('../services/resumableMoneyImports.service.js',import.meta.url),'utf8');
 assert.ok(source.indexOf('if(hold)')<source.indexOf('if(config.restart)'));
 assert.match(source,/if\(hold\)\{[^\n]*continue;/);
 const monitor=fs.readFileSync(new URL('../scripts/monitorResumableMoneyImports.mjs',import.meta.url),'utf8');
 assert.ok(monitor.indexOf('if(holdWarning)')<monitor.indexOf("['paused','publishing']"));
 assert.match(monitor,/if\(row.last_error\)alerts.push/);
});
