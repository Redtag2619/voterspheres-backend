import 'dotenv/config';
import {pool} from '../db/pool.js';
import {withMoneyImportLock} from '../services/moneyImportIntegrity.js';
import {scopeConfig} from '../services/fecMoneyProtocol.js';

const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  if(!arg.startsWith('--'))throw new Error('Use named options');
  const i=arg.indexOf('=');return i<0?[arg.slice(2),true]:[arg.slice(2,i),arg.slice(i+1)];
}));
try {
  if(Object.keys(args).some(k=>!['lane','cycle','scope','committees','reason','resume','apply'].includes(k)))throw new Error('Unknown option');
  if(!args.lane||!args.cycle||(!args.resume&&!String(args.reason||'').trim()))throw new Error('Explicit lane, cycle, scope and hold reason required');
  const config=scopeConfig({lane:args.lane,cycle:Number(args.cycle),national:args.scope==='national',committees:args.committees});
  if(args.scope && args.scope!=='national')throw new Error('Use --scope=national or --committees=...');
  const sql=`CREATE TABLE IF NOT EXISTS money_import_scope_holds (
    lane text NOT NULL, cycle integer NOT NULL, scope_key text NOT NULL,
    held_at timestamptz NOT NULL DEFAULT NOW(), reason text NOT NULL CHECK(length(trim(reason))>0),
    PRIMARY KEY(lane,cycle,scope_key),
    FOREIGN KEY(lane,cycle,scope_key) REFERENCES money_import_checkpoints(lane,cycle,scope_key)
  )`;
  if(!args.apply)console.log(JSON.stringify({preview:true,lane:config.lane,cycle:config.cycle,scope:config.key,action:args.resume?'resume':'hold',reason:args.reason||null,policy:'No database changes. Add --apply to record the decision.'},null,2));
  else await withMoneyImportLock(pool,async client=>{
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='30s'");
      await client.query(sql);
      const checkpoint=await client.query('SELECT active_scan_id,published_scan_id FROM money_import_checkpoints WHERE lane=$1 AND cycle=$2 AND scope_key=$3 FOR UPDATE',[config.lane,config.cycle,config.key]);
      if(!checkpoint.rows.length)throw new Error('Existing scope required');
      if(args.resume)await client.query('DELETE FROM money_import_scope_holds WHERE lane=$1 AND cycle=$2 AND scope_key=$3',[config.lane,config.cycle,config.key]);
      else await client.query(`INSERT INTO money_import_scope_holds(lane,cycle,scope_key,reason) VALUES($1,$2,$3,$4)
        ON CONFLICT(lane,cycle,scope_key) DO UPDATE SET reason=EXCLUDED.reason`,[config.lane,config.cycle,config.key,String(args.reason).trim()]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ok:true,action:args.resume?'resumed':'held',lane:config.lane,cycle:config.cycle,scope:config.key,...checkpoint.rows[0],policy:'Scan cursor, records, timestamps and publications preserved.'},null,2));
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  });
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'SCOPE_HOLD_FAILED',message:error.code?undefined:error.message}));process.exitCode=1;}
finally{await pool.end();}
