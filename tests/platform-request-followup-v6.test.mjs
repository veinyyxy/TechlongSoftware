import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {F,assertFollowupBaseline,makeFollowupReview,verifyFollowupReview,verifyFollowupWindow,verifyFollowupReadback,startFollowupOnce} from '../ops/platform-request-v6/followup.mjs';
import {requestEnvironmentV6} from '../ops/platform-request-v6/plan.mjs';
import {REQUEST_ADMIN_V6} from '../lib/deployments/reviewed-request-window-v6.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../lib/deployments/initialized-platform-request-v1.ts';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const at=Date.parse('2026-10-23T20:00:00Z');
function baseline(){return {schema:'techlong/held-request-state/v6',checkedAt:at-60000,adminId:REQUEST_ADMIN_V6,
  view:{supported:true,state:'expired',canRequest:true,latestJobId:F.predecessorJobId},target:null,
  snapshotRows:['deployment','app','workspace','subscription','environment','predecessorJob','resource','operation','templateVersion'].map(name=>({name,sha256:'a'.repeat(64)})),
  oldJobs:[F.predecessorJobId,F.cancelledJobId,...['1','2','3','4'].map(x=>'job_'+x.repeat(24))].sort().map(id=>
    ({id,status:id===F.cancelledJobId?'canceled':'succeeded',leasePresent:false,rowSha256:'b'.repeat(64)}))};}
async function review(){const sourceCommit='c'.repeat(40);return makeFollowupReview({sourceCommit,createdAt:at,baseline:baseline(),
  pins:Array.from({length:16},(_,i)=>({file:'fixture-'+i,sha256:'d'.repeat(64)})),
  ci:{sourceCommit,attempt:1,status:'completed',conclusion:'success'},metadata:{auth:{contentRead:false,length:300,aclSha256:'e'.repeat(64)},portFree:true}});}
async function runner(){const m=await review(),events=[];let used=false,fail;
  const step=n=>{events.push(n);if(fail===n)throw Error('PRIVATE_DETAIL_MUST_NOT_ESCAPE');};
  const io={assertSource:async()=>step('source'),metadata:async()=>m.metadata,claim:async()=>{step('claim');assert.equal(used,false);used=true;},
    readAuth:async()=>{step('auth');return 'SYNTHETIC_AUTH';},readState:async()=>{step('state');return m.baseline;},
    record:async(n,v)=>{step('record-'+n);assert.doesNotMatch(JSON.stringify(v),/SYNTHETIC_AUTH|PRIVATE_DETAIL/);},
    serve:async(env,lease,ready)=>{step('serve');assert.equal(env.DATABASE_URL,'SYNTHETIC_AUTH');
      for(const k of ['TECHLONG_PLATFORM_CONTROLLER_ENABLED','TECHLONG_PLATFORM_CONTROL_LOCAL','AWS_APPLY_ENABLED','DEPLOYMENT_WORKER_ENABLED'])assert.equal(env[k],'false');
      assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY,'');assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL,'');
      await ready({childPid:17,origin:lease.origin});return {childExited:true,portFree:true,cleanClose:true};}};
  return {m,io,events,fail:n=>{fail=n;},run:()=>startFollowupOnce({manifest:m,approved:m.manifestSha256,io,now:()=>at})};}

