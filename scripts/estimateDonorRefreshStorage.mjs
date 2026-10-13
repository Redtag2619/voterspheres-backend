import 'dotenv/config';
import {pool} from '../db/pool.js';
let client;
try{
 const options={};
 for(const arg of process.argv.slice(2)){
  const m=arg.match(/^--(scan|provider-total)=(.+)$/);
  if(!m||options[m[1]]!==undefined)throw Object.assign(new Error(),{code:'INVALID_ESTIMATE_ARGUMENT'});
  options[m[1]]=m[2];
 }
 if(!/^[0-9a-f-]{36}$/i.test(options.scan||'')||!/^\d+$/.test(options['provider-total']||'')||!Number.isSafeInteger(Number(options['provider-total'])))throw Object.assign(new Error(),{code:'SCAN_AND_PROVIDER_TOTAL_REQUIRED'});
 client=await pool.connect();await client.query('BEGIN READ ONLY');
 await client.query("SET LOCAL statement_timeout='30s'");
 const r=await client.query(`SELECT s.id,s.status,s.records,s.cutoff::text,c.published_scan_id,
 EXISTS(SELECT 1 FROM money_import_checkpoints x WHERE x.active_scan_id=s.id) AS is_active
 FROM money_import_scans s JOIN money_import_checkpoints c ON c.lane=s.lane AND c.cycle=s.cycle AND c.scope_key=s.scope_key
 WHERE s.id=$1 AND s.lane='donors'`,[options.scan]);
 const scan=r.rows[0];
 if(!scan||!scan.is_active||!['paused','publishing'].includes(scan.status))throw Object.assign(new Error(),{code:'ACTIVE_DONOR_REFRESH_REQUIRED'});
 const raw=await client.query(`SELECT COUNT(*)::text AS rows,pg_total_relation_size('public.money_import_records')::text AS bytes FROM money_import_records`);
 const snapshots=await client.query(`SELECT COUNT(*)::text AS rows,pg_total_relation_size('public.money_donor_snapshots')::text AS bytes FROM money_donor_snapshots`);
 const previous=await client.query(`SELECT (SELECT COUNT(*) FROM money_donor_snapshots WHERE scan_id=$1)::text AS groups,
 (SELECT records FROM money_import_scans WHERE id=$1)::text AS records`,[scan.published_scan_id]);
 const stagedGroups=await client.query('SELECT COUNT(*)::text AS groups FROM money_donor_snapshots WHERE scan_id=$1',[scan.id]);
 const db=await client.query('SELECT pg_database_size(current_database())::text AS bytes');
 const rawBytes=Number(raw.rows[0].bytes)/Math.max(1,Number(raw.rows[0].rows));
 const groupBytes=Number(snapshots.rows[0].bytes)/Math.max(1,Number(snapshots.rows[0].rows));
 const total=Number(options['provider-total']),remaining=Math.max(0,total-Number(scan.records));
 const ratio=Number(previous.rows[0].records)>0?Number(previous.rows[0].groups)/Number(previous.rows[0].records):null;
 const projectedGroups=ratio===null?null:Math.ceil(total*ratio);
 const existingGroups=Number(stagedGroups.rows[0].groups);
 const rawAdditional=Math.ceil(remaining*rawBytes),groupAdditional=projectedGroups===null?null:Math.ceil(Math.max(0,projectedGroups-existingGroups)*groupBytes);
 console.log(JSON.stringify({mode:'read_only_estimate',checked_at:new Date().toISOString(),scan,advisory_provider_total:total,remaining_receipts_estimate:remaining,current_database_bytes:db.rows[0].bytes,
 observed_raw_bytes_per_record:Math.ceil(rawBytes),observed_snapshot_bytes_per_group:Math.ceil(groupBytes),additional_raw_bytes:rawAdditional,
 projected_groups_using_previous_scan_ratio:projectedGroups,additional_snapshot_bytes_using_previous_ratio:groupAdditional,
 additional_snapshot_bytes_if_each_receipt_is_a_distinct_group:Math.ceil(Math.max(0,total-existingGroups)*groupBytes),
 estimated_additional_bytes_using_previous_ratio:groupAdditional===null?null:rawAdditional+groupAdditional,
 limitations:['Provider count is advisory, not a capacity gate.','Previous disclosure-group ratio may change.','Relation sizes include indexes/bloat; this is an estimate, not a guaranteed upper bound.','WAL, backups, temporary files and other services need additional headroom.','Compare against Render disk usage, not just PostgreSQL database size.','No imports, deletion or production changes performed.']},null,2));
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'DONOR_STORAGE_ESTIMATE_FAILED'}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}await pool.end();}
