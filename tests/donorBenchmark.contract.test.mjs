import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {candidateDonors,paritySql,originalDonors,ordered25} from '../scripts/lib/donorBenchmarkSql.mjs';
test('candidate keeps winner precedence, legacy suppression, exact ID and timestamp projections',()=>{
 const q=candidateDonors(true);for(const token of ["money_published_scan('donors'","source IS DISTINCT FROM 'fec_schedule_a'","c.cycle=d.cycle","'id',-d.row_id","'amount',d.amount","'contribution_count',d.contributions","'source_updated_at',d.published_at"] )assert.ok(q.includes(token));
 assert.ok(q.indexOf('LIMIT 25')<q.indexOf('jsonb_populate_record'));assert.ok(q.includes('jsonb_to_record(d.payload) AS p(cycle integer)'));assert.ok(!candidateDonors().includes('LIMIT 25'));
});
test('parity compares whole typed rows including duplicate multiplicity in both directions',()=>{
 const q=paritySql(originalDonors,candidateDonors());assert.match(q,/TABLE a EXCEPT ALL TABLE b/);assert.match(q,/TABLE b EXCEPT ALL TABLE a/);assert.match(ordered25(candidateDonors(true)),/source_updated_at DESC NULLS LAST,id DESC LIMIT 25$/);
});
test('benchmark rejects apply before opening a database',()=>{
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/benchmarkDonorReads.mjs',import.meta.url)),'--apply'],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/READ_ONLY_OPTION_REQUIRED/);
});
