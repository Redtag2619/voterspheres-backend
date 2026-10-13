const hour = 3600000;
export function moneyRefreshIntervals(env = process.env) {
  const defaults={donors:168,vendors:24,'political-money':24,noData:24,unavailable:24};
  const keys={donors:'MONEY_DONORS_REFRESH_HOURS',vendors:'MONEY_VENDORS_REFRESH_HOURS','political-money':'MONEY_POLITICAL_REFRESH_HOURS',noData:'MONEY_EMPTY_RECHECK_HOURS',unavailable:'MONEY_UNAVAILABLE_RECHECK_HOURS'};
  return Object.fromEntries(Object.entries(defaults).map(([name,fallback])=>{
    const n=Number(env[keys[name]]??fallback);
    if(!Number.isFinite(n)||n<1||n>8760)throw Object.assign(new Error('Invalid refresh interval'),{code:'INVALID_MONEY_REFRESH_INTERVAL'});
    return [name,n];
  }));
}
export function moneyRefreshDecision(state,lane,intervals,now=new Date()) {
  if(!state||!['completed','no_data','not_available_yet'].includes(state.status))return {due:true};
  const hours=state.status==='completed'?intervals[lane]:state.status==='no_data'?intervals.noData:intervals.unavailable;
  const timestamp=state.status==='not_available_yet'?state.updatedAt:state.completedAt;
  const previous=Date.parse(timestamp);
  // Missing historical timestamps must never certify freshness.
  if(!Number.isFinite(previous))return {due:true};
  const next=previous+hours*hour;
  return {due:now.getTime()>=next,nextDueAt:new Date(next).toISOString()};
}
export function previewScanRetention(scans,{now=new Date(),minAgeDays=30,keepCompleted=2}={}) {
  if(!Number.isInteger(minAgeDays)||minAgeDays<7||minAgeDays>3650||!Number.isInteger(keepCompleted)||keepCompleted<2||keepCompleted>100)
    throw Object.assign(new Error('Invalid retention policy'),{code:'INVALID_RETENTION_POLICY'});
  const ordered=[...scans].sort((a,b)=>Date.parse(b.completed_at||b.started_at)-Date.parse(a.completed_at||a.started_at)||String(b.id).localeCompare(String(a.id)));
  const ranks=new Map(),cutoff=now.getTime()-minAgeDays*86400000;
  return ordered.map(scan=>{
    const key=JSON.stringify([scan.lane,scan.cycle,scan.scope_key]);
    let rank=null;
    if(scan.status==='completed'){rank=(ranks.get(key)||0)+1;ranks.set(key,rank);}
    let reason;
    if(scan.is_active||scan.is_published)reason='checkpoint_reference';
    else if(!['completed','no_data','abandoned'].includes(scan.status))reason='unfinished_or_unknown_status';
    else if(rank!==null&&rank<=keepCompleted)reason='recent_completed_fallback';
    else if(!Number.isFinite(Date.parse(scan.completed_at||scan.updated_at))||Date.parse(scan.completed_at||scan.updated_at)>=cutoff)reason='within_minimum_age_or_unknown_date';
    else reason='superseded_retention_candidate';
    return {...scan,retention_candidate:reason==='superseded_retention_candidate',protection_reason:reason};
  });
}
