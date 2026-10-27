import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryControlFixture} from './fixtures/platform-recovery-control-v1.mjs';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {resultKeyV6} from '../ops/platform-cloud-v6/contract.mjs';
import {proposeReviewSuccessor,reviewTiming,RUNONCE_RESERVE_MS} from '../ops/platform-delegated-publisher-v1/successor.mjs';
async function fixture(){
  const f=await recoveryControlFixture(),q=f.writes.find(q=>q.text.includes('publish_plan')&&JSON.parse(q.values[3]).mode==='Review');
  const valid=await validatePlan(JSON.parse(q.values[3]),f.release,f.at),runId='123456797';
  const entry={...valid,riskSha256:valid.plan.riskSha256,attempt:{state:'ACKNOWLEDGED',runId,status:null,conclusion:null,proofSha256:null}};
  const key=resultKeyV6(entry.plan.jobId,f.envelope.recoveryReviewSha256,runId),object=f.objects.get(key);
  const ref={key,versionId:object.versionId,sha256:await sha256Hex(object.value)},reads=[];
  const input={binding:f.binding,basis:f.basis,entry,run:f.rawRun(runId),resultReference:ref,now:f.now,rebuildPackage:f.rebuild,
    readObject:async r=>{reads.push(r.key);return f.ports.readObject(r);}};
  return {...f,input,reads};
}
test('no-Web proposal reuses real publisher checks, captures three proposed writes and changes no actual ledger',async()=>{
  const f=await fixture(),before=structuredClone(f.input.entry),r=await proposeReviewSuccessor(f.input);
  assert.equal(r.outcome,'REVIEW_SUCCESSOR_PROPOSED_NOT_PUBLISHED');assert.equal(r.webLeaseRequired,false);
  assert.equal(r.physicalOwnerWrites,0);assert.equal(r.proposedWriteCount,3);assert.equal(r.successorPublished,false);
  assert.equal(r.actualObservationVerified,false);assert.equal(r.proofImported,false);assert.equal(r.executionApproved,false);
  assert.deepEqual(f.input.entry,before);assert.equal(r.successor.plan.mode,'RunOnce');assert.equal(r.objectReads,4);
  assert.equal(f.reads.length,4);assert.equal(r.successor.plan.predecessor.proofSha256,r.attestation.proofSha256);
  assert(r.successor.plan.expiresAt<=f.envelope.innerManifest.jobPlan.claimBy-RUNONCE_RESERVE_MS);
  assert(r.proposedObservation.text.includes('observe_run'));assert.equal(r.proposedOwnerQueries.length,2);
});
for(const fault of ['sha','source','run','unknown','occupied-proof','false-observed'])test('invalid '+fault+' cannot read evidence or propose a write',async()=>{
  const f=await fixture(),x=f.input;
  if(fault==='sha')x.entry.actionSha256='0'.repeat(64);
  if(fault==='source')x.entry.plan.sourceCommit='0'.repeat(40);
  if(fault==='run')x.run.conclusion='failure';
  if(fault==='unknown')x.entry.attempt.state='SUBMISSION_UNKNOWN';
  if(fault==='occupied-proof')x.entry.attempt.proofSha256='0'.repeat(64);
  if(fault==='false-observed')x.entry.attempt.state='OBSERVED';
  await assert.rejects(proposeReviewSuccessor(x));assert.deepEqual(f.reads,[]);
});
test('an actually observed successful attempt can be checked without pretending the proposal changes it',async()=>{
  const f=await fixture();Object.assign(f.input.entry.attempt,{state:'OBSERVED',status:'completed',conclusion:'success'});
  const r=await proposeReviewSuccessor(f.input);assert.equal(r.actualLedgerChanged,false);assert.equal(r.proofImported,false);
});
for(const fault of ['expired-claim','workload-reserve','handoff-reserve','basis-expired'])test('reject '+fault+' before returning a successor',async()=>{
  const f=await fixture();
  if(fault==='expired-claim')f.tick(15*60000);
  if(fault==='handoff-reserve')f.tick(6*60000);
  if(fault==='basis-expired')f.input.now=()=>f.basis.expiresAt;
  if(fault==='workload-reserve'){
    const inner=structuredClone(f.envelope.innerManifest);inner.workload.workloadExpiresAt=f.at+90*60000-1;
    assert.throws(()=>reviewTiming(inner,f.basis.expiresAt,f.at));return;
  }
  await assert.rejects(proposeReviewSuccessor(f.input));assert(f.reads.length<=2);
});
test('the real Oct27 expired timing is rejected, not restamped to the current clock',()=>{
  const inner={jobPlan:{preparedAt:Date.parse('2026-10-27T05:10:44.763Z'),claimBy:Date.parse('2026-10-27T05:25:44.763Z')},
    workload:{workloadExpiresAt:Date.parse('2026-10-27T07:10:44.000Z')}};
  assert.throws(()=>reviewTiming(inner,Date.parse('2026-10-27T18:47:57.695Z'),Date.parse('2026-10-27T12:37:18.197Z')));
});
test('tampered content never produces a proposal even when provider metadata is otherwise plausible',async()=>{
  const f=await fixture(),read=f.input.readObject;
  f.input.readObject=async r=>{const o=structuredClone(await read(r));if(r.key===f.input.resultReference.key)o.value.basisSha256='0'.repeat(64);return o;};
  await assert.rejects(proposeReviewSuccessor(f.input),/OBJECT_METADATA_OR_SHA/);
});
test('late clock change during full reconstruction cannot create a usable proposal',async()=>{
  const f=await fixture(),read=f.input.readObject;let count=0;
  f.input.readObject=async r=>{const v=await read(r);if(++count===3)f.tick(10*60000);return v;};
  await assert.rejects(proposeReviewSuccessor(f.input));assert(f.reads.length<=4);
});
