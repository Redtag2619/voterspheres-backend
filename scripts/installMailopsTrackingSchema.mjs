import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const args=process.argv.slice(2);
const sql=(await readFile(new URL("../db/migrations/20261110_mailops_campaign_tracking.sql",import.meta.url),"utf8")).replace(/\r\n/g,"\n");
const plan=createHash("sha256").update(sql).digest("hex");
if(args.some(a=>a!=="--apply"&&!a.startsWith("--plan=")))throw new Error("Unsupported migration option");
if(!args.includes("--apply")){
  console.log(JSON.stringify({mode:"preview",plan,tables:["mailops_tracking_budget","mailops_tracking_firms","mailops_tracking_campaigns","mailops_tracking_pieces","mailops_tracking_events","mailops_tracking_batches"],policy:"No connection or changes. Apply only this reviewed migration."},null,2));
}else{
  if(args.filter(a=>a.startsWith("--plan=")).length!==1 || args.find(a=>a.startsWith("--plan="))!=="--plan="+plan)throw new Error("Matching preview plan required");
  const {pool}=await import("../db/pool.js");
  const db=await pool.connect();
  try{
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='30s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('mailops_campaign_tracking_v1'))");
    await db.query("CREATE TABLE IF NOT EXISTS mailops_tracking_schema_versions(version INTEGER PRIMARY KEY, sha256 TEXT NOT NULL)");
    const marker=(await db.query("SELECT sha256 FROM mailops_tracking_schema_versions WHERE version=1")).rows[0];
    if(marker && marker.sha256!==plan)throw new Error("Schema marker differs");
    if(!marker){
      const existing=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
        [["mailops_tracking_budget","mailops_tracking_firms","mailops_tracking_campaigns","mailops_tracking_pieces","mailops_tracking_events","mailops_tracking_batches"]]);
      if(existing.rows.length)throw new Error("Unreviewed tracking tables already exist");
      await db.query(sql);
      await db.query("INSERT INTO mailops_tracking_schema_versions(version,sha256) VALUES(1,$1)",[plan]);
    }
    await db.query("COMMIT");
    console.log(JSON.stringify({ok:true,mode:"applied",plan,existing:Boolean(marker)}));
  }catch{await db.query("ROLLBACK");console.error(JSON.stringify({ok:false,code:"SCHEMA_APPLY_ROLLED_BACK"}));process.exitCode=1;}
  finally{db.release();await pool.end();}
}
