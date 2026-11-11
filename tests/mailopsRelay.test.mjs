import { fileURLToPath } from "node:url";
import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,writeFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";

test("relay previews locally, sends finalized files once and retains rejected files for retry",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"mailops-relay-"));
  const token="miv_"+"x".repeat(43);
  const imb="0024301234512345678901234567890";
  const csv="IMb,Scan Date Time,Scan Event Code,Handling Event Type\n"+imb+",2026-11-10T12:30:00,898,Actual\n";
  let calls=0, status=200;
  const server=createServer((req,res)=>{
    calls++;assert.equal(req.headers.authorization,"Bearer "+token);
    let body="";req.on("data",chunk=>body+=chunk);
    req.on("end",()=>{
      assert.equal(JSON.parse(body).csv,csv);
      res.writeHead(status,{"Content-Type":"application/json"});
      res.end(JSON.stringify({ok:status===200,inserted_rows:1,unmatched_rows:0,duplicate:false}));
    });
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const endpoint="http://127.0.0.1:"+server.address().port+"/api/mailops-feed";
  const script=fileURLToPath(new URL("../scripts/relayMailopsFeed.mjs",import.meta.url));
  async function run(extra=[]){
    const child=spawn(process.execPath,[script,"--input-dir="+directory,"--endpoint="+endpoint,...extra],{env:{...process.env,MAILOPS_FEED_TOKEN:token}});
    let output="";child.stdout.on("data",x=>output+=x);child.stderr.on("data",x=>output+=x);
    const [code]=await once(child,"exit");return {code,output};
  }
  try{
    await writeFile(join(directory,"one.ready.csv"),csv);
    await writeFile(join(directory,"unfinished.csv"),csv);
    assert.equal((await run(["--preview"])).code,0);assert.equal(calls,0);
    const accepted=await run();assert.equal(accepted.code,0);
    assert.equal(calls,1);assert.doesNotMatch(accepted.output,/miv_|002430/);
    assert.ok((await readdir(directory)).includes("one.accepted.csv"));
    assert.equal((await run()).code,0);assert.equal(calls,1);
    status=503;await writeFile(join(directory,"retry.ready.csv"),csv);
    assert.equal((await run()).code,1);
    assert.ok((await readdir(directory)).includes("retry.ready.csv"));
  }finally{server.close();await rm(directory,{recursive:true,force:true});}
});
