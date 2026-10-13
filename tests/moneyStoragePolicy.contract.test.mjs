import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {moneyRefreshIntervals,moneyRefreshDecision,previewScanRetention} from '../services/moneyStoragePolicy.js';
import {resumeMoneyLane} from '../services/resumableMoneyEngine.js';
import {scopeConfig} from '../services/fecMoneyProtocol.js';
const now=new Date('2026-10-13T12:00:00Z'),intervals=moneyRefreshIntervals({});
test('refresh intervals default weekly donors, daily vendors/political/availability and reject invalid configuration',()=>{
 assert.equal(intervals.donors,168);assert.equal(intervals.vendors,24);assert.equal(intervals.unavailable,24);
 for(const value of ['0','-1','NaN','9000',''])assert.throws(()=>moneyRefreshIntervals({MONEY_DONORS_REFRESH_HOURS:value}),{code:'INVALID_MONEY_REFRESH_INTERVAL'});
});
test('recent terminal states skip without provider requests or checkpoint writes',async()=>{
 for(const status of ['completed','no_data','not_available_yet']){
  const s={id:'scan',status,completedAt:now.toISOString(),updatedAt:now.toISOString()};
  const store={load:async()=>s,start(){throw Error('must not write');},prepareAvailabilityRetry(){throw Error('must not write');}};
  const result=await resumeMoneyLane({store,config:scopeConfig({lane:'donors',cycle:2026,committees:'C00547349'}),apiKey:'key',refreshIntervals:intervals,now:()=>now,request(){throw Error('must not request');}});
  assert.equal(result.status,'not_due');assert.equal(result.underlyingStatus,status);assert.equal(s.status,status);assert.ok(result.nextDueAt);
 }
});
test('due boundary, missing timestamps and active scans remain eligible',()=>{
 const s={status:'completed',completedAt:'2026-10-12T12:00:00Z'};
 assert.equal(moneyRefreshDecision(s,'vendors',intervals,now).due,true);
 assert.equal(moneyRefreshDecision(s,'donors',intervals,now).due,false);
 assert.equal(moneyRefreshDecision({status:'completed'},'donors',intervals,now).due,true);
 for(const status of ['paused','publishing'])assert.equal(moneyRefreshDecision({status,completedAt:now.toISOString()},'donors',intervals,now).due,true);
});
test('weekly donor refresh becomes eligible and starts new scan only after its interval',async()=>{
 let starts=0,requests=0;
 const store={load:async()=>({id:'old',status:'completed',completedAt:'2026-10-01T12:00:00Z'}),start:async()=>{starts++;return {id:'new',status:'paused',pages:0,records:0,cursor:{},cutoff:'2026-10-13'};},commitPage:async()=>({id:'new',status:'no_data'}),fail:async()=>{}};
 const result=await resumeMoneyLane({store,config:scopeConfig({lane:'donors',cycle:2026,committees:'C00547349'}),apiKey:'key',refreshIntervals:intervals,now:()=>now,request:async()=>{requests++;return {results:[],pagination:{pages:'0'}};}});
 assert.equal(starts,1);assert.equal(requests,1);assert.equal(result.status,'no_data');
});
test('retention protects all references, unfinished scans, latest two completed and minimum age',()=>{
 const base={lane:'vendors',cycle:2026,scope_key:'test',status:'completed',started_at:'2026-08-01',completed_at:'2026-08-01',updated_at:'2026-08-01'};
 const scans=[{...base,id:'published',is_published:true},{...base,id:'active',is_active:true,status:'paused'},
  {...base,id:'newest',completed_at:'2026-08-03'},{...base,id:'second',completed_at:'2026-08-02'},
  {...base,id:'old'},{...base,id:'recent',status:'no_data',completed_at:'2026-10-12'},
  {...base,id:'unfinished',status:'publishing'},{...base,id:'unknown',status:'mystery'},
  {...base,id:'other-scope',scope_key:'other'},{...base,id:'other-cycle',cycle:2028}];
 const report=previewScanRetention(scans,{now});
 assert.deepEqual(report.filter(r=>r.retention_candidate).map(r=>r.id),['old']);
 assert.throws(()=>previewScanRetention(scans,{keepCompleted:1}),{code:'INVALID_RETENTION_POLICY'});
});
test('retention CLI refuses --apply before opening a database connection',async()=>{
 const source=fs.readFileSync(new URL('../scripts/previewMoneyRetention.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');let connections=0,report;
 const context=vm.createContext({previewScanRetention,process:{argv:['node','script','--apply'],exitCode:0},pool:{connect(){connections++;},end:async()=>{}},console:{log(){},error:v=>report=JSON.parse(v)}});
 await vm.runInContext('(async()=>{'+source+'})()',context);
 assert.equal(connections,0);assert.equal(report.code,'PREVIEW_ONLY_NO_ARGUMENTS');
});
