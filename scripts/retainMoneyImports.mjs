import 'dotenv/config';
import {pool} from '../db/pool.js';
import {withMoneyImportLock} from '../services/moneyImportIntegrity.js';
import {retentionOptions,inspectRetentionDependencies,planMoneyRetention,applyMoneyRetention} from '../services/moneyScanRetention.js';
let client;
try{
  const options=retentionOptions(process.argv.slice(2));
  let report;
  if(options.apply)report=await withMoneyImportLock(pool,c=>applyMoneyRetention(c,options));
  else{
    client=await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='20s'");
    await inspectRetentionDependencies(client);
    report=await planMoneyRetention(client,options);
    await client.query('ROLLBACK');
  }
  console.log(JSON.stringify({ok:true,mode:options.apply?'applied':'preview',policy:{min_age_days:30,keep_latest_completed_per_scope:2,max_scans:options.maxScans,max_rows:options.maxRows},...report,
    limitations:'No provider requests, VACUUM or checkpoint edits. Deleted space can be reused by PostgreSQL; disk usage may not shrink. Preview does not delete records.'},null,2));
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'MONEY_RETENTION_FAILED'}));process.exitCode=1;}
finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}await pool.end();}
