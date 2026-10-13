import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseFecMoneyJson,scopeConfig,pageUrl,validatePage} from '../services/fecMoneyProtocol.js';
import {resumeMoneyLane} from '../services/resumableMoneyEngine.js';
import {MoneyCheckpointStore} from '../services/moneyCheckpointStore.js';
import {donorProjection,vendorProjection} from '../services/moneySnapshotProjection.js';
import {createFecHttpClient} from '../services/fecHttpClient.js';
import {parseImportCycles} from '../services/cycleImportCoordinator.js';
import {fileURLToPath} from 'node:url';
const config=()=>scopeConfig({lane:'vendors',cycle:2026,committees:'C00547349',perPage:2});
const row=(id='4081920251218787860',extra={})=>({sub_id:id,committee_id:'C00547349',two_year_transaction_period:'2026',disbursement_amount:'2535912.72',disbursement_date:'2025-02-05',recipient_name:'TEST VENDOR',...extra});
const state=()=>({id:'scan',status:'paused',cursor:{},pages:0,records:0,cutoff:'2026-10-12',publishCursor:null});
const page=(rows=[row()],last='4081920251218787860')=>({results:rows,pagination:{pages:'1',last_indexes:{last_index:last,last_disbursement_date:'2025-02-05'}}});

test('lossless JSON keeps large adjacent identifiers distinct and money exact',()=>{
 const r=parseFecMoneyJson('{"a":4081920251218787860,"b":4081920251218787861,"amount":2535912.72,"memoed":false,"text":"keep 123 and \\"quotes\\""}');
 assert.equal(r.a,'4081920251218787860');assert.equal(r.b,'4081920251218787861');assert.equal(r.amount,'2535912.72');assert.equal(r.memoed,false);assert.match(r.text,/123/);
});
test('lossless decoder works through actual retry/throttle client',async()=>{
 const get=createFecHttpClient({intervalMs:0,fetchImpl:async()=>({ok:true,text:async()=>'{"sub_id":4081920251218787861}'}),decodeResponse:async r=>parseFecMoneyJson(await r.text())});
 assert.equal((await get('https://example.invalid')).sub_id,'4081920251218787861');
});
test('explicit scope is required and can never combine national with committees',()=>{
 assert.throws(()=>scopeConfig({lane:'vendors',cycle:2026}),{code:'EXPLICIT_IMPORT_SCOPE_REQUIRED'});
 assert.throws(()=>scopeConfig({lane:'vendors',cycle:2026,national:true,committees:'C00547349'}),{code:'EXPLICIT_IMPORT_SCOPE_REQUIRED'});
 assert.throws(()=>scopeConfig({lane:'vendors',cycle:2029,national:true}),{code:'INVALID_ELECTION_CYCLE'});
});
test('Schedule A/B requests carry exact cursor, cycle, scope and frozen cutoff',()=>{
 const c=config(),s={...state(),cursor:{last_index:'4081920251218787861',last_disbursement_date:'2025-02-05'}};
 const url=pageUrl(c,s,'test-secret');
 assert.equal(url.searchParams.get('last_index'),'4081920251218787861');assert.equal(url.searchParams.get('two_year_transaction_period'),'2026');
 assert.equal(url.searchParams.get('max_date'),'2026-10-12');assert.deepEqual(url.searchParams.getAll('committee_id'),['C00547349']);assert.equal(url.searchParams.has('page'),false);
});
test('nonempty page count does not imply completion; terminal empty page does',()=>{
 assert.equal(validatePage(config(),state(),page()).complete,false);
 assert.equal(validatePage(config(),state(),page([])).complete,true);
});
test('malformed pagination, unsafe numbers, conflicting scope and invalid money fail',()=>{
 for(const [p,code] of [[{results:[],pagination:{}},'INVALID_PROVIDER_PAGINATION'],[page([row(4081920251218787860)]),'UNSAFE_PROVIDER_IDENTIFIER'],[page([row('1',{committee_id:'C00000001'})]),'PROVIDER_SCOPE_MISMATCH'],[page([row('1',{two_year_transaction_period:2030})]),'PROVIDER_CYCLE_MISMATCH'],[page([row('1',{disbursement_amount:null})]),'INVALID_PROVIDER_AMOUNT']])assert.throws(()=>validatePage(config(),state(),p),{code});
 assert.throws(()=>validatePage(scopeConfig({lane:'vendors',cycle:2026,national:true}),state(),page([row('1',{committee_id:['C00547349']})])),{code:'PROVIDER_SCOPE_MISMATCH'});
});
test('invalid dates, cutoff mismatch, repeated cursor and null cursor fail safely',()=>{
 assert.throws(()=>validatePage(config(),state(),page([row('1',{disbursement_date:'2026-02-30'})])),{code:'INVALID_PROVIDER_DATE'});
 assert.throws(()=>validatePage(config(),state(),page([row('1',{disbursement_date:'2027-01-01'})])),{code:'PROVIDER_CUTOFF_MISMATCH'});
 assert.throws(()=>validatePage(config(),{...state(),cursor:{last_index:'4081920251218787860',last_disbursement_date:'2025-02-05'}},page()),{code:'PROVIDER_CURSOR_DID_NOT_ADVANCE'});
 const p=page();p.pagination.last_indexes.last_disbursement_date=null;assert.throws(()=>validatePage(config(),state(),p),{code:'NULL_DATE_CURSOR_REQUIRES_REVIEW'});
});
test('donor disclosure groups separate committees and never invent candidate/contact identity',()=>{
 const r={contributor_name:'TEST PERSON',contributor_state:'TX',contributor_city:'AUSTIN',contribution_receipt_amount:'100.01',committee_id:'C00547349'};
 const a=donorProjection(r,2026),b=donorProjection({...r,committee_id:'C00000001'},2026);
 assert.notEqual(a.key,b.key);assert.equal(a.value.amount,'100.01');assert.equal(a.value.contact_verified,false);assert.equal(a.value.candidate_id,undefined);
});
test('vendor projection retains exact amount and item identity',()=>{
 const v=vendorProjection(row(),2026);assert.equal(v.amount,'2535912.72');assert.equal(v.transaction_id,'4081920251218787860');
});

