import 'dotenv/config';
import pool from '../config/database.js';
import {parseImportCycles} from '../services/cycleImportCoordinator.js';
let client;
try{
 const cycles=parseImportCycles(process.argv.find(s=>s.startsWith('--cycles='))?.slice(9)??process.env.FEC_IMPORT_CYCLES??'2026,2028,2030');
 client=await pool.connect();await client.query('BEGIN READ ONLY');
 const rows=(await client.query(`SELECT DISTINCT ON ((summary->>'cycle')::int) status,started_at,completed_at,summary FROM production_job_runs WHERE job_name='fec-sync' AND summary->>'cycle'=ANY($1::text[]) ORDER BY (summary->>'cycle')::int,started_at DESC`,[cycles.map(String)])).rows;
 const alerts=[];const warnings=[];
 for(const cycle of cycles){const row=rows.find(r=>Number(r.summary?.cycle)===cycle);
  if(!row){alerts.push(`${cycle}: no import telemetry`);continue;}
  if(row.status==='failed')alerts.push(`${cycle}: latest import failed`);
  else if(row.status==='running'){if(Date.now()-new Date(row.started_at).getTime()>3600000)alerts.push(`${cycle}: import running over one hour`);}
  else if(!row.completed_at||Date.now()-new Date(row.completed_at).getTime()>48*3600000)alerts.push(`${cycle}: import older than 48 hours`);
  if(row.summary?.status==='no_data')warnings.push(`${cycle}: provider returned no data; existing data preserved`);
  else if(row.summary?.status==='completed_with_skipped_pac')warnings.push(`${cycle}: PAC coverage partial`);
  else if(row.status==='degraded')alerts.push(`${cycle}: unrecognized degraded status`);
 }
 console.log(JSON.stringify({checked_at:new Date().toISOString(),cycles,alerts,warnings,runs:rows,coverage:'FEC totals only; provider pagination completion is not proof of all candidate registrations.'},null,2));if(alerts.length)process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'MONITOR_FAILED'}));process.exitCode=1;}
finally{try{if(client)await client.query('ROLLBACK');}finally{client?.release();await pool.end();}}
