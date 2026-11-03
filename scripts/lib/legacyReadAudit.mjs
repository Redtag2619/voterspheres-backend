import {createHash} from 'node:crypto';
export function optionsFromArgs(args) {
  const options={cycle:2026,limit:100,firmName:'',firmId:'',output:''};
  for(const arg of args){
    const match=/^--(cycle|limit|firm-name|firm-id|output)=(.+)$/.exec(arg);
    if(!match)throw Object.assign(new Error('Only read-only diagnostic options are supported.'),{code:'INVALID_READ_AUDIT_OPTION'});
    const key={'firm-name':'firmName','firm-id':'firmId'}[match[1]]||match[1]; options[key]=match[2];
  }
  options.cycle=Number(options.cycle);options.limit=Number(options.limit);
  if(!Number.isInteger(options.cycle)||options.cycle<2000||options.cycle>2200||options.cycle%2)throw Object.assign(new Error(),{code:'INVALID_CYCLE'});
  if(!Number.isInteger(options.limit)||options.limit<1||options.limit>200)throw Object.assign(new Error(),{code:'INVALID_ROW_LIMIT'});
  if(Boolean(options.firmName)===Boolean(options.firmId))throw Object.assign(new Error(),{code:'EXACT_FIRM_REQUIRED'});
  if(options.firmId&&!/^\d+$/.test(options.firmId))throw Object.assign(new Error(),{code:'INVALID_FIRM_ID'});
  return options;
}
export async function boundedRead(client,sql,params=[]){
  if(!/^\s*(SELECT|WITH|EXPLAIN)\b/i.test(sql))throw Object.assign(new Error(),{code:'NON_READ_STATEMENT_REJECTED'});
  await client.query('SAVEPOINT legacy_read_probe');
  const started=performance.now();
  try{
    const result=await client.query(sql,params);
    await client.query('RELEASE SAVEPOINT legacy_read_probe');
    return {ok:true,elapsed_ms:Math.round(performance.now()-started),row_count:result.rowCount??result.rows.length,rows:result.rows};
  }catch(error){
    // A timed-out query aborts the transaction until this savepoint is restored.
    await client.query('ROLLBACK TO SAVEPOINT legacy_read_probe');
    await client.query('RELEASE SAVEPOINT legacy_read_probe');
    return {ok:false,elapsed_ms:Math.round(performance.now()-started),code:String(error.code||'READ_FAILED')};
  }
}
export function safeTiming(name,result,sql){return {name,ok:result.ok,elapsed_ms:result.elapsed_ms,row_count:result.row_count??null,code:result.code||null,query_sha256:createHash('sha256').update(sql.replace(/\s+/g,' ').trim()).digest('hex')};}
export function classifyRecord(row){
  const title=String(row.title||'');
  const explicitPrefix=/^(AI TACTICAL ACCEPTANCE|UEI ACCEPTANCE|PRODUCTION.*(?:SMOKE|TEST)|TENANT.*SMOKE)/i.test(title);
  return {...row,review_classification:explicitPrefix?'explicit_test_title_marker':'possible_test_marker',
    caution:row.negative_case_marker?'Negative-test wording is a review signal, not proof of a current authorization bypass.':null,
    deletion_authorized:false};
}
export const taskCandidateSql=`
SELECT t.id::text AS task_id,
       LEFT(COALESCE(to_jsonb(t)->>'title',''),180) AS title,
       to_jsonb(t)->>'status' AS status,
       to_jsonb(t)->>'source' AS source,
       to_jsonb(t)->>'workspace_id' AS workspace_id,
       CASE WHEN to_jsonb(w)->>'firm_id' = to_jsonb(t)->>'firm_id' THEN to_jsonb(w)->>'name' ELSE NULL END AS workspace_name,
       CASE WHEN to_jsonb(w)->>'firm_id' = to_jsonb(t)->>'firm_id' THEN to_jsonb(w)->>'status' ELSE NULL END AS workspace_status,
       COALESCE(to_jsonb(t)->>'created_by',to_jsonb(t)->>'user_id') AS creator_id,
       to_jsonb(t)->>'created_at' AS created_at,
       to_jsonb(t)->>'updated_at' AS updated_at,
       (w.id IS NULL AND NULLIF(to_jsonb(t)->>'workspace_id','') IS NOT NULL) AS missing_workspace_reference,
       (w.id IS NOT NULL AND to_jsonb(w)->>'firm_id' IS DISTINCT FROM to_jsonb(t)->>'firm_id') AS workspace_firm_mismatch,
       (COALESCE(to_jsonb(t)->>'title','') || ' ' || COALESCE(to_jsonb(t)->>'description','')) ~* '(must never be created|invalid workspace|archived workspace)' AS negative_case_marker,
       CASE WHEN jsonb_typeof(to_jsonb(t)->'metadata')='object' THEN
         jsonb_build_object('test_run_id',to_jsonb(t)->'metadata'->>'test_run_id','test_case',to_jsonb(t)->'metadata'->>'test_case','acceptance_test',to_jsonb(t)->'metadata'->>'acceptance_test')
       ELSE NULL END AS test_metadata
FROM public.tasks t
LEFT JOIN public.workspaces w ON w.id::text = to_jsonb(t)->>'workspace_id'
WHERE to_jsonb(t)->>'firm_id' = $1
  AND (COALESCE(to_jsonb(t)->>'title','') || ' ' || COALESCE(to_jsonb(t)->>'description','') || ' ' || COALESCE(to_jsonb(t)->>'source',''))
      ~* '(acceptance|smoke[ _-]?test|must never be created|production[ _-]+.*test)'
ORDER BY COALESCE(to_jsonb(t)->>'created_at','') DESC, t.id::text
LIMIT $2`;
export function benchmarkQueries(cycle){return [
 {name:'fundraising_top_25',params:[cycle,25],sql:fundraisingSql},
 {name:'fundraising_top_250',params:[cycle,250],sql:fundraisingSql},
 {name:'fundraising_map_top_1000',params:[cycle,1000],sql:fundraisingSql},
 {name:'executive_feed_25',params:[25],sql:'SELECT id,event_type,severity,title,source,state,office,risk,candidate_name,candidate_id,vendor_id,metadata,created_at FROM public.executive_feed_events ORDER BY created_at DESC,id DESC LIMIT $1'},
 {name:'vendors_25',params:[25],sql:'SELECT * FROM public.vendors ORDER BY id DESC LIMIT $1'},
 {name:'consultants_25',params:[25],sql:'SELECT * FROM public.consultants ORDER BY id DESC LIMIT $1'},
 {name:'published_donors_25',params:[cycle,25],sql:'SELECT * FROM public.donors_read WHERE cycle=$1 ORDER BY source_updated_at DESC NULLS LAST,id DESC LIMIT $2'},
 {name:'mailops_events_25',params:[25],sql:'SELECT * FROM public.mailops_events ORDER BY event_time DESC NULLS LAST,id DESC LIMIT $1'},
 {name:'legacy_mail_ops_events_25',params:[25],sql:'SELECT * FROM public.mail_ops_events ORDER BY id DESC LIMIT $1'}
];}
const fundraisingSql=`SELECT candidate_id,name,state,office,district,party,COALESCE(receipts,0)::numeric AS receipts,COALESCE(cash_on_hand,0)::numeric AS cash_on_hand,coverage_end_date,election_year,source,source_updated_at,source_payload,created_at,updated_at FROM public.fundraising_live WHERE election_year=$1 ORDER BY COALESCE(receipts,0)::numeric DESC NULLS LAST,COALESCE(cash_on_hand,0)::numeric DESC NULLS LAST,name ASC LIMIT $2`;
