import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {a604Fixture} from './fixtures/platform-a604-cloud-v1.mjs';
import {createContinuousReviewFlow,CONTINUOUS} from '../ops/platform-a604-operator-v1/continuous.mjs';
import {extractReviewReference,createContinuousIo} from '../ops/platform-a604-operator-v1/continuous-io.mjs';
import {createA604Policy,oldHistory,INSTALLATION} from '../ops/platform-a604-operator-v1/policy.mjs';
import {D} from '../ops/platform-a604-operator-v1/scope.mjs';
import {createA604PublisherOperations} from '../ops/platform-a604-operator-v1/publisher.mjs';
import {createA604Publisher} from '../ops/platform-a604-cloud-v1/control.mjs';
import {createA604Runtime} from '../ops/platform-a604-cloud-v1/runtime.mjs';
import {environmentProof} from '../ops/platform-delegated-approval-v1/policy.mjs';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';
import {parseArgs} from '../ops/platform-a604-operator-v1/local.mjs';

async function fixture(fault){
  const f=await a604Fixture();let at=f.at,tracking=false;const now=()=>at,events=[],writes=[],records=[],entries=new Map();
  const installation=await f.readObject(f.installationReference);
  assert.equal(await sha256Hex(installation.value),INSTALLATION.sha256);
  f.objects.set(INSTALLATION.key,{...installation,versionId:INSTALLATION.versionId});
  const env={...f.env,TECHLONG_INPUT_INSTALLATION:canonicalJson(INSTALLATION)};
  let state=normalizedState({...f.projection,jobs:f.observed.jobs});const held=structuredClone(state);
  const requestEvidence={schema:'synthetic/continuous-request',transactionAt:f.at,afterSha256:await sha256Hex(held)};
  const policy=createA604Policy({publication:f.publication,profile:f.profile,baselineSha256:requestEvidence.afterSha256});
  const grant=await policy.grant({sourceCommit:f.sourceCommit,pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i,sha256:'a'.repeat(64)})),
    ci:{sourceCommit:f.sourceCommit,testedSourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    environment:environmentProof({name:D.environment,protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:14145707}}]}],can_admins_bypass:false}),
    history:oldHistory(Array.from({length:8},(_,i)=>({jobId:'job_9b57b43a6b88f37202b29170',planSha256:(i+1).toString(16).repeat(64),
      actionSha256:'a'.repeat(64),riskSha256:'b'.repeat(64),sourceCommit:'c'.repeat(40),mode:'Review',expiresAt:1,state:'EXPIRED',runId:null}))),
    key:{length:2000,contentRead:false,protectionSha256:'c'.repeat(64)},auth:{length:100,contentRead:false,aclSha256:'e'.repeat(64)},issuedAt:at});
  const writeOwner=async q=>{
    const phase=q.text.includes('attest_evidence')?'proof':'publish';if(tracking){writes.push(phase);if(fault===phase)throw Error('SYNTHETIC_UNKNOWN_WRITE');}
    if(phase==='proof'){entries.get(q.values[0]).attempt.proofSha256=q.values[1];state.ledger.attempts.find(a=>a.plan_sha===q.values[0]).proof_sha=q.values[1];}
    else{const v=await validatePlan(JSON.parse(q.values[3]),f.release,at);entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});
      state.ledger.plans.push({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:v.plan.riskSha256,body:v.plan,job_id:D.jobId,mode:v.plan.mode,
        expires_at:new Date(v.plan.expiresAt).toISOString(),created_at:new Date(at).toISOString()});}
  };
  const loadPlan=async sha=>structuredClone(entries.get(sha));
  const initial=await createA604Publisher({publication:f.publication,profile:f.profile,basis:f.basis,now,
    ports:{guard:async()=>{},readObject:f.readObject,readRun:async id=>f.rawRun(id),readHeldJob:async()=>f.observed,loadPlan,writeOwner}});
  const seed=await initial.publishReview({installationReference:INSTALLATION,recoveryPackageReference:f.pkgRef});
  assert.deepEqual(seed.plan,grant.seed.plan);assert.equal(seed.planSha256,grant.seed.planSha256);assert.equal(seed.actionSha256,grant.seed.actionSha256);
  const runtime=createA604Runtime({publication:f.publication,profile:f.profile,now});
  const publisher=createA604PublisherOperations({publication:f.publication,profile:f.profile,requestEvidence,now});
  const flow=createContinuousReviewFlow({policy,publisher,runtime,profile:f.profile,requestEvidence,now}),outer=await flow.makeReview({grant,createdAt:at});
  let reviewed;
  const db={loadPlan,snapshot:async()=>structuredClone(state),writeOwner,close:async()=>{},observe:async sha=>{
    writes.push('observe');if(fault==='observe')throw Error('SYNTHETIC_UNKNOWN_WRITE');
    Object.assign(entries.get(sha).attempt,{state:'OBSERVED',status:'completed',conclusion:'success'});
    Object.assign(state.ledger.attempts.find(a=>a.plan_sha===sha),{state:'OBSERVED',run_status:'completed',conclusion:'success',observed_at:new Date(at).toISOString()});}};
  const publisherIo={assertSource:async()=>{},verifyCi:async()=>{},verifySourceIdentity:async()=>{},open:async()=>db,claim:async()=>events.push('publisherClaim'),
    record:async(n,v)=>records.push({n,v}),readRun:async id=>f.rawRun(id),readObject:f.readObject,close:async()=>events.push('publisherClose')};
  const io={assertSource:async()=>{},assertUnused:async()=>{if(fault==='occupied')throw Error('SLOT_OCCUPIED');},verifyCi:async()=>{},claim:async()=>events.push('outerClaim'),
    record:async(n,v)=>records.push({n,v}),
    dispatchReview:async()=>{events.push('dispatchReview');if(fault==='dispatch')return {outcome:'UNKNOWN_ACK'};
      entries.get(seed.planSha256).attempt={state:'ACKNOWLEDGED',runId:'123456797',status:null,conclusion:null,proofSha256:null};
      state.ledger.approvals.push({plan_sha:seed.planSha256,admin_id:D.admin,approved_at:new Date(at).toISOString()});
      state.ledger.attempts.push({plan_sha:seed.planSha256,job_id:D.jobId,mode:'Review',state:'ACKNOWLEDGED',run_id:'123456797',run_status:null,conclusion:null,proof_sha:null,observed_at:null});
      return {outcome:'DELEGATED_DISPATCH_ACKNOWLEDGED_REQUIRES_USER_GITHUB_APPROVAL',mode:'Review',planSha256:seed.planSha256,runId:'123456797'};},
    waitReview:async()=>{events.push('humanGithubApproval');if(fault==='reviewFailure')return {...f.rawRun('123456797'),conclusion:'failure'};
      reviewed=await createA604Runtime({publication:f.publication,profile:f.profile,now}).run({env,closure:f.closure,ports:f.ports});
      return f.rawRun(fault==='wrongRun'?'123456799':'123456797');},
    capture:async()=>{events.push('capture');if(fault==='late')at+=12*60000;
      const result=(await f.readObject(reviewed.saved)).value,refs=[reviewed.saved,result.cloudReportReference,f.pkgRef,INSTALLATION],objects=[];
      for(const reference of refs)objects.push({reference,object:await f.readObject(reference)});
      if(fault==='badBytes')objects[0].object.value.outcome='FORGED';if(fault==='missingObject')objects.pop();
      const snapshot=structuredClone(state);if(fault==='business')snapshot.deployment.admissionSnapshot.subscription.status='paused';
      return {entry:await loadPlan(seed.planSha256),snapshot,objects,resultReference:reviewed.saved};},
    publisherIo:async()=>{events.push('publisherIo');tracking=true;return publisherIo;},close:async()=>events.push('close')};
  return {flow,outer,io,events,writes,records,grant,state:()=>state,now};
}

