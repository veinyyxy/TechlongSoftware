// ALB-header simulation only, INSIDE --network none; no TLS/DB/real credentials.
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {PUBLIC_ORIGIN} from './ingress.mjs';
const host=new URL(PUBLIC_ORIGIN).host;
const proxy={host,'x-forwarded-proto':'https','x-forwarded-port':'443'};
function send(path,headers=proxy,method='GET',body){
  return new Promise((resolve,reject)=>{
    const r=request({hostname:'127.0.0.1',port:3000,path,method,headers,timeout:5000},res=>{
      let text='';res.setEncoding('utf8');res.on('data',part=>{text+=part;});
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));
    });
    r.on('error',reject);r.on('timeout',()=>r.destroy(new Error('SMOKE_TIMEOUT')));r.end(body);
  });
}
let ready=false;
for(let n=0;n<45;n++){
  try{if((await send('/api/health',{host:'10.0.1.10:3000'})).status===200){ready=true;break;}}catch{/* liveness only */}
  await new Promise(r=>setTimeout(r,1000));
}
assert(ready);
const login=await send('/login');assert.equal(login.status,200);assert.match(login.text,/登录/);
assert.equal(login.headers['strict-transport-security'],'max-age=300');
const assets=[...new Set([...login.text.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map(m=>m[1]))];
assert(assets.length>0&&assets.length<=40);
for(const asset of assets)assert.equal((await send(asset)).status,200);
const admin=await send('/admin');assert([302,303,307,308].includes(admin.status));
assert.equal(new URL(admin.headers.location,PUBLIC_ORIGIN).origin,PUBLIC_ORIGIN);
assert.match(admin.headers.location,/\/login/);
assert.equal((await send('/login',{...proxy,host:'attacker.invalid'})).status,421);
assert.equal((await send('/login',{...proxy,'x-forwarded-host':'attacker.invalid'})).status,421);
assert.equal((await send('/login',{...proxy,'x-forwarded-proto':'https, http'})).status,400);
assert.equal((await send('/login',{host})).status,400);
const write={...proxy,'content-type':'application/json'};
assert.equal((await send('/api/auth/login',write,'POST','{}')).status,403);
assert.equal((await send('/api/auth/login',{...write,origin:'https://attacker.invalid'},'POST','{}')).status,403);
// Invalid payload stops before credentials/database access in the REAL login route.
assert.equal((await send('/api/auth/login',{...write,origin:PUBLIC_ORIGIN},'POST','{}')).status,400);
// No Cookie means the REAL logout route does not delete a database session.
const logout=await send('/api/auth/logout',{...proxy,origin:PUBLIC_ORIGIN,'sec-fetch-site':'same-origin'},'POST');
assert.equal(logout.status,303);
const cookies=logout.headers['set-cookie'];assert.equal(cookies.length,1);
for(const attribute of ['saas_session=','Path=/','HttpOnly','SameSite=Lax','Max-Age=0','Secure'])assert(cookies[0].split('; ').includes(attribute));
assert(!/Domain=/i.test(cookies[0]));
console.log(JSON.stringify({outcome:'NODE_HOSTING_HTTPS_BOUNDARY_SMOKE_PASSED',browserAssets:assets.length,
  hostRejection:true,csrfRejection:true,secureLogoutCookie:true,realDatabaseConfigured:false,
  realAuthenticationProved:false,realTlsProved:false,cloudWrites:0,deploymentControllerEnabled:false}));
