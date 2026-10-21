import test from 'node:test';
import assert from 'node:assert/strict';
import {readinessDeadlines,pageReadyReceipt,assertRecoveryControl,abortableDelay,waitForPageReady,waitForLeaseAck,waitForLeaseRun,createReadyGatedDriver} from '../ops/platform-operations-v6/window.mjs';
import {createRecoveryHandoff,reserveRunOncePlan,assertHandoffBudget} from '../ops/platform-operations-v6/handoff.mjs';
import {operationsFixtureV6} from './fixtures/platform-operations-v6.mjs';
import {createTrustedPublisherV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {canonicalJson} from '../lib/deployments/execution/hash.ts';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';

const signal=()=>new AbortController().signal;
const expected=f=>({manifestSha256:'a'.repeat(64),childPid:123,scope:f.scope});
const publisher=f=>createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,ports:f.ports,now:f.now});
test('lease deadlines remain page8min/review14min/run29.5min, never a two-hour live server',async()=>{
  const f=await operationsFixtureV6(),d=readinessDeadlines(f.lease);
  assert.equal(d.pageReadyBy-f.at,480000);assert.equal(d.reviewCompleteBy-f.at,840000);assert.equal(d.runCompleteBy-f.at,1770000);
  assert.throws(()=>readinessDeadlines({...f.lease,expiresAt:f.at+7200000}));
});
test('page receipt binds scope/child/manifest/lease and excludes late confirmation',async()=>{
  const f=await operationsFixtureV6(),e=expected(f),receipt=pageReadyReceipt({...e,lease:f.lease,checkedAt:f.now()});assert.equal(receipt.pageOpened,true);
  for(const patch of [{childPid:0},{scope:{...f.scope,sourceCommit:'0'.repeat(40)}},{checkedAt:f.at+480000},{manifestSha256:'wrong'}])
    assert.throws(()=>pageReadyReceipt({...e,lease:f.lease,checkedAt:f.now(),...patch}));
});
test('page waits for exact human receipt; public readiness alone does not publish anything',async()=>{
  const f=await operationsFixtureV6(),e=expected(f);let reads=0;
  const out=await waitForPageReady({expected:e,lease:f.lease,deadline:f.at+480000,signal:signal(),now:f.now,sleep:async ms=>f.tick(ms),
    loadReady:async()=>{reads++;return f.now()>=f.at+180000?pageReadyReceipt({...e,lease:f.lease,checkedAt:f.now()}):null;}});
  assert.equal(out.checkedAt,f.at+180000);assert.equal(reads,181);assert.equal(f.writes.length,0);
});
test('page rejects wrong receipt fields, future timestamp and extended wait deadline',async()=>{
  for(const patch of [{childPid:124},{pageOpened:false},{unexpected:true},{checkedAt:Date.now()+3600000}]){
    const f=await operationsFixtureV6(),e=expected(f),r=pageReadyReceipt({...e,lease:f.lease,checkedAt:f.now()});
    await assert.rejects(waitForPageReady({expected:e,lease:f.lease,deadline:f.at+480000,signal:signal(),now:f.now,loadReady:async()=>({...r,...patch})}));
  }
  const f=await operationsFixtureV6();await assert.rejects(waitForPageReady({expected:expected(f),lease:f.lease,deadline:f.at+480001,signal:signal(),now:f.now,loadReady:async()=>null}));
});
test('aborted wait removes its timer and never calls the loader',async()=>{
  const a=new AbortController();a.abort(Error('stopped'));await assert.rejects(abortableDelay(1000,a.signal));
  const f=await operationsFixtureV6();let reads=0;await assert.rejects(waitForPageReady({expected:expected(f),lease:f.lease,deadline:f.at+480000,signal:a.signal,
    now:f.now,loadReady:async()=>{reads++;}}));assert.equal(reads,0);
});
test('only the exact retained Review with no approval or attempt may precede a new publication',async()=>{
  const f=await operationsFixtureV6(),p=f.review;
  const control={plans:[{plan_sha:p.planSha256,action_sha:p.actionSha256,risk_sha:f.release.riskSha256,job_id:f.scope.jobId,mode:'Review',
    body:p.plan,expires_at:new Date(p.plan.expiresAt).toISOString()}],approvals:[],attempts:[]};
  const options={scope:f.scope,riskSha256:f.release.riskSha256};assert.equal(assertRecoveryControl(control,p,options).noPriorApprovalOrAttempt,true);
  for(const change of [c=>c.attempts.push({state:'SUBMISSION_STARTED'}),c=>c.attempts.push({state:'UNKNOWN'}),c=>c.approvals.push({}),c=>c.plans[0].action_sha='0'.repeat(64),c=>c.plans.push(c.plans[0])]){
    const bad=structuredClone(control);change(bad);assert.throws(()=>assertRecoveryControl(bad,p,options));
  }
});
test('ACK wait supports real human delay, but rejects another plan, UNKNOWN and invalid IDs',async()=>{
  const f=await operationsFixtureV6(),entry=f.plans.get(f.review.planSha256),deadline=f.at+840000;let reads=0;
  const out=await waitForLeaseAck({planSha256:f.review.planSha256,scope:f.scope,mode:'Review',release:f.release,deadline,signal:signal(),now:f.now,sleep:async ms=>f.tick(ms),
    loadPlan:async()=>{reads++;return {...entry,attempt:f.now()<f.at+240000?null:entry.attempt};}});
  assert.equal(out.attempt.runId,'123456789');assert.equal(reads,17);
  for(const patch of [{planSha256:'0'.repeat(64)},{attempt:{...entry.attempt,state:'UNKNOWN'}},{attempt:{...entry.attempt,runId:'abc'}}])
    await assert.rejects(waitForLeaseAck({planSha256:f.review.planSha256,scope:f.scope,mode:'Review',release:f.release,deadline,signal:signal(),now:f.now,loadPlan:async()=>({...entry,...patch})}));
});
test('ACK and run responses arriving past the deadline are rejected even if successful',async()=>{
  const f=await operationsFixtureV6(),deadline=f.at+1000;
  await assert.rejects(waitForLeaseAck({planSha256:f.review.planSha256,scope:f.scope,mode:'Review',release:f.release,deadline,signal:signal(),now:f.now,
    loadPlan:async()=>{f.tick(1001);return f.plans.get(f.review.planSha256);}}));
  const g=await operationsFixtureV6();await assert.rejects(waitForLeaseRun({runId:'123456789',scope:g.scope,release:g.release,deadline:g.at+1000,signal:signal(),now:g.now,
    record:async()=>{},stage:'test',readRun:async()=>{g.tick(1001);return g.rawRun('123456789');}}));
});
test('run wait preserves strict actor/source/reusable bindings, announces once, and rejects failure',async()=>{
  const f=await operationsFixtureV6(),events=[];let reads=0;
  const raw=await waitForLeaseRun({runId:'123456789',scope:f.scope,release:f.release,deadline:f.at+100000,signal:signal(),now:f.now,sleep:async ms=>f.tick(ms),
    record:async(n,v)=>events.push({n,v}),stage:'environment',readRun:async()=>{reads++;return {...f.rawRun('123456789'),...(reads<3?{status:'waiting',conclusion:null}:{})};}});
  assert.equal(raw.conclusion,'success');assert.equal(events.length,1);assert.equal(f.now()-f.at,50000);
  for(const patch of [{head_sha:'0'.repeat(40)},{actor:{id:1}},{conclusion:'failure'},{run_attempt:2},{status:'in_progress',conclusion:'success'},{referenced_workflows:[]}])
    await assert.rejects(waitForLeaseRun({runId:'123456789',scope:f.scope,release:f.release,deadline:f.at+100000,signal:signal(),now:f.now,
      record:async()=>{},stage:'test',readRun:async()=>({...f.rawRun('123456789'),...patch})}));
});
test('full driver publishes only after human page gate, waits through two four-minute approvals, never dispatches itself',async()=>{
  const f=await operationsFixtureV6(),e=expected(f),stages=[];let publishedAt,runAt,review,next,publications=0;
  const live={ports:{},readRun:f.ports.readRun,discover:async()=>({}),loadServicePlan:async sha=>{
    const item=sha===review.planSha256?review:next,base=sha===review.planSha256?publishedAt:runAt;
    return {...item,riskSha256:f.release.riskSha256,attempt:f.now()<base+240000?null:{state:'ACKNOWLEDGED',runId:sha===review.planSha256?'123456789':'123456790'}};},
    dispatch:()=>{throw Error('driver must not dispatch');}};
  const driver=createReadyGatedDriver({scope:f.scope,release:f.release,frozenSourceCommit:f.frozenSourceCommit,manifestSha256:e.manifestSha256,live,
    probeLogin:async()=>{},record:async(n,v)=>stages.push({n,v}),now:f.now,sleep:async ms=>f.tick(ms),
    loadReady:async()=>f.now()>=f.at+240000?pageReadyReceipt({...e,lease:f.lease,checkedAt:f.now()}):null,
    publishReview:async()=>{publications++;publishedAt=f.now();review=await validatePlan({...f.basePlan,preparedAt:f.now(),expiresAt:f.now()+7200000},f.release,f.now());return review;},
    bridgeFactory:()=>({async once(){runAt=f.now();const p={...structuredClone(review.plan),mode:'RunOnce',preparedAt:f.now(),expiresAt:f.now()+420000,
      predecessor:{planSha256:review.planSha256,runId:'123456789',proofSha256:'a'.repeat(64)}};
      p.inputs.mode='RunOnce';p.inputs.manifest=canonicalJson(f.manifestReference);p.inputs.manifestSha=f.manifest.manifestSha256;
      next=await validatePlan(p,f.release,f.now());return {outcome:'RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL',planSha256:next.planSha256,expiresAt:p.expiresAt};}})});
  const out=await driver({lease:f.lease,child:{childPid:e.childPid},signal:signal()});
  assert.equal(publishedAt,f.at+240000);assert.equal(runAt,f.at+480000);assert.equal(f.now(),f.at+720000);assert.equal(publications,1);
  assert.deepEqual(stages.map(v=>v.n),['awaiting-page-open','awaiting-human-review-plan','awaiting-human-runonce-plan']);assert.equal(out.workflowDispatchesByParent,0);assert.equal(out.deploymentAccepted,false);
  await assert.rejects(driver({lease:f.lease,child:{childPid:e.childPid},signal:signal()}),/DRIVER_MEMORY_ONCE/);assert.equal(publications,1);
});
test('invalid release/lease and failed page probe never publish a Review',async()=>{
  const f=await operationsFixtureV6();let published=0;const args={scope:f.scope,release:f.release,frozenSourceCommit:f.frozenSourceCommit,manifestSha256:'a'.repeat(64),
    live:{},loadReady:async()=>null,publishReview:async()=>{published++;},probeLogin:async()=>{throw Error('not reachable');},record:async()=>{},bridgeFactory:()=>{},now:f.now};
  const driver=createReadyGatedDriver(args);await assert.rejects(driver({lease:{...f.lease,releaseSha256:'0'.repeat(64)},child:{childPid:1},signal:signal()}));
  await assert.rejects(createReadyGatedDriver(args)({lease:f.lease,child:{childPid:1},signal:signal()}));assert.equal(published,0);assert.throws(()=>createReadyGatedDriver({...args,bridgeFactory:undefined}));
});
test('handoff preserves immutable cloud clock and only shortens a validated RunOnce plan',async()=>{
  const f=await operationsFixtureV6(),p=publisher(f);await p.attestResult(f.review.planSha256,f.resultReference);const candidate=await p.publishSuccessor(f.review.planSha256,f.resultReference);
  const before=structuredClone(f.manifest),out=await reserveRunOncePlan(candidate,f.manifest,f.lease,f.release,f.now());
  assert.equal(out.plan.expiresAt,f.manifest.jobPlan.claimBy-480000);assert(out.plan.expiresAt<=candidate.plan.expiresAt);assert.deepEqual(f.manifest,before);
  assert.throws(()=>assertHandoffBudget(f.manifest,{expiresAt:f.now()+480000},f.now()));
  f.tick(420000);assert.throws(()=>assertHandoffBudget(f.manifest,f.lease,f.now()));
});
test('full real-publisher handoff observes1/proofs1/plans1, reads each object once and cannot replay',async()=>{
  const f=await operationsFixtureV6(),bridge=createRecoveryHandoff({...f,release:f.release,scope:f.scope,lease:f.lease,ports:f.ports,now:f.now});
  const input={planSha256:f.review.planSha256,runId:'123456789',resultReference:f.resultReference,manifestReference:f.manifestReference,manifestSha256:f.manifest.manifestSha256};
  const out=await bridge.once(input);assert.equal(out.outcome,'RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL');assert.equal(out.workflowDispatches,0);
  assert.deepEqual(f.effects,{claims:1,observations:1,owners:2,disposed:1,objectGets:3});assert.equal(out.expiresAt,f.manifest.jobPlan.claimBy-480000);
  await assert.rejects(bridge.once(input),/MEMORY_ONCE/);assert.equal(f.effects.claims,1);
});
for(const failure of ['approval','claim','observe','proof','plan'])test('handoff '+failure+' stops without retry, compensation or dispatch',async()=>{
  const f=await operationsFixtureV6();f.setFailure(failure);const bridge=createRecoveryHandoff({...f,scope:f.scope,ports:f.ports,now:f.now});
  const out=await bridge.once({planSha256:f.review.planSha256,runId:'123456789',resultReference:f.resultReference,manifestReference:f.manifestReference,manifestSha256:f.manifest.manifestSha256});
  assert.equal(out.outcome,'HANDOFF_STOPPED_REQUIRES_READBACK_NO_RETRY');assert.equal(out.workflowDispatches,0);assert.equal(out.retryAllowed,false);assert(f.effects.owners<=2);assert.equal(f.effects.disposed,1);
  if(failure==='claim'){assert.equal(out.slotClaimAttempted,true);assert.equal(out.slotClaimed,false);assert(f.stages.some(v=>v.name==='result'));}
  await assert.rejects(bridge.once({}),/MEMORY_ONCE/);assert.equal(f.effects.claims,failure==='approval'?0:1);
});
test('corrupt S3 proof fails before any control ledger mutation',async()=>{
  const f=await operationsFixtureV6();f.objects.get(f.resultReference.key).value.requestSha256='0'.repeat(64);
  const bridge=createRecoveryHandoff({...f,scope:f.scope,ports:f.ports,now:f.now}),out=await bridge.once({planSha256:f.review.planSha256,runId:'123456789',
    resultReference:f.resultReference,manifestReference:f.manifestReference,manifestSha256:f.manifest.manifestSha256});
  assert.equal(out.phase,'FULL_RECONSTRUCTION');assert.equal(f.effects.observations,0);assert.equal(f.effects.owners,0);
});
