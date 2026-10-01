// Schema-backed operational context. No fallback may drop tenant/workspace predicates.
const CONTACTS=`SELECT c.id, c.full_name AS name, c.full_name AS contact_name,
 c.organization, c.role_type, c.state, c.updated_at
 FROM public.campaign_crm_contacts c
 JOIN public.campaign_workspaces w ON w.id = c.workspace_id AND w.firm_id = c.firm_id
 WHERE c.firm_id = $1 AND c.workspace_id = $2
 AND ($3::text IS NULL OR UPPER(BTRIM(c.state)) = $3)
 ORDER BY c.updated_at DESC NULLS LAST, c.id DESC LIMIT 10`;
const ACTIVITIES=`SELECT a.id, a.title, a.outcome, a.due_at, a.completed_at, a.updated_at,
 c.full_name AS contact_name, c.organization, COALESCE(c.state, w.home_state) AS state,
 CASE WHEN a.completed_at IS NULL THEN a.title ELSE NULL END AS next_step,
 CASE WHEN a.completed_at IS NULL THEN 'pending' ELSE 'completed' END AS status
 FROM public.campaign_crm_activities a
 JOIN public.campaign_workspaces w ON w.id = a.workspace_id AND w.firm_id = a.firm_id
 LEFT JOIN public.campaign_crm_contacts c ON c.id = a.contact_id
 AND c.firm_id = a.firm_id AND c.workspace_id = a.workspace_id
 WHERE a.firm_id = $1 AND a.workspace_id = $2
 AND (a.contact_id IS NULL OR c.id IS NOT NULL)
 AND ($3::text IS NULL OR UPPER(BTRIM(COALESCE(c.state, w.home_state))) = $3)
 ORDER BY a.updated_at DESC NULLS LAST, a.id DESC LIMIT 10`;
const blocked=(source,reason)=>({source,status:'unavailable',reason,scope:'operational',fetched_records:0});
export async function loadOperationalContext({query,firmId,workspaceId,state=null,strictGeography=false}) {
 const coverage=[blocked('Shared Donor Records','tenant_scope_not_established'),blocked('Vendor Network','tenant_scope_not_established')];
 const read=async(source,sql)=>{
  if(!/^[1-9]\d*$/.test(String(firmId))||!Number.isSafeInteger(Number(firmId))||!/^[1-9]\d*$/.test(String(workspaceId))||!Number.isSafeInteger(Number(workspaceId))){coverage.push(blocked(source,'firm_and_workspace_required'));return [];}
  try {
   const result=await query(sql,[Number(firmId),Number(workspaceId),strictGeography?state:null]);
   const rows=Array.isArray(result?.rows)?result.rows:[];
   coverage.push({source,status:rows.length?'available':'empty',reason:null,scope:'firm_workspace_operational',fetched_records:rows.length});
   return rows;
  }catch(error){coverage.push(blocked(source,['42703','42P01'].includes(error?.code)?'schema_incompatible':'query_failed'));return [];}
 };
 const crm=await read('Campaign CRM Contacts',CONTACTS),crmActivities=await read('Campaign CRM Activities',ACTIVITIES);
 return {donors:[],vendors:[],crm,crmActivities,coverage};
}
export function describeContextCoverage(coverage=[],context={}) {
 const counts={'Shared Donor Records':context.donors?.length||0,'Vendor Network':context.vendors?.length||0,
 'Campaign CRM Contacts':context.crm_contacts?.length||0,'Campaign CRM Activities':context.crm_activities?.length||0};
 return coverage.map(x=>({...x,supplied_records:counts[x.source]||0}));
}
export function planningSourceLabel(context={}) {
 const cycle=(context.tasks?.length||0)+(context.recommendations?.length||0)+(context.threats?.length||0)+(context.reports?.length||0)+(context.workspace?1:0);
 if(cycle)return 'Selected-cycle platform context supplied; individual claims are not independently verified';
 const operational=(context.crm_contacts?.length||0)+(context.crm_activities?.length||0)+(context.donors?.length||0)+(context.vendors?.length||0);
 return operational?'Assumption-based planning with operational context; no verified selected-cycle evidence':'Assumption-based planning; no supplied selected-cycle evidence or live research';
}
export function withPlanningSourceLabel(answer='',label='') {
 const parts=String(answer).split(/(```[\s\S]*?```)/g);
 const text=parts.map((part,index)=>index%2?part:part.replace(/^\s*[*_]*Source label(?: for this answer)?\s*:[^\n]*$/gim,'')).join('').trimEnd();
 return text+'\n\nSource label: '+label+'.';
}
