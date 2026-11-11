import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {createTrackingStore} from "../../services/mailopsTracking/store.js";
const schema=await readFile(new URL("../../db/migrations/20261110_mailops_campaign_tracking.sql",import.meta.url),"utf8");
const imb="00243"+"012345"+"123456789"+"01234567890";
const other="00243"+"012345"+"123456780"+"01234567890";
const manifest="imb,sequence\n"+imb+",000001\n"+other+",000002\n";
const feed=(code="898",barcode=imb,type="Actual")=>"IMb,Scan Date Time,Scan Event Code,Handling Event Type\n"+barcode+",2026-11-10T12:30:00,"+code+","+type+"\n";
async function fixture(fn){
  const pg=new PGlite();
  await pg.exec("CREATE TABLE firms(id INTEGER PRIMARY KEY);INSERT INTO firms(id) VALUES(7),(8);");
  await pg.exec(schema);
  const adapter={query:(sql,args)=>pg.query(sql,args),connect:async()=>({query:(sql,args)=>pg.query(sql,args),release(){}})};
  try{await fn(createTrackingStore(adapter),pg,adapter);}finally{await pg.close();}
}
async function create(store,firm=7){
  return store.create(firm,42,{name:"Fixture mailing",mailing_date:"2026-11-10"},"cat");
}
async function apply(store,id,firm=7){
  const preview=await store.manifest(firm,id,manifest,false);
  return store.manifest(firm,id,manifest,true,preview.plan);
}

test("manifest preview is read-only; stale plans and cross-firm IDs fail; receipts freeze manifests",async()=>{
  await fixture(async(store,pg)=>{
    const c=await create(store);
    const preview=await store.manifest(7,c.id,manifest,false);
    assert.equal(preview.new_pieces,2);
    assert.equal((await pg.query("SELECT count(*)::int n FROM mailops_tracking_pieces")).rows[0].n,0);
    await assert.rejects(store.manifest(8,c.id,manifest,false),{code:"CAMPAIGN_NOT_FOUND"});
    await store.manifest(7,c.id,"imb,sequence\n"+imb+",000001\n",true,(await store.manifest(7,c.id,"imb,sequence\n"+imb+",000001\n",false)).plan);
    await assert.rejects(store.manifest(7,c.id,manifest,true,preview.plan),{code:"MANIFEST_PLAN_CHANGED"});
    const t=await store.token(7,c.id);
    await store.ingest(t.token,feed(),()=>true);
    await assert.rejects(store.manifest(7,c.id,manifest,false),{code:"MANIFEST_FROZEN_AFTER_FEED"});
  });
});

test("feed tokens isolate campaigns; retries, event dedupe and revoke are safe; unknown barcodes stay unmatched",async()=>{
  await fixture(async(store,pg)=>{
    const c=await create(store);await apply(store,c.id);
    const second=await create(store,8);await apply(store,second.id,8);
    const t=await store.token(7,c.id);
    await assert.rejects(store.ingest(t.token,feed(),()=>false),{code:"FEED_UNAUTHORIZED"});
    const first=await store.ingest(t.token,feed(),()=>true);
    assert.equal(first.inserted_rows,1);
    assert.equal((await store.ingest(t.token,feed(),()=>true)).duplicate,true);
    // Different bytes carrying the same event don't inflate counts.
    assert.equal((await store.ingest(t.token,feed()+"\n",()=>true)).inserted_rows,0);
    const unknown=await store.ingest(t.token,feed("900","00243012345111111111"),()=>true);
    assert.equal(unknown.unmatched_rows,1);
    const summary=await store.summary(7,c.id);
    assert.equal(summary.totals.total_pieces,2);
    assert.equal(summary.totals.observed_pieces,1);
    assert.equal(summary.totals.no_scan_received,1);
    assert.equal((await store.summary(8,second.id)).totals.observed_pieces,0);
    await assert.rejects(store.summary(8,c.id),{code:"CAMPAIGN_NOT_FOUND"});
    const hash=(await pg.query("SELECT feed_token_hash FROM mailops_tracking_campaigns WHERE id=$1",[c.id])).rows[0].feed_token_hash;
    assert.notEqual(hash,t.token);assert.match(hash,/^[a-f0-9]{64}$/);
    await store.token(7,c.id,true);
    await assert.rejects(store.ingest(t.token,feed(),()=>true),{code:"FEED_UNAUTHORIZED"});
  });
});

test("assumed and logical events remain separate from actual scans; no delivery assertion is fabricated",async()=>{
  await fixture(async store=>{
    const c=await create(store);await apply(store,c.id);
    const {token}=await store.token(7,c.id);
    await store.ingest(token,feed("111",imb,"Assumed Actual"),()=>true);
    await store.ingest(token,feed("112",imb,"Logical"),()=>true);
    const result=await store.summary(7,c.id);
    assert.equal(result.totals.actual_scan_pieces,0);
    assert.equal(result.totals.assumed_events,1);
    assert.equal(result.totals.logical_events,1);
    assert.equal(result.totals.observed_pieces,1);
    assert.equal(Object.hasOwn(result.totals,"delivered"),false);
    assert.equal((await store.events(7,c.id,imb))[0].event_time,"2026-11-10T12:30:00");
  });
});

