import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import { electionPhaseViolations as check, timelineCompletenessViolations as combined } from '../services/aiCampaignCopilot/electionPhaseIntegrity.js';
import { electionMilestoneViolations, withCycleEvidenceAssessment } from '../services/aiCampaignCopilot/planningIntegrity.js';
import { buildPlanningRepairInstructions } from '../services/aiCampaignCopilot/planningRepairInstructions.js';
const scope={strict_temporal:true,cycle_year:2030},prompt='Create a full campaign timeline';
const valid=`## Primary Election Phase (pending official confirmation)
### Primary Election Day Operations
- Timing: 2030; pending official confirmation
## General Election Phase
### GOTV Execution
- Timing: October 2030 - November 2030
### Election Day Operations
- Timing: November 2030 (provisional; verify)
### Post-Election Review
- Timing: December 2030`;
test('separate primary and general phases with pending primary timing are complete',()=>assert.deepEqual(combined(valid,prompt,scope),[]));
test('reported March-only timeline is incomplete',()=>{
 const answer='## Campaign Timeline\n### GOTV Execution Phase (2030)\n#### GOTV Mobilization\nTiming: January - March 2030\n### Election Day Operations (Provisional Date: March 5, 2030)\nTiming: March 5, 2030';
 const issues=check(answer,prompt,scope);assert.ok(issues.some(x=>x.includes('primary-election phase')));assert.ok(issues.some(x=>x.includes('general-election Election Day')));assert.ok(issues.some(x=>x.includes('post-election review')));
});
test('primary execution cannot satisfy general election milestones',()=>{
 const draft=valid.replace('## General Election Phase','## Primary Election Phase (pending official confirmation)');assert.ok(check(draft,prompt,scope).some(x=>x.includes('general-election GOTV')));
});
test('provisional primary day remains rejected',()=>{
 for(const date of ['March 5, 2030 (provisional; pending official confirmation)','2030-03-05 (pending official confirmation)','March 2030; pending official confirmation'])assert.ok(check(valid.replace('2030; pending official confirmation',date),prompt,scope).some(x=>x.includes('without a specific date')));
});
test('primary unknown dates need explicit pending official confirmation',()=>assert.ok(check(valid.replaceAll('pending official confirmation','provisional'),prompt,scope).some(x=>x.includes('Primary election timing'))));
test('primary preparation can have ordinary dates without implying a voting date',()=>assert.deepEqual(check(valid.replace('### Primary Election Day Operations','### Primary Preparation\nTiming: January 2029\n### Primary Election Day Operations'),prompt,scope),[]));
test('general election operations in March cannot pass with provisional label',()=>assert.ok(check(valid.replace('November 2030 (provisional; verify)','March 2030 (provisional; verify)'),prompt,scope).some(x=>x.includes('must use November'))));
test('post-election review cannot occur before or on general Election Day',()=>{
 for(const timing of ['October 2030','2030-11-04','2030-11-05','November 2030','December 2029'])assert.ok(check(valid.replace('December 2030',timing),prompt,scope).some(x=>x.includes('review')));
});
test('post-election review accepts explicit day after general election',()=>assert.deepEqual(check(valid.replace('December 2030','2030-11-06 (provisional; verify)'),prompt,scope),[]));
test('flattened Markdown preserves phase ownership',()=>assert.deepEqual(combined(valid.replaceAll('\n',' '),prompt,scope),[]));
test('sibling phase cannot inherit primary identity',()=>assert.ok(check(valid.replace('## General Election Phase','## Other Phase'),prompt,scope).some(x=>x.includes('general-election phase'))));
test('wrong cycle and preparation-only general GOTV fail coverage',()=>{
 assert.ok(combined(valid.replace('October 2030 - November 2030','October 2028 - November 2028'),prompt,scope).some(x=>x.includes('GOTV')));
 assert.ok(check(valid.replace('### GOTV Execution','### GOTV Preparation'),prompt,scope).some(x=>x.includes('GOTV')));
});
test('non-strict and ordinary requests preserve completeness behavior',()=>{assert.deepEqual(combined('Nothing',prompt,{}),[]);assert.deepEqual(check('Preparation','Make a preparation plan',scope),[]);});
test('repair instructions explicitly separate election phases and pending dates',()=>{
 const text=buildPlanningRepairInstructions({prompt,temporalScope:scope,violations:['missing general election']});assert.match(text,/Primary Election Phase/);assert.match(text,/General Election Phase/);assert.match(text,/pending official confirmation/);assert.match(text,/December 2030/);
});
test('actual service imports combined phase guard and repairs incomplete answer',async()=>{
 const source=fs.readFileSync(new URL('../services/aiCampaignCopilot.service.js',import.meta.url),'utf8');assert.match(source,/import \{ timelineCompletenessViolations \} from "\.\/aiCampaignCopilot\/electionPhaseIntegrity.js"/);
 const start=source.indexOf('  answer = generated.answer;'),end=source.indexOf('  confidence = generated.confidence ??',start);let calls=0;
 const ctx={generated:{answer:'## Primary Election Phase (pending official confirmation)'},platformContext:{scope:{cycle_evidence:{matched_records:0}}},prompt,temporalScope:scope,isPlanningRequest:()=>true,temporalViolations:electionMilestoneViolations,timelineCompletenessViolations:combined,withCycleEvidenceAssessment,repairTemporalAnswer:async({violations})=>{calls++;assert.ok(violations.some(x=>x.includes('general-election')));return valid;}};
 vm.createContext(Object.assign(ctx, { process: { env: {} } }));const code='(async()=>{let answer;'+source.slice(start,end)+';return answer;})()';assert.match(await vm.runInContext(code,ctx),/General Election Phase/);assert.equal(calls,1);
 ctx.generated.answer='Incomplete';ctx.repairTemporalAnswer=async()=> 'Still incomplete';await assert.rejects(vm.runInContext(code,ctx),e=>e.code==='TEMPORAL_SCOPE_VIOLATION'&&e.statusCode===422);
});
test('reported overview and numbered action are not primary milestone timing',()=>{
 const answer='## Campaign Overview - Office: U.S. House - Geography: Texas - Primary Goal: Win the primary election\n'+valid.replace('## General Election Phase','1. Implement a rapid response team for any election day challenges.\n## General Election Phase');
 assert.deepEqual(check(answer,prompt,scope),[]);
});
test('standalone action inside primary phase cannot demand a confirmation label',()=>assert.deepEqual(check(valid.replace('## General Election Phase','1. Support primary election volunteers.\n2. Implement a rapid response team for any election day challenges.\n## General Election Phase'),prompt,scope),[]));
test('reported Primary GOTV fixed date still requires pending-only execution timing',()=>{
 const answer=valid.replace('### Primary Election Day Operations','### Primary GOTV Execution\nTiming: 2030-01-01 to Primary Election Day (pending official confirmation)\n### Primary Election Day Operations');
 const issues=check(answer,prompt,scope);assert.equal(issues.filter(x=>x.includes('Primary GOTV Execution')).length,1);
});
test('repair explicitly supplies the required outline instead of preserving invalid phase layout',()=>{
 const text=buildPlanningRepairInstructions({prompt,temporalScope:scope,violations:['Missing phases']});
 for(const title of ['## Primary Election Phase (pending official confirmation)','## General Election Phase','### General-election GOTV Execution','### General-election Election Day Operations','### General-election Post-Election Review'])assert.ok(text.includes(title));
 assert.match(text,/moving early execution activities to preparation/);assert.ok(text.includes('Timing: December 2030'));
});
test('incorrect exact general Election Day is rejected even with provisional label',()=>{
 assert.ok(check(valid.replace('November 2030 (provisional; verify)','2030-11-03 (provisional; verify)'),prompt,scope).some(x=>x.includes('conflicts with the federal')));
 assert.deepEqual(check(valid.replace('November 2030 (provisional; verify)','2030-11-05 (provisional; verify)'),prompt,scope),[]);
});
test('the actual diagnostic draft is rejected for absent phases and wrong-cycle execution',()=>{
 const answer=fs.readFileSync(new URL('./reportedRejectedTimeline.txt',import.meta.url),'utf8');
 assert.ok(electionMilestoneViolations(answer,scope).some(x=>x.includes('2029')));
 const issues=check(answer,prompt,scope);assert.ok(issues.some(x=>x.includes('primary-election phase')));assert.ok(issues.some(x=>x.includes('general-election phase')));
});
