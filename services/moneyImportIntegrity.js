import { createFecHttpClient } from './fecHttpClient.js';
import { financeElectionCycle } from '../utils/financeElectionCycle.js';
const failure = code => Object.assign(new Error(code), {code, statusCode:502});
export async function collectMoneyPages({cycle, maxPages=3, perPage=100, apiKey, pauseMs=4000, request}={}) {
 cycle=financeElectionCycle(cycle);
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>25)throw failure('INVALID_PAGE_CAP');
 if(!Number.isInteger(perPage)||perPage<1||perPage>100)throw failure('INVALID_PAGE_SIZE');
 if(!apiKey)throw failure('FEC_KEY_MISSING');
 const get=request??createFecHttpClient({intervalMs:Math.max(4000,Number(pauseMs)||0)});
 const rows=[];
 for(let page=1;page<=maxPages;page++){
  const url=new URL('https://api.open.fec.gov/v1/schedules/schedule_e/');
  for(const [k,v] of Object.entries({api_key:apiKey,cycle,page,per_page:perPage,sort:'-expenditure_date'}))url.searchParams.set(k,String(v));
  const data=await get(url);
  if(!Array.isArray(data?.results))throw failure('FEC_INVALID_PAYLOAD');
  const pages=data.pagination?.pages;
  if(!Number.isInteger(pages)||pages<0||(pages===0&&data.results.length))throw failure('FEC_INVALID_PAGINATION');
  for(const row of data.results){
   if(!row||typeof row!=='object'||Array.isArray(row))throw failure('FEC_INVALID_ROW');
   if(row.cycle!=null&&Number(row.cycle)!==cycle)throw failure('FEC_CYCLE_MISMATCH');
  }
  rows.push(...data.results);
  if(page>=pages)return {rows,pages:page};
  if(!data.results.length)throw failure('FEC_INCOMPLETE_PAGINATION');
 }
 throw failure('FEC_PAGE_CAP_REACHED');
}
export async function withMoneyImportLock(pool, work, {onLoss=()=>process.exit(1)}={}){
 const client=await pool.connect();let locked=false,heartbeat;
 const lost=()=>onLoss();client.on?.('error',lost);
 try{
  locked=(await client.query("SELECT pg_try_advisory_lock(hashtextextended('voterspheres:fec-sync',0)) AS acquired")).rows[0]?.acquired===true;
  if(!locked)throw Object.assign(new Error('Another FEC writer is active'),{code:'IMPORT_LOCK_BUSY',statusCode:409});
  heartbeat=setInterval(()=>client.query('SELECT 1').catch(lost),20000);
  return await work();
 }finally{
  clearInterval(heartbeat);
  try{if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended('voterspheres:fec-sync',0))");}
  finally{client.removeListener?.('error',lost);client.release();}
 }
}
