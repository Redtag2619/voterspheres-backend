import { fileURLToPath } from "node:url";
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {csvRows,parseManifest,parseFeed,campaignInput} from "../services/mailopsTracking/protocol.js";
import {canManage,trackingMode} from "../services/mailopsTracking/policy.js";
const imb="0024301234512345678901234567890";
const csv="IMb,Scan Date Time,Scan Event Code,Handling Event Type\n"+imb+",2026-11-10 12:30:00,898,Actual\n";

test("strict CSV preserves zeroes and quoted values; rejects malformed, duplicate, extra and personal-data fields",()=>{
  assert.equal(csvRows('imb,sequence\r\n'+imb+',"A, B"\r\n').rows[0][1],"A, B");
  assert.equal(parseManifest("imb,sequence\n"+imb+",00001").rows[0].sequence,"00001");
  assert.throws(()=>parseManifest("imb,sequence,address\n"+imb+",1,any"),{code:"UNSUPPORTED_CSV_HEADERS"});
  assert.throws(()=>parseManifest("imb\n"+imb+"\n"+imb),{code:"DUPLICATE_MANIFEST_IMB"});
  assert.throws(()=>csvRows('imb\n"open'),{code:"MALFORMED_CSV"});
  assert.throws(()=>csvRows("imb,imb\na,b"),{code:"DUPLICATE_CSV_HEADER"});
  assert.throws(()=>csvRows("imb,sequence\na,b,c"),{code:"CSV_COLUMN_MISMATCH"});
});
test("feed preserves source time and distinguishes evidence types without delivery inference",()=>{
  assert.equal(parseFeed(csv.replace("Handling Event Type","Handling Event Type Description")).rows[0].event_type,"Actual");
  assert.equal(parseFeed(csv).rows[0].event_time,"2026-11-10 12:30:00");
  assert.equal(parseFeed(csv.replace("Actual","Assumed Logical")).rows[0].event_type,"Assumed Logical");
  assert.throws(()=>parseFeed(csv.replace("Actual","Delivered")),{code:"UNSUPPORTED_EVENT_TYPE"});
  assert.throws(()=>parseFeed(csv.replace("2026-11-10","2026-02-30")),{code:"INVALID_FEED_TIME"});
  assert.throws(()=>parseFeed(csv.replace("12:30:00","12:30:00+99:00")),{code:"INVALID_FEED_TIME"});
  assert.throws(()=>campaignInput({name:"x",mailing_date:"2026-02-30"}),{code:"INVALID_MAILING_DATE"});
});
test("bounded imports and CAT policy reject other firms, spoofed IDs and standard-user management",()=>{
  assert.throws(()=>parseManifest("imb\n"+"0".repeat(1000001)),{code:"INVALID_OR_OVERSIZED_CSV"});
  const config={enabled:"true",mode:"cat",userId:"42",firmId:"7"};
  assert.equal(trackingMode(config,42,7),"cat");
  assert.equal(trackingMode(config,42,8),null);
  assert.equal(trackingMode({...config,userId:""},42,7),null);
  assert.equal(trackingMode({...config,enabled:"false"},42,7),null);
  assert.equal(canManage({role:"user"}),false);
  assert.equal(canManage({role:"firm_admin"}),true);
});
test("targeted migration preview does not connect and apply requires the exact plan",()=>{
  const script=new URL("../scripts/installMailopsTrackingSchema.mjs",import.meta.url);
  const result=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:"utf8"});
  assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).mode,"preview");
  const blocked=spawnSync(process.execPath,[fileURLToPath(script),"--apply","--plan=wrong"],{encoding:"utf8"});
  assert.notEqual(blocked.status,0);
  assert.match(blocked.stderr,/Matching preview plan required/);
});

test("actual campaign handlers bind reads to the authenticated firm and block viewer mutations and private CAT bypass",async()=>{
  const {createCampaignHandlers}=await import("../services/mailopsTracking/handlers.js");
  const calls=[];
  const store={
    list:async firm=>{calls.push(["list",firm]);return [];},
    create:async()=>{throw new Error("should not be called");},
    token:async()=>{throw new Error("should not be called");},
  };
  let config={enabled:"true",mode:"production"};
  const handlers=createCampaignHandlers(store,()=>config);
  async function invoke(name,user){
    const out={status:200};const res={set(){return this;},status(s){out.status=s;return this;},json(body){out.body=body;return this;}};
    await handlers[name]({user,body:{firm_id:7},params:{id:"arbitrary"}},res);
    return out;
  }
  assert.equal((await invoke("list",{id:2,firm_id:8,role:"user"})).status,200);
  assert.deepEqual(calls,[["list",8]]);
  assert.equal((await invoke("create",{id:2,firm_id:8,role:"user"})).status,403);
  assert.equal((await invoke("token",{id:2,firm_id:8,role:"user"})).status,403);
  config={enabled:"true",mode:"cat",userId:"42",firmId:"7"};
  assert.equal((await invoke("list",{id:2,firm_id:8,role:"platform_admin"})).status,503);
  assert.equal((await invoke("list",null)).status,403);
  assert.equal(calls.length,1);
});
