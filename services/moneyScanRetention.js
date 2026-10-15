import crypto from 'node:crypto';
import {previewScanRetention} from './moneyStoragePolicy.js';

export const retentionChildren = [
  ['political_money_evidence','money_scan_id'],
  ['political_money_transactions','money_scan_id'],
  ['money_donor_snapshots','scan_id'],
  ['money_vendor_snapshots','scan_id'],
  ['money_import_pages','scan_id'],
  ['money_import_records','scan_id']
];
const fail=code=>Object.assign(new Error(code),{code});
export function retentionOptions(args) {
  const options={apply:false,maxScans:1,maxRows:100000,plan:null};
  const seen=new Set();
  for(const arg of args){
    const [key,...rest]=arg.split('=');const value=rest.join('=');
    if(seen.has(key))throw fail('DUPLICATE_RETENTION_OPTION');seen.add(key);
    if(key==='--apply'&&!rest.length)options.apply=true;
    else if(key==='--max-scans')options.maxScans=Number(value);
    else if(key==='--max-rows')options.maxRows=Number(value);
    else if(key==='--plan'&&/^[a-f0-9]{64}$/.test(value))options.plan=value;
    else throw fail('INVALID_RETENTION_OPTION');
  }
  if(!Number.isInteger(options.maxScans)||options.maxScans<1||options.maxScans>5||
     !Number.isInteger(options.maxRows)||options.maxRows<1||options.maxRows>250000)throw fail('INVALID_RETENTION_BUDGET');
  if(options.apply&&!options.plan)throw fail('PREVIEW_PLAN_REQUIRED');
  return options;
}

export async function inspectRetentionDependencies(client) {
  const managed=['money_import_scans',...retentionChildren.map(([table])=>table)];
  const result=await client.query(`SELECT pn.nspname AS parent_schema,p.relname AS parent_table,
    cn.nspname AS child_schema,c.relname AS child_table,
    array_agg(a.attname::text ORDER BY k.ordinality) AS child_columns
    FROM pg_constraint f JOIN pg_class p ON p.oid=f.confrelid
    JOIN pg_namespace pn ON pn.oid=p.relnamespace
    JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(f.conkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
    WHERE f.contype='f' AND pn.nspname='public' AND p.relname=ANY($1::text[])
    GROUP BY f.oid,pn.nspname,p.relname,cn.nspname,c.relname`,[managed]);
  const allowed=new Set(retentionChildren.map(([t,c])=>`${t}:${c}`));
  allowed.add('money_import_checkpoints:active_scan_id');allowed.add('money_import_checkpoints:published_scan_id');
  for(const row of result.rows){
    if(row.parent_table!=='money_import_scans'||row.child_schema!=='public'||
       row.child_columns.length!==1||!allowed.has(`${row.child_table}:${row.child_columns[0]}`))
      throw fail('UNREVIEWED_RETENTION_DEPENDENCY');
  }
  return result.rows;
}

export async function planMoneyRetention(client,options,now=new Date()) {
  const scans=await client.query(`SELECT s.id,s.lane,s.cycle,s.scope_key,s.status,s.started_at,s.updated_at,s.completed_at,
    EXISTS(SELECT 1 FROM money_import_checkpoints c WHERE c.active_scan_id=s.id) AS is_active,
    EXISTS(SELECT 1 FROM money_import_checkpoints c WHERE c.published_scan_id=s.id) AS is_published,
    EXISTS(SELECT 1 FROM money_import_scope_holds h WHERE h.lane=s.lane AND h.cycle=s.cycle AND h.scope_key=s.scope_key) AS is_held
    FROM public.money_import_scans s`);
  const report=previewScanRetention(scans.rows,{now}).map(row=>row.is_held?
    {...row,retention_candidate:false,protection_reason:'scope_hold'}:row);
  const candidates=report.filter(row=>row.retention_candidate).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const selected=[],deferred=[];let total=0;
  for(const row of candidates.slice(0,20)){
    if(selected.length>=options.maxScans){deferred.push({id:row.id,reason:'scan_budget'});continue;}
    const counts={};let rows=1;
    for(const [table,column] of retentionChildren){
      const result=await client.query(`SELECT COUNT(*)::text AS n FROM public.${table} WHERE ${column}=$1`,[row.id]);
      counts[table]=Number(result.rows[0].n);rows+=counts[table];
    }
    if(!Number.isSafeInteger(rows)||total+rows>options.maxRows){deferred.push({id:row.id,reason:'row_budget',rows});continue;}
    total+=rows;selected.push({id:row.id,lane:row.lane,cycle:row.cycle,scope_key:row.scope_key,counts,rows});
  }
  for(const row of candidates.slice(20))deferred.push({id:row.id,reason:'inspection_budget'});
  const plan=crypto.createHash('sha256').update(JSON.stringify({policy:'30days/latest2/v1',maxScans:options.maxScans,maxRows:options.maxRows,selected})).digest('hex');
  return {plan,selected,deferred,total_rows:total,protected_scans:report.filter(row=>!row.retention_candidate).map(({id,protection_reason})=>({id,protection_reason}))};
}

export async function applyMoneyRetention(client,options) {
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='20s'");
    await client.query('SET LOCAL search_path=public,pg_catalog');
    // Prevent pointer changes, new holds, dependent inserts and DDL while rechecking.
    await client.query(`LOCK TABLE public.money_import_checkpoints,public.money_import_scope_holds,
      public.money_import_scans,${retentionChildren.map(([t])=>`public.${t}`).join(',')}
      IN SHARE ROW EXCLUSIVE MODE`);
    await inspectRetentionDependencies(client);
    const fresh=await planMoneyRetention(client,options);
    if(fresh.plan!==options.plan)throw fail('RETENTION_PLAN_CHANGED_RUN_PREVIEW_AGAIN');
    const began=Date.now();
    for(const scan of fresh.selected){
      for(const [table,column] of retentionChildren){
        if(Date.now()-began>45000)throw fail('RETENTION_RUNTIME_BUDGET');
        const deleted=await client.query(`DELETE FROM public.${table} WHERE ${column}=$1`,[scan.id]);
        if(deleted.rowCount!==scan.counts[table])throw fail('RETENTION_ROW_COUNT_CHANGED');
      }
      const deleted=await client.query('DELETE FROM public.money_import_scans WHERE id=$1',[scan.id]);
      if(deleted.rowCount!==1)throw fail('RETENTION_SCAN_CHANGED');
    }
    await client.query('COMMIT');return fresh;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
