import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {electionMilestoneViolations as violations,withCycleEvidenceAssessment as decorate,timelineCompletenessViolations as completeness} from '../services/aiCampaignCopilot/planningIntegrity.js';
const scope={strict_temporal:true,cycle_year:2030};
const gotv=year=>`### 10. Execute Get-Out-The-Vote (GOTV) Strategy\n- **Timing:** September ${year} - November ${year}\n- **Next Actions:** Mobilize volunteers.`;
test('reported 2029 GOTV defect is rejected for 2030',()=>assert.ok(violations(gotv(2029),scope).length));
test('selected-cycle execution is accepted',()=>assert.deepEqual(violations(gotv(2030),scope),[]));
test('early GOTV preparation remains valid',()=>assert.deepEqual(violations('### Prepare GOTV training\n- **Timing:** September 2029\nDevelop a volunteer training plan.',scope),[]));
test('preparation in another action never exempts execution',()=>assert.ok(violations('### Preparation\nTraining in 2029\n'+gotv(2029),scope).length));
test('standalone wrong-year election operations fail',()=>assert.ok(violations('Election Day operations: November 2029.',scope).length));
test('exact election date must be labeled for verification',()=>assert.ok(violations('### Election Day Operations\n- **Timing:** November 5, 2030',scope).length));
test('provisional election date is accepted with verification label',()=>assert.deepEqual(violations('### Election Day Operations\n- **Timing:** November 5, 2030 (provisional; verify)',scope),[]));
test('non-strict requests preserve prior behavior',()=>assert.deepEqual(violations(gotv(2029),{}),[]));
test('duplicate headings and inline assessments become one canonical assessment',()=>{
 const answer='Plan\n### Cycle Evidence Assessment\nLLM claim\n\nCycle evidence assessment: duplicate';
 const result=decorate(answer,{matched_records:0});assert.equal((result.match(/cycle evidence assessment/gi)||[]).length,1);assert.ok(!result.includes('LLM claim'));assert.ok(result.startsWith('Plan'));
});
test('later substantive sections survive assessment replacement',()=>assert.ok(decorate('Plan\n### Cycle Evidence Assessment\nclaim\n## Next actions\nKeep this',{}).includes('Keep this')));
test('canonical assessment is idempotent and inputs remain immutable',()=>{const evidence=Object.freeze({matched_records:2});const first=decorate('Plan',evidence);assert.equal(decorate(first,evidence),first);assert.ok(first.includes('context is available'));});
test('installed temporal wrapper combines original date guard and milestone guard',()=>{
 const source=fs.readFileSync(new URL('../services/aiCampaignCopilot.service.js',import.meta.url),'utf8');
 const body=source.match(/function temporalViolations\(answer = "", temporalScope = \{\}\) \{([\s\S]*?)\n\}/)?.[0];assert.ok(body);
 const context={electionMilestoneViolations:violations};vm.createContext(Object.assign(context, { process: { env: {} } }));vm.runInContext(body+'; this.check=temporalViolations;',context);
 assert.ok(context.check(gotv(2029),{...scope,current_year:2026}).length);
 assert.ok(context.check('Timing: October 2032',{...scope,current_year:2026}).length);
 assert.equal(context.check(gotv(2030),{...scope,current_year:2026}).length,0);
});
test('nested Timing subheading stays with its execution action',()=>assert.ok(violations('## Execute GOTV Strategy\n### Priority\nHigh\n### Timing\nSeptember 2029 - November 2029\n### Risks\nReview required',scope).length));
test('repair output receives exactly one canonical evidence assessment',async()=>{
 const source=fs.readFileSync(new URL('../services/aiCampaignCopilot.service.js',import.meta.url),'utf8');
 const start=source.indexOf('  answer = generated.answer;');const end=source.indexOf('  confidence = generated.confidence ??',start);assert.ok(start>0&&end>start);
 const context={generated:{answer:gotv(2029)},platformContext:{scope:{cycle_evidence:{matched_records:0}}},prompt:'plan',temporalScope:scope,isPlanningRequest:()=>true,temporalViolations:violations,withCycleEvidenceAssessment:decorate,timelineCompletenessViolations:completeness,repairTemporalAnswer:async()=>gotv(2030)+'\n### Cycle Evidence Assessment\nUntrusted assessment'};
 vm.createContext(Object.assign(context, { process: { env: {} } }));const result=await vm.runInContext('(async()=>{let answer;'+source.slice(start,end)+';return answer;})()',context);
 assert.equal((result.match(/cycle evidence assessment/gi)||[]).length,1);assert.ok(!result.includes('Untrusted assessment'));assert.ok(result.includes('2030'));
});
test('reported parenthesized GOTV Campaign rejects 2028 in a 2030 plan',()=>{
 const draft='### 2. Execution Phase\n#### C. GOTV (Get Out The Vote) Campaign\n- **Priority**: High\n- **Owner**: GOTV Coordinator\n- **Timing**: Q3 2028 (July - September 2028)\n- **Next Actions**: Mobilize volunteers for GOTV efforts.\n#### D. Election Day Operations\n- **Timing**: November 5, 2030 (Provisional Election Date)';
 assert.ok(violations(draft,scope).some(x=>x.includes('selected cycle 2030')));
});
test('parenthesized GOTV Campaign accepts execution in 2030',()=>assert.deepEqual(violations('#### C. GOTV (Get Out The Vote) Campaign\n- **Timing**: Q3 2030 (July - September 2030)',scope),[]));
test('plain GOTV campaign and full phrase cannot evade the guard',()=>{
 for(const title of ['GOTV Campaign','Get Out The Vote Campaign','Get-Out-The-Vote Campaign'])assert.ok(violations('#### '+title+'\n- **Timing**: September 2028',scope).length);
});
test('GOTV campaign planning and development remain preparation',()=>{
 for(const title of ['GOTV Campaign Planning','GOTV Campaign Development'])assert.deepEqual(violations('#### '+title+'\n- **Timing**: September 2028',scope),[]);
});

