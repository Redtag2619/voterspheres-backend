import 'dotenv/config';
import pool from '../config/database.js';
const hours=Number(process.env.JOB_STALE_HOURS||30),dataDays=Number(process.env.POLLING_STALE_DAYS||14);
let client;
try {
 if(!Number.isFinite(hours)||hours<=0||!Number.isFinite(dataDays)||dataDays<=0)throw new Error('Invalid monitoring thresholds');
 client=await pool.connect();await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='15s'");
 const report={checked_at:new Date().toISOString(),alerts:[],warnings:[],jobs:{},polling:{}};
 for(const [table,job] of [['production_job_runs','fec-sync'],['polling_ingestion_runs','polling']]) {
  const exists=(await client.query('SELECT to_regclass($1) AS name',[`public.${table}`])).rows[0]?.name;
  if(!exists){report.alerts.push(`${job}: monitoring table unavailable`);continue;}
  const sql=job==='fec-sync'?"SELECT status,started_at,completed_at,summary FROM production_job_runs WHERE job_name='fec-sync' ORDER BY started_at DESC LIMIT 1":"SELECT status,started_at,completed_at FROM polling_ingestion_runs ORDER BY started_at DESC LIMIT 1";
  const latest=(await client.query(sql)).rows[0];report.jobs[job]=latest||null;
  if(!latest){report.alerts.push(`${job}: no recorded run`);continue;}
  const partialPac = job === 'fec-sync' &&
    latest.status === 'degraded' &&
    latest.summary?.status === 'completed_with_skipped_pac';
  if (partialPac) {
    report.warnings.push('fec-sync: fundraising refreshed; PAC coverage is partial');
  } else if (latest.status === 'running') {
    const maxMinutes = Number(process.env.JOB_MAX_RUNTIME_MINUTES || 120);
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0)
      throw new Error('Invalid job runtime threshold');
    const started = new Date(latest.started_at).getTime();
    if (!Number.isFinite(started) || Date.now() - started > maxMinutes * 60000)
      report.alerts.push(`${job}: running beyond allowed runtime`);
  } else if (!['complete', 'completed'].includes(latest.status)) {
    report.alerts.push(`${job}: latest status ${latest.status}`);
  }
  const successfulSql=job==='fec-sync'?"SELECT MAX(completed_at) AS at FROM production_job_runs WHERE job_name='fec-sync' AND (status='complete' OR (status='degraded' AND summary->>'status'='completed_with_skipped_pac'))":"SELECT MAX(completed_at) AS at FROM polling_ingestion_runs WHERE status='complete'";
  const last=(await client.query(successfulSql)).rows[0]?.at;
  if(!last||Date.now()-new Date(last).getTime()>hours*3600000)report.alerts.push(`${job}: successful run is missing or older than ${hours} hours`);
 }
 const data=(await client.query(`SELECT temporal_scope, MAX(field_end) FILTER (WHERE field_end::date<=CURRENT_DATE) AS latest_survey,COUNT(*) FILTER (WHERE field_end::date>CURRENT_DATE) AS future_answers FROM polling_results GROUP BY temporal_scope`)).rows;
 report.polling=data;
 for(const row of data){if(row.temporal_scope==='unresolved')continue;if(!row.latest_survey||Date.now()-new Date(row.latest_survey).getTime()>dataDays*86400000)report.alerts.push(`${row.temporal_scope}: surveys missing or older than ${dataDays} days`);}
 console.log(JSON.stringify(report,null,2));if(report.alerts.length)process.exitCode=1;
} catch(error){console.error(JSON.stringify({status:'monitor_failed',message:'Monitoring could not complete; check database access and schema.'}));process.exitCode=1;}
finally{try{if(client)await client.query('ROLLBACK');}finally{client?.release();await pool.end();}}
