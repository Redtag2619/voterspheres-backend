// Read-only checks. Tokens remain in environment; response bodies are never logged.
const base=String(process.env.RELEASE_API_BASE||'').replace(/\/$/,'');
const origin=process.env.RELEASE_FRONTEND_ORIGIN;
const results=[];
async function check(name,path,{token,method='GET',headers={},expected=[200]}={}){
 try{const response=await fetch(base+path,{method,headers:{...headers,...(token?{Authorization:`Bearer ${token}`}:{})},signal:AbortSignal.timeout(15000),redirect:'manual'});await response.body?.cancel();const passed=expected.includes(response.status);results.push({name,status:response.status,passed});return response;}
 catch{results.push({name,passed:false,error:'Request failed or timed out'});}
}
if(!/^https:\/\//.test(base))throw new Error('Set RELEASE_API_BASE to the intended HTTPS backend URL, without /api.');
await check('health','/api/health');
await check('unauthenticated identity rejected','/api/auth/me',{expected:[401]});
await check('billing configuration','/api/billing/config');
if(origin){const r=await check('login preflight','/api/auth/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'},expected:[200,204]});if(r)results.push({name:'CORS exact origin',passed:r.headers.get('access-control-allow-origin')===origin});}
if(process.env.RELEASE_TOKEN_A){await check('authenticated identity A','/api/auth/me',{token:process.env.RELEASE_TOKEN_A});await check('authenticated tasks','/api/tasks',{token:process.env.RELEASE_TOKEN_A});}
else results.push({name:'authenticated identity and tasks',passed:false,pending:true});
const path=process.env.RELEASE_TENANT_RESOURCE_PATH;
if(path&&/^\/api\/[A-Za-z0-9_/-]+$/.test(path)&&process.env.RELEASE_TOKEN_A&&process.env.RELEASE_TOKEN_B){
 await check('A owns known resource',path,{token:process.env.RELEASE_TOKEN_A});
 await check('B cannot read A resource',path,{token:process.env.RELEASE_TOKEN_B,expected:[403,404]});
}else results.push({name:'cross-tenant resource denial',passed:false,pending:true});
results.push({name:'browser login, billing lifecycle and core workflow acceptance',passed:false,pending:true});
console.log(JSON.stringify({checked_at:new Date().toISOString(),results,ready:false},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