test('fixed followup target separates local operator source from deployed image source; old slots retained',async()=>{
  const m=await review();assert.equal(m.target.jobId,F.jobId);assert.equal(m.target.requestId,F.requestId);
  assert.notEqual(m.sourceCommit,m.runtimeSourceCommit);assert.equal(m.runtimeSourceCommit,F.runtimeSourceCommit);
  assert.equal(m.expiresAt-at,48*3600000);assert.match(m.permanentSlot,/w8i/);assert.doesNotMatch(m.permanentSlot,/w6l/);
  for(const k of ['privateKeyReads','awsSecretReads','awsCalls','appTokens','workflowDispatches'])assert.equal(m.effects[k],0);
  await verifyFollowupReview(m,m.manifestSha256,at);
  await assert.rejects(verifyFollowupReview({...m,runtimeSourceCommit:m.sourceCommit},m.manifestSha256,at));
  await assert.rejects(verifyFollowupReview(m,'f'.repeat(64),at));
  await assert.rejects(verifyFollowupReview(m,m.manifestSha256,m.expiresAt-1800000));
});
test('only the observed canceled task is allowed; new, active or changed historical rows fail closed',()=>{
  const b=baseline();assertFollowupBaseline(b);
  for(const patch of [{target:{}},{adminId:'usr_other'},{oldJobs:[]},{snapshotRows:[]},
    {view:{...b.view,latestJobId:'job_ecbf09030d3da7286ea3ef93'}},
    {oldJobs:b.oldJobs.map(j=>({...j,status:'succeeded'}))},
    {oldJobs:b.oldJobs.map(j=>({...j,leasePresent:true}))}])assert.throws(()=>assertFollowupBaseline({...b,...patch}));
  const drift=structuredClone(b);drift.oldJobs[0].rowSha256='f'.repeat(64);assert.throws(()=>assertFollowupBaseline(drift,b));
});
test('request-only launch uses existing child with no controller/private key; permanent attempt cannot replay',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'FOLLOWUP_WINDOW_CLOSED_REQUIRES_INDEPENDENT_READBACK');
  assert.ok(f.events.indexOf('claim')<f.events.indexOf('auth'));assert.ok(f.events.indexOf('state')<f.events.indexOf('serve'));
  await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='auth').length,1);
});
test('failures preserve one attempt and never retry authentication, queries or child starts',async()=>{
  for(const phase of ['auth','state','record-window','serve']){const f=await runner();f.fail(phase);const r=await f.run();
    assert.equal(r.outcome,'FOLLOWUP_WINDOW_STOPPED_OR_UNKNOWN_NO_RETRY');assert.equal(r.retryAllowed,false);
    assert.ok(f.events.filter(n=>n==='auth').length<=1);assert.ok(f.events.filter(n=>n==='serve').length<=1);
    assert.doesNotMatch(JSON.stringify(r),/PRIVATE_DETAIL/);}
});
test('fresh baseline drift prevents child start rather than modifying or reviving old jobs',async()=>{
  const f=await runner();f.io.readState=async()=>({...f.m.baseline,oldJobs:[]});const r=await f.run();
  assert.equal(r.phase,'BASELINE');assert.equal(f.events.includes('serve'),false);
});
test('independent readback binds full window and exact held row while retaining canceled history',async()=>{
  const m=await review(),p=await requestEnvironmentV6(m,'',at),window={lease:p.lease,request:p.request};
  await verifyFollowupWindow(m,window);await assert.rejects(verifyFollowupWindow(m,{...window,request:{...window.request,jobId:'job_'+'f'.repeat(24)}}));
  const target={id:F.jobId,deploymentId:S.deploymentId,jobType:'reconcile',status:'pending',attempts:0,maxAttempts:1,availableAt:Number.MAX_SAFE_INTEGER,
    createdAt:at+1000,completedAt:null,leasePresent:false,kind:'express_initialized_request_v4',requestId:F.requestId,requestedBy:REQUEST_ADMIN_V6,
    requestedAt:at+1000,reviewRequired:true,cloudExecutionAuthorized:false,scopeSha256:await sha256Hex(S)};
  const after={...baseline(),target};assert.equal((await verifyFollowupReadback(m.baseline,after,m.target,window)).oldJobsPreserved,6);
  for(const patch of [{status:'running'},{attempts:1},{leasePresent:true},{cloudExecutionAuthorized:true},{requestedAt:at+1800000},{createdAt:at-1}])
    await assert.rejects(verifyFollowupReadback(m.baseline,{...after,target:{...target,...patch}},m.target,window));
  assert.equal((await verifyFollowupReadback(m.baseline,baseline(),m.target,window)).created,false);
});
test('new operator has no App/AWS mutation or owner-plan write capability; credentials are never an import side effect',async()=>{
  const s=await readFile(new URL('../ops/platform-request-v6/followup-local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(s,/readKey|readSecret|createTrustedPublisher|writeOwner|CreateStack|UpdateStack|dispatchWorkflow/);
  assert.match(s,/flag:'wx'/);assert.match(s,/mode==='Prepare'/);assert.match(s,/readLocalCiV6/);
});