class MemoryStore {
 constructor(){this.s=null;this.receipts=new Map();this.published='previous';this.failures=[];this.publishSteps=0;}
 async load(){return this.s;}
 async start(c,cutoff){this.s={...state(),config:c,cutoff};return this.s;}
 async commitPage(_c,_s,p){
  for(const r of p.records)this.receipts.set(r.id,r.payload);
  this.s={...this.s,cursor:p.cursor,pages:this.s.pages+1,records:this.receipts.size,anchor:this.s.anchor||p.fingerprint,status:p.complete?(this.receipts.size?'publishing':'no_data'):'paused'};return this.s;
 }
 async publishChunk(){if(this.publishSteps++>0){this.s={...this.s,status:'completed'};this.published=this.s.id;}return this.s;}
 async fail(_c,_s,code){this.failures.push(code);}
}
test('budget exhaustion saves progress and never publishes a partial sweep',async()=>{
 const store=new MemoryStore();
 const r=await resumeMoneyLane({store,request:async()=>page(),apiKey:'key',config:config(),pageBudget:1,publishBudget:1,now:()=>new Date('2026-10-12')});
 assert.equal(r.status,'paused');assert.equal(r.pages,1);assert.equal(store.published,'previous');
});
test('next invocation resumes exact cursor and completes publishing separately',async()=>{
 const store=new MemoryStore();
 await resumeMoneyLane({store,request:async()=>page(),apiKey:'key',config:config(),pageBudget:1,publishBudget:1});
 let cursor;
 let result=await resumeMoneyLane({store,request:async url=>{cursor=url.searchParams.get('last_index');return page([]);},apiKey:'key',config:config(),pageBudget:1,publishBudget:1});
 assert.equal(cursor,'4081920251218787860');assert.equal(result.status,'publishing');assert.equal(store.published,'previous');
 result=await resumeMoneyLane({store,request:async()=>{throw new Error('must not request provider while publishing');},apiKey:'key',config:config(),pageBudget:1,publishBudget:1});
 assert.equal(result.status,'completed');assert.equal(store.published,'scan');
});
test('failed provider request preserves cursor and previous publication',async()=>{
 const store=new MemoryStore();await store.start(config(),'2026-10-12');
 await assert.rejects(resumeMoneyLane({store,request:async()=>{throw Object.assign(new Error(),{code:'FEC_RATE_LIMIT'});},apiKey:'key',config:config()}),{code:'FEC_RATE_LIMIT'});
 assert.deepEqual(store.s.cursor,{});assert.equal(store.s.pages,0);assert.equal(store.published,'previous');assert.deepEqual(store.failures,['FEC_RATE_LIMIT']);
});
test('no-data traversal preserves previously published evidence',async()=>{
 const store=new MemoryStore();const r=await resumeMoneyLane({store,request:async()=>page([]),apiKey:'key',config:config()});
 assert.equal(r.status,'no_data');assert.equal(store.published,'previous');
});
test('Schedule E anchor change blocks resume instead of silently skipping rows',async()=>{
 const c=scopeConfig({lane:'political-money',cycle:2026,committees:'C00547349',perPage:2}),store=new MemoryStore();
 const e=id=>({results:[{sub_id:id,committee_id:'C00547349',cycle:2026,expenditure_date:'2025-01-01',expenditure_amount:'1.00'}],pagination:{pages:'3',last_indexes:{last_index:id,last_expenditure_date:'2025-01-01'}}});
 await resumeMoneyLane({store,request:async()=>e('1'),apiKey:'key',config:c,pageBudget:1});
 await assert.rejects(resumeMoneyLane({store,request:async()=>e('2'),apiKey:'key',config:c,pageBudget:1}),{code:'PROVIDER_ANCHOR_CHANGED'});
 assert.equal(store.s.pages,1);assert.equal(store.published,'previous');
});

