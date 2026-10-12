import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resumableImportOptions} from '../services/resumableMoneyImports.service.js';
const allowed=new Set(['cycles','lanes','scope','committees','perPage','per-page','pages-per-lane','publish-pages']);
try{
 const options={};const moneyArgs=[];
 for(const arg of process.argv.slice(2)){
  if(arg==='--apply')continue;
  const match=arg.match(/^--([^=]+)=(.+)$/);
  if(!match||!allowed.has(match[1]))throw Object.assign(new Error(),{code:'INVALID_CLI_ARGUMENT'});
  options[match[1]]=match[2];moneyArgs.push(arg);
 }
 const config=resumableImportOptions(options);
 const fec=fileURLToPath(new URL('./runCycleImports.mjs',import.meta.url));
 const money=fileURLToPath(new URL('./runResumableMoneyImports.mjs',import.meta.url));
 if(!fs.existsSync(fec)||!fs.existsSync(money))throw Object.assign(new Error(),{code:'IMPORT_SCRIPT_MISSING'});
 const apply=process.argv.includes('--apply');
 if(!apply)console.log(JSON.stringify({mode:'preview',fec_cycles:config.cycles,money:config,policy:'No child processes, database connections or provider requests. After canary validation, use this one command in the existing FEC cron.'},null,2));
 else for(const [script,args] of [[fec,[`--cycles=${config.cycles.join(',')}`,'--apply']],[money,[...moneyArgs,'--apply']]]){
  const child=spawnSync(process.execPath,[script,...args],{stdio:'inherit',shell:false});
  if(child.error||child.status!==0)throw Object.assign(new Error(),{code:'COORDINATED_CHILD_FAILED'});
 }
}catch(error){console.error(JSON.stringify({ok:false,code:error.code||'COORDINATED_IMPORT_FAILED'}));process.exitCode=1;}