const fullPrompt='Create a full campaign timeline';
const completeTimeline='### GOTV Execution\n- **Timing**: October 2030 - November 2030\n### Election Day Operations\n- **Timing**: November 2030 (provisional; verify)';
test('preparation-only full timeline is incomplete',()=>assert.equal(completeness('### Develop GOTV Strategy\nTiming: 2029',fullPrompt,scope).length,2));
test('dated election-year GOTV and Election Day milestones complete the timeline',()=>assert.deepEqual(completeness(completeTimeline,fullPrompt,scope),[]));
test('wrong-year and undated milestones cannot satisfy completeness',()=>{assert.equal(completeness(completeTimeline.replaceAll('2030','2029'),fullPrompt,scope).length,2);assert.equal(completeness('### GOTV Execution\nTiming: final weeks\n### Election Day Operations\nTiming: election day',fullPrompt,scope).length,2);});
test('ordinary plans and preparation requests do not require full execution coverage',()=>{for(const prompt of ['Build a name recognition plan','Create a preparation timeline'])assert.deepEqual(completeness('Preparation',prompt,scope),[]);});
test('timeline requesting preparation GOTV and Election Day requires completeness',()=>assert.equal(completeness('Preparation','Create a timeline with preparation, GOTV and Election Day operations',scope).length,2));
test('non-strict full timelines preserve previous behavior',()=>assert.deepEqual(completeness('Preparation',fullPrompt,{}),[]));
test('actual response pipeline repairs missing election milestones',async()=>{
 const source=fs.readFileSync(new URL('../services/aiCampaignCopilot.service.js',import.meta.url),'utf8');const start=source.indexOf('  answer = generated.answer;');const end=source.indexOf('  confidence = generated.confidence ??',start);
 let repairs=0;const context={generated:{answer:'Preparation only'},platformContext:{scope:{cycle_evidence:{matched_records:0}}},prompt:fullPrompt,temporalScope:scope,isPlanningRequest:()=>true,temporalViolations:violations,withCycleEvidenceAssessment:decorate,timelineCompletenessViolations:completeness,repairTemporalAnswer:async()=>{repairs++;return completeTimeline;}};vm.createContext(Object.assign(context, { process: { env: {} } }));
 const result=await vm.runInContext('(async()=>{let answer;'+source.slice(start,end)+';return answer;})()',context);assert.equal(repairs,1);assert.ok(result.includes('GOTV Execution'));
 context.generated.answer='Preparation only';context.repairTemporalAnswer=async()=> 'Still preparation only';await assert.rejects(vm.runInContext('(async()=>{let answer;'+source.slice(start,end)+';return answer;})()',context),error=>error.statusCode===422&&error.code==='TEMPORAL_SCOPE_VIOLATION');
});
const decimalTimeline = `## Preparation
1.1. **GOTV Preparation** - Owner: Coordinator - Timing: January 2029 - December 2029 - Actions: Train volunteers.
## Execution
2.1. **GOTV Execution** - Owner: Coordinator - Timing: October 2030 - November 2030 - Actions: Deploy volunteers.
2.2. **Election Day Operations** - Owner: Election Day Coordinator - Timing: 2030-11-05 (Election Day, provisional) - Actions: 1. Ensure locations are staffed. 2. Provide assistance. - Metrics: Turnout - Risks: Long lines.`;
test('decimal inline titles accept valid provisional election milestone without borrowing preparation dates',()=>assert.deepEqual(violations(decimalTimeline,scope),[]));
test('decimal inline milestones satisfy completeness',()=>assert.deepEqual(completeness(decimalTimeline,fullPrompt,scope),[]));
test('fully flattened decimal timeline preserves milestone boundaries',()=>{const flat=decimalTimeline.replaceAll('\n',' ');assert.deepEqual(violations(flat,scope),[]);assert.deepEqual(completeness(flat,fullPrompt,scope),[]);});
test('invalid neighboring GOTV dates do not contaminate valid Election Day milestone',()=>{const result=violations(decimalTimeline.replace('October 2030 - November 2030','October 2029 - November 2029'),scope);assert.ok(result.some(x=>x.includes('GOTV Execution')));assert.ok(!result.some(x=>x.includes('Election Day Operations')));});
test('each exact election date needs its own label',()=>{const draft='1.1. GOTV Execution - Timing: 2030-10-20 - Actions: Deploy\n1.2. Election Day Operations - Timing: 2030-11-05 (provisional)';assert.ok(violations(draft,scope).some(x=>x.includes('GOTV Execution')));});
test('provisional marker in same milestone title is accepted',()=>assert.deepEqual(violations('2.2. Election Day Operations (provisional)\n- Timing: 2030-11-05\n- Actions: Review logistics',scope),[]));
test('early voting and post-election execution cannot occur in preceding cycle',()=>{for(const title of ['Early Voting Mobilization','Post-Election Analysis'])assert.ok(violations('2.2. '+title+' - Timing: November 2029 - Risks: Review',scope).some(x=>x.includes('selected cycle 2030')));});
