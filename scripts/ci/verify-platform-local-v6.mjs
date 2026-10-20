// One real disposable local server on the CI runner. Never use production material.
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {childEnvironmentV6} from '../../ops/platform-local-v6/plan.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
const root=fileURLToPath(new URL('../../',import.meta.url)),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),now=Date.now();
const lease={schema:'techlong/platform-local-runtime-lease/v6',releaseSha256:B.publisher.releaseSha256,origin:'http://127.0.0.1:3100',sourceCommit:head,issuedAt:now,expiresAt:now+180000};
// CI invokes the same entry with a diagnostic wrapper. Only synthetic values
// exist in this sanitized child; production launcher still discards all stdio.
const entry=new URL('../../ops/platform-local-v6/child.mjs',import.meta.url).href;
const code=`import {childMainV6} from ${JSON.stringify(entry)};childMainV6().then(()=>{if(process.connected)process.disconnect();}).catch(e=>{console.error('CI_SYNTHETIC_STARTUP_ERROR',e);process.exit(1);});`;
const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],
  {cwd:root,env:childEnvironmentV6(process.env,{authUrl:'postgresql://synthetic:synthetic@127.0.0.1/ci?sslmode=verify-full',
    databaseUrl:'postgresql://synthetic:synthetic@127.0.0.1/ci?sslmode=verify-full',privateKey:'SYNTHETIC_NOT_A_PRIVATE_KEY'},lease),
  windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
let clean=false,exited=false;const closed=once(child,'close').then(([code])=>{exited=true;return code;});
const timer=setTimeout(()=>child.kill(),180000);
try{
  await new Promise((resolve,reject)=>{
    child.on('message',m=>{if(m?.type==='ready')resolve();if(m?.type==='stopped'){clean=m.clean===true;if(!clean)reject(Error('CI_LOCAL_CHILD_STOPPED'));}});
    void closed.then(()=>reject(Error('CI_LOCAL_CHILD_CLOSED_BEFORE_READY')));
  });
  const health=await fetch(lease.origin+'/api/health',{redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(health.status,200);
  const unauth=await fetch(lease.origin+'/api/admin/instances/app_e897a4377bce498b9c5ee9e64509dcad/deployment-control',
    {redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(unauth.status,401);
  child.send({type:'stop'});assert.equal(await closed,0);assert.equal(clean,true);
  console.log('REAL_CI_LOCAL_CHILD_HEALTH_200_ADMIN_401_CLOSED_NO_PRIVATE_MATERIAL');
}finally{clearTimeout(timer);if(!exited){if(child.connected)child.send({type:'stop'});const hard=setTimeout(()=>child.kill(),10000);await closed;clearTimeout(hard);}}
