import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../middleware/auth.middleware.js',import.meta.url),'utf8');
async function run({token='test',user={id:1,firm_id:7,role:'user'},firm={id:7},jwtError,secret='test_secret'}={}){
 const queries=[];let next=false,verification;
 const context=vm.createContext({process:{env:{NODE_ENV:'production',JWT_SECRET:secret}},console:{error(){}},jwt:{verify:(value,key,options)=>{verification=options;if(jwtError)throw jwtError;return {id:1,firm_id:999,role:'admin'};}},pool:{query:async(sql,args)=>{queries.push(args);return {rows:sql.includes('FROM users')?(user?[user]:[]):(firm?[firm]:[])};}}});
 vm.runInContext(source.replace(/import[^;]+;/g,'').replace(/export\s+default\s+[^;]+;/g,'').replace(/export\s+/g,'')+'\nglobalThis.authHandler=requireAuth;',context);
 const req={headers:{authorization:token?`Bearer ${token}`:''},query:{}},res={status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
 await context.authHandler(req,res,()=>{next=true;});return {req,res,next,queries,verification};
}
test('verified token tenant and role claims do not override database ownership',async()=>{const result=await run();assert.equal(result.next,true);assert.equal(result.req.user.firm_id,7);assert.equal(result.req.user.role,'user');assert.equal(result.queries[1][0],7);assert.equal(result.verification.algorithms[0],'HS256');});
test('missing bearer token is rejected before database access',async()=>{const r=await run({token:''});assert.equal(r.next,false);assert.equal(r.res.code,401);assert.equal(r.queries.length,0);});
test('expired token is rejected before database access',async()=>{const r=await run({jwtError:Object.assign(new Error('expired'),{name:'TokenExpiredError'})});assert.equal(r.res.code,401);assert.equal(r.queries.length,0);});
test('missing user and deleted firm are rejected',async()=>{for(const options of [{user:null},{firm:null}]){const r=await run(options);assert.equal(r.next,false);assert.equal(r.res.code,401);}});
test('production secret cannot fall back to development secret',async()=>{const r=await run({secret:''});assert.equal(r.next,false);assert.equal(r.queries.length,0);});
