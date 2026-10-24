import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedReadyReceipt,waitForHostedReady,createHostedCycleDriver} from '../ops/platform-review-v6/hosted-driver.mjs';
import {operationsFixtureV6} from './fixtures/platform-operations-v6.mjs';
import {K,P} from '../ops/platform-hosted-window-v6/contract.mjs';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {canonicalJson} from '../lib/deployments/execution/hash.ts';
async function fixture(){const f=await operationsFixtureV6();f.lease={...f.lease,schema:'techlong/platform-hosted-runtime-lease/v6',origin:'https://'+P.domain};
  return {...f,hosting:{stackId:K.stackId,taskDefinition:`arn:aws:ecs:ca-central-1:402010193138:task-definition/${P.family}:5`},manifestSha256:'a'.repeat(64)};}
const ready=f=>hostedReadyReceipt({...f,checkedAt:f.now(),humanReadyUntil:f.lease.expiresAt});
test('HOSTED readiness binds scope, real stack/revision and lease hash without a fake local PID',async()=>{
  const f=await fixture(),r=await ready(f);assert.equal(r.schema,'techlong/hosted-human-page-ready/v6');assert.equal(r.pageOpened,true);
  assert.equal(r.viewOnly,true);assert.equal(r.stackId,K.stackId);assert(!Object.hasOwn(r,'childPid'));
  for(const patch of [{hosting:{...f.hosting,childPid:123}},{hosting:{...f.hosting,stackId:'wrong'}},{lease:{...f.lease,origin:'http://127.0.0.1:3100'}},
    {manifestSha256:'bad'},{humanReadyUntil:f.now()+900000},{checkedAt:f.at+480000}])await assert.rejects(hostedReadyReceipt({...f,checkedAt:f.now(),humanReadyUntil:f.lease.expiresAt,...patch}));
});
test('HOSTED page wait rejects stale, altered, future and late human receipts',async()=>{
  for(const change of [r=>{r.leaseSha256='0'.repeat(64);},r=>{r.checkedAt+=1;},r=>{r.pageOpened=false;},r=>{r.extra=true;}]){
    const f=await fixture(),r=await ready(f);change(r);
    await assert.rejects(waitForHostedReady({...f,expected:f,signal:new AbortController().signal,loadReady:async()=>r}));
  }
  const f=await fixture(),r=await ready(f);f.tick(60000);
  await assert.rejects(waitForHostedReady({...f,expected:f,signal:new AbortController().signal,loadReady:async()=>r}));
});
test('HOSTED driver waits for page before publication, supports manual approvals and never dispatches',async()=>{
  const f=await fixture(),stages=[];let publishedAt,runAt,review,next,publications=0;
  const live={ports:{},readRun:f.ports.readRun,discover:async()=>({}),loadPlan:async sha=>{
    const p=sha===review.planSha256?review:next,at=sha===review.planSha256?publishedAt:runAt;
    return {...p,riskSha256:f.release.riskSha256,attempt:f.now()<at+240000?null:{state:'ACKNOWLEDGED',runId:sha===review.planSha256?'123456789':'123456790'}};}};
  const driver=createHostedCycleDriver({...f,live,loadReady:async()=>f.now()>=f.at+240000?ready(f):null,
    probePage:async()=>{},record:async(n,v)=>stages.push({n,v}),sleep:async ms=>f.tick(ms),
    publishReview:async()=>{publications++;publishedAt=f.now();review=await validatePlan({...f.basePlan,preparedAt:f.now(),expiresAt:f.now()+7200000},f.release,f.now());return review;},
    bridgeFactory:()=>({async once(){runAt=f.now();const p={...structuredClone(review.plan),mode:'RunOnce',preparedAt:f.now(),expiresAt:f.now()+420000,
      predecessor:{planSha256:review.planSha256,runId:'123456789',proofSha256:'a'.repeat(64)}};
      p.inputs.mode='RunOnce';p.inputs.manifest=canonicalJson(f.manifestReference);p.inputs.manifestSha=f.manifest.manifestSha256;
      next=await validatePlan(p,f.release,f.now());return {outcome:'RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL',planSha256:next.planSha256,expiresAt:p.expiresAt};}})});
  const out=await driver({lease:f.lease,hosting:f.hosting,signal:new AbortController().signal});
  assert.equal(publishedAt,f.at+240000);assert.equal(runAt,f.at+480000);assert.equal(f.now(),f.at+720000);assert.equal(publications,1);
  assert.deepEqual(stages.map(v=>v.n),['awaiting-hosted-page','awaiting-human-review-plan','awaiting-human-runonce-plan']);
  assert.equal(out.workflowDispatchesByParent,0);assert.equal(out.deploymentAccepted,false);
  await assert.rejects(driver({}),/HOSTED_DRIVER_MEMORY_ONCE/);
});
test('failed probe or expired/local lease never publishes a Review',async()=>{
  for(const failure of ['probe','expired','local']){
    const f=await fixture();let writes=0;
    const d=createHostedCycleDriver({...f,live:{},loadReady:async()=>null,record:async()=>{},probePage:async()=>{throw Error('unavailable');},publishReview:async()=>{writes++;}});
    if(failure==='expired')f.tick(1800000);if(failure==='local')f.lease.origin='http://127.0.0.1:3100';
    await assert.rejects(d({lease:f.lease,hosting:f.hosting,signal:new AbortController().signal}));assert.equal(writes,0);
  }
});
test('human approval after a fixed lease deadline cannot extend the driver',async()=>{
  const f=await fixture();f.tick(480000);let writes=0;
  const d=createHostedCycleDriver({...f,live:{},loadReady:async()=>ready(f),record:async()=>{},probePage:async()=>{},publishReview:async()=>{writes++;}});
  await assert.rejects(d({lease:f.lease,hosting:f.hosting,signal:new AbortController().signal}));assert.equal(writes,0);
});