class TransactionClient {
 constructor(){this.row={...state(),config:config()};this.records=new Map();this.fingerprints=[];this.events=[];this.breakAt=null;}
 async query(sql,args=[]){
  this.events.push(sql);
  if(sql==='BEGIN'){this.backup=structuredClone({row:this.row,records:this.records,fingerprints:this.fingerprints});return {rows:[]};}
  if(sql==='ROLLBACK'){Object.assign(this,this.backup);return {rows:[]};}
  if(sql==='COMMIT')return {rows:[]};
  if(this.breakAt&&sql.includes(this.breakAt))throw new Error('injected failure');
  if(sql.startsWith('SELECT pages'))return {rows:[{pages:this.row.pages}]};
  if(sql.startsWith('SELECT 1 FROM money_import_pages'))return {rows:this.fingerprints.includes(args[1])?[{}]:[]};
  if(sql.startsWith('SELECT digest'))return {rows:this.records.has(args[1])?[{digest:this.records.get(args[1]).digest}]:[]};
  if(sql.startsWith('INSERT INTO money_import_records')){if(this.records.has(args[1]))return {rows:[]};this.records.set(args[1],{digest:args[2],payload:JSON.parse(args[3])});return {rows:[{record_id:args[1]}]};}
  if(sql.startsWith('INSERT INTO money_import_pages')){this.fingerprints.push(args[2]);return {rows:[]};}
  if(sql.startsWith('UPDATE money_import_scans SET status=$2')){Object.assign(this.row,{status:args[1],cursor:JSON.parse(args[2]),pages:this.row.pages+1,records:this.row.records+args[4],anchor:this.row.anchor||args[3]});return {rows:[]};}
  if(sql.startsWith('SELECT s.*'))return {rows:[structuredClone(this.row)]};
  throw new Error(`Unexpected mocked SQL: ${sql}`);
 }
}
test('actual checkpoint store rolls back receipts when cursor update fails',async()=>{
 const client=new TransactionClient(),store=new MoneyCheckpointStore(client);client.breakAt='UPDATE money_import_scans SET status=$2';
 await assert.rejects(store.commitPage(config(),state(),validatePage(config(),state(),page())),/injected/);
 assert.equal(client.records.size,0);assert.equal(client.row.pages,0);assert.ok(client.events.includes('ROLLBACK'));assert.ok(!client.events.includes('COMMIT'));
});
test('actual checkpoint store commits receipts and cursor together',async()=>{
 const client=new TransactionClient(),store=new MoneyCheckpointStore(client);
 const r=await store.commitPage(config(),state(),validatePage(config(),state(),page()));
 assert.equal(r.records,1);assert.equal(r.pages,1);assert.equal(r.cursor.last_index,'4081920251218787860');assert.equal(client.events.at(-1),'COMMIT');
});
test('actual store rejects a repeated page without advancing checkpoint',async()=>{
 const client=new TransactionClient(),store=new MoneyCheckpointStore(client),p=validatePage(config(),state(),page());
 const saved=await store.commitPage(config(),state(),p);
 await assert.rejects(store.commitPage(config(),saved,p),{code:'PROVIDER_REPEATED_PAGE'});
 assert.equal(client.row.pages,1);assert.equal(client.records.size,1);
});
test('actual store rejects changed content for an existing item within the sweep',async()=>{
 const client=new TransactionClient(),store=new MoneyCheckpointStore(client),p=validatePage(config(),state(),page());
 const saved=await store.commitPage(config(),state(),p);
 const changed={...p,fingerprint:'different',records:[{...p.records[0],digest:'changed'}]};
 await assert.rejects(store.commitPage(config(),saved,changed),{code:'PROVIDER_RECORD_CHANGED_DURING_SCAN'});assert.equal(client.row.pages,1);
});
test('controller agrees with platform role guard and reports partial progress as 202',async()=>{
 let source=fs.readFileSync(new URL('../controllers/politicalMoneyEvidence.controller.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n').replace(/^import .*?;\n/gm,'').replace(/^import \{[\s\S]*?from .*?;\n/gm,'').replace(/export /g,'');
 let status=200,body;
 const ctx=vm.createContext({pool:{},console,runResumableMoneyImports:async()=>({results:[{lane:'political-money',status:'paused'}]})});vm.runInContext(source,ctx);
 const response={status(n){status=n;return this;},json(v){body=v;return this;}};
 await ctx.syncFecPoliticalMoneyController({user:{role:'platform_operator'},query:{}},response);assert.equal(status,202);assert.match(body.message,/progress saved/);
 await ctx.syncFecPoliticalMoneyController({user:{role:'admin'},query:{}},response);assert.equal(status,403);
});

class PublicationClient {
 constructor(rows,lane='donors') {this.rows=rows;this.cursor=null;this.published='previous';this.snapshots=new Map();this.events=[];this.lane=lane;this.failCursor=false;}
 async query(sql,args=[]) {
  this.events.push(sql);
  if(sql==='BEGIN'){this.backup=structuredClone({cursor:this.cursor,published:this.published,snapshots:this.snapshots});return {rows:[]};}
  if(sql==='ROLLBACK'){Object.assign(this,this.backup);return {rows:[]};}
  if(sql==='COMMIT')return {rows:[]};
  if(sql.startsWith('SELECT record_id,payload'))return {rows:this.rows.filter(r=>!args[1]||r.record_id>args[1]).slice(0,100)};
  if(sql.startsWith('INSERT INTO money_donor_snapshots')){
   const existing=this.snapshots.get(args[1])||{amount:0,contributions:0};
   existing.amount+=Number(args[4]);existing.contributions++;this.snapshots.set(args[1],existing);return {rows:[]};
  }
  if(sql.startsWith('INSERT INTO money_vendor_snapshots')){this.snapshots.set(args[1],JSON.parse(args[3]));return {rows:[]};}
  if(sql.startsWith('UPDATE money_import_scans SET publish_cursor')){if(this.failCursor)throw new Error('cursor failure');this.cursor=args[1];return {rows:[]};}
  if(sql.startsWith('UPDATE money_import_checkpoints')){this.published=args[3];return {rows:[]};}
  if(sql.startsWith("UPDATE money_import_scans SET status='completed'"))return {rows:[]};
  if(sql.startsWith('UPDATE political_money_scores'))return {rows:[]};
  if(sql.startsWith('SELECT s.*'))return {rows:[{...state(),status:this.published==='previous'?'publishing':'completed',publish_cursor:this.cursor,config:{...config(),lane:this.lane}}]};
  throw new Error(`Unexpected publisher SQL ${sql}`);
 }
}
test('actual donor publishing atomically rolls back accumulated amounts on interruption',async()=>{
 const payload={sub_id:'1',committee_id:'C00547349',contributor_name:'TEST PERSON',contribution_receipt_amount:'100.01'};
 const client=new PublicationClient([{record_id:'1',payload}]);client.failCursor=true;
 const store=new MoneyCheckpointStore(client);
 await assert.rejects(store.publishChunk({...config(),lane:'donors'},{...state(),status:'publishing'}),/cursor failure/);
 assert.equal(client.snapshots.size,0);assert.equal(client.cursor,null);assert.equal(client.published,'previous');
 client.failCursor=false;
 const saved=await store.publishChunk({...config(),lane:'donors'},{...state(),status:'publishing'});
 assert.equal(client.snapshots.size,1);assert.equal([...client.snapshots.values()][0].contributions,1);assert.equal(client.published,'previous');
 await store.publishChunk({...config(),lane:'donors'},saved);
 assert.equal(client.published,'scan');assert.equal([...client.snapshots.values()][0].contributions,1);
});
test('memo entries stay staged but are excluded from financial snapshot promotion',async()=>{
 const client=new PublicationClient([{record_id:'1',payload:row('1',{memoed:true})},{record_id:'2',payload:row('2')}],'vendors');
 await new MoneyCheckpointStore(client).publishChunk(config(),{...state(),status:'publishing'});
 assert.equal(client.snapshots.size,1);assert.ok(client.snapshots.has('2'));assert.equal(client.cursor,'2');assert.equal(client.published,'previous');
});
function politicalContext(db) {
 const source=fs.readFileSync(new URL('../services/politicalMoneyEvidence.service.js',import.meta.url),'utf8').replace(/\r\n?/g,'\n').replace(/^import .*\n/gm,'').replace(/export default \{[\s\S]*?\};/,'').replace(/\bexport /g,'');
 const ctx=vm.createContext({pool:{query:()=>{throw new Error('global pool query forbidden');},connect:()=>{throw new Error('new connection forbidden');}},financeElectionCycle:v=>Number(v),console,process:{env:{}}});
 vm.runInContext(source,ctx);return ctx;
}
test('actual political promotion uses supplied transaction client and preserves exact money',async()=>{
 const queries=[];const db={query:async(sql,values)=>{queries.push({sql,values});return {rows:[{id:1}]};}};
 const c=politicalContext(db);
 await c.promoteResumablePoliticalRecord({sub_id:'4081920251218787861',committee_id:'C00547349',committee_name:'TEST COMMITTEE',expenditure_amount:'100.01',expenditure_date:'2025-01-01'},2026,db,{scanId:'scan',scopeKey:'scope'});
 const tx=queries.find(q=>q.sql.includes('INSERT INTO political_money_transactions'));
 const evidence=queries.find(q=>q.sql.includes('INSERT INTO political_money_evidence'));
 assert.equal(tx.values[0],'schedule-e:scan:4081920251218787861');assert.equal(tx.values[7],'100.01');assert.equal(tx.values.at(-1),'scan');
 assert.equal(evidence.values[6],'100.01');assert.equal(evidence.values[14],'scan');assert.equal(evidence.values[15],'C00547349');
});
test('actual resumable score rebuild borrows the lock client without releasing it',async()=>{
 const sql=[];let released=false;const db={query:async q=>{sql.push(q);return {rows:[]};},release:()=>released=true};
 await politicalContext(db).rebuildResumableMoneyScores({cycle:2026},db);
 assert.ok(sql.includes('BEGIN'));assert.ok(sql.includes('COMMIT'));assert.equal(released,false);
 assert.ok(sql.some(q=>q.includes('JOIN political_money_evidence_read')));
});
test('actual Dark Money profile passes the selected future cycle to evidence',async()=>{
 const source=fs.readFileSync(new URL('../services/darkMoneyExposure.service.js',import.meta.url),'utf8');
 const start=source.indexOf('export async function getDarkMoneyExposureProfile('),end=source.indexOf('\nexport default',start);
 let passed;
 const ctx=vm.createContext({ensureDarkMoneyExposureSchema:async()=>{},clean:String,financeElectionCycle:Number,pool:{query:async()=>({rows:[]})},evidenceByCommittee:async()=>new Map([['C00547349',{political_money_organization_id:1}]]),getPoliticalMoneyEvidenceProfile:async(_id,options)=>{passed=options;return {};},POLITICAL_MONEY_BUILD:'test'});
 vm.runInContext(source.slice(start,end).replace('export ',''),ctx);
 const result=await ctx.getDarkMoneyExposureProfile('C00547349',{cycle:2030});
 assert.equal(passed.cycle,2030);assert.equal(result.cycle,2030);
});
test('actual CLI preview validates scope and budgets without connecting or requesting',async()=>{
 const service=fs.readFileSync(new URL('../services/resumableMoneyImports.service.js',import.meta.url),'utf8');
 const a=service.indexOf('export function resumableImportOptions('),b=service.indexOf('\nexport async function runResumableMoneyImports',a);
 const cli=fs.readFileSync(new URL('../scripts/runResumableMoneyImports.mjs',import.meta.url),'utf8').replace(/^import .*\n/gm,'');
 let report,connections=0,requests=0;
 const context=vm.createContext({LANES:{vendors:{},donors:{},'political-money':{}},scopeConfig,parseImportCycles,importError:(code)=>Object.assign(new Error(code),{code}),process:{env:{},argv:['node','script','--cycles=2026','--lanes=vendors','--committees=C00547349','--pages-per-lane=2'],exitCode:0},dotenv:{config(){}},pool:{connect(){connections++;},end:async()=>{}},runResumableMoneyImports:async()=>{requests++;},console:{log:v=>report=JSON.parse(v),error:v=>report=JSON.parse(v)}});
 vm.runInContext(service.slice(a,b).replace('export ',''),context);
 await vm.runInContext('(async()=>{'+cli+'})()',context);
 assert.equal(report.mode,'preview');assert.equal(report.pageBudget,2);assert.equal(connections,0);assert.equal(requests,0);
 assert.throws(()=>context.resumableImportOptions({lanes:'vendors',cycle:2026,scope:'national',state:'CA'}),{code:'UNSUPPORTED_IMPORT_FILTER'});
});
test('coordinated cron command runs FEC then money and stops after a failed FEC child',()=>{
 const script=fs.readFileSync(new URL('../scripts/runCoordinatedElectionImports.mjs',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../scripts/runCoordinatedElectionImports.mjs',import.meta.url).href));
 for(const fail of [false,true]){
  const calls=[];
  const context=vm.createContext({fs:{existsSync:()=>true},fileURLToPath,URL,resumableImportOptions:()=>({cycles:[2026]}),spawnSync:(_node,args,opts)=>{calls.push({args,opts});return {status:fail?1:0};},process:{argv:['node','script','--cycles=2026','--lanes=vendors','--committees=C00547349','--apply'],execPath:'node',exitCode:0},console:{log(){},error(){}}});
  vm.runInContext(script,context);
  assert.equal(calls.length,fail?1:2);assert.ok(calls[0].args[0].endsWith('runCycleImports.mjs'));assert.equal(calls[0].opts.shell,false);
  if(!fail)assert.ok(calls[1].args[0].endsWith('runResumableMoneyImports.mjs'));
  assert.equal(context.process.exitCode,fail?1:0);
 }
});
