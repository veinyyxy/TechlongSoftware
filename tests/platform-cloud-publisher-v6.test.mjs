import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedPublisherV6,ownerQueryV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {CLOUD_V6 as C,S} from '../ops/platform-cloud-v6/contract.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const publisher=f=>createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,ports:f.ports,now:f.now});
test('trusted Review import reconstructs real public material and held job, only publishes a plan with fixed bound SQL',async()=>{
  const f=await platformFixtureV6(),p=await publisher(f).publishReview({jobId:f.observed.job.id,installationReference:f.installationReference});
  assert.equal(p.executionApproved,false);assert.equal(f.writes.length,1);assert.equal(f.writes[0].text,'SELECT deployment_control_v6.publish_plan($1,$2,$3,$4::jsonb)');
  assert.equal(p.plan.predecessor,null);assert.equal(p.plan.inputs.manifest,'');assert.equal(p.plan.jobId,f.observed.job.id);
  assert.throws(()=>ownerQueryV6('arbitrarySql',{}));
});
test('unpublished binding, already completed job, wrong object version or capability values reject before SQL writes',async()=>{
  for(const fault of ['closed','old','version','secret','job']) {
    const f=await platformFixtureV6();
    if(fault==='closed')f.release.state='UNPUBLISHED';
    if(fault==='version')f.objects.get(f.installationReference.key).versionId='wrong';
    if(fault==='secret')f.objects.get(f.installationReference.key).value.password='must-not-pass';
    if(fault==='job')f.ports.readHeldJob=async()=>({...f.observed,job:{...f.observed.job,status:'running'}});
    await assert.rejects(publisher(f).publishReview({jobId:fault==='old'?S.completedJob:f.observed.job.id,installationReference:f.installationReference}));assert.equal(f.writes.length,0);
  }
});
test('GitHub success alone cannot attest; exact result object, request/source, old core reconstruction and role bindings are required',async()=>{
  for(const patch of [{outcome:'success'},{requestSha256:'0'.repeat(64)},{closureSha256:'0'.repeat(64)},{installationSha256:'0'.repeat(64)}]) {
    const f=await platformFixtureV6(),v=await f.observedPlan(f.basePlan,'123456789'),ref=await f.resultFor(v.plan,'123456789',patch);
    await assert.rejects(publisher(f).attestResult(v.planSha256,ref));assert.equal(f.writes.length,0);
  }
  const f=await platformFixtureV6(),v=await f.observedPlan(f.basePlan,'123456789'),ref=await f.resultFor(v.plan,'123456789');
  f.ports.readRun=async()=>({...f.rawRun('123456789'),actor:{id:Number(S.ownerId)}});
  await assert.rejects(publisher(f).attestResult(v.planSha256,ref));assert.equal(f.writes.length,0);
});
test('real Review manifest validation then one attestation enables a separately published bounded RunOnce; no restamping old claim window',async()=>{
  const f=await platformFixtureV6(),v=await f.observedPlan(f.basePlan,'123456789'),ref=await f.resultFor(v.plan,'123456789'),p=publisher(f);
  await assert.rejects(p.publishSuccessor(v.planSha256,ref));assert.equal(f.writes.length,0);
  const a=await p.attestResult(v.planSha256,ref);assert.equal(f.writes.length,1);assert.equal(f.writes[0].text,'SELECT deployment_control_v6.attest_evidence($1,$2)');
  await assert.rejects(p.attestResult(v.planSha256,ref),/OCCUPIED/);assert.equal(f.writes.length,1);
  const next=await p.publishSuccessor(v.planSha256,ref);assert.equal(next.plan.mode,'RunOnce');assert.equal(next.executionApproved,false);
  assert.equal(next.plan.inputs.manifestSha,f.manifest.manifestSha256);assert.equal(next.plan.predecessor.proofSha256,a.proofSha256);
  assert.ok(next.plan.expiresAt<=f.manifest.jobPlan.claimBy);f.tick(900001);
  await assert.rejects(p.publishSuccessor(v.planSha256,ref));assert.equal(f.writes.length,2);
});
test('RunOnce report and conditional descriptor bind independent Inspect plan; final success requires exact Inspect body digest',async()=>{
  const f=await platformFixtureV6(),p=publisher(f),review=await f.observedPlan(f.basePlan,'123456789'),reviewRef=await f.resultFor(review.plan,'123456789');
  await p.attestResult(review.planSha256,reviewRef);const runPlan=await p.publishSuccessor(review.planSha256,reviewRef);
  const runId='123456790',run=f.run(runId),mv=f.manifest.manifestSha256;
  await f.observedPlan(runPlan.plan,runId);
  const report={schema:'techlong/cloud-worker-run/v5',jobId:f.observed.job.id,manifestSha256:mv,run,
    result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'},retryAllowed:false};
  const rr=await f.store(`worker-v5/${S.instanceId}/${f.observed.job.id}/${mv}/run-${runId}-1/run.json`,report);
  const er=await f.store(`worker-v5/${S.instanceId}/${f.observed.job.id}/${mv}/execution-reference-${runId}-v1.json`,{executionRun:run,executionReportReference:rr});
  const pr=await f.resultFor(runPlan.plan,runId,{outcome:report.result.outcome,cloudReportReference:rr,executionReference:er});
  await p.attestResult(runPlan.planSha256,pr);const inspectPlan=await p.publishSuccessor(runPlan.planSha256,pr);
  assert.equal(inspectPlan.plan.mode,'Inspect');assert.deepEqual(JSON.parse(inspectPlan.plan.inputs.execution),er);
  const inspectId='123456791',irun=f.run(inspectId),body={schema:'techlong/cloud-worker-independent-inspect/v5',outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',
    jobId:f.observed.job.id,manifestSha256:mv,receiptSha256:'1'.repeat(64),providerObservationSha256:'2'.repeat(64),run:irun,executionRun:run,
    journal:{state:'ALL_SLOTS_CONSUMED'},checkedAt:f.at,retryAllowed:false,cloudWrites:0,databaseWrites:0,privateControlReads:0};
  const ir=await f.store(`worker-v5/${S.instanceId}/${f.observed.job.id}/${mv}/run-${inspectId}-1/inspect.json`,{...body,inspectSha256:await sha256Hex(body)});
  await f.observedPlan(inspectPlan.plan,inspectId);
  const proof=await f.resultFor(inspectPlan.plan,inspectId,{outcome:body.outcome,cloudReportReference:ir});
  const result=await p.attestResult(inspectPlan.planSha256,proof);assert.equal(result.outcome,'SUCCEEDED_INDEPENDENTLY_VERIFIED');
  await assert.rejects(p.publishSuccessor(inspectPlan.planSha256,proof));
  assert.equal(C.installationSha256,f.release.installationSha256);
});
test('publisher write failure is surfaced once without dispatch, compensation, automatic retry or owner fallback',async()=>{
  const f=await platformFixtureV6();let attempts=0;
  f.ports.writeOwner=async()=>{attempts++;throw Error('ambiguous SQL commit');};
  await assert.rejects(publisher(f).publishReview({jobId:f.observed.job.id,installationReference:f.installationReference}));assert.equal(attempts,1);
});
