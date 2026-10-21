import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {verifyCloudResultContent} from '../ops/platform-operations-v6/evidence.mjs';
import {createTrustedPublisherV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {CLOUD_V6 as C,S} from '../ops/platform-cloud-v6/contract.mjs';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {platformClosureV6} from '../ops/platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {load} from 'js-yaml';
import {assertEvidenceSafeV5} from '../ops/cloud-worker/cloud-evidence-v5.mjs';

async function runFixture(){
  const f=await platformFixtureV6(),pub=createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,ports:f.ports,now:f.now});
  const review=await f.observedPlan(f.basePlan,'123456789'),reviewRef=await f.resultFor(review.plan,'123456789');
  await pub.attestResult(review.planSha256,reviewRef);const plan=await pub.publishSuccessor(review.planSha256,reviewRef),runId='123456790',run=f.run(runId),mv=f.manifest.manifestSha256;
  const report={schema:'techlong/cloud-worker-run/v5',jobId:f.observed.job.id,manifestSha256:mv,run,result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'},retryAllowed:false};
  const reportReference=await f.store(`worker-v5/${S.instanceId}/${f.observed.job.id}/${mv}/run-${runId}-1/run.json`,report);
  const executionReference=await f.store(`worker-v5/${S.instanceId}/${f.observed.job.id}/${mv}/execution-reference-${runId}-v1.json`,{executionRun:run,executionReportReference:reportReference});
  const resultReference=await f.resultFor(plan.plan,runId,{outcome:report.result.outcome,cloudReportReference:reportReference,executionReference});
  const request={plan:plan.plan,runId,run:f.rawRun(runId),resultReference,release:f.release,sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,
    readObject:f.ports.readObject,now:f.now};
  return {...f,request,report,reportReference,executionReference};
}
async function inspectFixture(){
  const f=await runFixture(),derived=await verifyCloudResultContent({...f.request,deriveInspectPlan:true}),plan=derived.derivedInspectPlan.plan,runId='123456791';
  const body={schema:'techlong/cloud-worker-independent-inspect/v5',outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',jobId:f.observed.job.id,
    manifestSha256:f.manifest.manifestSha256,receiptSha256:'1'.repeat(64),providerObservationSha256:'2'.repeat(64),run:f.run(runId),executionRun:f.run(f.request.runId),
    journal:{state:'ALL_SLOTS_CONSUMED'},checkedAt:f.at,retryAllowed:false,cloudWrites:0,databaseWrites:0,privateControlReads:0};
  async function proof(patch={}){const changed={...structuredClone(body),...patch},report={...changed,inspectSha256:await sha256Hex(changed)};
    const ref=await f.store(`worker-v5/${S.instanceId}/${f.observed.job.id}/${f.manifest.manifestSha256}/run-${runId}-1/inspect.json`,report);
    return f.resultFor(plan,runId,{outcome:changed.outcome,cloudReportReference:ref});}
  return {...f,body,proof,request:{...f.request,plan,runId,run:f.rawRun(runId),resultReference:await proof()}};
}
test('real RunOnce reconstruction derives an Inspect plan only in memory, not a new approval or DB publication',async()=>{
  const f=await runFixture(),before=structuredClone(f.writes);const out=await verifyCloudResultContent({...f.request,deriveInspectPlan:true});
  assert.equal(out.contentVerified,true);assert.equal(out.independentCloudAcceptanceVerified,false);assert.equal(out.derivedInspectPlan.plan.mode,'Inspect');
  assert.equal(out.platformLedgerVerified,false);assert.equal(out.physicalOwnerWrites,0);assert.equal(out.proofImported,false);assert.equal(out.successorPublished,false);assert.equal(out.executionApproved,false);
  assert.deepEqual(f.writes,before);assert.equal(out.derivedInspectPlan.plan.predecessor.runId,f.request.runId);
  assert.deepEqual(JSON.parse(out.derivedInspectPlan.plan.inputs.execution),f.executionReference);
});
test('real independent Inspect verifies all report/reference/body/identity checks but never imports a platform attestation',async()=>{
  const f=await inspectFixture(),before=structuredClone(f.writes),out=await verifyCloudResultContent(f.request);
  assert.equal(out.attestation.outcome,'SUCCEEDED_INDEPENDENTLY_VERIFIED');assert.equal(out.independentCloudAcceptanceVerified,true);
  assert.equal(out.platformLedgerVerified,false);assert.equal(out.proofImported,false);assert.equal(out.derivedInspectPlan,null);assert.deepEqual(f.writes,before);
});
test('no persisted ledger is consulted or silently claimed verified',async()=>{
  const f=await runFixture();f.plans.clear();f.ports.loadPlan=()=>{throw Error('no ledger capability');};f.ports.writeOwner=()=>{throw Error('no writer');};
  const out=await verifyCloudResultContent({...f.request,deriveInspectPlan:true});assert.equal(out.platformLedgerVerified,false);assert.equal(out.physicalOwnerWrites,0);
});
test('each immutable object is read only once despite successor reconstruction',async()=>{
  const f=await runFixture(),reads=new Map();await verifyCloudResultContent({...f.request,deriveInspectPlan:true,readObject:async ref=>{
    const key=ref.key+'#'+ref.versionId;reads.set(key,(reads.get(key)??0)+1);return f.ports.readObject(ref);}});
  assert.equal(reads.size,5);assert([...reads.values()].every(n=>n===1));
});
for(const fault of ['actor','rerun','source','reusable','requestDigest','objectVersion','objectSecret','manifestHash'])test('content rejects '+fault+' without owner writes',async()=>{
  const f=await runFixture(),request={...f.request},before=f.writes.length;
  if(fault==='actor')request.run={...request.run,actor:{id:Number(S.ownerId)}};
  if(fault==='rerun')request.run={...request.run,run_attempt:2};
  if(fault==='source')request.sourceCommit='0'.repeat(40);
  if(fault==='reusable')request.run={...request.run,referenced_workflows:[]};
  if(fault==='requestDigest')f.objects.get(request.resultReference.key).value.requestSha256='0'.repeat(64);
  if(fault==='objectVersion')f.objects.get(request.resultReference.key).versionId='wrong';
  if(fault==='objectSecret')f.objects.get(request.resultReference.key).value.password='must-not-serialize';
  if(fault==='manifestHash')f.objects.get(f.manifestReference.key).value.manifestSha256='0'.repeat(64);
  await assert.rejects(verifyCloudResultContent(request));assert.equal(f.writes.length,before);
});
for(const patch of [{outcome:'UNKNOWN_OR_INCOMPLETE_NO_RETRY'},{cloudWrites:1},{databaseWrites:1},{privateControlReads:1},
  {journal:{state:'PARTIAL'}},{executionRun:{repository:S.repository,commitSha:'0'.repeat(40),runId:'123456790',runAttempt:1}}])
  test('correctly hashed but semantically invalid Inspect report is rejected: '+Object.keys(patch)[0],async()=>{
    const f=await inspectFixture(),resultReference=await f.proof(patch);await assert.rejects(verifyCloudResultContent({...f.request,resultReference}));});
