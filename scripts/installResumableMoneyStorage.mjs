import 'dotenv/config';
import fs from 'node:fs';
import { pool } from '../db/pool.js';
const sql=fs.readFileSync(new URL('../db/managed-migrations/resumable_money_imports.sql',import.meta.url),'utf8');
let client;
try {
 if(!process.argv.includes('--apply')) console.log(JSON.stringify({mode:'preview',migration:'resumable_money_imports.sql',policy:'No connections or writes. Preserves all original vendor/donor rows; reconciles label-only duplicates in a derived baseline. Financial conflicts abort.'},null,2));
 else {
  client=await pool.connect(); await client.query('BEGIN');
  await client.query('SET LOCAL search_path=public');
  await client.query("SET LOCAL lock_timeout='10s'"); await client.query("SET LOCAL statement_timeout='120s'");
  if(!(await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('voterspheres:fec-sync',0)) AS acquired")).rows[0]?.acquired) throw Object.assign(new Error(),{code:'IMPORT_LOCK_BUSY'});
  const marker=await client.query("SELECT to_regclass('public.resumable_money_storage_version') AS name");
  if(marker.rows[0]?.name) {
   if(!(await client.query('SELECT version FROM resumable_money_storage_version WHERE version=1')).rows.length) throw Object.assign(new Error(),{code:'STORAGE_VERSION_MISMATCH'});
  } else {
   if(!(await client.query('SELECT version FROM money_integrity_storage_version WHERE version=1')).rows.length) throw Object.assign(new Error(),{code:'MONEY_INTEGRITY_MIGRATION_REQUIRED'});
   await client.query(sql);
  }
  const totals=await client.query('SELECT (SELECT COUNT(*) FROM vendor_fec_spend) AS original_vendor_rows,(SELECT COUNT(*) FROM money_vendor_baseline) AS canonical_vendor_records');
  await client.query('COMMIT'); console.log(JSON.stringify({ok:true,...totals.rows[0],policy:'Original rows retained; no provider requests.'},null,2));
 }
} catch(error) {
 if(client)await client.query('ROLLBACK').catch(()=>{});
 const known=['VENDOR_FINANCIAL_CONFLICT','VENDOR_MISSING_IDENTITY'];
 const code=known.includes(error.message)?error.message:error.code||'MIGRATION_FAILED';
 console.error(JSON.stringify({ok:false,code})); process.exitCode=1;
} finally {client?.release();await pool.end();}
