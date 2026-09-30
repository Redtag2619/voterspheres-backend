import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assessPollingOperations, parseArgs, main } from '../scripts/monitorPollingOperations.mjs';
const now = Date.parse('2026-09-29T23:00:00Z');
const date = new Date(now).toISOString();
function fixtures(ids = ['1','2']) {
  const labels = ['API health','Scopes reject anonymous access','User scope discovery','User receives only public scopes','dashboard defaults to election cycle','explicit election cycle','continuous tracking','continuous scope rejects cycle','user cannot read unresolved','user cannot read combined scope','records election scope','records continuous scope','Post-validation scope discovery','Polling scope counts unchanged'];
  return {
    now,
    validation: { phase:'2.6',validator_version:'2.6.0',mode:'read_only',generated_at:date,base_url:'https://example.test/api',operator_checks_run:false,passed:true,checks:labels.map(label=>({label,passed:true})) },
    closeout: { closeout_version:'2.7.0',mode:'diagnostic_only',generated_at:date,closeout_status:ids.length?'ambiguous_records_remain_quarantined':'complete',mapping:[],mapping_sha256:createHash('sha256').update('[]').digest('hex'),decisions:ids.map(id=>({group_key:`poll-${id}`,record_ids:[id],answer_rows:1,decision:'quarantined',issue_code:'missing_deterministic_cycle'})),summary:{unresolved_records:ids.length,unresolved_groups:ids.length,deterministic_records:0,deterministic_groups:0,quarantined_records:ids.length,quarantined_groups:ids.length} },
  };
}
test('ambiguous quarantine is an explicit healthy operating state',()=>{
  const result=assessPollingOperations(fixtures());
  assert.equal(result.status,'healthy_with_quarantine'); assert.equal(result.summary.quarantined_records,2);
  assert.equal(result.drift,null); assert.equal(result.coverage_notes.length,2);
});
test('empty quarantine is healthy',()=>assert.equal(assessPollingOperations(fixtures([])).status,'healthy'));
test('unchanged baseline has no drift',()=>{
  const f=fixtures();f.baseline=assessPollingOperations(f);
  assert.equal(assessPollingOperations(f).status,'healthy_with_quarantine');
});
test('equal counts with changed IDs trigger attention',()=>{
  const f=fixtures(['1','3']);f.baseline=assessPollingOperations(fixtures());
  const r=assessPollingOperations(f);assert.equal(r.status,'attention_required');
  assert.deepEqual(r.drift.added_ids,['3']);assert.deepEqual(r.drift.removed_ids,['2']);
});
test('issue changes trigger attention',()=>{
  const f=fixtures();f.baseline=assessPollingOperations(f);f.closeout.decisions[0].issue_code='conflicting_cycle';
  assert.deepEqual(assessPollingOperations(f).drift.changed_ids,['1']);
});
test('failed production validation triggers attention',()=>{
  const f=fixtures();f.validation.checks[8].passed=false;f.validation.passed=false;
  assert.equal(assessPollingOperations(f).alerts[0].code,'validation_failed');
});
test('stale or future evidence cannot pass',()=>{
  for(const offset of [-25*3600000,600000]){
    const f=fixtures();f.closeout.generated_at=new Date(now+offset).toISOString();
    assert.equal(assessPollingOperations(f).passed,false);
  }
});
test('invalid totals, duplicate records, mapping hash and malformed validation fail closed',()=>{
  const edits=[f=>f.closeout.summary.unresolved_records++,f=>f.closeout.decisions[1].record_ids=['1'],f=>f.closeout.mapping_sha256='bad',f=>f.validation.checks=[],f=>f.validation.passed=false,f=>f.closeout.closeout_status='complete'];
  for(const edit of edits){const f=fixtures();edit(f);assert.throws(()=>assessPollingOperations(f));}
});
test('deterministic group requires matching complete mapping and prompts review',()=>{
  const f=fixtures(['1']);const g=f.closeout.decisions[0];
  Object.assign(g,{decision:'deterministic',issue_code:null,proposed_temporal_scope:'election_cycle',proposed_cycle:2026});
  Object.assign(f.closeout.summary,{deterministic_records:1,deterministic_groups:1,quarantined_records:0,quarantined_groups:0});
  f.closeout.closeout_status='deterministic_correction_available';
  f.closeout.mapping=[{polling_result_id:'1',temporal_scope:'election_cycle',cycle:2026,group_key:'poll-1'}];
  f.closeout.mapping_sha256=createHash('sha256').update(JSON.stringify(f.closeout.mapping)).digest('hex');
  assert.equal(assessPollingOperations(f).alerts[0].code,'deterministic_correction_available');
  f.closeout.mapping=[];assert.throws(()=>assessPollingOperations(f));
});
test('baseline integrity, health and environment are required',()=>{
  const edits=[b=>b.snapshot_sha256='bad',b=>b.base_url='https://other.test/api',b=>b.status='attention_required'];
  for(const edit of edits){const f=fixtures();f.baseline=assessPollingOperations(f);edit(f.baseline);assert.throws(()=>assessPollingOperations(f));}
});
test('assessment preserves its input reports',()=>{
  const f=fixtures();const previous=JSON.stringify(f);assessPollingOperations(f);assert.equal(JSON.stringify(f),previous);
});
test('CLI requires explicit evidence and rejects unknown or duplicated options',()=>{
  assert.throws(()=>parseArgs([]));assert.throws(()=>parseArgs(['--apply=true']));
  assert.throws(()=>parseArgs(['--validation=a','--closeout=b','--validation=c']));
  assert.equal(parseArgs(['--validation=a','--closeout=b']).validation,'a');
});
test('CLI writes reviewable reports, returns health status and rejects malformed JSON',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vs-monitor-test-'));
  try {
    const f=fixtures();f.validation.generated_at=f.closeout.generated_at=new Date().toISOString();
    const validationPath=path.join(directory,'validation.json'),closeoutPath=path.join(directory,'closeout.json');
    fs.writeFileSync(validationPath,JSON.stringify(f.validation));fs.writeFileSync(closeoutPath,JSON.stringify(f.closeout));
    const args=[`--validation=${validationPath}`,`--closeout=${closeoutPath}`,`--output=${directory}`];
    const messages=[];const log=console.log;
    try {
      console.log=message=>messages.push(JSON.parse(message));
      assert.equal(main(args),0);
      assert.equal(JSON.parse(fs.readFileSync(messages[0].output_path,'utf8')).status,'healthy_with_quarantine');
      f.validation.passed=false;f.validation.checks[0].passed=false;
      fs.writeFileSync(validationPath,JSON.stringify(f.validation));
      assert.equal(main(args),2);assert.equal(messages[1].alerts[0].code,'validation_failed');
      fs.writeFileSync(validationPath,'broken');assert.throws(()=>main(args));
    } finally {console.log=log;}
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