test('Inspect cannot derive another execution; Review is handled only by the separately approved handoff',async()=>{
  const f=await inspectFixture();await assert.rejects(verifyCloudResultContent({...f.request,deriveInspectPlan:true}));
  await assert.rejects(verifyCloudResultContent({...f.request,plan:f.basePlan}));
});
test('read failure is propagated once, never retried or compensated',async()=>{
  const f=await runFixture();let reads=0;await assert.rejects(verifyCloudResultContent({...f.request,readObject:async()=>{reads++;throw Error('unknown read');}}));assert.equal(reads,1);
});
test('operations modules and tests are portable and expose no ambient live adapter or direct dispatch/SQL executor',async()=>{
  for(const file of (await readdir(new URL('../ops/platform-operations-v6/',import.meta.url))).filter(f=>f.endsWith('.mjs'))){
    const text=await readFile(new URL('../ops/platform-operations-v6/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(text,/[EF]:[/\\]|file:\/\/\/|ChatGPT_workshop|fromLoginCredentials|GetSecretValueCommand|CreateStackCommand|process\.env|process\.argv|node:child_process/);
    assert.doesNotMatch(text,/\.dispatch\(|\.query\(|fetch\(/);
  }
});
test('consolidation leaves the published cloud closure and existing fixed material unchanged',async()=>{
  const closure=await platformClosureV6();assert.equal(closure.closureSha256,B.platform.closureSha256);assert.equal(closure.legacyClosureSha256,C.legacyClosureSha256);
  assert(!closure.pins.some(p=>p.file.startsWith('ops/platform-operations-v6/')));
});
test('new modules are covered by existing No-AWS CI with contents-read-only permissions',async()=>{
  const workflow=load(await readFile(new URL('../.github/workflows/platform-cloud-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(workflow.permissions,{contents:'read'});assert(workflow.on.push.paths.includes('ops/platform-operations-v6/**'));
  assert(workflow.on.pull_request.paths.includes('tests/platform-operations-*v6.test.mjs'));
  const step=workflow.jobs.candidate.steps.find(s=>s.name==='Consolidated operator core with synthetic capabilities only');assert(step);
  for(const part of ['credentials','window','evidence'])assert(step.run.includes('tests/platform-operations-'+part+'-v6.test.mjs'));
  assert.doesNotMatch(step.run,/aws |workflow_dispatch|--mode (?:Inspect|Start)|\.pem/);
});
test('published acceptance summary is sanitized historical evidence, not a ledger import or new authorization',async()=>{
  const summary=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/platform-independent-inspect-w6w.verified.json',import.meta.url),'utf8'));
  assertEvidenceSafeV5(summary);assert.equal(summary.historicalSourceCommit,'b82ef569582655ff8f121fa15bcc1b6ebafa193d');
  assert.equal(summary.outcome,'SUCCEEDED_INDEPENDENTLY_VERIFIED');assert.equal(summary.platformAttestationImported,false);
  assert.equal(summary.platformAcceptanceFlagChanged,false);assert.equal(summary.notAnExecutionApproval,true);assert.equal(summary.wholePlatformAwsHostingClaimed,false);
  assert(!JSON.stringify(summary).includes('ChatGPT_workshop'));
});
