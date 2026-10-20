import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeReviewedRequestWindowV6,verifiedRequestWindowV6,createReviewedRequestFenceV6,REQUEST_ADMIN_V6} from '../lib/deployments/reviewed-request-window-v6.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../lib/deployments/initialized-platform-request-v1.ts';
import {createInitializedPlatformHandlers} from '../lib/deployments/initialized-platform-http.ts';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {makeRequestReviewV6,verifyRequestReviewV6,startRequestOnceV6,requestEnvironmentV6} from '../ops/platform-request-v6/plan.mjs';
import {projectRequestStateV6,assertRequestBaselineV6,verifyRequestReadbackV6,REQUEST_STATE_SQL_V6} from '../ops/platform-request-v6/state.mjs';
const at=Date.parse('2026-10-20T20:00:00Z'),nonce='12345678-1234-1234-1234-123456789012';
const capsule=()=>makeReviewedRequestWindowV6({sourceCommit:'a'.repeat(40),clientRequestId:nonce,issuedAt:at,expiresAt:at+1800000});
async function review(){const sourceCommit='a'.repeat(40);return makeRequestReviewV6({sourceCommit,clientRequestId:nonce,createdAt:at,
  pins:Array.from({length:15},(_,i)=>({file:'synthetic-'+i,sha256:'b'.repeat(64)})),ci:{sourceCommit,attempt:1,status:'completed',conclusion:'success'},
  metadata:{auth:{length:500,aclSha256:'c'.repeat(64),contentRead:false},portFree:true,previousRuntimeStopped:true}});}
test('fixed nonce reproduces the unchanged original v1 request/job derivation and cannot target old completed job',async()=>{
  const r=await capsule(),requestId=await sha256Hex({purpose:'platform-initialized-request/v1',clientRequestId:nonce,adminUserId:REQUEST_ADMIN_V6,scope:S});
  assert.equal(r.requestId,requestId);assert.equal(r.jobId,'job_'+(await sha256Hex({purpose:'express-initialized-job/v2',deploymentId:S.deploymentId,materialSha256:S.materialSha256,requestId})).slice(0,24));
  assert.deepEqual(await verifiedRequestWindowV6(JSON.stringify(r),at),r);
  for(const p of [{jobId:'job_ecbf09030d3da7286ea3ef93'},{adminUserId:'usr_other'},{releaseSha256:'b'.repeat(64)},{extra:true},
    {requestId:'d'.repeat(64)},{expiresAt:at+1800001},{issuedAt:at+1}])assert.equal(await verifiedRequestWindowV6(JSON.stringify({...r,...p}),at),null);
  assert.equal(await verifiedRequestWindowV6(JSON.stringify(r),at+1800000),null);
});
test('exact administrator/nonce/body and in-process once fence reject before store; post-auth latency cannot cross expiry',async()=>{
  const r=await capsule(),raw=JSON.stringify(r),body={clientRequestId:nonce,deploymentId:S.deploymentId,intent:'restore_initialized_workload'},f=createReviewedRequestFenceV6();
  for(const [admin,b] of [['usr_other',body],[REQUEST_ADMIN_V6,{...body,clientRequestId:'ffffffff-ffff-ffff-ffff-ffffffffffff'}]])await assert.rejects(f.begin(raw,admin,b,at));
  const accepted=await f.begin(raw,REQUEST_ADMIN_V6,body,at);assert.deepEqual(accepted,r);await assert.rejects(f.begin(raw,REQUEST_ADMIN_V6,body,at));
  await f.assertLive(raw,r,at+1000);await assert.rejects(f.assertLive(raw,r,r.expiresAt));
});
test('local request window is not controller startup or dispatch authorization; private keys and AWS secrets are absent',async()=>{
  const m=await review();await verifyRequestReviewV6(m,m.manifestSha256,at);assert.equal(m.expiresAt-at,48*3600000);
  for(const k of ['privateKeyReads','awsSecretReads','awsCalls','appTokens','workflowDispatches','automaticRetries'])assert.equal(m.effects[k],0);
  const p=await requestEnvironmentV6(m,'synthetic-auth-only',at),e=p.environment;
  assert.equal(e.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,'');assert.equal(e.TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL,'');
  assert.equal(e.TECHLONG_PLATFORM_CONTROLLER_ENABLED,'false');assert.equal(e.TECHLONG_PLATFORM_CONTROL_LOCAL,'false');
  assert.equal(e.AWS_INITIALIZED_REQUESTS_ENABLED,'true');assert.equal(e.AWS_APPLY_ENABLED,'false');assert.equal(e.DEPLOYMENT_WORKER_ENABLED,'false');
  assert.equal((await verifiedRequestWindowV6(e.TECHLONG_PLATFORM_REQUEST_WINDOW_V6,at)).jobId,m.target.jobId);
  await assert.rejects(verifyRequestReviewV6({...m,effects:{...m.effects,privateKeyReads:1}},m.manifestSha256,at));
  await assert.rejects(verifyRequestReviewV6(m,'wrong',at));await assert.rejects(verifyRequestReviewV6(m,m.manifestSha256,m.expiresAt-1800000));
  await verifyRequestReviewV6(m,m.manifestSha256,m.expiresAt-1,true);await assert.rejects(verifyRequestReviewV6(m,m.manifestSha256,m.expiresAt,true));
});
async function runner(){const m=await review(),events=[];let used=false,fail;
  const step=n=>{events.push(n);if(fail===n)throw Error('SENSITIVE_PROVIDER_DETAIL');};
  const io={assertSource:async()=>step('source'),metadata:async()=>m.metadata,claim:async()=>{assert.equal(used,false);used=true;step('slot');},
    readAuth:async()=>{step('auth');return 'synthetic-auth';},readState:async()=>{step('baseline');return {synthetic:true};},validateBaseline:async()=>step('validate'),
    record:async n=>step(n),serve:async(e,lease,ready)=>{step('serve');assert.equal(e.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,'');await ready({childPid:1});return {childExited:true,portFree:true,cleanClose:true};}};
  return {m,io,events,fail:n=>{fail=n;},run:()=>startRequestOnceV6({manifest:m,approved:m.manifestSha256,io,now:()=>at})};}
