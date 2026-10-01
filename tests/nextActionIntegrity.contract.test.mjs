import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { explicitDateWindows, nextActionDateIssues as check } from '../services/aiCampaignCopilot/nextActionIntegrity.js';
import { assessDeliverableQuality as assess, qualityInstructions } from '../services/aiCampaignCopilot/deliverableQuality.js';
const scope={strict_temporal:true,cycle_year:2030,current_date:'2026-10-01'};
const review='General-election Post-Election Review';
const fields={timing:'December 2030','next actions':'Schedule a debrief meeting for the campaign team by December 2029.'};
test('reported December 2029 debrief under December 2030 review is flagged',()=>assert.ok(check(review,fields,scope).some(x=>/precedes its declared review window/.test(x.reason))));
test('December 2030 review step aligns',()=>assert.deepEqual(check(review,{...fields,'next actions':'Conduct the debrief by December 15, 2030.'},scope),[]));
test('quarter before review cannot satisfy review scheduling',()=>assert.ok(check(review,{...fields,'next actions':'Complete post-election report by Q3 2030.'},scope).length));
test('date after milestone completion is flagged',()=>assert.ok(check('Training',{timing:'October 2030','next actions':'Complete training by November 2030.'},scope).some(x=>/after this milestone/.test(x.reason))));
test('early volunteer logistics are valid for later GOTV execution',()=>assert.deepEqual(check('General-election GOTV Execution',{timing:'October 2030 - November 2030','next actions':'Launch volunteer recruitment in Q3 2030.'},scope),[]));
test('booking review venue early does not imply early results analysis',()=>assert.deepEqual(check(review,{...fields,'next actions':'Reserve a room in October 2030.'},scope),[]));
test('invalid ISO and named dates fail visibly',()=>{for(const text of ['2030-02-30','February 30, 2030'])assert.ok(check('Training',{timing:'March 2030','next actions':text},scope).some(x=>/Invalid calendar/.test(x.reason)));});
test('leap day validity is explicit',()=>{assert.equal(explicitDateWindows('2028-02-29')[0].valid,true);assert.equal(explicitDateWindows('2030-02-29')[0].valid,false);});
test('dates before server planning date are flagged',()=>assert.ok(check('Research',{'next actions':'Finish by September 2026.'},scope).some(x=>/precedes the planning date/.test(x.reason))));
test('month spanning planning date is not presumed expired',()=>assert.deepEqual(check('Research',{'next actions':'Start in October 2026.'},{...scope,current_date:'2026-10-15'}),[]));
test('dates after selected cycle are flagged',()=>assert.ok(check('Review',{'next actions':'Finish by January 2031.'},scope).some(x=>/after selected cycle/.test(x.reason))));
test('relative and pending deadlines are not assigned invented dates',()=>assert.deepEqual(check('Primary Operations',{'next actions':'Brief volunteers seven days before the confirmed primary; pending official confirmation.'},scope),[]));
test('no strict scope preserves previous behavior',()=>assert.deepEqual(check(review,fields,{...scope,strict_temporal:false}),[]));
test('inputs remain immutable',()=>{const input=structuredClone(fields);check(review,input,scope);assert.deepEqual(input,fields);});
test('all explicit deadlines are examined',()=>assert.equal(check('Training',{timing:'October 2030','next actions':'Finish by November 2030; publish by December 2030.'},scope).filter(x=>/after this milestone/.test(x.reason)).length,2));
const answer=`## General Election Phase
### General-election Post-Election Review
**Owner:** Proposed analytics team
**Timing:** December 2030
**Actions:** Analyze final general-election results and campaign performance.
**Risks:** Incomplete reporting may delay the review.
**Metrics:** Completion of the results analysis report.
**Next Actions:** Schedule a debrief meeting for the campaign team by December 2029.`;
test('full timeline quality report includes the reported date contradiction',()=>assert.ok(assess(answer,'Create a full campaign timeline',scope).issues.some(x=>x.field==='next actions'&&/December 2029/.test(x.reason))));
test('dated GOTV strategy also receives quality assessment',()=>assert.ok(assess(answer,'Create a GOTV strategy',scope).issues.some(x=>/December 2029/.test(x.reason))));
test('ordinary summary remains outside deliverable assessment',()=>assert.equal(assess(answer,'Summarize the workspace',scope).status,'not_applicable'));
test('generic contingent primary work is flagged despite bullet prefix',()=>{const text=answer.replace('General-election Post-Election Review','Primary Election Day Operations').replace('Analyze final general-election results and campaign performance.','- Prepare for primary operations contingent on confirmed official schedule.');assert.ok(assess(text,'Create a full campaign timeline',scope).issues.some(x=>x.field==='actions'&&/generic/.test(x.reason)));});
test('generator instructions describe dependency ordering',()=>assert.match(qualityInstructions(),/Do not schedule a 2030 post-election debrief in 2029/));
test('actual service supplies authoritative scope to the quality assessor',()=>{const service=fs.readFileSync(new URL('../services/aiCampaignCopilot.service.js',import.meta.url),'utf8');assert.match(service,/assessDeliverableQuality\(answer, prompt, temporalScope\)/);});

test('venue reservation cannot exempt early results work',()=>assert.ok(check(review,{...fields,'next actions':'Reserve a room and conduct the debrief by December 2029.'},scope).some(x=>/precedes its declared/.test(x.reason))));
test('unsupported future years are not silently ignored',()=>assert.ok(check('Review',{'next actions':'Finish by January 2201.'},scope).some(x=>/after selected cycle/.test(x.reason))));
