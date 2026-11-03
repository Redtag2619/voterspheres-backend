import {AsyncLocalStorage} from 'node:async_hooks';
const scopes = new AsyncLocalStorage();
function sourceFor(sql) {
  if(sql.startsWith('/* donors_read dashboard v1 */')) return {name:'donors',limit:25};
  for (const [table,name,limit] of [['fundraising_live','fundraising',1000],['executive_feed_events','executive_feed',25],['vendors','vendors',25],['consultants','consultants',25],['donors_read','donors',25],['mailops_events','mailops',25],['mail_ops_events','legacy_mailops',25]]) {
    if (new RegExp('\\bFROM\\s+(?:public\\.)?'+table+'\\b','i').test(sql)) return {name,limit};
  }
  return null;
}
export async function dashboardReadQuery(sql, params, query) {
  const scope=scopes.getStore(), source=sourceFor(sql);
  if (!scope || !source || !/LIMIT\s+\$\d+\s*$/i.test(sql.trim())) return query(sql,params);
  const requested=Number(params.at(-1));
  if(!Number.isInteger(requested)||requested<1)return query(sql,params);
  const values=[...params];values[values.length-1]=Math.max(requested,source.limit);
  const key=sql.replace(/\s+/g,' ').trim()+'\n'+JSON.stringify(values);
  if(!scope.cache.has(key)){
    // Store the pending promise before another branch can ask for the same rows.
    const pending=Promise.resolve().then(()=>query(sql,values)).then(result=>{
      scope.sources.set(key,{source:source.name,status:result.rows.length?'available':'empty',rows_read:result.rows.length,code:null});
      return result;
    },error=>{
      const code=/^[A-Z0-9_]{1,50}$/.test(String(error.code||''))?String(error.code):'SOURCE_READ_FAILED';
      scope.sources.set(key,{source:source.name,status:'error',rows_read:null,code});throw error;
    });
    scope.cache.set(key,pending);
  }
  const result=await scope.cache.get(key);
  const rows=result.rows.slice(0,requested);
  return {...result,rows,rowCount:rows.length};
}
export function withDashboardReads(work) {
  return scopes.run({cache:new Map(),sources:new Map()},async()=>{
    const payload=await work();
    const source_status=[...scopes.getStore().sources.values()];
    const failed=source_status.filter(item=>item.status==='error');
    const available=source_status.some(item=>item.status!=='error');
    const data_status=failed.length?(available?'degraded':'unavailable'):(source_status.some(item=>item.status==='available')?'ready':'empty');
    return {...payload,ok:failed.length===0,degraded:failed.length>0,data_status,source_status,
      ...(failed.some(item=>item.source==='fundraising')?{metrics:(payload.metrics || []).map(metric=>({...metric,value:'Unavailable',delta:'Financial source unavailable',tone:'down'}))}:{})};
  });
}
