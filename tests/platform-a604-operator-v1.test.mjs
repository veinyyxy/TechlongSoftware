import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {a604Fixture} from './fixtures/platform-a604-cloud-v1.mjs';
import {createDispatchOperation} from '../ops/platform-delegated-approval-v1/operation.mjs';
import {createA604Policy,oldHistory,auditKey,slot} from '../ops/platform-a604-operator-v1/policy.mjs';
import {D,publicationAt,PUBLISH_SLOT,LOCAL_PUBLICATION} from '../ops/platform-a604-operator-v1/scope.mjs';
import {createPackageCandidateBuilder} from '../ops/platform-a604-operator-v1/package.mjs';
import {createA604PublisherOperations} from '../ops/platform-a604-operator-v1/publisher.mjs';
import {parseArgs,assertPreparationReadiness} from '../ops/platform-a604-operator-v1/local.mjs';
import {SNAPSHOT_MAX_AGE_MS} from '../ops/platform-a604-publication-v1/readiness.mjs';
import {environmentProof} from '../ops/platform-delegated-approval-v1/policy.mjs';
import {verifyAuditPermission,appFetchGuard} from '../ops/platform-delegated-approval-v1/io.mjs';
import {createA604Runtime} from '../ops/platform-a604-cloud-v1/runtime.mjs';
import {createA604Publisher} from '../ops/platform-a604-cloud-v1/control.mjs';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {EVIDENCE_V5 as E} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
const ep=()=>environmentProof({name:D.environment,protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:14145707}}]}],can_admins_bypass:false});
const history=()=>oldHistory(Array.from({length:8},(_,i)=>({jobId:'job_9b57b43a6b88f37202b29170',planSha256:(i+1).toString(16).repeat(64),
  actionSha256:'a'.repeat(64),riskSha256:'b'.repeat(64),sourceCommit:'c'.repeat(40),mode:'Review',expiresAt:1,state:'EXPIRED',runId:null})));
async function grantFixture(){const f=await a604Fixture(),policy=createA604Policy({publication:f.publication,profile:f.profile,baselineSha256:'d'.repeat(64)});
  const g=await policy.grant({sourceCommit:f.sourceCommit,pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'a'.repeat(64)})),
    ci:{sourceCommit:f.sourceCommit,testedSourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},environment:ep(),history:history(),
    key:{length:2000,contentRead:false,protectionSha256:'c'.repeat(64)},auth:{length:100,contentRead:false,aclSha256:'e'.repeat(64)},issuedAt:f.at});return {...f,policy,g};}
test('grant preparation shares the five-hour snapshot window without changing recorded timestamps',()=>{
  const at=1700000000000,saved={checkedAt:at,expiresAt:at+1000},original=structuredClone(saved);
  assert.equal(SNAPSHOT_MAX_AGE_MS,5*3600000);
  for(const age of [0,2*3600000,SNAPSHOT_MAX_AGE_MS-1])assert.doesNotThrow(()=>assertPreparationReadiness(saved,at+age));
  for(const now of [at-1,at+SNAPSHOT_MAX_AGE_MS,at+SNAPSHOT_MAX_AGE_MS+1,NaN,Infinity,at+0.5,'1700000000000']){
    assert.throws(()=>assertPreparationReadiness(saved,now),/READINESS_AGE/);
  }
  for(const checkedAt of [undefined,null,-1,NaN,Infinity,at+0.5,String(at)]){
    assert.throws(()=>assertPreparationReadiness({checkedAt},at),/READINESS_AGE/);
  }
  assert.throws(()=>assertPreparationReadiness(null,at),/READINESS_AGE/);assert.deepEqual(saved,original);
});