test("dependent insert failure rolls back every event and the batch receipt",async()=>{
  await fixture(async(store,pg,adapter)=>{
    const c=await create(store);await apply(store,c.id);
    const {token}=await store.token(7,c.id);
    const broken=createTrackingStore({query:adapter.query,connect:async()=>{
      const db=await adapter.connect();
      return {...db,query:(sql,args)=>/INSERT INTO mailops_tracking_batches/.test(sql)
        ? Promise.reject(new Error("injected failure")):db.query(sql,args)};
    }});
    await assert.rejects(broken.ingest(token,feed(),()=>true),/injected failure/);
    assert.equal((await pg.query("SELECT count(*)::int n FROM mailops_tracking_events")).rows[0].n,0);
    assert.equal((await pg.query("SELECT count(*)::int n FROM mailops_tracking_batches")).rows[0].n,0);
  });
});

test("storage cap failures roll back imported pieces and feed events",async()=>{
  await fixture(async(store,pg,adapter)=>{
    const c=await create(store);
    const bounded=createTrackingStore({query:adapter.query,connect:async()=>{
      const db=await adapter.connect();
      return {...db,query:(sql,args)=>{
        if(sql==="SELECT count(*) AS n FROM mailops_tracking_pieces WHERE firm_id=$1")return Promise.resolve({rows:[{n:"100000"}]});
        return db.query(sql,args);
      }};
    }});
    const preview=await bounded.manifest(7,c.id,manifest,false);
    await assert.rejects(bounded.manifest(7,c.id,manifest,true,preview.plan),{code:"PIECE_STORAGE_LIMIT"});
    assert.equal((await pg.query("SELECT count(*)::int n FROM mailops_tracking_pieces")).rows[0].n,0);
    await apply(store,c.id);
    const {token}=await store.token(7,c.id);
    const eventBounded=createTrackingStore({query:adapter.query,connect:async()=>{
      const db=await adapter.connect();
      return {...db,query:(sql,args)=>sql==="SELECT count(*) AS n FROM mailops_tracking_events WHERE firm_id=$1"
        ? Promise.resolve({rows:[{n:"250001"}]}):db.query(sql,args)};
    }});
    await assert.rejects(eventBounded.ingest(token,feed(),()=>true),{code:"EVENT_STORAGE_LIMIT"});
    assert.equal((await pg.query("SELECT count(*)::int n FROM mailops_tracking_events")).rows[0].n,0);
    assert.equal((await pg.query("SELECT count(*)::int n FROM mailops_tracking_batches")).rows[0].n,0);
  });
});

test("health counts all accepted receipts, separates evidence, bounds samples and scopes every read",async()=>{
  await fixture(async(store,pg)=>{
    const c=await create(store);await apply(store,c.id);
    let summary=await store.summary(7,c.id);
    assert.equal(summary.feed_health.status,"relay_token_disabled");
    const {token}=await store.token(7,c.id);
    assert.equal((await store.summary(7,c.id)).feed_health.status,"awaiting_first_receipt");
    await store.ingest(token,feed("111",imb,"Logical"),()=>true);
    await store.ingest(token,feed("112","00243012345111111111"),()=>true);
    await store.ingest(token,feed("112","00243012345111111111"),()=>true);
    summary=await store.summary(7,c.id);
    assert.equal(summary.feed_health.status,"recent_receipt");
    assert.equal(summary.feed_health.receipt_count,2);
    assert.equal(summary.feed_health.unmatched_rows,1);
    assert.equal(summary.feed_health.exceptions.no_reported_event_pieces,1);
    assert.equal(summary.feed_health.exceptions.pieces_without_physical_scan,2);
    assert.equal(summary.feed_health.exceptions.no_event_sample[0].imb,other);
    await store.ingest(token,feed("113",imb,"Actual"),()=>true);
    assert.equal((await store.summary(7,c.id)).feed_health.exceptions.pieces_without_physical_scan,1);
    await assert.rejects(store.summary(8,c.id),{code:"CAMPAIGN_NOT_FOUND"});
    await pg.query("UPDATE mailops_tracking_batches SET received_at=CURRENT_TIMESTAMP-INTERVAL '25 hours' WHERE campaign_id=$1",[c.id]);
    assert.equal((await store.summary(7,c.id)).feed_health.status,"receipt_needs_review");
    const second=await create(store,8);
    const rows=Array.from({length:30},(_,i)=>`00243012345${String(i).padStart(9,"0")},${String(i).padStart(3,"0")}`).join("\n");
    const csv="imb,sequence\n"+rows+"\n";
    const plan=await store.manifest(8,second.id,csv,false);
    await store.manifest(8,second.id,csv,true,plan.plan);
    const isolated=await store.summary(8,second.id);
    assert.equal(isolated.feed_health.receipt_count,0);
    assert.equal(isolated.feed_health.exceptions.no_event_sample.length,25);
    assert.equal(isolated.totals.total_pieces,30);
  });
});
