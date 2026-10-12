import dotenv from 'dotenv';
import {pool} from '../db/pool.js';
import {resumableImportOptions,runResumableMoneyImports} from '../services/resumableMoneyImports.service.js';
dotenv.config({quiet:true});
try{
 const allowed=new Set(['cycles','lanes','scope','committees','perPage','per-page','pages-per-lane','publish-pages','restart']);
 const options={};
 for(const arg of process.argv.slice(2)){
  if(arg==='--apply')continue;
  const match=arg.match(/^--([^=]+)=(.+)$/);
  if(!match||!allowed.has(match[1]))throw Object.assign(new Error(),{code:'INVALID_CLI_ARGUMENT'});
  options[match[1]]=match[2];
 }
 const config=resumableImportOptions(options);
 if(!process.argv.includes('--apply'))console.log(JSON.stringify({mode:'preview',...config,policy:'No database connections or provider requests. Explicit committee list or --scope=national required.'},null,2));
 else console.log(JSON.stringify(await runResumableMoneyImports(pool,options),null,2));
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'RESUMABLE_IMPORT_FAILED',provider_status:error.providerStatus||null}));process.exitCode=1;}
finally{await pool.end();}
