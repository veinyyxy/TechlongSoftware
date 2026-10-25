import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {recoveryFixture} from './fixtures/platform-recovery-v1.mjs';
import {recoveryData,prepareRecoveryBasis} from '../ops/platform-recovery-v1/basis.mjs';
import {compileRecoveryRequest,makeRecoveryRequestReview,verifyRecoveryRequestReadback,createRecoveryRequestTransaction} from '../ops/platform-recovery-v1/request.mjs';
import {createRecoveryWorker,recoveryEnvelope} from '../ops/platform-recovery-v1/worker.mjs';
import {continueCloudContextV5} from '../ops/cloud-worker/cloud-worker-root-v5.mjs';
import {loadNeonContractV5} from '../ops/cloud-worker/neon-contract-v5.mjs';
import {platformClosureV6} from '../ops/platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {canonicalJson} from '../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
import {parseSavedArgs} from '../ops/platform-recovery-v1/saved.mjs';

test('full execution evidence plus retirement creates only an unaccepted recovery basis; no owner write',async()=>{
  const f=await recoveryFixture(),d=recoveryData(f.basis,f.at);assert.equal(f.basis.disposition.independentAcceptance,false);
  assert.equal(f.basis.disposition.executionSucceeded,true);assert.equal(f.basis.disposition.acceptedLineageAppend,false);
  assert.equal(d.context.predecessor.jobId,f.profile.oldJobId);assert.equal(d.context.acceptedPredecessor.jobId,f.context.predecessor.jobId);
  assert.equal(d.context.executionAuthorized,false);assert(Object.isFrozen(d));assert(Object.isFrozen(d.context));
  assert.throws(()=>recoveryData(JSON.parse(JSON.stringify(f.basis)),f.at));
  await assert.rejects(continueCloudContextV5(f.context,[f.basis]));
  await assert.rejects(prepareRecoveryBasis(f.input),'fixed production profile cannot select a synthetic case');
});
for(const fault of ['receipt','state','lease','pending','uuid','resource','duplicate','status','futureDelete','wrongRun','wrongActor','resultRef','expired','futureFacts','providerHash','planNotInLedger'])
test('reject malformed or drifting recovery evidence: '+fault,async()=>{
  const f=await recoveryFixture(),v={...f.input,state:structuredClone(f.state),retirement:structuredClone(f.retirement),execution:structuredClone(f.input.execution)};
  if(fault==='receipt')v.state.deployment.outputs.expressInitializedWorkerRunsV2[f.profile.oldJobId].initializedVerified=false;
  if(fault==='state')v.state.deployment.status='failed';
  if(fault==='lease')v.state.jobs[0].lease_owner='synthetic-worker';
  if(fault==='pending')v.state.jobs[0].status='pending';
  if(fault==='uuid')v.retirement.stackId=v.retirement.stackId.replace(/.$/,'a');
  if(fault==='resource')v.retirement.resources[0].PhysicalResourceId='different';
  if(fault==='duplicate')v.retirement.resources[0]=v.retirement.resources[1];
  if(fault==='status')v.retirement.resources[0].ResourceStatus='DELETE_IN_PROGRESS';
  if(fault==='futureDelete')v.retirement.deletionTime=new Date(f.at+60000).toISOString();
  if(fault==='wrongRun')v.execution.runId='123456799';
  if(fault==='wrongActor')v.execution.run.actor.id=1;
  if(fault==='planNotInLedger')v.execution.plan.preparedAt++;
  if(fault==='resultRef')v.execution.resultReference.versionId='different-version';
  if(fault==='expired')v.createdAt=f.profile.factsAt+f.profile.validMs;
  if(fault==='futureFacts')v.createdAt=f.profile.observedBy-1;
  if(fault==='providerHash')v.readObject=async ref=>{const o=await f.ports.readObject(ref);if(ref.key.endsWith('provider-after.json'))o.value.imageUri='different';return o;};
  await assert.rejects(f.compile(v));
});
test('the new held-request compiler is insert-only, deterministic, and preserves every old successful row',async()=>{
  const f=await recoveryFixture(),p=await compileRecoveryRequest(f.basis,f.at),before=canonicalJson(f.state);
  assert.equal(p.jobId,f.profile.newJobId);assert.equal(p.payload.cloudExecutionAuthorized,false);assert.equal(p.values[4],Number.MAX_SAFE_INTEGER);
  assert.doesNotMatch(p.text,/\b(?:UPDATE|DELETE)\s+public\./i);assert.equal(canonicalJson(f.state),before);
  const m=await makeRecoveryRequestReview({basis:f.basis,sourceCommit:f.sourceCommit,createdAt:f.at});
  assert.equal(m.effects.oldTaskUpdates,0);assert.equal(m.target.slot,f.profile.requestSlot);assert.equal(m.policy.productionEntryInstalled,false);
  const r=await verifyRecoveryRequestReadback(f.basis,f.makeAfter(p),f.at);assert.equal(r.cloudExecutionAuthorized,false);
  const changed=f.makeAfter(p);changed.jobs.find(j=>j.id===f.profile.oldJobId).status='canceled';await assert.rejects(verifyRecoveryRequestReadback(f.basis,changed,f.at));
});
async function transactionRig(fault){
  const f=await recoveryFixture(),review=await makeRecoveryRequestReview({basis:f.basis,sourceCommit:f.sourceCommit,createdAt:f.at}),sql=[],claims=[];
  let state=structuredClone(f.state),inserted=false;
  const p=await compileRecoveryRequest(f.basis,f.at),client={async query(text){sql.push(text);
    if(text.startsWith('SELECT floor('))return {rows:[{at:f.at}]};
    if(text.startsWith('SELECT id FROM public.deployment_jobs'))return {rows:state.jobs.map(j=>({id:j.id}))};
    if(text.includes(') SELECT id FROM locked'))return {rowCount:1};
    if(text.includes(') INSERT INTO public.deployment_jobs')){if(fault==='insert')throw Error('synthetic private error');state=f.makeAfter(p);inserted=true;return {rowCount:1};}
    if(text==='COMMIT'&&fault==='commit')throw Error('synthetic commit lost');return {rows:[],rowCount:0};}};
  const op=createRecoveryRequestTransaction({client,now:()=>f.at,readState:async()=>state,assertApproved:async()=>{},claimPermanent:async v=>{
    claims.push(v);if(fault==='claim')throw Error('ambiguous slot');},record:async()=>{if(fault==='record')throw Error('local disk');}});
  return {...f,review,op,sql,claims,wasInserted:()=>inserted};
}
test('transaction locks admission/history, claims once, inserts once, reads back and requires independent inspection',async()=>{
  const f=await transactionRig(),r=await f.op({review:f.review,basis:f.basis,approved:f.review.manifestSha256});
  assert.equal(r.committed,true);assert.equal(r.oldTaskUpdates,0);assert.equal(f.claims.length,1);
  assert.equal(f.sql.filter(s=>s.includes(') INSERT INTO public.deployment_jobs')).length,1);
  assert(f.sql.indexOf('COMMIT')>f.sql.findIndex(s=>s.includes(') INSERT INTO')));
  assert(!f.sql.some(s=>/^UPDATE|^DELETE/.test(s)));await assert.rejects(f.op({review:f.review,basis:f.basis,approved:f.review.manifestSha256}));
});
for(const fault of ['claim','record','insert','commit'])test('request '+fault+' ambiguity has no retry or compensating write',async()=>{
  const f=await transactionRig(fault),r=await f.op({review:f.review,basis:f.basis,approved:f.review.manifestSha256});
  assert.equal(r.retryAllowed,false);assert.equal(f.claims.length,1);assert(!JSON.stringify(r).includes('synthetic private'));
  if(fault==='commit'){assert.equal(r.commitSubmissionAttempted,true);assert(!f.sql.includes('ROLLBACK'));}
  else assert(f.sql.includes('ROLLBACK'));
  assert(f.sql.filter(s=>s.includes(') INSERT INTO')).length<=1);
});
test('wrong request approval is rejected before any injected query or permanent claim',async()=>{
  const f=await transactionRig();await assert.rejects(f.op({review:f.review,basis:f.basis,approved:'0'.repeat(64)}));
  assert.deepEqual(f.sql,[]);assert.deepEqual(f.claims,[]);
});

