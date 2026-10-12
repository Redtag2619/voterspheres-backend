import 'dotenv/config';
import {pool} from '../db/pool.js';
import {parseImportCycles} from '../services/cycleImportCoordinator.js';
import {syncFecIndependentExpenditures,rebuildPoliticalMoneyScores} from '../services/politicalMoneyEvidence.service.js';
try{
 const cycles=parseImportCycles(process.argv.find(x=>x.startsWith('--cycles='))?.slice(9)||'2026,2028,2030');
 const scoresOnly=process.argv.includes('--scores-only');
 const cap=Number(process.argv.find(x=>x.startsWith('--max-pages='))?.slice(12)||3);
 if(!Number.isInteger(cap)||cap<1||cap>25)throw Object.assign(new Error(),{code:'INVALID_PAGE_CAP'});
 if(!process.argv.includes('--apply'))console.log(JSON.stringify({mode:'preview',cycles,max_pages:cap,scores_only:scoresOnly,policy:'No provider requests or database writes. A page cap fails before provider records are stored. Not national-coverage automation.'},null,2));
 else{
  if(!(await pool.query('SELECT version FROM money_integrity_storage_version WHERE version=1')).rows.length)throw Object.assign(new Error(),{code:'STORAGE_VERSION_MISMATCH'});
  for(const cycle of cycles)console.log(JSON.stringify({cycle,result:scoresOnly?await rebuildPoliticalMoneyScores({cycle}):await syncFecIndependentExpenditures({cycle,maxPages:cap})}));
 }
}catch(e){console.error(JSON.stringify({ok:false,code:e.code||'MONEY_IMPORT_FAILED',provider_status:e.providerStatus||null}));process.exitCode=1;}
finally{await pool.end();}
