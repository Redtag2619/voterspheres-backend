import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import baseline from './production-view-baseline.json' with {type:'json'};
import {dashboardDonorSql} from '../../services/dashboardDonorRead.js';
const db=new PGlite();
const donorColumns=`id bigint,donor_name text,name text,donor_type text,state text,amount numeric,relationship_strength numeric,candidate_id text,candidate_name text,committee_name text,occupation text,employer text,city text,source text,source_updated_at timestamptz,created_at timestamptz,updated_at timestamptz,committee_id text,website_url text,linkedin_url text,x_url text,facebook_url text,phone text,address_line1 text,address_line2 text,postal_code text,contact_source text,contact_verified boolean,contribution_count integer,cycle integer`;
let seq=0;
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
before(async()=>{await db.exec(`CREATE TABLE donors(${donorColumns});
 CREATE TABLE money_import_scans(id uuid PRIMARY KEY,cycle integer,cutoff date);
 CREATE TABLE money_import_checkpoints(lane text,cycle integer,scope_key text,committees jsonb,published_scan_id uuid,published_at timestamptz,active_scan_id uuid,PRIMARY KEY(lane,cycle,scope_key));
 CREATE TABLE money_donor_snapshots(row_id bigint PRIMARY KEY,scan_id uuid,committee_id text,amount numeric,contributions integer,payload jsonb);
 ${baseline.winner_function};CREATE VIEW donors_read AS ${baseline.view}`);});
