import {createHash} from 'node:crypto';
export function buildProposal(baseline, live, references, dependencies) {
 const fields=['task_id','title','status','source','workspace_id','created_at','updated_at','creator_id','workspace_status','missing_workspace_reference','workspace_firm_mismatch','negative_case_marker'];
 const expected=new Map(baseline.records.map(row=>[row.task_id,row]));const found=new Map(live.map(row=>[row.task_id,row]));
 const drift=[];
 for(const [id,row] of expected){if(!found.has(id)){drift.push({task_id:id,reason:'missing_or_not_in_reviewed_firm'});continue;}for(const key of fields)if((row[key]??null)!==(found.get(id)[key]??null))drift.push({task_id:id,field:key,reason:'changed_since_review'});}
 for(const id of found.keys())if(!expected.has(id))drift.push({task_id:id,reason:'unreviewed_id'});
 const unknown=references.filter(row=>row.schema_name!=='public'||!['task_activity','task_comments'].includes(row.referencing_table));
 const failed=Object.entries(dependencies).filter(([,value])=>!value.ok).map(([table,value])=>({table,code:value.code}));
 const proposal={mode:'preview_only',firm_id:baseline.firm_id,exact_task_ids:[...expected.keys()].sort((a,b)=>Number(a)-Number(b)),ready_for_manual_review:drift.length===0&&unknown.length===0&&failed.length===0,
  proposed_method:'Separate firm-scoped test-fixture archive registry; retain task rows, statuses, timestamps, activity, comments and assignment audit unchanged. A future reviewed implementation would exclude only registered IDs from operational reads and counts while exposing an explicit administrative history view.',
  mutations_performed:0,deletion_authorized:false,drift,unknown_foreign_keys:unknown,dependency_read_errors:failed,dependencies,
  records:baseline.records.map(row=>({...row,current:found.get(row.task_id)||null,selection_basis:'Exact ID and snapshot from the November 3 reviewed test-record audit; manual confirmation still required',proposed_action:'register_as_historical_test_fixture_without_changing_task'}))};
 return {...proposal,plan_sha256:createHash('sha256').update(JSON.stringify(proposal)).digest('hex')};
}
