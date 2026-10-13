import 'dotenv/config';
import {pool} from '../db/pool.js';
import {previewScanRetention} from '../services/moneyStoragePolicy.js';
let client;
try{
 if(process.argv.length!==2)throw Object.assign(new Error(),{code:'PREVIEW_ONLY_NO_ARGUMENTS'});
 client=await pool.connect();await client.query('BEGIN READ ONLY');
 await client.query("SET LOCAL statement_timeout='30s'");
 const scans=await client.query(`SELECT s.id,s.lane,s.cycle,s.scope_key,s.status,s.started_at,s.updated_at,s.completed_at,s.records,
 EXISTS(SELECT 1 FROM money_import_checkpoints c WHERE c.active_scan_id=s.id) AS is_active,
 EXISTS(SELECT 1 FROM money_import_checkpoints c WHERE c.published_scan_id=s.id) AS is_published
 FROM money_import_scans s`);
 const inventory=await client.query(`SELECT scan_id,COUNT(*)::text AS raw_records,
 SUM(pg_column_size(r))::text AS row_bytes FROM money_import_records r GROUP BY scan_id`);
 const dependencies=await client.query(`SELECT conrelid::regclass::text AS table_name,conname,pg_get_constraintdef(oid) AS definition
 FROM pg_constraint WHERE contype='f' AND confrelid='public.money_import_scans'::regclass ORDER BY conname`);
 const byScan=new Map(inventory.rows.map(r=>[r.scan_id,r]));
 const report=previewScanRetention(scans.rows).map(s=>({...s,raw_storage:byScan.get(s.id)||{raw_records:'0',row_bytes:'0'}}));
 console.log(JSON.stringify({mode:'preview',checked_at:new Date().toISOString(),policy:{min_age_days:30,keep_latest_completed_per_scope:2,protect:'All active and published scans, unfinished scans, and their evidence'},candidate_scans:report.filter(s=>s.retention_candidate),protected_scans:report.filter(s=>!s.retention_candidate),dependencies:dependencies.rows,
 estimated_candidate_raw_row_bytes:report.filter(s=>s.retention_candidate).reduce((n,s)=>n+Number(s.raw_storage.row_bytes),0),
 limitations:'Preview only. No DELETE, VACUUM, checkpoint edits, or provider requests. Row bytes do not predict disk reclaimed. Unknown references must be reviewed before any later cleanup implementation.'},null,2));
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'RETENTION_PREVIEW_FAILED'}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}await pool.end();}
