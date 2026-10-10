import 'dotenv/config';
import pool from '../config/database.js';
import {syncFundraisingFromFec} from '../services/fec.service.js';
import {parseImportCycles,runCycleImports} from '../services/cycleImportCoordinator.js';
let client,locked=false,heartbeat;
try{
 const arg=process.argv.find(s=>s.startsWith('--cycles='))?.slice(9);
 const cycles=parseImportCycles(arg??process.env.FEC_IMPORT_CYCLES??'2026,2028,2030');
 if(!process.argv.includes('--apply'))console.log(JSON.stringify({mode:'preview',cycles,lanes:['FEC candidates','FEC fundraising','configured limited PAC lookup'],not_scheduled:['donors','vendor spending','political-money evidence','polling','contacts','consultants'],policy:'No provider requests or database writes. Use --apply after storage migration and deployment.'},null,2));
 else{
  client=await pool.connect();
  client.on('error',()=>{console.error('Import lock connection lost; terminating.');process.exit(1);});
  locked=(await client.query("SELECT pg_try_advisory_lock(hashtextextended('voterspheres:fec-sync',0)) AS acquired")).rows[0]?.acquired===true;
  if(!locked)throw Object.assign(new Error('FEC import already running'),{code:'IMPORT_LOCK_BUSY'});
  heartbeat=setInterval(()=>client.query('SELECT 1').catch(()=>process.exit(1)),20000);
  const marker=await client.query("SELECT to_regclass('public.cycle_import_storage_version') AS name");
  if(!marker.rows[0]?.name)throw Object.assign(new Error('Install cycle storage first'),{code:'CYCLE_STORAGE_MISSING'});
  if(!(await client.query('SELECT version FROM public.cycle_import_storage_version WHERE version=1')).rows.length)throw Object.assign(new Error('Unsupported storage version'),{code:'CYCLE_STORAGE_MISSING'});
  const registered=await client.query('SELECT cycle_year FROM election_cycles WHERE is_selectable=TRUE AND cycle_year=ANY($1::int[])',[cycles]);
  if(cycles.some(c=>!registered.rows.some(r=>Number(r.cycle_year)===c)))throw Object.assign(new Error('Cycle is not selectable'),{code:'CYCLE_NOT_SELECTABLE'});
  const results=await runCycleImports({cycles,client,sync:syncFundraisingFromFec,onResult:summary=>console.log(JSON.stringify(summary))});
  console.log(JSON.stringify({ok:true,results,policy:'Empty provider results preserve stored data. PAC coverage remains limited; no other import lanes ran.'}));
 }
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'IMPORT_FAILED',provider_status:error.providerStatus||null}));process.exitCode=1;}
finally{clearInterval(heartbeat);try{if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended('voterspheres:fec-sync',0))");}finally{client?.release();await pool.end();}}