after(async()=>{await db.close();});
async function reset(){await db.exec('TRUNCATE donors,money_donor_snapshots,money_import_checkpoints,money_import_scans');seq=0;}
async function scan(n,{cycle=2026,cutoff='2026-10-10',scope='committees:A',committees=['A'],published='2026-10-11',lane='donors',active=null}={}){
 await db.query('INSERT INTO money_import_scans VALUES($1,$2,$3)',[uuid(n),cycle,cutoff]);
 if(published)await db.query('INSERT INTO money_import_checkpoints VALUES($1,$2,$3,$4,$5,$6,$7)',[lane,cycle,scope,JSON.stringify(committees),uuid(n),published,active?uuid(active):null]);
}
async function snapshot(n,{committee='A',rowId=null,cycle=2026,amount='125.15',count=2,name='Example donor',extra={}}={}){
 seq++;const id=rowId??String(seq);
 const payload={id:999,name,donor_name:name,source:'fec_schedule_a',committee_id:committee,cycle,amount:'0',contribution_count:0,source_updated_at:'2000-01-01',...extra};
 await db.query('INSERT INTO money_donor_snapshots VALUES($1,$2,$3,$4,$5,$6)',[id,uuid(n),committee,amount,count,JSON.stringify(payload)]);return String(id);
}
async function legacy(id,{cycle=2026,source='fec_schedule_a',date=null,amount='22.22'}={}){
 await db.query('INSERT INTO donors(id,cycle,source,source_updated_at,amount,name) VALUES($1,$2,$3,$4,$5,$6)',[id,cycle,source,date,amount,'Legacy '+id]);
}
const plain=rows=>JSON.parse(JSON.stringify(rows,(_key,value)=>typeof value==='bigint'?value.toString():value));
async function parity(cycle=2026,limit=1000){
 const before=await db.query('SELECT * FROM donors_read WHERE cycle=$1 ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT $2',[cycle,limit]);
 const after=await db.query(dashboardDonorSql(),[cycle,limit]);assert.deepEqual(plain(after.rows),plain(before.rows));return after.rows;
}
test('no publication keeps legacy FEC/manual/null-source records and excludes other/null cycles',async()=>{
 await reset();await legacy(1);await legacy(2,{source:'manual'});await legacy(3,{source:null});await legacy(4,{cycle:2028});await legacy(5,{cycle:null});
 const rows=await parity();assert.deepEqual(rows.map(r=>r.id),[3,2,1]);await parity(2028);
});
test('any donor publication suppresses all legacy FEC for that cycle; manual rows survive',async()=>{
 await reset();await legacy(1);await legacy(2,{source:'manual'});await legacy(3,{cycle:2028});await scan(1);await snapshot(1);
 const rows=await parity();assert.equal(rows.length,2);assert.ok(rows.some(r=>r.id===2));assert.ok(!rows.some(r=>r.id===1));await parity(2028);
});
test('newer committee cutoff overrides older national only for its own committee',async()=>{
 await reset();await scan(1,{scope:'national',committees:[],cutoff:'2026-10-01',published:'2026-10-20'});await snapshot(1);await snapshot(1,{committee:'B'});
 await scan(2,{cutoff:'2026-10-02',published:'2026-10-03'});await snapshot(2,{name:'new A'});
 const rows=await parity();assert.equal(rows.length,2);assert.ok(rows.some(r=>r.name==='new A'));assert.ok(!rows.some(r=>r.id===-1));
});
test('newer national overrides committee publications and unfinished newer scan stays invisible',async()=>{
 await reset();await scan(1);await snapshot(1);await scan(2,{scope:'national',committees:[],cutoff:'2026-10-12'});await snapshot(2,{name:'national A'});await snapshot(2,{committee:'B'});
 await scan(3,{published:null,cutoff:'2026-10-30'});await snapshot(3,{name:'unfinished'});
 const rows=await parity();assert.equal(rows.length,2);assert.ok(!rows.some(r=>r.name==='unfinished'));assert.ok(rows.some(r=>r.name==='national A'));
});
test('publication timestamp breaks equal cutoff ties before scope-key lexical tie-break',async()=>{
 await reset();await scan(1,{scope:'committees:Z',published:'2026-10-10'});await snapshot(1,{name:'older publication'});
 await scan(2,{scope:'committees:Y',published:'2026-10-11'});await snapshot(2,{name:'Y'});
 await scan(3,{scope:'committees:X',published:'2026-10-11'});await snapshot(3,{name:'X'});
 const rows=await parity();assert.equal(rows.length,1);assert.equal(rows[0].name,'X');
});
test('empty newer winner never resurrects superseded snapshots or suppressed legacy FEC',async()=>{
 await reset();await legacy(1);await scan(1);await snapshot(1);await scan(2,{scope:'national',cutoff:'2026-10-20'});
 assert.deepEqual(await parity(),[]);
});
test('checkpoint join multiplicity is preserved, including another lane pointing at same scan',async()=>{
 await reset();await scan(1);await snapshot(1);
 await db.query('INSERT INTO money_import_checkpoints VALUES($1,2026,$2,$3,$4,$5,NULL)',['vendors','national','[]',uuid(1),'2026-10-12']);
 const rows=await parity();assert.equal(rows.length,2);assert.equal(rows[0].id,rows[1].id);
});
test('snapshot payload cycle governs filtering even when different from scan cycle',async()=>{
 await reset();await scan(1,{cycle:2028});await snapshot(1,{cycle:2026});await snapshot(1,{cycle:2028});await snapshot(1,{cycle:null});
 assert.equal((await parity(2026)).length,1);assert.equal((await parity(2028)).length,1);
});
test('exact large signed identifiers, numeric money, counts and disclosed fields survive projection',async()=>{
 await reset();await scan(1);await snapshot(1,{rowId:'9007199254740993',amount:'123456789012345.67',count:17,extra:{employer:'Example',contact_verified:true,city:'Austin'}});
 // Compare in SQL to avoid either JS driver converting BIGINT above safe range.
 const r=await db.query(`WITH candidate AS (${dashboardDonorSql()}) SELECT id::text,amount::text,contribution_count,employer,city,contact_verified FROM candidate`,[2026,25]);
 assert.deepEqual(r.rows,[{id:'-9007199254740993',amount:'123456789012345.67',contribution_count:17,employer:'Example',city:'Austin',contact_verified:true}]);await parity();
});
test('mixed legacy/snapshot top-N retains timestamp/null/ID ordering at all used limits',async()=>{
 await reset();await scan(1);for(let i=0;i<65;i++)await snapshot(1,{name:'A'+i});
 await legacy(100,{source:'manual',date:'2026-10-11'});await legacy(101,{source:null});await legacy(102,{source:'manual',date:'2026-10-15'});
 for(const limit of [1,8,25,50,250]){const rows=await parity(2026,limit);assert.equal(rows[0].id,102);}
});
test('null published timestamp sorts last without losing snapshot rows',async()=>{
 await reset();await scan(1);await snapshot(1);await db.exec('UPDATE money_import_checkpoints SET published_at=NULL');await legacy(100,{source:'manual'});
 const rows=await parity();assert.deepEqual(rows.map(r=>r.id),[100,-1]);
});
test('an available publication for another cycle/lane does not suppress legacy current-cycle FEC',async()=>{
 await reset();await legacy(1);await scan(1,{cycle:2028});await snapshot(1,{cycle:2028});await scan(2,{lane:'vendors',scope:'vendors'});await snapshot(2);
 const rows=await parity();assert.ok(rows.some(r=>r.id===1));
});
test('malformed selected donor payload produces an error in both queries rather than a fabricated empty page',async()=>{
 await reset();await scan(1);await snapshot(1,{extra:{contact_verified:'invalid_boolean'}});
 await assert.rejects(db.query('SELECT * FROM donors_read WHERE cycle=$1 ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT $2',[2026,25]));
 await assert.rejects(db.query(dashboardDonorSql(),[2026,25]));
});
