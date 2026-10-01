import { parsePlanningMilestones, isFullTimelineRequest, timelineCompletenessViolations as baseCompleteness } from './planningIntegrity.js';

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const EXACT = /\b(?:20\d{2}|21\d{2}|2200)-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:20\d{2}|21\d{2}|2200)\b/i;
const PENDING = /\bpending official confirmation\b/i;
function dates(text) {
 const hits=[];
 const re=/\b(20\d{2}|21\d{2}|2200)-(\d{2})-(\d{2})\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:(\d{1,2}),?\s+)?(20\d{2}|21\d{2}|2200)\b/gi;
 for(const m of String(text).matchAll(re)) {
  const year=Number(m[1]||m[6]),month=m[2]?Number(m[2])-1:MONTHS.indexOf(m[4].toLowerCase()),day=Number(m[3]||m[5]||1);
  const start=Date.UTC(year,month,day),d=new Date(start);
  if(month<0||month>11||d.getUTCFullYear()!==year||d.getUTCMonth()!==month||d.getUTCDate()!==day)continue;
  hits.push({year,month,start,exact:Boolean(m[3]||m[5]),end:(m[3]||m[5])?start:Date.UTC(year,month+1,0)});
 }
 return hits;
}
function phased(answer) {
 // Stack headings to inherit only the owning phase; sibling headings cannot leak phase labels.
 const normalized=String(answer).replace(/\r\n/g,'\n').replace(/[ \t]+(?=#{1,6}\s)/g,'\n');
 const stack=[],out=[];
 for(const block of normalized.split(/\n(?=\s*#{1,6}\s)/)) {
  const head=block.match(/^\s*(#{1,6})\s+([^\n]*)/);
  if(head&&!/^(?:Timing|Owner|Priority|Actions|Next Actions|Metrics|Risks)\b/i.test(head[2].replace(/\*/g,''))) {
   const depth=head[1].length;while(stack.length&&stack.at(-1).depth>=depth)stack.pop();
   const title=head[2].replace(/\*/g,'');
   const own=/^\s*(?:campaign )?overview\b/i.test(title)?null:/\bgeneral[- ]election\b/i.test(title)?'general':/\bprimary\b/i.test(title)?'primary':null;
   stack.push({depth,phase:own||stack.at(-1)?.phase||null});
  }
  for(const item of parsePlanningMilestones(block)) {
   const explicit=/^\s*(?:campaign )?overview\b/i.test(item.title)?null:/\bgeneral[- ]election\b/i.test(item.title)?'general':/\bprimary\b/i.test(item.title)?'primary':null;
   out.push({...item,phase:explicit||stack.at(-1)?.phase||null});
  }
 }
 return out;
}
export function electionPhaseViolations(answer='',prompt='',scope={}) {
 if(!scope.strict_temporal)return [];
 const cycle=Number(scope.cycle_year);if(!Number.isInteger(cycle))return ['Selected election year is missing'];
 const full=isFullTimelineRequest(prompt),items=phased(answer),issues=[];
 let primary=false,primaryPending=false,general=false,gotv=false,day=false,review=false;
 for(const item of items) {
  const {title,timing,phase,preparation}=item;
  if(phase==='primary') {
   primary=true;
   if(PENDING.test(title+' '+timing))primaryPending=true;
   // No authoritative primary calendar is supplied to this boundary. A label cannot validate an invented day.
   const ownsTiming = Boolean(timing && timing !== title);
   const datedElectionTitle = EXACT.test(title) && /\b(?:primary election|election[- ]day|gotv|early voting|filing|deadline)\b/i.test(title);
   if(/\b(?:election|voting|gotv|filing|deadline|primary)\b/i.test(title) && !preparation && (ownsTiming || datedElectionTitle)) {
    if(EXACT.test(title+' '+timing)||dates(title+' '+timing).length||!PENDING.test(title+' '+timing))issues.push(`Primary election timing must say "pending official confirmation" without a specific date: ${title}`);
   }
  }
  if(phase!=='general'||preparation)continue;
  general=true;
  const years=[...timing.matchAll(/\b(20\d{2}|21\d{2}|2200)\b/g)].map(m=>Number(m[1]));
  const ds=dates(timing),valid=years.length&&years.every(y=>y===cycle)&&ds.length&&ds.every(d=>d.year===cycle);
  if(/\b(?:gotv|get[- ]out[- ]the[- ]vote)\b/i.test(title)&&valid)gotv=true;
  if(/\belection[- ]day (?:operations|execution|deployment|logistics)\b/i.test(title)&&valid) {
   const firstMonday=1+(8-new Date(Date.UTC(cycle,10,1)).getUTCDay())%7;
   const election=Date.UTC(cycle,10,firstMonday+1);
   if(ds.every(d=>d.month===10 && (!d.exact || d.start===election)))day=true;
   else if(ds.every(d=>d.month===10))issues.push(`Exact general-election Election Day date conflicts with the federal November calendar in ${cycle}; use November ${cycle} pending verification: ${title}`);
   else issues.push(`General-election Election Day operations must use November ${cycle}, not a primary-election date: ${title}`);
  }
  if(/\bpost[- ]election (?:review|analysis|reporting|debrief)\b/i.test(title)&&valid) {
   // December is unambiguously after the November general election. November needs an explicit date after the statutory day.
   const firstMonday=1+(8-new Date(Date.UTC(cycle,10,1)).getUTCDay())%7;
   const election=Date.UTC(cycle,10,firstMonday+1);
   if(ds.every(d=>d.start>election))review=true;
   else issues.push(`Post-election review must occur after the November ${cycle} general election: ${title}`);
  }
 }
 if(full) {
  if(!primary||!primaryPending)issues.push('Full timeline requires a separate primary-election phase with timing pending official confirmation');
  if(!general)issues.push('Full timeline requires a separate general-election phase');
  if(!gotv)issues.push(`Full timeline requires general-election GOTV execution with explicit month/year timing in ${cycle}`);
  if(!day)issues.push(`Full timeline requires general-election Election Day operations in November ${cycle}`);
  if(!review)issues.push(`Full timeline requires a post-election review dated after the general election in ${cycle}`);
 }
 return [...new Set(issues)];
}
export function timelineCompletenessViolations(answer='',prompt='',scope={}) {
 return [...new Set([...baseCompleteness(answer,prompt,scope),...electionPhaseViolations(answer,prompt,scope)])];
}
