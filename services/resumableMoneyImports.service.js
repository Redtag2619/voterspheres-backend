import { createFecHttpClient } from './fecHttpClient.js';
import { classifyFecPeriodResponse } from './fecPeriodAvailability.js';
import { moneyRefreshIntervals } from './moneyStoragePolicy.js';
import { parseFecMoneyJson, scopeConfig, importError, LANES } from './fecMoneyProtocol.js';
import { withMoneyImportLock } from './moneyImportIntegrity.js';
import { resumeMoneyLane } from './resumableMoneyEngine.js';
import { MoneyCheckpointStore } from './moneyCheckpointStore.js';
import { promoteResumablePoliticalRecord, rebuildResumableMoneyScores } from './politicalMoneyEvidence.service.js';
import { parseImportCycles } from './cycleImportCoordinator.js';

export function resumableImportOptions(options={}) {
 for(const key of ['state','search','q','category','candidate_id','min_date','max_date','min_amount','max_amount']) {
  if(options[key]!=null && String(options[key]).trim()!=='')throw importError('UNSUPPORTED_IMPORT_FILTER',400);
 }
 const lanes=[...new Set(String(options.lanes||options.lane||'vendors,donors,political-money').split(',').map(x=>x.trim()))];
 if(lanes.some(x=>!LANES[x]))throw importError('INVALID_IMPORT_LANE',400);
 let cycles;
 try {cycles=parseImportCycles(options.cycles??String(options.cycle??process.env.FEC_DEFAULT_CYCLE??2026));}
 catch {throw importError('INVALID_IMPORT_CYCLES',400);}
 const national=options.scope==='national';
 const perPage=Number(options.perPage??options.per_page??options['per-page']??100);
 const pageBudget=Number(options.pageBudget??options['pages-per-lane']??options.maxPages??options.max_pages??2);
 const publishBudget=Number(options.publishBudget??options['publish-pages']??2);
 for(const n of [pageBudget,publishBudget])if(!Number.isInteger(n)||n<1||n>100)throw importError('INVALID_WORK_BUDGET',400);
 const committees=options.committees;
 for(const lane of lanes)for(const cycle of cycles)scopeConfig({lane,cycle,committees,national,perPage});
 return {lanes,cycles,national,committees,perPage,pageBudget,publishBudget,restart:options.restart===true||options.restart==='true'};
}
export async function runResumableMoneyImports(pool, options={}) {
 const config=resumableImportOptions(options);
 const refreshIntervals=moneyRefreshIntervals();
 const apiKey=process.env.FEC_API_KEY||process.env.OPENFEC_API_KEY;
 if(!apiKey)throw importError('FEC_KEY_MISSING',400);
 const request=createFecHttpClient({decodeResponse:async response=>parseFecMoneyJson(await response.text()),classifyErrorResponse:classifyFecPeriodResponse});
 return withMoneyImportLock(pool,async client=>{
  if(!(await client.query('SELECT version FROM resumable_money_storage_version WHERE version=1')).rows.length)throw importError('STORAGE_VERSION_MISMATCH',409);
  const registered=await client.query('SELECT cycle_year FROM election_cycles WHERE is_selectable=TRUE AND cycle_year=ANY($1::int[])',[config.cycles]);
  if(config.cycles.some(c=>!registered.rows.some(r=>Number(r.cycle_year)===c)))throw importError('CYCLE_NOT_SELECTABLE',400);
  const store=new MoneyCheckpointStore(client,{promotePoliticalRecord:promoteResumablePoliticalRecord});
  const results=[];
  for(const cycle of config.cycles){
   for(const lane of config.lanes){
    const scope=scopeConfig({...config,lane,cycle});
    if(config.restart)await store.restart(scope);
    const state=await resumeMoneyLane({store,request,apiKey,config:scope,pageBudget:config.pageBudget,publishBudget:config.publishBudget,refreshIntervals});
    let publishedRecords=0;
    if(state.status==='completed') {
      const sql=lane==='vendors'?'SELECT COUNT(*) AS n FROM money_vendor_snapshots WHERE scan_id=$1'
        :lane==='donors'?'SELECT COUNT(*) AS n FROM money_donor_snapshots WHERE scan_id=$1'
        :'SELECT COUNT(*) AS n FROM political_money_transactions WHERE money_scan_id=$1';
      publishedRecords=Number((await client.query(sql,[state.id])).rows[0]?.n||0);
    }
    results.push({lane,cycle,scope:scope.key,status:state.status,pages:state.pages,staged_records:state.records,published_records:publishedRecords,scan_id:state.id,
      ...(state.status==='not_available_yet'?{availability_reason:'FEC transaction period is not available yet; future runs will recheck. Existing publication preserved.'}:{}),
      ...(state.status==='not_due'?{underlying_status:state.underlyingStatus,next_due_at:state.nextDueAt}:{})});
   }
   const pending=await client.query("SELECT scope_key FROM money_import_checkpoints WHERE lane='political-money' AND cycle=$1 AND needs_scores=TRUE",[cycle]);
   if(pending.rows.length){
    const scores=await rebuildResumableMoneyScores({cycle},client);
    await client.query("UPDATE money_import_checkpoints SET needs_scores=FALSE WHERE lane='political-money' AND cycle=$1",[cycle]);
    results.push({lane:'scores',cycle,...scores});
   }
  }
  return {ok:true,imported:results.reduce((n,r)=>n+(r.published_records||0),0),results,policy:'Budget exhaustion is paused progress, not complete coverage. Partial scans keep previously published data visible.'};
 });
}