test('new delegation has independent scope/slots and cannot be mistaken for a9b grant',async()=>{
  const f=await grantFixture();await f.policy.approve(f.g,f.g.grantSha256,f.at);
  assert.equal(f.g.schema,'techlong/a604-delegated-approval/v1');assert.equal(f.g.policy.jobId,D.jobId);assert.equal(f.g.policy.approveGithubEnvironment,false);
  assert.equal(f.g.policy.createStackMax,1);assert.equal(f.g.policy.resourcesMax,7);assert(!slot('Review').includes('approval-v1-'));
  assert.notEqual(slot('Review'),PUBLISH_SLOT);assert(auditKey(f.g.grantSha256,'Review').includes(D.jobId+'/a604-delegation-v1/'));
  for(const mutate of [g=>g.schema='techlong/delegated-platform-approval/v1',g=>g.policy.jobId='job_9b57b43a6b88f37202b29170',g=>g.policy.approveGithubEnvironment=true]){
    const g=structuredClone(f.g);mutate(g);await assert.rejects(f.policy.approve(g,g.grantSha256,f.at));}
});
test('all-mode history projection preserves actual state/proof but excludes only new a604 plans',()=>{
  const h=history();assert.deepEqual(oldHistory([...h,{jobId:D.jobId}]),h);
  const changed=structuredClone(h);changed[0].state='OBSERVED';changed[0].proofSha256='f'.repeat(64);assert.notDeepEqual(oldHistory(changed),h);
  assert.throws(()=>oldHistory(h.slice(1)));
});
test('new RunOnce and Inspect dispatch targets require the same a604 seed and trusted proof chain',async()=>{
  const f=await grantFixture(),seed={...f.g.seed,riskSha256:f.g.seed.plan.riskSha256,
    attempt:{state:'OBSERVED',runId:'123456797',status:'completed',conclusion:'success',proofSha256:'a'.repeat(64)}},entries=new Map([[seed.planSha256,seed]]);
  const envelope='b'.repeat(64),ref={key:`worker-v5/${seed.plan.instanceId}/${D.jobId}/${envelope}/manifest.json`,versionId:'fixed',sha256:'c'.repeat(64)};
  const plan={...structuredClone(seed.plan),mode:'RunOnce',predecessor:{planSha256:seed.planSha256,runId:'123456797',proofSha256:'a'.repeat(64)}};
  Object.assign(plan.inputs,{mode:'RunOnce',manifest:canonicalJson(ref),manifestSha:envelope});
  const valid=await validatePlan(plan,f.release,f.at),run={...valid,riskSha256:valid.plan.riskSha256,attempt:null};
  await f.policy.target(f.g,run,async sha=>entries.get(sha),f.at);
  const parent={...run,attempt:{state:'OBSERVED',runId:'123456798',status:'completed',conclusion:'success',proofSha256:'d'.repeat(64)}};entries.set(run.planSha256,parent);
  const inspect=structuredClone(plan);inspect.mode='Inspect';inspect.inputs.mode='Inspect';
  inspect.inputs.execution=canonicalJson({key:`worker-v5/${plan.instanceId}/${D.jobId}/${envelope}/execution-reference-123456798-v1.json`,versionId:'fixed',sha256:'e'.repeat(64)});
  inspect.predecessor={planSha256:run.planSha256,runId:'123456798',proofSha256:'d'.repeat(64)};
  const iv=await validatePlan(inspect,f.release,f.at);await f.policy.target(f.g,{...iv,riskSha256:inspect.riskSha256,attempt:null},async sha=>entries.get(sha),f.at);
  entries.get(seed.planSha256).attempt.proofSha256='0'.repeat(64);
  await assert.rejects(f.policy.target(f.g,{...iv,riskSha256:inspect.riskSha256,attempt:null},async sha=>entries.get(sha),f.at),/INSPECT_ANCHOR/);
});
test('a604 delegated Review persists audit before seed/begin/dispatch and retains human GitHub decision',async()=>{
  const f=await grantFixture(),entries=new Map(),calls=[];
  const io={assertSource:async()=>{},verifyCi:async()=>{},environment:async()=>f.g.environment,preflight:async()=>{},status:async()=>f.g.history,
    loadPlan:async sha=>entries.get(sha)??null,claim:async()=>calls.push('claim'),record:async()=>{},persistAudit:async key=>{assert(key.includes(D.jobId));calls.push('audit');},
    publishSeed:async v=>{calls.push('publish');entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});},
    begin:async()=>calls.push('begin'),assertLive:async()=>{},acknowledge:async(sha,ack)=>{entries.get(sha).attempt={state:'ACKNOWLEDGED',runId:ack.runId};},
    markUnknown:async()=>calls.push('unknown'),dispatch:async(p,before,ack)=>{calls.push('dispatch');await before();await ack({runId:'123456797'});},close:async()=>calls.push('close')};
  const run=createDispatchOperation({definition:D,approve:f.policy.approve,target:f.policy.target,history:oldHistory,key:auditKey,historyModes:D.modes});
  const r=await run({grant:f.g,approved:f.g.grantSha256,mode:'Review',planSha256:f.g.seed.planSha256,io,now:f.now});
  assert(r.outcome.includes('ACKNOWLEDGED'));assert.deepEqual(calls,['claim','audit','publish','begin','dispatch','close']);assert.equal(r.githubEnvironmentApprovedByAgent,false);
});
test('new audit permission must prove the exact new prefix; legacy prefix cannot pass',async()=>{
  const f=await grantFixture(),resource=`arn:aws:s3:::${E.bucket}/${auditKey(f.g.grantSha256,'Review')}`;
  const r={EvaluationResults:[{EvalActionName:'s3:PutObject',EvalResourceName:resource,EvalDecision:'allowed',MissingContextValues:[]}]};
  assert.doesNotThrow(()=>verifyAuditPermission(r,f.g.grantSha256,'Review',auditKey));
  assert.throws(()=>verifyAuditPermission(r,f.g.grantSha256,'Review'));
  const counts={appHttp:0};const guard=appFetchGuard({guard:async()=>{},counts,fetcher:async()=>{throw Error('MUST_NOT_FETCH');}});
  await assert.rejects(guard('https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/123/pending_deployments',{method:'POST',redirect:'manual'}));
});
test('package preview reconstructs original evidence with fixed post-facts without authorizing upload/window',async()=>{
  const f=await a604Fixture(),projection=f.projection,after={...projection,jobs:[...projection.jobs,{id:D.jobId}]};
  const profile=f.profile,builder=createPackageCandidateBuilder({profile,originalSha256:await sha256Hex(f.pkg),derive:async()=>({proposedProfile:profile})});
  const r=await builder({originalPackage:f.pkg,handoff:{after},createdAt:f.at+1});
  assert.equal(r.state,'CANDIDATE_NOT_APPROVED');assert.equal(r.newFactsWindowApproved,false);assert.equal(r.approvedForUpload,false);
  assert.equal(r.proposedNewExpiresAt,profile.factsAt+profile.validMs);assert.equal(r.packageValue.inputs.createdAt,f.at+1);
  const altered=structuredClone(f.pkg);altered.objects[0].object.value={};await assert.rejects(builder({originalPackage:altered,handoff:{after},createdAt:f.at+2}));
});
test('publisher accepts the real pre-basis held timestamp and performs only observe/proof/RunOnce publication',async()=>{
  const f=await a604Fixture(),at=f.at-1000;f.observed.job.created_at=at;f.observed.job.updated_at=at;
  const payload=JSON.parse(f.observed.job.payload);payload.requestedAt=at;f.observed.job.payload=JSON.stringify(payload);
  f.observed.jobs=f.observed.jobs.map(j=>j.id===D.jobId?structuredClone(f.observed.job):j);
  let state=normalizedState({...f.projection,jobs:f.observed.jobs}),entries=new Map(),submissions=[];
  const evidence={schema:'synthetic/handoff',transactionAt:at,afterSha256:await sha256Hex(state)};
  const db={loadPlan:async sha=>structuredClone(entries.get(sha)),snapshot:async()=>structuredClone(state),close:async()=>{},
    observe:async sha=>{submissions.push('observe');Object.assign(entries.get(sha).attempt,{state:'OBSERVED',status:'completed',conclusion:'success'});
      Object.assign(state.ledger.attempts.find(a=>a.plan_sha===sha),{state:'OBSERVED',run_status:'completed',conclusion:'success',observed_at:new Date(f.at).toISOString()});},
    writeOwner:async q=>{if(q.text.includes('attest_evidence')){submissions.push('proof');entries.get(q.values[0]).attempt.proofSha256=q.values[1];state.ledger.attempts.find(a=>a.plan_sha===q.values[0]).proof_sha=q.values[1];}
      else{submissions.push('publish');const v=await validatePlan(JSON.parse(q.values[3]),f.release,f.at);entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});
        state.ledger.plans.push({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:v.plan.riskSha256,body:v.plan,job_id:D.jobId,mode:v.plan.mode,expires_at:new Date(v.plan.expiresAt).toISOString(),created_at:new Date(f.at).toISOString()});}}};
  const publisher=await createA604Publisher({publication:f.publication,profile:f.profile,basis:f.basis,now:f.now,ports:{guard:async()=>{},readObject:f.readObject,
    readHeldJob:async()=>f.observed,loadPlan:db.loadPlan,readRun:async id=>f.rawRun(id),writeOwner:db.writeOwner}});
  const seed=await publisher.publishReview({installationReference:f.installationReference,recoveryPackageReference:f.pkgRef});submissions=[];
  const cloud=await createA604Runtime({publication:f.publication,profile:f.profile,now:f.now}).run({env:f.env,closure:f.closure,ports:f.ports});
  const e=entries.get(seed.planSha256);e.attempt={state:'ACKNOWLEDGED',runId:'123456797',status:null,conclusion:null,proofSha256:null};
  state.ledger.approvals.push({plan_sha:seed.planSha256,admin_id:D.admin,approved_at:new Date(f.at).toISOString()});
  state.ledger.attempts.push({plan_sha:seed.planSha256,job_id:D.jobId,mode:'Review',state:'ACKNOWLEDGED',run_id:'123456797',run_status:null,conclusion:null,proof_sha:null,observed_at:null});
  const ops=createA604PublisherOperations({publication:f.publication,profile:f.profile,requestEvidence:evidence,now:f.now}),inner=f.puts[0].value.innerManifest;
  const m=await ops.makeReview({binding:f.publication,basis:f.basis,baseline:state,reviewEntry:structuredClone(e),requestEvidence:evidence,
    action:{operation:'AdvanceReview',planSha256:seed.planSha256,runId:'123456797',resultReference:cloud.saved},
    timing:{preparedAt:inner.jobPlan.preparedAt,claimBy:inner.jobPlan.claimBy,workloadExpiresAt:inner.workload.workloadExpiresAt},
    pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i,sha256:'1'.repeat(64)})),ci:{sourceCommit:f.sourceCommit,testedSourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    auth:{contentRead:false,length:100,aclSha256:'2'.repeat(64)},createdAt:f.at});
  const io={assertSource:async()=>{},verifyCi:async()=>{},verifySourceIdentity:async()=>{},open:async()=>db,claim:async()=>{},record:async()=>{},
    readRun:async id=>f.rawRun(id),readObject:f.readObject,close:async()=>{}};
  const r=await ops.runReviewed({manifest:m,basis:f.basis,approved:m.manifestSha256,io,now:f.now});
  assert.equal(r.outcome,'DELEGATED_RUNONCE_PUBLISHED_REQUIRES_SEPARATE_DISPATCH',JSON.stringify(r));assert.deepEqual(submissions,['observe','proof','publish']);
  assert.equal(r.plan.jobId,D.jobId);assert.equal(m.slot,PUBLISH_SLOT);assert.equal(m.protectedHistoricalPlanShas.length,0);
});
test('default publication remains closed and CLI has no job/profile/binding override',async()=>{
  if(LOCAL_PUBLICATION.state==='UNPUBLISHED')await assert.rejects(publicationAt('a'.repeat(40),Date.now()),/NOT_PUBLISHED/);
  else{const at=LOCAL_PUBLICATION.template.factsApproval.observedBy,p=await publicationAt('a'.repeat(40),at);
    assert.equal(p.release.reusableCommit,LOCAL_PUBLICATION.reusableCommit);assert.equal(p.factsApproval.originalBasisExtended,false);
    await assert.rejects(publicationAt('a'.repeat(40),p.factsApproval.expiresAt));}
  assert.equal(parseArgs(['--check']).mode,'Check');
  for(const args of [[],['--mode','DispatchReviewed','--grant','x','--approved-sha','x','--action','Review','--plan-sha','a'.repeat(64),'--job','other'],
    ['--mode','PreparePackageSaved','--ci-run','1','--output','F:/arbitrary']])assert.throws(()=>parseArgs(args));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-a604-operator-v1/local.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.privateReads+v.sqlConnections+v.awsCalls+v.dispatches,0);assert.equal(v.executionAuthorized,false);
});
