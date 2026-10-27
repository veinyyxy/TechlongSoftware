import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPublisherFixture} from './fixtures/platform-a604-inspect-publisher-v1.mjs';
import {createInspectProposer,inspectTiming} from '../ops/platform-a604-operator-v1/inspect-successor.mjs';
import {verifyCompletionContent} from '../ops/platform-a604-operator-v1/inspect-state.mjs';
import {INSPECT_PUBLISH_SLOT,PUBLISH_SLOT,D} from '../ops/platform-a604-operator-v1/scope.mjs';
import {parseArgs} from '../ops/platform-a604-operator-v1/local.mjs';
import {sqlGate} from '../ops/platform-recovery-launch-v1/io.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const args=f=>({binding:f.publication,basis:f.basis,entry:structuredClone(f.entries.get(f.runPlan.planSha256)),run:f.rawRun('123456798'),resultReference:f.executed.saved,readObject:f.readObject});
test('RunOnce successor captures six exact objects and derives independent Inspect, never acceptance or writes',async()=>{
  const f=await inspectPublisherFixture(),p=await createInspectProposer({publication:f.publication,profile:f.profile,now:f.now})(args(f));
  assert.equal(p.successor.plan.mode,'Inspect');assert.equal(p.objectReads,6);assert.equal(p.physicalOwnerWrites,0);assert.equal(p.independentCloudAcceptanceVerified,false);
  assert.equal(p.successor.plan.predecessor.runId,'123456798');await verifyCompletionContent(f.state(),p);
  assert.deepEqual(f.writes,[]);assert.notEqual(INSPECT_PUBLISH_SLOT,PUBLISH_SLOT);
});
test('reviewed three-write flow independently verifies Inspect publication and preserves all other rows',async()=>{
  const f=await inspectPublisherFixture(),m=await f.prepare(),before=structuredClone(f.state());
  const r=await f.ops.runReviewed({manifest:m,basis:f.basis,approved:m.manifestSha256,io:f.io,now:f.now});
  assert.equal(r.outcome,'DELEGATED_INSPECT_PUBLISHED_REQUIRES_SEPARATE_DISPATCH',JSON.stringify(r));assert.equal(r.plan.mode,'Inspect');
  assert.deepEqual(f.writes,['observe','proof','publish']);assert.equal(r.independentReadbackVerified,true);assert.equal(r.dispatches,0);
  assert.equal(m.effects.s3GetsMax,6);assert.equal(m.slot,INSPECT_PUBLISH_SLOT);assert.equal(m.latestStartAt,m.expiresAt-12*60000);
  assert.deepEqual(before.jobs,f.state().jobs);assert.deepEqual(before.deployment,f.state().deployment);
});
for(const fault of ['oldJob','business','protection','oldHistory','parentProof','lease','receipt'])test('baseline rejects '+fault+' without a write',async()=>{
  const f=await inspectPublisherFixture(),s=f.state();
  if(fault==='oldJob')s.jobs.find(j=>j.id!==D.jobId).status='running';if(fault==='business')s.deployment.admissionSnapshot.subscription.status='paused';
  if(fault==='protection')s.protection.catalogSha256='0'.repeat(64);if(fault==='oldHistory')s.ledger.plans.find(p=>p.job_id!==D.jobId).body.sourceCommit='0'.repeat(40);
  if(fault==='parentProof')s.ledger.attempts.find(a=>a.job_id===D.jobId&&a.mode==='Review').proof_sha='0'.repeat(64);
  if(fault==='lease')s.jobs.find(j=>j.id===D.jobId).lease_owner='other';if(fault==='receipt')delete s.deployment.outputs.expressInitializedWorkerRunsV2[D.jobId];
  await assert.rejects(f.prepare());assert.deepEqual(f.writes,[]);
});
for(const fault of ['descriptor','report','receiptHash','source','version'])test('content rejects '+fault+' before claiming or publishing',async()=>{
  const f=await inspectPublisherFixture(),a=args(f),read=f.readObject;
  if(fault==='source')a.run.head_sha='0'.repeat(40);
  if(fault==='receiptHash')f.state().deployment.outputs.expressInitializedWorkerRunsV2[D.jobId].providerObservationSha256='0'.repeat(64);
  a.readObject=async ref=>{const o=await read(ref);if(fault==='version')o.versionId='wrong';
    if(fault==='descriptor'&&o.value.executionRun){o.value.recoveryBasisSha256='0'.repeat(64);}
    if(fault==='report'&&o.value.schema==='techlong/cloud-worker-run/v5')o.value.result.outcome='FAILED';
    return o;};
  const run=async()=>{const p=await createInspectProposer({publication:f.publication,profile:f.profile,now:f.now})(a);await verifyCompletionContent(f.state(),p);};
  await assert.rejects(run());assert.deepEqual(f.writes,[]);assert(!f.effects.includes('claim'));
});
for(const phase of ['observe','proof','publish'])test('unknown '+phase+' stops once with no retry or dispatch',async()=>{
  const f=await inspectPublisherFixture(),m=await f.prepare();f.failAt(phase);
  const r=await f.ops.runReviewed({manifest:m,basis:f.basis,approved:m.manifestSha256,io:f.io,now:f.now});
  assert(r.outcome.includes('STOPPED'));assert.equal(r.retryAllowed,false);assert.equal(f.writes.filter(x=>x===phase).length,1);
  assert(f.writes.length<=3);assert.equal(f.effects.at(-1),'close');
});
test('exact completion compiler rejects altered provenance even if a receipt digest is recomputed',async()=>{
  const f=await inspectPublisherFixture(),p=await createInspectProposer({publication:f.publication,profile:f.profile,now:f.now})(args(f));
  const s=structuredClone(f.state());s.jobs.find(j=>j.id===D.jobId).payload.platformRequest.requestedAt++;
  await assert.rejects(verifyCompletionContent(s,p));
  const extra=structuredClone(f.state()),receipt=extra.deployment.outputs.expressInitializedWorkerRunsV2[D.jobId];receipt.extra='not-approved';
  p.verifiedRunReport.result.receiptSha256=await sha256Hex(receipt);await assert.rejects(verifyCompletionContent(extra,p));
});
test('expired claim is not revived; Inspect only needs its original workload/basis window and reserve',async()=>{
  const f=await inspectPublisherFixture();f.advanceClock(20*60000);const m=await f.prepare();
  assert(m.createdAt>f.inner.jobPlan.claimBy);assert.equal(m.action.operation,'AdvanceRunOnce');
  assert.throws(()=>inspectTiming(f.inner,f.basis.expiresAt,f.inner.workload.workloadExpiresAt-12*60000));
  const g=sqlGate('AdvanceRunOnce');g.check('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',false);
  assert.throws(()=>g.check('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',false));
  assert.throws(()=>sqlGate('AdvanceRunOnce').check('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',true));
  assert.equal(parseArgs(['--mode','PrepareInspectSaved','--ci-run','1','--output','F:/ChatGPT_workshop/techlong-a604-operator-inspect-a','--material','x'])['--mode'],'PrepareInspectSaved');
});
