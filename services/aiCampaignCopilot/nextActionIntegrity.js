// Advisory date comparisons only. Never invent missing primary dates or rewrite output.
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH = MONTHS.join('|');
const YEAR = '\\d{4}';
const DATE = new RegExp(`\\b(${YEAR})-(\\d{2})-(\\d{2})\\b|\\b(${MONTH})\\s+(\\d{1,2}),?\\s+(${YEAR})\\b|\\bQ([1-4])\\s+(${YEAR})\\b|\\b(${MONTH})\\s+(${YEAR})\\b`, 'gi');
function day(year, month, date) {
 const value=Date.UTC(year,month,date),check=new Date(value);
 return check.getUTCFullYear()===year&&check.getUTCMonth()===month&&check.getUTCDate()===date?value:null;
}
export function explicitDateWindows(value='') {
 const result=[];
 for(const match of String(value).matchAll(DATE)) {
  let year,month,start,end;
  if(match[1]){year=Number(match[1]);month=Number(match[2])-1;start=end=day(year,month,Number(match[3]));}
  else if(match[4]){year=Number(match[6]);month=MONTHS.indexOf(match[4].toLowerCase());start=end=day(year,month,Number(match[5]));}
  else if(match[7]){year=Number(match[8]);month=(Number(match[7])-1)*3;start=day(year,month,1);end=Date.UTC(year,month+3,1)-86400000;}
  else{year=Number(match[10]);month=MONTHS.indexOf(match[9].toLowerCase());start=day(year,month,1);end=Date.UTC(year,month+1,1)-86400000;}
  result.push({text:match[0],start,end,valid:start!==null&&end!==null});
 }
 return result;
}
export function nextActionDateIssues(title='',fields={},scope={}) {
 if(!scope.strict_temporal)return [];
 const issues=[],cycle=Number(scope.cycle_year),dates=explicitDateWindows(fields['next actions']||'');
 const timing=explicitDateWindows(fields.timing||'').filter(x=>x.valid);
 const add=reason=>issues.push({milestone:title,field:'next actions',reason});
 const current=/^\d{4}-\d{2}-\d{2}$/.test(scope.current_date||'')?explicitDateWindows(scope.current_date)[0]:null;
 const last=Number.isInteger(cycle)&&cycle>=2026&&cycle<=2200?Date.UTC(cycle,11,31):null;
 const postReview=/post[- ]election.*(?:review|analysis|report|debrief)|(?:review|analysis|debrief).*post[- ]election/i.test(title);
 for(const date of dates) {
  if(!date.valid){add(`Invalid calendar date in Next Actions: ${date.text}`);continue;}
  if(current?.valid&&date.end<current.start)add(`Next Actions date ${date.text} precedes the planning date ${scope.current_date}`);
  if(last!==null&&date.start>last)add(`Next Actions date ${date.text} falls after selected cycle ${cycle}`);
  if(timing.length&&date.start>Math.max(...timing.map(x=>x.end)))add(`Next Actions date ${date.text} falls after this milestone's Timing window (${fields.timing})`);
  // Early logistics preparation is valid for execution milestones. Review/debrief work,
  // however, cannot finish before the declared post-election review window.
  if(postReview&&timing.length&&date.end<Math.min(...timing.map(x=>x.start))) {
   const work=fields['next actions']||'';
   if(!(/\b(?:reserve|book)\b.*\b(?:room|venue|space)\b/i.test(work) && !/\b(?:conduct|complete|analy[sz]e|evaluate|debrief|report)\b/i.test(work)))add(`Post-election review/debrief deadline ${date.text} precedes its declared review window (${fields.timing}); schedule review work after the general election`);
  }
 }
 return issues;
}
export function nextActionInstructions() {
 return 'Keep Next Actions dates within the allowed planning window and no later than the milestone completion window. Earlier logistical preparation may support a later execution milestone. Post-election results analysis and debrief work must follow the general election and align with the declared review window. Do not schedule a 2030 post-election debrief in 2029. If a primary schedule is unconfirmed, use contingent or relative briefing deadlines pending official confirmation.';
}
