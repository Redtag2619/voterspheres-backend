import { planningSourceLabel } from './contextCoverage.js';
import { nextActionDateIssues, nextActionInstructions } from './nextActionIntegrity.js';
import { isFullTimelineRequest } from './planningIntegrity.js';

export function normalizeDeliverableMarkdown(value='') {
 const parts=String(value).replace(/\r\n/g,'\n').split(/(```[\s\S]*?```)/g);
 return parts.map((part,index)=>index%2?part:part
  .replace(/\\n(?=\\n|\s*(?:#{1,6}\s|Cycle evidence assessment:))/g,'\n')
  .replace(/\\n(?=\n)/g,'\n')
  .replace(/[ \t]+(?=#{1,6}\s)/g,'\n\n')
  .replace(/(^|\n)(#{1,6}\s+(?:Overview|Assumptions|Conclusion|Next Actions|Metrics for Success|Risks))\s+(?=[A-Z0-9])/g,'$1$2\n\n')
  .replace(/[ \t]+---[ \t]+/g,'\n\n---\n\n')
  .replace(/(?<!-)[ \t]+(?=(?:-\s*)?\*\*(?:Owner|Priority|Timing|Actions|Next Actions|Risks|Metrics)\s*:\*\*)/gi,'\n')
  .replace(/[ \t]+(?=-\s*\*{0,2}(?:Owner|Priority|Timing|Actions|Next Actions|Risks|Metrics)\b)/gi,'\n')
 ).join('').trim();
}
export function qualityInstructions() {
 return nextActionInstructions() + ' For full timelines, give every actionable milestone its own Owner, Timing, Actions, Risks, Metrics and Next Actions fields. Actions must describe concrete work rather than repeat the heading. Metrics must identify observable measurements; do not invent achieved results or unsupported numeric targets. Next Actions must identify an executable first step. A global risks or metrics section does not substitute for milestone fields. For primary operations include schedule-confirmation work, a contingent logistics checklist and readiness checks without inventing primary dates. Mark proposed roles, targets and resources as assumptions. Split broad preparation workstreams into separately owned and dated milestones rather than one phase with a long action list. While the primary schedule is pending official confirmation, express primary briefing and operational readiness deadlines relative to the confirmed schedule without inventing fixed dates. Use real Markdown line breaks, one heading per milestone, and separate field lines.';
}
export function assessDeliverableQuality(answer='',prompt='',scope={}) {
 if(!isFullTimelineRequest(prompt) && !(/\b(?:strategy|plan|gotv)\b/i.test(prompt) && /(?:^|\n)#{1,6}\s/m.test(answer) && /\bTiming\s*:/i.test(answer)))return {status:'not_applicable',milestones:0,issues:[]};
 const text=normalizeDeliverableMarkdown(answer),blocks=text.split(/\n(?=\s*#{1,6}\s)/),issues=[];
 let count=0;
 for(const block of blocks) {
  const title=block.split('\n')[0].replace(/[#*]/g,'').trim();
  if(!/^\s*(?:-\s*)?\*{0,2}Timing\b/im.test(block))continue;
  count++;
  const fields={};
  for(const m of block.matchAll(/^\s*(?:-\s*)?\*{0,2}(Owner|Timing|Actions|Next Actions|Risks|Metrics)\s*:?\*{0,2}\s*:?\s*([\s\S]*?)(?=\n\s*(?:-\s*)?\*{0,2}(?:Owner|Timing|Actions|Next Actions|Risks|Metrics)\b|(?![\s\S]))/gim))fields[m[1].toLowerCase()]=m[2].trim();
  issues.push(...nextActionDateIssues(title,fields,scope));
  if(/\bpreparation\b/i.test(title)) {
   const actions=fields.actions||'';
   const numbered=[...actions.matchAll(/(?:^|\s)\d+\.\s/g)].length;
   if(numbered>=6)issues.push({milestone:title,field:'actions',reason:'Preparation groups six or more actions under one timing field; split workstreams into separately owned and dated milestones'});
  }
  const primaryPending=/\bprimary\b/i.test(title)&&/pending official confirmation/i.test(text);
  if(primaryPending) {
   for(const name of ['timing','next actions']) {
    const fixed=fields[name]?.match(/\b20\d{2}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}\b/gi);
    if(fixed?.length && /brief|readiness|election day|polling|deploy/i.test(title+' '+fields[name]))issues.push({milestone:title,field:name,reason:'Unsupported fixed primary operations deadline ('+fixed.join(', ')+'); make the briefing/readiness deadline relative to the confirmed primary schedule, pending official confirmation'});
   }
  }
  for(const name of ['owner','timing','actions','risks','metrics','next actions'])if(!fields[name])issues.push({milestone:title,field:name,reason:'Missing milestone field'});
  for(const name of ['actions','metrics','next actions']) {
   const value=(fields[name]||'').replace(/^(?:\d+\.|-)\s*/,'').trim();
   if(value&& (value.length<24||/^(?:final general-election mobilization|general-election operations|evaluate general-election results|(?:prepare for )?primary operations contingent on (?:the )?confirmed official schedule)\.?$/i.test(value)))issues.push({milestone:title,field:name,reason:'Expand this generic statement into concrete work or an observable measurement'});
  }
 }
 if(!count)issues.push({milestone:'Timeline',field:'milestones',reason:'No milestones with individual timing fields detected'});
 return {status:issues.length?'needs_review':'complete',milestones:count,issues};
}
const SOURCES=[['Mission Control','tasks'],['Strategic Advisor','recommendations'],['Election War Room','threats']];
export function describePlanningEvidence(context={},modelConfidence=null) {
 const supplied=[];
 for(const [source,key]of SOURCES) {
  const rows=Array.isArray(context[key])?context[key]:[];
  if(rows.length)supplied.push({source,scope:'selected_cycle_context',context_entries:rows.length});
 }
 if(context.reports?.length)supplied.push({source:'Intelligence Reports',scope:'selected_cycle_context',context_entries:context.reports.length});
 if(context.workspace)supplied.push({source:'Campaign Workspace',scope:'selected_cycle_context',context_entries:1});
 for(const [name,key]of [['Shared Donor Records','donors'],['Vendor Network','vendors'],['Campaign CRM','crm_followups']])if(context[key]?.length && !(key==='crm_followups' && context.crm_activities?.length))supplied.push({source:name,scope:'shared_operational_context',context_entries:context[key].length});
 for(const [source,key] of [['Campaign CRM Contacts','crm_contacts'],['Campaign CRM Activities','crm_activities']])if(context[key]?.length)supplied.push({source,scope:'firm_workspace_operational_context',context_entries:context[key].length});
 const selected=supplied.filter(x=>x.scope==='selected_cycle_context');
 return {context_coverage:context.context_coverage||[],source_label:planningSourceLabel(context),coverage_limitation:'Coverage covers donor, vendor and CRM retrieval only; other platform providers are not audited by this field.',status:selected.length?'selected_cycle_context_supplied':'assumption_based',selected_cycle:context.scope?.cycle_year??null,sources_supplied:supplied,source_usage:'Context supplied to the generator; individual claim attribution is not established',live_research_connected:false,confidence_status:'not_calibrated',model_reported_confidence:Number.isFinite(modelConfidence)?modelConfidence:null,limitation:'Matching cycle metadata does not independently verify factual claims. Available integrations and requested sources are not evidence of retrieval.'};
}
