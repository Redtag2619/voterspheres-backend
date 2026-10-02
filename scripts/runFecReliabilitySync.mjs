import 'dotenv/config';
import pool from '../config/database.js';
import { syncFundraisingFromFec } from '../services/fec.service.js';
import { normalizeFederalElectionCycle } from '../utils/electionCycle.js';
const cycleArg=process.argv.find(arg=>arg.startsWith('--cycle='))?.slice(8);
let client,locked=false,runId,heartbeat;
try {
  const cycle=normalizeFederalElectionCycle(cycleArg??process.env.FEC_DEFAULT_CYCLE??2026,{fieldName:'cycle'});
  client=await pool.connect();
  const connectionFailed = () => {
    console.error(JSON.stringify({
      job: 'fec-sync',
      status: 'failed',
      code: 'DB_LOCK_CONNECTION_LOST',
      message: 'Database lock connection lost. Sync stopped; inspect telemetry before retrying.'
    }));
    process.exit(1);
  };
  client.on('error', connectionFailed);
  heartbeat = setInterval(() => {
    client.query('SELECT 1').catch(connectionFailed);
  }, 20000);
  locked=(await client.query("SELECT pg_try_advisory_lock(hashtextextended('voterspheres:fec-sync',0)) AS acquired")).rows[0]?.acquired===true;
  if(!locked) throw new Error('Another reliability FEC sync holds the job lock.');
  // Install the explicit migration first. Missing telemetry must not silently disappear.
  runId=(await client.query("INSERT INTO production_job_runs(job_name,status) VALUES ('fec-sync','running') RETURNING id")).rows[0].id;
  const result=await syncFundraisingFromFec({cycle,syncContacts:false});
  if(result?.ok!==true) throw new Error('FEC service returned an incomplete result.');
  const status=result.status==='completed'?'complete':'degraded';
  await client.query('UPDATE production_job_runs SET status=$2,completed_at=NOW(),summary=$3::jsonb WHERE id=$1',[runId,status,JSON.stringify({cycle,status:result.status,fetched:result.fetched,stored:result.fundraising_stored,pac_skipped_candidates:result.pac_skipped_candidates,contacts:'not implemented; intentionally disabled'})]);
  console.log(JSON.stringify({job:'fec-sync',run_id:runId,status,result,contacts:'not implemented; intentionally disabled'},null,2));
  if(status!=='complete')process.exitCode=1;
} catch(error) {
  if(runId)await client.query("UPDATE production_job_runs SET status='failed',completed_at=NOW(),summary=$2::jsonb WHERE id=$1",[runId,JSON.stringify({code:error.code||'SYNC_FAILED',provider_status:error.providerStatus||null})]).catch(()=>{});
  console.error(JSON.stringify({job:'fec-sync',status:'failed',code:error.code||'SYNC_FAILED',provider_status:error.providerStatus||null,message:'Sync failed; inspect configuration, quota and application logs. No credentials logged.'}));
  process.exitCode=1;
} finally {
  clearInterval(heartbeat);
  try{if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended('voterspheres:fec-sync',0))");}
  finally{client?.release();await pool.end();}
}