test('new independent permanent slot precedes auth/baseline/window; old W6k slot is never reset or reused',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'REQUEST_WINDOW_CLOSED_REQUIRES_INDEPENDENT_READBACK');
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('auth'));assert.ok(f.events.indexOf('validate')<f.events.indexOf('serve'));
  await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='auth').length,1);
});
test('auth, baseline, validation or process failure consumes the new slot with no secret read/retry/reset',async()=>{
  for(const phase of ['auth','baseline','validate','serve','started']){const f=await runner();f.fail(phase);const r=await f.run();
    assert.equal(r.outcome,'REQUEST_WINDOW_STOPPED_OR_UNKNOWN_NO_RETRY');assert.doesNotMatch(JSON.stringify(r),/SENSITIVE_PROVIDER_DETAIL/);
    assert.equal(f.events.filter(n=>n==='auth').length,1);assert.ok(f.events.filter(n=>n==='serve').length<=1);
  }
});
test('reviewed request HTTP origin stops remote GET and POST before authentication',async()=>{
  let calls=0;const h=createInitializedPlatformHandlers({origin:()=> 'http://127.0.0.1:3100',enabled:()=>true,authorize:async()=>{calls++;return {account:null,response:null};},read:async()=>{},submit:async()=>{throw Error('NO');}}),
    c={params:Promise.resolve({instanceId:S.appInstanceId})};
  assert.equal((await h.GET(new Request('https://remote.invalid/status'),c)).status,403);
  assert.equal((await h.POST(new Request('https://remote.invalid/status',{method:'POST',headers:{origin:'https://remote.invalid'}}),c)).status,403);assert.equal(calls,0);
});
async function stateFixture(){const target=(await review()).target,old='job_ecbf09030d3da7286ea3ef93',receipt={jobId:old,materialSha256:S.materialSha256,configurationHash:S.configurationHash,
  imageUri:S.artifactRef,existingDefaultStoreId:S.existingDefaultStoreId,epoch:S.epoch,operationHash:S.operationHash,completedBy:'express-initialized-single-job-v2',
  initializedVerified:true,effectiveConfigurationVerified:true,jobPlanSha256:'1'.repeat(64),controlObservationSha256:'2'.repeat(64),providerObservationSha256:'3'.repeat(64),
  authorityObservationSha256:'4'.repeat(64),controlCheckedAt:at-7200000,workloadExpiresAt:at-1000,stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/12345678-1234-1234-1234-123456789012'};
  const jobs=[old,...['1','2','3'].map(x=>'job_'+x.repeat(24))].map(id=>({id,deployment_id:S.deploymentId,job_type:'reconcile',status:'succeeded',attempts:1,max_attempts:1,
    leasePresent:false,payload:{kind:'express_initialized_workload_v2',planSha256:receipt.jobPlanSha256,materialSha256:S.materialSha256},created_at:at-7200000,completed_at:at-7100000}));
  const snapshot={deployment:{id:S.deploymentId,app_instance_id:S.appInstanceId,environment_id:S.environmentId,mode:'aws_sandbox',status:'ready',plan_hash:S.planHash,
    configuration_hash:S.configurationHash,artifact_ref:S.artifactRef,outputs:{expressInitializedWorkerRunsV2:{[old]:receipt}}},app:{id:S.appInstanceId},workspace:{id:S.workspaceId},
    subscription:{id:'sub_fixture'},environment:{id:S.environmentId},predecessorJob:jobs[0],resource:{id:'resource'},operation:{id:'operation'},templateVersion:{id:'template'}};
  const admin={id:REQUEST_ADMIN_V6,email:'veinyang@gmail.com',status:'active',platformAdmin:1};
  const before=await projectRequestStateV6(snapshot,jobs,admin,target,at);assertRequestBaselineV6(before);
  const newRow={id:target.jobId,deployment_id:S.deploymentId,job_type:'reconcile',status:'pending',attempts:0,max_attempts:1,available_at:Number.MAX_SAFE_INTEGER,
    created_at:at+1000,completed_at:null,leasePresent:false,payload:{kind:'express_initialized_request_v4',requestId:target.requestId,requestedByUserId:REQUEST_ADMIN_V6,
      requestedAt:at+1000,reviewRequired:true,cloudExecutionAuthorized:false,scope:S}};
  return {target,snapshot,jobs,admin,before,newRow,window:{lease:{issuedAt:at,expiresAt:at+1800000}}};}
test('independent readback proves exact new held row and unchanged nine rows/four old jobs without raw payload or capability output',async()=>{
  const f=await stateFixture(),after=await projectRequestStateV6(f.snapshot,[...f.jobs,f.newRow],f.admin,f.target,at+2000),r=await verifyRequestReadbackV6(f.before,after,f.target,f.window);
  assert.equal(r.outcome,'NEW_EXACT_HELD_REQUEST_INDEPENDENTLY_VERIFIED');assert.equal(r.oldRowsPreserved,9);assert.equal(r.oldJobsPreserved,4);
  assert.equal(r.cloudExecutionAuthorized,false);assert.doesNotMatch(JSON.stringify(after),/"payload"|"lease_token"|postgresql:|PRIVATE KEY/);
  assert.equal((await verifyRequestReadbackV6(f.before,f.before,f.target,f.window)).created,false);
});
test('wrong new row, old-row/job drift or active prior task stops without corrective writes',async()=>{
  const f=await stateFixture(),after=await projectRequestStateV6(f.snapshot,[...f.jobs,f.newRow],f.admin,f.target,at+2000);
  for(const patch of [{status:'running'},{attempts:1},{availableAt:at},{requestedBy:'usr_wrong'},{requestId:'e'.repeat(64)},
    {scopeSha256:'f'.repeat(64)},{cloudExecutionAuthorized:true},{leasePresent:true},{requestedAt:at+1800000}])
    await assert.rejects(verifyRequestReadbackV6(f.before,{...after,target:{...after.target,...patch}},f.target,f.window));
  await assert.rejects(verifyRequestReadbackV6(f.before,{...after,snapshotRows:[]},f.target,f.window));
  assert.throws(()=>assertRequestBaselineV6({...f.before,oldJobs:[...f.before.oldJobs,{id:'other',status:'pending',leasePresent:false}]}));
});
test('state adapter is SELECT-only; UI and concrete store bind reviewed nonce and keep old SQL/queue closed semantics',async()=>{
  assert.match(REQUEST_STATE_SQL_V6,/SELECT/);assert.doesNotMatch(REQUEST_STATE_SQL_V6,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|password_hash|token_hash/);
  const ui=await readFile(new URL('../components/admin/InitializedDeploymentPanel.tsx',import.meta.url),'utf8'),store=await readFile(new URL('../lib/deployments/initialized-platform-management.ts',import.meta.url),'utf8');
  assert.match(ui,/view\.reviewedRequest\?\.clientRequestId\?\?fallbackRequestId/);assert.match(store,/reviewedFence\.begin/);assert.match(store,/reviewedFence\.assertLive/);
  assert.ok(store.indexOf('reviewedFence.begin')<store.indexOf('const current = await load(input.instanceId)'));
});
