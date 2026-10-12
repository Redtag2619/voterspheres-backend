import 'dotenv/config';
import {pool} from '../db/pool.js';
const statements=[
 "CREATE TABLE money_integrity_score_archive AS SELECT to_jsonb(s) AS original_record, NOW() AS archived_at FROM political_money_scores s",
 "ALTER TABLE political_money_evidence ADD COLUMN cycle INTEGER",
 "UPDATE political_money_evidence SET cycle=CASE WHEN metadata->>'cycle' ~ '^[0-9]{4}$' THEN CASE WHEN (metadata->>'cycle')::int BETWEEN 2000 AND 2200 AND (metadata->>'cycle')::int % 2=0 THEN (metadata->>'cycle')::int ELSE NULL END ELSE NULL END",
 "ALTER TABLE political_money_evidence DROP CONSTRAINT political_money_evidence_provider_evidence_type_source_reco_key",
 "CREATE UNIQUE INDEX money_evidence_cycle_key ON political_money_evidence(provider,evidence_type,source_record_id,(COALESCE(cycle,0)))",
 "ALTER TABLE political_money_transactions DROP CONSTRAINT political_money_transactions_provider_source_record_id_key",
 "CREATE UNIQUE INDEX money_transactions_cycle_key ON political_money_transactions(provider,source_record_id,(COALESCE(cycle,0)))",
 "ALTER TABLE political_money_scores DROP CONSTRAINT political_money_scores_pkey",
 "ALTER TABLE political_money_scores ADD COLUMN score_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY",
 "ALTER TABLE political_money_scores ADD COLUMN cycle_scoped_verified BOOLEAN NOT NULL DEFAULT FALSE",
 "CREATE UNIQUE INDEX money_scores_cycle_key ON political_money_scores(organization_id,(COALESCE(cycle,0)))",
 "CREATE TABLE money_integrity_storage_version(version INTEGER PRIMARY KEY, installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
 "INSERT INTO money_integrity_storage_version(version) VALUES(1)"
];
let client;
try{
 if(!process.argv.includes('--apply'))console.log(JSON.stringify({mode:'preview',statements,policy:'All rows preserved. No donor/vendor cleanup. Untagged evidence stays unassigned. Existing scores are archived and excluded until rebuilt by cycle.'},null,2));
 else{
  client=await pool.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='10s'");await client.query("SET LOCAL statement_timeout='60s'");
  if(!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('voterspheres:fec-sync',0)) AS acquired")).rows[0]?.acquired)throw Object.assign(new Error(),{code:'IMPORT_LOCK_BUSY'});
  const marker=(await client.query("SELECT to_regclass('public.money_integrity_storage_version') AS name")).rows[0]?.name;
  if(marker){if(!(await client.query('SELECT version FROM money_integrity_storage_version WHERE version=1')).rows.length)throw Object.assign(new Error(),{code:'STORAGE_VERSION_MISMATCH'});}
  else for(const sql of statements)await client.query(sql);
  await client.query('COMMIT');console.log('Money integrity storage installed; all existing donor, vendor and evidence rows preserved.');
 }
}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({ok:false,code:e.code||'MIGRATION_FAILED'}));process.exitCode=1;}
finally{client?.release();await pool.end();}
