// Runs INSIDE the candidate container with --network none; no cookie or auth POST.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000';
let ready=false;
for(let n=0;n<45;n++){
  try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(2000)});if(r.status===200){ready=true;break;}}
  catch{/* bounded liveness polling only, never a mutation retry */}
  await new Promise(r=>setTimeout(r,1000));
}
assert(ready,'candidate liveness');
const health=await fetch(base+'/api/health'),body=await health.json();assert.equal(body.data.status,'ok');assert.equal(body.data.service,'saas-platform');
assert.equal(health.headers.get('cache-control'),'no-store');
const login=await fetch(base+'/login');assert.equal(login.status,200);assert.match(await login.text(),/登录/);
const admin=await fetch(base+'/admin',{redirect:'manual'});assert([302,303,307,308].includes(admin.status));
assert.match(admin.headers.get('location')??'',/\/login/);
const api=await fetch(base+'/api/admin/instances/app_e897a4377bce498b9c5ee9e64509dcad/deployment-control',{redirect:'manual'});
assert.equal(api.status,401);
const asset=await fetch(base+'/favicon.svg');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type')??'',/svg/);
console.log(JSON.stringify({outcome:'NODE_HOSTING_ANONYMOUS_SMOKE_PASSED',health:true,login:true,adminGuard:true,apiGuard:true,asset:true,
  realDatabaseConfigured:false,realAuthenticationProved:false,cloudWrites:0,deploymentControllerEnabled:false}));
