import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeConfig,pageUrl,validatePage} from '../services/fecMoneyProtocol.js';
import {resumeMoneyLane} from '../services/resumableMoneyEngine.js';
import {MoneyCheckpointStore} from '../services/moneyCheckpointStore.js';
const config=scopeConfig({lane:'political-money',cycle:2026,committees:'C00524181'});
const initial={id:'scan',status:'paused',cutoff:'2026-10-13',cursor:{},pages:0,records:0};
const page=(id='4060120261512036294')=>({results:[{sub_id:id,committee_id:'C00524181',cycle:'2026',expenditure_date:'2026-03-02',expenditure_amount:'100.01'}],pagination:{pages:'2',last_indexes:{last_index:id,last_expenditure_date:'2026-03-02'}}});
test('Schedule E second request uses exact provider cursor and never page number',()=>{
 const first=validatePage(config,initial,page());
 const url=pageUrl(config,{...initial,cursor:first.cursor},'key');
 assert.equal(url.searchParams.get('last_index'),'4060120261512036294');
 assert.equal(url.searchParams.get('last_expenditure_date'),'2026-03-02');
 assert.equal(url.searchParams.get('cycle'),'2026');
 assert.equal(url.searchParams.has('page'),false);
 assert.throws(()=>pageUrl(config,{...initial,cursor:{page:2}},'key'),{code:'LEGACY_SCHEDULE_E_CURSOR'});
});
test('Schedule E requires valid advancing cursor and terminal empty page',()=>{
 const first=validatePage(config,initial,page());
 assert.throws(()=>validatePage(config,{...initial,cursor:first.cursor},page()),{code:'PROVIDER_CURSOR_DID_NOT_ADVANCE'});
 const bad=page();delete bad.pagination.last_indexes;
 assert.throws(()=>validatePage(config,initial,bad),{code:'MISSING_PROVIDER_CURSOR'});
 assert.equal(validatePage(config,{...initial,cursor:first.cursor},{results:[],pagination:{pages:'2'}}).complete,true);
});
test('verified legacy one-page scan repairs cursor then requests next distinct page',async()=>{
 const first=validatePage(config,initial,page());
 let state={...initial,cursor:{page:2},pages:1,records:1,anchor:first.fingerprint},repairs=0;
 const requests=[];
 const store={load:async()=>state,repairScheduleECursor:async(_c,s,cursor)=>{repairs++;state={...s,cursor};return state;},commitPage:async(_c,s,p)=>{state={...s,cursor:p.cursor,pages:s.pages+1,records:s.records+p.records.length};return state;},fail:async()=>{}};
 await resumeMoneyLane({store,config,apiKey:'key',pageBudget:1,request:async url=>{requests.push(url);return requests.length===1?page():page('4060120261512036295');}});
 assert.equal(repairs,1);assert.equal(state.pages,2);assert.equal(state.records,2);
 assert.equal(requests[0].searchParams.has('page'),false);
 assert.equal(requests[1].searchParams.get('last_index'),'4060120261512036294');
});
test('ambiguous or changed legacy checkpoints never repair or publish',async()=>{
 for(const changed of [false,true]){
  const first=validatePage(config,initial,page());let repairs=0;
  const s={...initial,cursor:{page:2},pages:changed?1:2,records:1,anchor:changed?'different':first.fingerprint};
  const store={load:async()=>s,repairScheduleECursor:async()=>{repairs++;},fail:async()=>{}};
  await assert.rejects(resumeMoneyLane({store,config,apiKey:'key',request:async()=>page()}),{code:changed?'PROVIDER_ANCHOR_CHANGED':'LEGACY_SCHEDULE_E_CHECKPOINT_REQUIRES_REVIEW'});
  assert.equal(repairs,0);
 }
});
test('checkpoint repair is transactional and rolls back a moved checkpoint',async()=>{
 for(const moved of [false,true]){
  const events=[];
  const client={query:async(sql)=>{events.push(sql);if(sql.startsWith('UPDATE money_import_scans'))return {rows:moved?[]:[{id:'scan'}]};return {rows:[]};}};
  const store=new MoneyCheckpointStore(client);store.load=async()=>({...initial,cursor:{last_index:'1',last_expenditure_date:'2026-03-02'}});
  const work=store.repairScheduleECursor(config,{...initial,records:1,anchor:'a',cursor:{page:2}},{last_index:'1',last_expenditure_date:'2026-03-02'});
  if(moved)await assert.rejects(work,{code:'CHECKPOINT_MOVED'});else await work;
  assert.equal(events[0],'BEGIN');assert.equal(events.at(-1),moved?'ROLLBACK':'COMMIT');
 }
});
