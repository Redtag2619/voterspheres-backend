import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../scripts/monitorProductionReliability.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
async function run({status='complete',missing=false,old=false,fail=false,summary=null}={}){
 const queries=[];let report,closed=false,released=false;
 const recent=new Date(),date=old?new Date(Date.now()-90*86400000):recent;
 const client={query:async(sql)=>{queries.push(sql);if(fail&&sql.includes('to_regclass'))throw new Error('private DB information');if(sql.includes('to_regclass'))return {rows:[{name:missing?null:'exists'}]};if(sql.includes('MAX(completed_at)'))return {rows:[{at:date}]};if(sql.includes('FROM polling_results'))return {rows:[{temporal_scope:'election_cycle',latest_survey:date,future_answers:'4'}]};if(sql.startsWith('SELECT status'))return {rows:[{status:sql.includes('FROM production_job_runs')?status:'complete',started_at:date,completed_at:date,summary}]};return {rows:[]};},release:()=>{released=true;}};
 const context=vm.createContext({process:{env:{},exitCode:0},Date,console:{log:text=>{report=JSON.parse(text);},error:text=>{report=JSON.parse(text);}},pool:{connect:async()=>client,end:async()=>{closed=true;}}});
 await vm.runInContext('(async()=>{'+source+'})()',context);return {report,queries,closed,released,exit:context.process.exitCode};
}
test('healthy monitor reads dates and future counts without mutating records',async()=>{const r=await run();assert.equal(r.exit,0);assert.equal(r.report.polling[0].future_answers,'4');assert.ok(r.queries.includes('BEGIN READ ONLY'));assert.ok(r.queries.includes('ROLLBACK'));assert.ok(!r.queries.some(q=>/^(UPDATE|INSERT|DELETE|CREATE)/.test(q)));assert.ok(r.closed&&r.released);});
test('failed runs and stale surveys produce failing exit status',async()=>{const r=await run({status:'failed',old:true});assert.equal(r.exit,1);assert.ok(r.report.alerts.some(x=>x.includes('latest status failed')));assert.ok(r.report.alerts.some(x=>x.includes('surveys missing or older')));});
test('missing telemetry and database failure cannot look healthy',async()=>{const r=await run({missing:true});assert.equal(r.exit,1);assert.equal(r.report.alerts.length,2);const broken=await run({fail:true});assert.equal(broken.exit,1);assert.equal(broken.report.status,'monitor_failed');assert.ok(!JSON.stringify(broken.report).includes('private'));assert.ok(broken.closed&&broken.released);});

test('partial PAC coverage warns without falsely reporting failed fundraising ingestion', async () => {
  const result = await run({
    status: 'degraded',
    summary: { status: 'completed_with_skipped_pac', stored: 4573 }
  });
  assert.equal(result.exit, 0);
  assert.ok(result.report.warnings.some(value => value.includes('PAC coverage is partial')));
  assert.equal(result.report.alerts.length, 0);

  const unknown = await run({ status: 'degraded' });
  assert.equal(unknown.exit, 1);
  assert.ok(unknown.report.alerts.some(value => value.includes('latest status degraded')));
});

test('running jobs alert only after the runtime threshold', async () => {
  const active = await run({ status: 'running' });
  assert.equal(active.exit, 0);
  assert.ok(!active.report.alerts.some(value => value.includes('running beyond')));

  const overdue = await run({ status: 'running', old: true });
  assert.equal(overdue.exit, 1);
  assert.ok(overdue.report.alerts.some(value => value.includes('running beyond allowed runtime')));
});