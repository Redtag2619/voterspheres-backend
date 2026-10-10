export function parseImportCycles(value='2026,2028,2030') {
 const parts=String(value).split(',').map(s=>s.trim());
 if(parts.length>8||!parts.length||parts.some(s=>!/^\d{4}$/.test(s)||Number(s)<2026||Number(s)>2200||Number(s)%2))throw Object.assign(new Error('Invalid import cycles'),{code:'INVALID_IMPORT_CYCLES'});
 return [...new Set(parts.map(Number))].sort((a,b)=>a-b);
}
export async function runCycleImports({cycles,client,sync,onResult=()=>{}}) {
 const results=[];
 for(const cycle of cycles){
  const id=(await client.query("INSERT INTO production_job_runs(job_name,status,summary) VALUES ('fec-sync','running',$1::jsonb) RETURNING id",[JSON.stringify({cycle,coordinator:true})])).rows[0].id;
  try{
   const result=await sync({cycle,syncContacts:false});
   if(result?.ok!==true||!['completed','completed_with_skipped_pac','no_data'].includes(result.status))throw Object.assign(new Error('Incomplete cycle import'),{code:'INCOMPLETE_IMPORT'});
   const status=result.status==='completed'?'complete':'degraded';
   const summary={cycle,status:result.status,fetched:result.fetched,stored:result.fundraising_stored,pac_skipped_candidates:result.pac_skipped_candidates||0,preserved_existing:result.preserved_existing||false};
   await client.query('UPDATE production_job_runs SET status=$2,completed_at=NOW(),summary=$3::jsonb WHERE id=$1',[id,status,JSON.stringify(summary)]);
   results.push(summary);onResult(summary);
  }catch(error){
   await client.query("UPDATE production_job_runs SET status='failed',completed_at=NOW(),summary=$2::jsonb WHERE id=$1",[id,JSON.stringify({cycle,code:error.code||'IMPORT_FAILED'})]).catch(()=>{});
   throw error;
  }
 }
 return results;
}