test('preapproved continuous Review uses real content verifier and three-write independent publisher without another chat gate',async()=>{
  const f=await fixture(),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
  assert.equal(r.outcome,'CONTINUOUS_REVIEW_VERIFIED_RUNONCE_PLAN_PUBLISHED_NOT_DISPATCHED',JSON.stringify(r));
  assert.deepEqual(f.writes,['observe','proof','publish']);assert.equal(r.successor.independentReadbackVerified,true);
  assert.equal(r.runOnceDispatched,false);assert.equal(f.outer.effects.runOnceDispatchMax,0);assert.equal(f.outer.policy.approveGithubEnvironment,false);
  assert.deepEqual(f.events,['outerClaim','dispatchReview','humanGithubApproval','capture','publisherIo','publisherClaim','publisherClose','close']);
  const derived=f.records.find(r=>r.n==='derived-publisher-review').v;
  assert.equal(derived.outerSha256,f.outer.manifestSha256);assert.equal(derived.review.action.runId,'123456797');
  assert(f.records.findIndex(r=>r.n==='derived-publisher-review')<f.records.findIndex(r=>r.n==='publisher-intent'));
  await assert.rejects(f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io}),/MEMORY_ONCE/);
});

for(const fault of ['occupied','dispatch','reviewFailure','wrongRun','badBytes','missingObject','business','late'])test('continuous '+fault+' stops without publisher writes or a dispatch retry',async()=>{
  const f=await fixture(fault),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
  assert.equal(r.outcome,'CONTINUOUS_REVIEW_STOPPED_REQUIRES_READBACK');assert.deepEqual(f.writes,[]);
  assert(f.events.filter(e=>e==='dispatchReview').length<=1);assert(!f.events.includes('publisherIo'));assert.equal(r.runOnceDispatched,false);
  if(fault==='late')assert.equal(r.code,'DELEGATED_PUBLISHER_INSUFFICIENT_HANDOFF_RESERVE');
});

