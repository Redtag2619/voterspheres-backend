import test from 'node:test';
import assert from 'node:assert/strict';
import { createFecHttpClient } from '../services/fecHttpClient.js';
import { withStripeEvent } from '../services/stripeEventIntegrity.js';
const response = (status, retry = null) => ({ok: status === 200, status, headers: {get: () => retry}, body: {cancel: async () => {}}, json: async () => ({ok: true})});
test('429 retries, honors Retry-After, and returns genuine payload', async () => {
  const delays=[]; let calls=0;
  const get=createFecHttpClient({intervalMs:0, sleep:async ms=>delays.push(ms), fetchImpl:async()=>response(++calls===1?429:200,'2')});
  assert.deepEqual(await get('https://example.test/?api_key=secret'),{ok:true}); assert.equal(calls,2); assert.ok(delays.includes(2000));
});
test('long Retry-After stops without an early retry or secret exposure', async () => {
  let calls=0; const get=createFecHttpClient({fetchImpl:async()=>{calls++;return response(429,'3600');},sleep:async()=>{}});
  await assert.rejects(get('https://example.test/?api_key=secret'), e=>e.code==='FEC_RATE_LIMIT'&&!e.message.includes('secret')); assert.equal(calls,1);
});
test('permanent errors are not retried and failed queue recovers', async () => {
  let calls=0; const get=createFecHttpClient({intervalMs:0,fetchImpl:async()=>response(++calls===1?403:200),sleep:async()=>{}});
  await assert.rejects(get('https://example.test')); assert.deepEqual(await get('https://example.test'),{ok:true}); assert.equal(calls,2);
});
test('transient failures are bounded', async () => {
  let calls=0; const get=createFecHttpClient({intervalMs:0,retries:2,sleep:async()=>{},fetchImpl:async()=>{calls++;throw new Error('secret');}});
  await assert.rejects(get('https://example.test'),e=>e.attempts===3&&!e.message.includes('secret')); assert.equal(calls,3);
});
test('concurrent requests serialize', async () => {
  let active=0,max=0; const get=createFecHttpClient({intervalMs:0,fetchImpl:async()=>{max=Math.max(max,++active);await Promise.resolve();active--;return response(200);}});
  await Promise.all([get('https://example.test'),get('https://example.test')]);assert.equal(max,1);
});
function fakePool({status, acquired=true}={}) {
  const queries=[]; let released=false;
  return {queries,get released(){return released;},connect:async()=>({query:async(sql,args)=>{queries.push({sql,args});return {rows:sql.includes('AS acquired')?[{acquired}]:sql.startsWith('SELECT status')?(status?[{status}]:[]):[]};},release:()=>{released=true;}})};
}
test('completed Stripe event is acknowledged without reapplying',async()=>{const pool=fakePool({status:'completed'});let calls=0;const result=await withStripeEvent(pool,{id:'evt_1',type:'invoice.paid'},async()=>calls++);assert.equal(result.duplicate,true);assert.equal(calls,0);assert.equal(pool.released,true);});
test('in-flight Stripe event receives retryable failure',async()=>{const pool=fakePool({acquired:false});await assert.rejects(withStripeEvent(pool,{id:'evt_1',type:'invoice.paid'},()=>assert.fail()),e=>e.statusCode===503);assert.equal(pool.released,true);});
test('crashed or failed event can recover; success is recorded afterward',async()=>{const pool=fakePool({status:'processing'});assert.deepEqual(await withStripeEvent(pool,{id:'evt_1',type:'invoice.paid'},async()=>({received:true})),{received:true});assert.ok(pool.queries.some(q=>q.sql.includes("status='completed'")));});
test('application failure is recorded and propagated with lock released',async()=>{const pool=fakePool();await assert.rejects(withStripeEvent(pool,{id:'evt_1',type:'invoice.paid'},async()=>{throw new Error('failure');}));assert.ok(pool.queries.some(q=>q.sql.includes("status='failed'")));assert.ok(pool.queries.some(q=>q.sql.includes('pg_advisory_unlock')));assert.equal(pool.released,true);});
import fs from 'node:fs';
import vm from 'node:vm';
const billingSource=fs.readFileSync(new URL('../services/billing.service.js',import.meta.url),'utf8');
function billingHandler({valid=true}={}){
 let schemaCalls=0,claims=0;
 const context=vm.createContext({getEnv:()=> 'test_secret',createHttpError:(message,statusCode)=>Object.assign(new Error(message),{statusCode}),getStripe:async()=>({webhooks:{constructEvent:()=>{if(!valid)throw new Error('Invalid signature');return {id:'evt_test',type:'unknown.event',data:{object:{}}};}}}),withStripeEvent:async(pool,event,apply)=>{claims++;return apply();},pool:{},ensureBillingColumns:async()=>{schemaCalls++;}});
 const fn=billingSource.slice(billingSource.indexOf('export async function handleStripeWebhook'),billingSource.indexOf('\nexport default')).replace('export ','');
 vm.runInContext(fn+'\nglobalThis.handle=handleStripeWebhook;',context);
 return {handle:context.handle,get schemaCalls(){return schemaCalls;},get claims(){return claims;}};
}
test('active billing handler verifies signatures before any schema or ledger work',async()=>{const api=billingHandler({valid:false});await assert.rejects(api.handle({rawBody:Buffer.from('x'),signature:'bad'}));assert.equal(api.schemaCalls,0);assert.equal(api.claims,0);});
test('active billing handler uses event guard for verified events',async()=>{const api=billingHandler();const result=await api.handle({rawBody:Buffer.from('x'),signature:'valid'});assert.equal(result.received,true);assert.equal(api.claims,1);assert.equal(api.schemaCalls,1);});

test('FEC runner exit policy preserves partial coverage and rejects unexpected degradation', () => {
  const runner = fs.readFileSync(
    new URL('../scripts/runFecReliabilitySync.mjs', import.meta.url),
    'utf8'
  );
  const start = runner.indexOf('const expectedPartialPac =');
  const end = runner.indexOf('} catch(error)', start);
  assert.ok(start >= 0 && end > start, 'Runner exit-policy boundaries missing');
  const policy = runner.slice(start, end);

  for (const [status, result, expected] of [
    ['complete', { ok: true, status: 'completed' }, 0],
    ['degraded', { ok: true, status: 'completed_with_skipped_pac' }, 0],
    ['degraded', { ok: true, status: 'unexpected_status' }, 1],
    ['degraded', { ok: false, status: 'completed_with_skipped_pac' }, 1]
  ]) {
    const context = vm.createContext({ status, result, process: { exitCode: 0 } });
    vm.runInContext(policy, context);
    assert.equal(context.process.exitCode, expected);
  }
});