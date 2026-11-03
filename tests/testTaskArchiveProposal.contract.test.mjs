import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import baseline from '../scripts/lib/testTaskArchiveBaseline.json' with {type:'json'};
import {buildProposal} from '../scripts/lib/testTaskArchiveProposal.mjs';
const deps={task_activity:{ok:true,counts:[{task_id:'82',rows:'3'}]},task_comments:{ok:true,counts:[]},task_assignment_audit:{ok:true,counts:[]}};
const refs=[{schema_name:'public',referencing_table:'task_activity'},{schema_name:'public',referencing_table:'task_comments'}];
test('proposal is pinned to the twelve reviewed IDs and preserves task/history rows',()=>{
 const plan=buildProposal(baseline,baseline.records,refs,deps);assert.deepEqual(plan.exact_task_ids,['70','71','72','73','78','79','80','81','82','83','84','85']);assert.equal(plan.firm_id,'7');assert.equal(plan.ready_for_manual_review,true);assert.equal(plan.mutations_performed,0);assert.equal(plan.deletion_authorized,false);assert.equal(plan.dependencies.task_activity.counts[0].rows,'3');
});
test('missing records, edits, unreviewed IDs, unknown references and failed dependency reads prevent a ready preview',()=>{
 const missing=buildProposal(baseline,baseline.records.slice(1),refs,deps);assert.equal(missing.ready_for_manual_review,false);
 const changed=structuredClone(baseline.records);changed[0].status='open';assert.equal(buildProposal(baseline,changed,refs,deps).ready_for_manual_review,false);
 assert.equal(buildProposal(baseline,[...baseline.records,{task_id:'999'}],refs,deps).ready_for_manual_review,false);
 assert.equal(buildProposal(baseline,baseline.records,[...refs,{schema_name:'public',referencing_table:'new_reference'}],deps).ready_for_manual_review,false);
 assert.equal(buildProposal(baseline,baseline.records,refs,{...deps,task_comments:{ok:false,code:'57014'}}).ready_for_manual_review,false);
});
test('preview CLI rejects apply and another firm before loading credentials or connecting',()=>{
 for(const args of [['--apply'],['--firm-id=8']]){const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/previewTestTaskArchive.mjs',import.meta.url)),...args],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/PREVIEW_ONLY_OPTION_REJECTED|REVIEWED_FIRM_REQUIRED/);assert.ok(!result.stderr.includes('ERR_MODULE_NOT_FOUND'));}
});
test('donor plan CLI rejects mutation options before connecting',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/inspectDonorReadPlan.mjs',import.meta.url)),'--apply'],{encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/READ_PLAN_OPTION_REJECTED/);
});