for(const fault of ['observe','proof','publish'])test('unknown '+fault+' ACK preserves partial state and never retries or dispatches RunOnce',async()=>{
  const f=await fixture(fault),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
  assert.equal(r.outcome,'CONTINUOUS_REVIEW_STOPPED_REQUIRES_READBACK');assert.equal(r.phase,'PUBLISH');assert.equal(r.knownAck.runId,'123456797');
  assert.equal(f.writes.filter(p=>p===fault).length,1);assert.equal(f.events.filter(e=>e==='dispatchReview').length,1);assert.equal(r.runOnceDispatched,false);
});

test('old Review-only grant or changed outer budget is never continuous approval',async()=>{
  const f=await fixture();assert.notEqual(f.grant.grantSha256,f.outer.manifestSha256);
  await assert.rejects(f.flow.run({manifest:f.outer,approved:f.grant.grantSha256,io:f.io}),/APPROVAL/);
  const changed=structuredClone(f.outer);changed.effects.runOnceDispatchMax=1;
  await assert.rejects(f.flow.run({manifest:changed,approved:f.outer.manifestSha256,io:f.io}),/APPROVAL/);assert.deepEqual(f.events,[]);
});

test('log reference extraction accepts only one exact Review/run/job and never arbitrary keys',()=>{
  const job=D.jobId,id='123456797',sha='a'.repeat(64),value={mode:'Review',jobId:job,manifestSha256:sha,
    saved:{key:`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/${job}/${sha}/run-${id}-1/platform-result-v6.json`,versionId:'fixed',sha256:'b'.repeat(64)}};
  const text='2026-10-27 '+JSON.stringify(value);assert.deepEqual(extractReviewReference(text,{jobId:job,runId:id}),value.saved);
  assert.throws(()=>extractReviewReference(text+'\n'+text,{jobId:job,runId:id}));
  assert.throws(()=>extractReviewReference(text,{jobId:job,runId:'123456798'}));
  assert.throws(()=>extractReviewReference(JSON.stringify({...value,saved:{...value.saved,key:'other/key'}}),{jobId:job,runId:id}));
  assert.doesNotThrow(()=>createContinuousIo({manifest:{grant:{}},record:async()=>{}}));
});

test('CLI has explicit prepare/run modes, no resume/profile/run-id override, and check remains zero I/O',()=>{
  assert.equal(parseArgs(['--mode','PrepareContinuousSaved','--grant','F:/ChatGPT_workshop/techlong-fixture/grant.json','--output','F:/ChatGPT_workshop/techlong-a604-operator-fixture'])['--mode'],'PrepareContinuousSaved');
  for(const flag of ['--resume','--run-id','--profile'])assert.throws(()=>parseArgs(['--mode','RunContinuousReviewed','--manifest','x','--approved-sha','a'.repeat(64),flag,'override']));
  assert.notEqual(CONTINUOUS.slot,'F:/ChatGPT_workshop/techlong-a604-delegation-v1-Review.intent.json');
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-a604-operator-v1/local.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.privateReads+v.sqlConnections+v.awsCalls+v.dispatches,0);assert.equal(v.executionAuthorized,false);
});
