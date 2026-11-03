import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {optionsFromArgs,boundedRead,safeTiming,classifyRecord,taskCandidateSql,benchmarkQueries} from '../scripts/lib/legacyReadAudit.mjs';
test('audit requires exactly one firm, validates budgets and rejects mutation flags',()=>{
 assert.equal(optionsFromArgs(['--firm-name=Red Tag Strategies']).limit,100);
 for(const args of [[],['--apply'],['--firm-id=2','--firm-name=Other'],['--firm-id=2','--limit=201'],['--firm-id=2','--cycle=2027']])assert.throws(()=>optionsFromArgs(args));
});
test('query timeout rolls back its savepoint so subsequent reads remain usable',async()=>{
 const calls=[];let fail=true;
 const client={query:async(sql)=>{calls.push(sql);if(sql==='SELECT slow'&&fail){fail=false;throw Object.assign(new Error('private database detail'),{code:'57014'});}return {rows:[{secret:'not-for-report'}],rowCount:1};}};
 const failure=await boundedRead(client,'SELECT slow');assert.equal(failure.code,'57014');assert.ok(!JSON.stringify(failure).includes('private'));
 assert.deepEqual(calls.slice(-2),['ROLLBACK TO SAVEPOINT legacy_read_probe','RELEASE SAVEPOINT legacy_read_probe']);
 const result=await boundedRead(client,'SELECT fast');assert.equal(result.ok,true);
 const timing=safeTiming('fast',result,'SELECT fast');assert.ok(!JSON.stringify(timing).includes('secret'));assert.equal(timing.row_count,1);
});
test('non-read statements are rejected before the client is called',async()=>{
 const client={query:async()=>assert.fail('client must not be called')};
 for(const sql of ['DELETE FROM tasks','UPDATE tasks SET status=1','CREATE TABLE x(id int)'])await assert.rejects(boundedRead(client,sql),{code:'NON_READ_STATEMENT_REJECTED'});
});
test('record selection is firm-scoped, bounded and omits full descriptions and metadata',()=>{
 assert.match(taskCandidateSql,/WHERE to_jsonb\(t\)->>'firm_id' = \$1/);
 assert.match(taskCandidateSql,/LIMIT \$2/);
 assert.match(taskCandidateSql,/AS negative_case_marker/);
 assert.ok(!/SELECT\s+t\.\*/i.test(taskCandidateSql));
 assert.match(taskCandidateSql,/ELSE NULL END AS workspace_name/);
});
test('negative acceptance labels remain review candidates, never authorization findings or deletion approval',()=>{
 const row=classifyRecord({title:'AI TACTICAL ACCEPTANCE - INVALID WORKSPACE',negative_case_marker:true});
 assert.equal(row.review_classification,'explicit_test_title_marker');assert.equal(row.deletion_authorized,false);assert.match(row.caution,/not proof/);
 assert.equal(classifyRecord({title:'Customer acceptance review'}).review_classification,'possible_test_marker');
});
test('every benchmark is a bounded parameterized read and requests no provider data',()=>{
 for(const query of benchmarkQueries(2028)){assert.match(query.sql,/^SELECT/i);assert.match(query.sql,/LIMIT \$/);assert.ok(query.params.length>0);}
 assert.deepEqual(benchmarkQueries(2028)[0].params,[2028,25]);
});
test('actual CLI rejects --apply before loading dotenv or connecting',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/auditLegacyDashboardAndTestRecords.mjs',import.meta.url)),'--apply'],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/INVALID_READ_AUDIT_OPTION/);assert.ok(!result.stderr.includes('ERR_MODULE_NOT_FOUND'));
});
