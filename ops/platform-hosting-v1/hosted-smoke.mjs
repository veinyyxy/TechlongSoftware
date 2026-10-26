// ONLY a credential-free CI bootstrap/expiry check, never a production launcher.
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {CONTROL_SCOPE as S} from '../../lib/deployments/controller-v6/contract.ts';
import {PUBLIC_ORIGIN} from './ingress.mjs';
import {hostedControlRelease,hostedControlBinding,PRIVATE_CONTROL_BINDINGS} from './control-runtime.mjs';
import {main} from './start.mjs';

async function smoke(){
  assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert(!Object.keys(process.env).some(k=>PRIVATE_CONTROL_BINDINGS.includes(k)||
    /DATABASE_URL|PRIVATE_KEY|SECRET|TOKEN|^AWS_/.test(k)));
  const source=process.env.GITHUB_SHA;assert.match(source??'',/^[a-f0-9]{40}$/);
  const now=Date.now(),lease={schema:'techlong/platform-hosted-runtime-lease/v6',origin:PUBLIC_ORIGIN,
    sourceCommit:source,releaseSha256:await sha256Hex(await hostedControlRelease()),issuedAt:now,expiresAt:now+25000};
  Object.assign(process.env,{TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:PUBLIC_ORIGIN,
    TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROL_HOSTED:'true',TECHLONG_PLATFORM_CONTROL_LOCAL:'false',
    TECHLONG_PLATFORM_CONTROLLER_LEASE:JSON.stringify(lease),TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT:source});
  const server=await main(['--hosted-controller']);
  assert.equal(hostedControlBinding('TECHLONG_PLATFORM_CONTROLLER_ENABLED'),'true');
  const send=path=>new Promise((resolve,reject)=>{
    const r=request({hostname:'127.0.0.1',port:3000,path,timeout:5000,headers:{host:new URL(PUBLIC_ORIGIN).host,
      'x-forwarded-proto':'https','x-forwarded-port':'443'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    r.on('error',reject);r.on('timeout',()=>r.destroy(Error('SMOKE_TIMEOUT')));r.end();
  });
  assert.equal(await send('/api/health'),200);
  assert.equal(await send('/api/admin/instances/'+S.instanceId+'/deployment-control'),401);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,lease.expiresAt-Date.now()+100)));
  assert.equal(hostedControlBinding('TECHLONG_PLATFORM_CONTROLLER_ENABLED'),'false');
  for(const name of PRIVATE_CONTROL_BINDINGS)assert.equal(hostedControlBinding(name),null);
  assert.equal(await send('/api/health'),200); // Expiry is not a hosting stop/cleanup.
  console.log('NODE_HOSTED_CONTROL_SMOKE_PASSED_NO_REAL_PRIVATE_BINDINGS');
  await new Promise(resolve=>server.close(()=>resolve()));
}
smoke().catch(()=>{console.error('NODE_HOSTED_CONTROL_SMOKE_FAILED');process.exit(1);});
