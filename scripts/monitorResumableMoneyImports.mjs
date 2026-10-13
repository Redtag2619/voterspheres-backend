import 'dotenv/config';
import {pool} from '../db/pool.js';
import {moneyRefreshIntervals,moneyRefreshDecision} from '../services/moneyStoragePolicy.js';
const client=await pool.connect();
try{
 await client.query('BEGIN READ ONLY');
 const r=await client.query(`SELECT c.lane,c.cycle,c.scope_key,c.published_at,c.needs_scores,
 s.status,s.pages,s.records,s.last_error,s.updated_at,s.completed_at,s.cutoff::text,p.cutoff::text AS published_cutoff
 FROM money_import_checkpoints c LEFT JOIN money_import_scans s ON s.id=c.active_scan_id
 LEFT JOIN money_import_scans p ON p.id=c.published_scan_id ORDER BY c.cycle,c.lane,c.scope_key`);
 const alerts=[],warnings=[],intervals=moneyRefreshIntervals();
 for(const row of r.rows){
  const label=`${row.lane}/${row.cycle}/${row.scope_key}`;
  const decision=moneyRefreshDecision({status:row.status,completedAt:row.completed_at,updatedAt:row.updated_at},row.lane,intervals);
  row.next_due_at=decision.nextDueAt||null;
  if(row.last_error)alerts.push(`${label}: ${row.last_error}`);
  if(row.needs_scores)warnings.push(`${label}: score rebuild pending`);
  if(row.status==='not_available_yet')warnings.push(`${label}: FEC transaction period not available yet; next run will recheck`);
  else if(!row.published_at)warnings.push(`${label}: no completed publication yet`);
  if(['paused','publishing'].includes(row.status)&&Date.now()-new Date(row.updated_at).getTime()>48*3600000)alerts.push(`${label}: progress older than 48 hours`);
  if(row.published_at&&Date.now()-new Date(row.published_at).getTime()>7*86400000)warnings.push(`${label}: published data older than seven days`);
 }
 if(!r.rows.length)warnings.push('No resumable imports have been configured or run.');
 console.log(JSON.stringify({checked_at:new Date().toISOString(),alerts,warnings,scopes:r.rows,policy:'Read-only job progress, not certification of provider filing completeness.'},null,2));
 if(alerts.length)process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'MONITOR_FAILED'}));process.exitCode=1;}
finally{await client.query('ROLLBACK');client.release();await pool.end();}