async function workerRig(fault){
  const f=await recoveryFixture(),events=[],p=await compileRecoveryRequest(f.basis,f.at),newState=f.makeAfter(p),d=recoveryData(f.basis,f.at);
  const observed=structuredClone(f.observed);observed.job={...newState.jobs.find(j=>j.id===p.jobId),payload:canonicalJson(p.payload)};
  observed.jobs=[...newState.jobs.filter(j=>j.id!==p.jobId),structuredClone(observed.job)];observed.requester={id:ADMIN,status:'active',is_platform_admin:1};observed.checkedAt=f.at;
  const dependencies={code:{commitSha:f.sourceCommit,closureSha256:B.platform.closureSha256},run:f.run('123456795'),
    installation:f.installation,contract:await loadNeonContractV5(),
    openDatabase:async()=>{events.push('db.open');return {verify:async()=>{},read:async()=>structuredClone(observed)};},
    provider:{readCell:async()=>({stackId:d.context.base.compute.stackId,outputs:Object.fromEntries(['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k=>[k,d.context.base.compute.outputs[k]])),
      parentTagExpiresAt:d.context.base.compute.outputs.CellExpiresAt,activeCellCount:1,activeTenantCount:0}),
      inspectBefore:async()=>{events.push('provider.preflight');return {namespacesAbsent:fault!=='namespace',retiredPredecessor:d.context.predecessor.stackId,cloudWrites:0};}},
    evidence:{verify:async()=>{},put:async()=>{events.push('evidence.put');return {synthetic:true};}}};
  const options={basis:f.basis,dependencies,now:()=>f.at,authorize:async()=>{events.push('authorize');if(fault==='approval')throw Error('not approved');},
    observeRetirement:async()=>{events.push('retirement');return {retirement:f.retirement,observedAt:fault==='stale'?f.at-30000:f.at};}};
  return {...f,events,options,worker:createRecoveryWorker(options)};
}
test('real V5 root Review works only through the distinct recovery wrapper, preserving namespace/admission checks',async()=>{
  const f=await workerRig(),r=await f.worker.review({jobId:f.profile.newJobId,signal:AbortSignal.timeout(10000)});
  assert.equal(r.review.schema,'techlong/retired-unaccepted-worker-review/v1');assert.equal(r.review.disposition.historicalIndependentAcceptance,false);
  assert.equal(r.review.innerManifest.predecessor.jobId,f.profile.oldJobId);assert.equal(r.executionApproved,false);
  assert.deepEqual(f.events.slice(0,3),['authorize','retirement','db.open']);assert(f.events.includes('provider.preflight'));
  await assert.rejects(f.worker.review({jobId:f.profile.newJobId}));
});
for(const fault of ['approval','stale','namespace'])test('recovery Review preserves '+fault+' refusal',async()=>{
  const f=await workerRig(fault);await assert.rejects(f.worker.review({jobId:f.profile.newJobId,signal:AbortSignal.timeout(10000)}));
  if(fault!=='namespace')assert(!f.events.includes('db.open'));assert(!f.events.includes('evidence.put'));
});
test('run envelope cannot swap basis/job/hash or bypass its approval before any delegated root',async()=>{
  const f=await workerRig(),r=await f.worker.review({jobId:f.profile.newJobId,signal:AbortSignal.timeout(10000)});let calls=0;
  const make=()=>createRecoveryWorker({...f.options,rootFactory:()=>{calls++;return {runOnce:async()=>({synthetic:true})};}});
  await assert.rejects(make().runOnce({review:r.review,approvedRecoveryReviewSha256:'0'.repeat(64)}));assert.equal(calls,0);
  const bad=structuredClone(r.review);bad.disposition.historicalIndependentAcceptance=true;
  await assert.rejects(make().runOnce({review:bad,approvedRecoveryReviewSha256:r.review.recoveryReviewSha256}));assert.equal(calls,0);
  const result=await make().runOnce({review:r.review,approvedRecoveryReviewSha256:r.review.recoveryReviewSha256});assert.equal(result.synthetic,true);assert.equal(calls,1);
  await assert.rejects(recoveryEnvelope(JSON.parse(JSON.stringify(f.basis)),r.review.innerManifest,f.at));
});
test('published cloud closure stays byte-identical, and the new candidate is not an active workflow import',async()=>{
  const c=await platformClosureV6();assert.equal(c.pinCount,81);assert.equal(c.closureSha256,B.platform.closureSha256);
  assert(!c.pins.some(p=>p.file.startsWith('ops/platform-recovery-v1/')));
  const w=await readFile(new URL('../.github/workflows/cloud-worker-platform-job-v6.yml',import.meta.url),'utf8');assert(!w.includes('platform-recovery-v1'));
  const ci=load(await readFile(new URL('../.github/workflows/platform-cloud-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(ci.permissions,{contents:'read'});assert(ci.jobs.candidate.steps.some(s=>s.run?.includes('tests/platform-recovery-v1.test.mjs')));
  assert.equal(S.deploymentId,'dep_7c99bd249470184852f0dc74');
});
test('saved-only CLI has no run, cloud, profile, source or execution-mode override',()=>{
  for(const args of [[],['--mode','RunReviewed','--output','F:/ChatGPT_workshop/techlong-w9e-recovery-candidate-test'],
    ['--mode','PrepareSaved','--output','../outside'],['--mode','PrepareSaved','--profile','untrusted'],
    ['--mode','PrepareSaved','--output','x','--allow-write','yes']])assert.throws(()=>parseSavedArgs(args));
  if(process.platform==='win32')assert.match(parseSavedArgs(['--mode','PrepareSaved','--output','F:/ChatGPT_workshop/techlong-w9e-recovery-candidate-test']),/candidate-test$/);
});
