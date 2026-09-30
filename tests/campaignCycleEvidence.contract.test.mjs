import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitEvidenceCycle, isolateCampaignCycleEvidence } from '../services/aiCampaignCopilot/cycleEvidence.js';
const scope = cycle_year => ({ cycle_year, strict_temporal: true });
test('2028 excludes 2026 and unscoped context', () => {
 const next = isolateCampaignCycleEvidence({ advisor: { recommendations: [{cycle:2026},{cycle:2028},{title:'unknown'}] } }, scope(2028));
 assert.equal(next.advisor.recommendations.length,1); assert.equal(next.advisor.recommendations[0].cycle,2028);
 assert.equal(next.scope.cycle_evidence.excluded_records,2);
});
test('2030 and 2032 remain isolated without date inference', () => {
 for (const cycle of [2030,2032]) {
  const next=isolateCampaignCycleEvidence({warRoom:{signals:[{election_year:cycle},{election_year:2028},{created_at:`${cycle}-01-01`}] }},scope(cycle));
  assert.equal(next.warRoom.signals.length,1);
 }
});
test('conflicting cycle aliases, unresolved and continuous evidence are excluded', () => {
 assert.equal(explicitEvidenceCycle({cycle:2028,election_year:2026}),null);
 const next=isolateCampaignCycleEvidence({mission:{critical_signals:[{cycle:2028,temporal_scope:'unresolved'},{cycle:2028,temporal_scope:'continuous_tracking'}]}},scope(2028));
 assert.equal(next.mission.critical_signals.length,0);
});
test('empty future cycle is explicitly unavailable and aggregate summaries are removed', () => {
 const next=isolateCampaignCycleEvidence({mission:{summary:{polls:999},open_tasks:[{cycle:2026}]}},scope(2028));
 assert.equal(next.scope.cycle_evidence_status,'no_verified_cycle_context'); assert.equal(next.mission.summary.polls,undefined);
});
test('workspace mismatch is excluded; shared operational data is labeled', () => {
 const donors=[{name:'shared'}];
 const next=isolateCampaignCycleEvidence({workspace:{cycle:2026},donors},scope(2028));
 assert.equal(next.workspace,null); assert.equal(next.donors,donors);assert.match(next.scope.evidence_policy,/shared operational context/);
});
test('input remains immutable and non-strict behavior is preserved', () => {
 const original={advisor:{recommendations:[{cycle:2026},{cycle:2028}]}};
 isolateCampaignCycleEvidence(original,scope(2028)); assert.equal(original.advisor.recommendations.length,2);
 assert.equal(isolateCampaignCycleEvidence(original,{strict_temporal:false}),original);
});
test('invalid resolved cycle fails closed', () => {assert.throws(()=>isolateCampaignCycleEvidence({},scope(null)),/resolved campaign cycle/);});
