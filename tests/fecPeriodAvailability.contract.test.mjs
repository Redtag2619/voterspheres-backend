import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {classifyFecPeriodResponse} from '../services/fecPeriodAvailability.js';
import {createFecHttpClient} from '../services/fecHttpClient.js';
import {resumeMoneyLane} from '../services/resumableMoneyEngine.js';
import {scopeConfig,parseFecMoneyJson} from '../services/fecMoneyProtocol.js';
import {MoneyCheckpointStore} from '../services/moneyCheckpointStore.js';
import {parseImportCycles} from '../services/cycleImportCoordinator.js';
import {moneyRefreshIntervals,moneyRefreshDecision} from '../services/moneyStoragePolicy.js';
const message='two_year_transaction_period not found. Data exists for two_year_transaction_periods between 1976 and 2026.';
const url=(lane='b',period=2028)=>`https://api.open.fec.gov/v1/schedules/schedule_${lane}/?two_year_transaction_period=${period}&api_key=private-key`;
const response=(body={message,status:404},status=404)=>new Response(JSON.stringify(body),{status});
test('recognizes only exact unavailable future A/B period contract',async()=>{
 for(const lane of ['a','b'])assert.equal((await classifyFecPeriodResponse(response(),url(lane))).code,'FEC_PERIOD_NOT_AVAILABLE');
 for(const [r,u] of [[response(),url('e')],[response(),url('b',2026)],[response(),url('b',2029)],[response({message:'Not found',status:404}),url()],[response({message,status:403}),url()],[response({message},500),url()]])assert.equal(await classifyFecPeriodResponse(r,u),null);
});
test('actual HTTP client emits safe availability code once without leaking body or URL',async()=>{
 let requests=0;
 const request=createFecHttpClient({intervalMs:0,fetchImpl:async()=>{requests++;return response();},classifyErrorResponse:classifyFecPeriodResponse});
 await assert.rejects(request(url()),error=>{assert.equal(error.code,'FEC_PERIOD_NOT_AVAILABLE');assert.equal(error.availablePeriodMax,2026);assert.ok(!JSON.stringify(error).includes('private-key'));return true;});
 assert.equal(requests,1);
});
test('generic 404 and default FEC client remain hard failures',async()=>{
 for(const classifier of [null,classifyFecPeriodResponse]){
  const request=createFecHttpClient({intervalMs:0,fetchImpl:async()=>response({message:'Not found',status:404}),classifyErrorResponse:classifier});
  await assert.rejects(request(url()),{code:'FEC_REQUEST_FAILED',providerStatus:404});
 }
});
class Store {
 constructor(){this.states=new Map();this.publication='previous';this.failures=[];}
 async load(c){return this.states.get(c.lane+'/'+c.cycle);}
 async start(c,cutoff){const s={id:c.lane+'/'+c.cycle,status:'paused',pages:0,records:0,cursor:{},cutoff};this.states.set(s.id,s);return s;}
 async markNotAvailable(_c,s){s.status='not_available_yet';s.last_error=null;return s;}
 async prepareAvailabilityRetry(_c,s,cutoff){s.status='paused';s.cutoff=cutoff;s.cursor={};return s;}
 async commitPage(_c,s,p){s.pages++;s.status=p.complete?'no_data':'paused';s.records+=p.records.length;s.cursor=p.cursor;return s;}
 async fail(_c,s,code){this.failures.push(code);s.last_error=code;}
}
const unavailable=()=>Object.assign(new Error(),{code:'FEC_PERIOD_NOT_AVAILABLE'});
test('unavailable scan preserves publication and next run makes a fresh availability request',async()=>{
 const store=new Store(),config=scopeConfig({lane:'vendors',cycle:2028,committees:'C00547349'});let requests=0;
 const first=await resumeMoneyLane({store,config,apiKey:'key',request:async()=>{requests++;throw unavailable();},now:()=>new Date('2026-10-13')});
 assert.equal(first.status,'not_available_yet');assert.equal(store.publication,'previous');assert.equal(store.failures.length,0);
 let cutoff;
 const second=await resumeMoneyLane({store,config,apiKey:'key',request:async u=>{requests++;cutoff=u.searchParams.get('max_date');return {results:[],pagination:{pages:'0'}};},now:()=>new Date('2027-01-02')});
 assert.equal(requests,2);assert.equal(cutoff,'2027-01-02');assert.equal(second.id,first.id);assert.equal(second.status,'no_data');assert.equal(store.publication,'previous');
});
test('unavailable response after staged data or in Schedule E remains a hard error',async()=>{
 for(const lane of ['vendors','political-money']){
  const store=new Store(),c=scopeConfig({lane,cycle:2028,committees:'C00547349'}),s=await store.start(c,'2026-10-13');
  if(lane==='vendors'){s.pages=1;s.records=100;}
  await assert.rejects(resumeMoneyLane({store,config:c,apiKey:'key',request:async()=>{throw unavailable();}}),{code:'FEC_PERIOD_NOT_AVAILABLE'});
  assert.equal(s.status,'paused');assert.equal(store.failures.length,1);
 }
});
test('actual batch continues donor and later cycles after unavailable vendors',async()=>{
 const source=fs.readFileSync(new URL('../services/resumableMoneyImports.service.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
 const store=new Store(),visited=[];
 const request=async u=>{const lane=u.pathname.includes('schedule_b')?'vendors':'donors',cycle=Number(u.searchParams.get('two_year_transaction_period'));visited.push(lane+'/'+cycle);if(lane==='vendors')throw unavailable();return {results:[],pagination:{pages:'0'}};};
 const client={query:async sql=>({rows:sql.includes('storage_version')?[{version:1}]:sql.includes('election_cycles')?[{cycle_year:2028},{cycle_year:2030}]:[]})};
 const context=vm.createContext({moneyRefreshIntervals,createFecHttpClient:()=>request,classifyFecPeriodResponse,parseFecMoneyJson,scopeConfig,LANES:{vendors:{},donors:{}},importError:code=>Object.assign(new Error(),{code}),parseImportCycles,withMoneyImportLock:async(_p,work)=>work(client),resumeMoneyLane,MoneyCheckpointStore:class{constructor(){return store;}},promoteResumablePoliticalRecord(){},rebuildResumableMoneyScores(){},process:{env:{FEC_API_KEY:'key'}}});
 vm.runInContext(source,context);
 const result=await context.runResumableMoneyImports({}, {cycles:'2028,2030',lanes:'vendors,donors',committees:'C00547349'});
 assert.equal(result.ok,true);assert.deepEqual(visited,['vendors/2028','donors/2028','vendors/2030','donors/2030']);
 assert.deepEqual(Array.from(result.results,r=>r.status),['not_available_yet','no_data','not_available_yet','no_data']);
});
test('availability store updates are conditional transactions and never touch publication pointers',async()=>{
 for(const moved of [false,true]){
  const events=[],client={query:async sql=>{events.push(sql);return {rows:sql.startsWith('UPDATE money_import_scans')?(moved?[]:[{id:'scan'}]):[]};}};
  const store=new MoneyCheckpointStore(client);store.load=async()=>({status:'not_available_yet'});
  const operation=store.markNotAvailable({}, {id:'scan'});
  if(moved)await assert.rejects(operation,{code:'CHECKPOINT_MOVED'});else await operation;
  assert.equal(events.at(-1),moved?'ROLLBACK':'COMMIT');assert.ok(events.every(sql=>!sql.includes('published_scan_id')));
 }
});
test('monitor reports unavailable periods as warnings without failure alerts',async()=>{
 const source=fs.readFileSync(new URL('../scripts/monitorResumableMoneyImports.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');let report;
 const client={query:async sql=>({rows:sql.startsWith('SELECT')?[{lane:'vendors',cycle:2028,scope_key:'test',status:'not_available_yet',last_error:null,published_at:null,updated_at:new Date().toISOString()}]:[]}),release(){}};
 const context=vm.createContext({moneyRefreshIntervals,moneyRefreshDecision,pool:{connect:async()=>client,end:async()=>{}},Date,process:{exitCode:0},console:{log:v=>report=JSON.parse(v),error(){}}});
 await vm.runInContext('(async()=>{'+source+'})()',context);
 assert.equal(report.alerts.length,0);assert.match(report.warnings[0],/not available yet/);assert.equal(context.process.exitCode,0);
});
