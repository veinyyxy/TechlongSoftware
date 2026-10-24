import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {ownerQueryV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {TRANSFER as T} from '../ops/platform-request-v6/transfer.mjs';
import {J} from '../ops/platform-review-v6/followup.mjs';
import {TRANSFERRED_CYCLE,makeTransferredAnchor,assertTransferredBaseline,assertTransferredReviewQuery,createTransferredReviewPublisher} from '../ops/platform-review-v6/transferred-cycle.mjs';
import {createHostedHandoff} from '../ops/platform-review-v6/hosted-handoff.mjs';
import {operationsFixtureV6} from './fixtures/platform-operations-v6.mjs';
import {transferFixture,expectedAfter,AT} from './fixtures/platform-task-transfer-v6.mjs';

async function anchorFixture(){
  const before=await transferFixture(),entry=before.ledger.plans.find(p=>p.body.sourceCommit===T.oldSource),oldSha=entry.plan_sha;
  entry.body.inputs.installation=canonicalJson({key:`worker-v5/${entry.body.instanceId}/installation/${B.platform.installationSha256}.json`,
    sha256:TRANSFERRED_CYCLE.installationObjectSha256,versionId:'synthetic-installation-version'});
  entry.body.inputs.lineage=canonicalJson({key:J.lineageKey,sha256:J.lineageSha256,versionId:'synthetic-lineage-version'});
  const p=await validatePlan(entry.body,B.platform,entry.body.preparedAt);Object.assign(entry,{plan_sha:p.planSha256,action_sha:p.actionSha256});
  for(const r of [...before.ledger.approvals,...before.ledger.attempts])if(r.plan_sha===oldSha)r.plan_sha=p.planSha256;
  const after=expectedAfter(before,AT),anchor=await makeTransferredAnchor({before,after,transferredAt:AT});
  return {anchor,current:{state:after,newLedger:{plans:[],approvals:[],attempts:[]}}};
}
async function publicationFixture(){
  const f=await anchorFixture(),sourceCommit='f'.repeat(40),scope={sourceCommit,jobId:T.newJobId},effects={claims:0,objects:0,owners:0,disposed:0};
  const lease={schema:'techlong/platform-hosted-runtime-lease/v6',origin:'https://console.sandbox.techlong.cloud',
    releaseSha256:await sha256Hex(B.platform),sourceCommit,issuedAt:AT,expiresAt:AT+1800000};
  const ports={assertApproved:async()=>{},assertSource:async()=>{},assertTransferEvidence:async()=>{},readLease:async()=>lease,
    readiness:async()=>({sourceCommit,jobId:scope.jobId,checkedAt:AT,humanReadyUntil:lease.expiresAt,mainFrozen:true,leaseVerified:true,
      publisherAdapterReady:true,controllerReady:true,independentInspectorReady:true,replacementIndependentlyVerified:true,
      sourceCredentialsReady:true,environmentApprovalPageReady:true}),readBaseline:async()=>f.current,
    claim:async()=>{effects.claims++;},readObject:async()=>{effects.objects++;throw Error('synthetic unavailable object');},
    readHeldJob:async()=>{throw Error('must verify objects first');},writeOwner:async()=>{effects.owners++;},record:async()=>{},
    dispose:async()=>{effects.disposed++;}};
  return {...f,sourceCommit,scope,lease,ports,effects,now:()=>AT};
}
async function hostedFixture({lineage=false}={}){
  const f=await operationsFixtureV6();f.lease={...f.lease,schema:'techlong/platform-hosted-runtime-lease/v6',origin:'https://console.sandbox.techlong.cloud'};
  if(lineage){
    const ref=await f.store(`worker-v5/${f.basePlan.instanceId}/lineage/synthetic-empty.json`,[]),plan=structuredClone(f.basePlan);
    plan.inputs.lineage=canonicalJson(ref);f.review=await f.observedPlan(plan,'123456789');f.resultReference=await f.resultFor(plan,'123456789');
  }
  Object.assign(f.plans.get(f.review.planSha256).attempt,{state:'ACKNOWLEDGED',status:null,conclusion:null});
  f.input={planSha256:f.review.planSha256,runId:'123456789',resultReference:f.resultReference,
    manifestReference:f.manifestReference,manifestSha256:f.manifest.manifestSha256};return f;
}

test('transferred anchor retains exact canceled history and existing immutable lineage, not old execution authority',async()=>{
  const f=await anchorFixture(),before=structuredClone(f);await assertTransferredBaseline(f.anchor,f.current);
  assert.equal(f.anchor.jobId,T.newJobId);assert.equal(f.anchor.priorReviewReusableForExecution,false);
  assert.equal(f.anchor.references.lineage.key,J.lineageKey);assert.equal(f.anchor.after.jobs.find(j=>j.id===T.oldJobId).status,'canceled');
  assert.equal(f.anchor.after.jobs.find(j=>j.id===T.newJobId).payload.cloudExecutionAuthorized,false);assert.deepEqual(f,before);
});
test('installation object checksum is not confused with the embedded body checksum',async()=>{
  const binding=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json',import.meta.url),'utf8'));
  assert.equal(await sha256Hex(binding),TRANSFERRED_CYCLE.installationObjectSha256);
  assert.notEqual(TRANSFERRED_CYCLE.installationObjectSha256,B.platform.installationSha256);
});
test('changed transfer rows, history, protections or occupied new ledger fail closed',async()=>{
  for(const mutate of [f=>{f.current.state.jobs[0].updated_at++;},f=>{f.current.state.ledger.attempts[0].proof_sha='a'.repeat(64);},
    f=>{f.current.state.protection.catalogSha256='a'.repeat(64);},f=>{f.current.newLedger.plans.push({});},
    f=>{f.current.newLedger.approvals.push({});},f=>{f.current.newLedger.attempts.push({state:'UNKNOWN'});},
    f=>{f.anchor.anchorSha256='0'.repeat(64);}]){const f=await anchorFixture();mutate(f);await assert.rejects(assertTransferredBaseline(f.anchor,f.current));}
});
test('new Review query binds new job, source, two-hour clock and both exact version references',async()=>{
  const {anchor}=await anchorFixture(),old=anchor.before.ledger.plans.find(p=>p.plan_sha===anchor.priorReviewPlanSha256),source='f'.repeat(40);
  const plan={...structuredClone(old.body),jobId:T.newJobId,sourceCommit:source,preparedAt:AT,expiresAt:AT+7200000};plan.inputs.job=T.newJobId;
  const v=await validatePlan(plan,B.platform,AT),q=ownerQueryV6('plan',v);await assertTransferredReviewQuery(q,anchor,source,AT);
  for(const mutate of [p=>{p.jobId=T.oldJobId;p.inputs.job=T.oldJobId;},p=>{p.sourceCommit='e'.repeat(40);},
    p=>{p.expiresAt--;},p=>{p.inputs.lineage=canonicalJson({...anchor.references.lineage,versionId:'changed'});}]){
    const bad=structuredClone(plan);mutate(bad);const candidate=await validatePlan(bad,B.platform,AT);
    await assert.rejects(assertTransferredReviewQuery(ownerQueryV6('plan',candidate),anchor,source,AT));
  }
  await assert.rejects(assertTransferredReviewQuery({...q,values:[...q.values,'extra']},anchor,source,AT));
});
for(const failure of ['approval','source','evidence','readiness','lease','lease-change','baseline'])test('publication '+failure+' cannot consume slot or start a Review',async()=>{
  const f=await publicationFixture();
  if(['approval','source','evidence'].includes(failure))f.ports[{approval:'assertApproved',source:'assertSource',evidence:'assertTransferEvidence'}[failure]]=async()=>{throw Error('unavailable');};
  if(failure==='readiness'){const original=f.ports.readiness;f.ports.readiness=async()=>({...await original(),publisherAdapterReady:false});}
  if(failure==='lease')f.lease.origin='http://127.0.0.1:3100';
  if(failure==='lease-change')f.ports.readLease=async()=>({...f.lease,expiresAt:f.lease.expiresAt-1});
  if(failure==='baseline')f.current.newLedger.attempts.push({state:'SUBMISSION_STARTED'});
  const p=createTransferredReviewPublisher(f),out=await p.once();assert.equal(out.outcome,'TRANSFERRED_REVIEW_STOPPED_REQUIRES_READBACK_NO_RETRY');
  assert.equal(out.slotClaimAttempted,false);assert.deepEqual(f.effects,{claims:0,objects:0,owners:0,disposed:1});
  await assert.rejects(p.once(),/MEMORY_ONCE/);
});
test('unavailable immutable evidence consumes only its explicitly claimed slot, no SQL or retry',async()=>{
  const f=await publicationFixture(),p=createTransferredReviewPublisher(f),out=await p.once();
  assert.equal(out.phase,'RECONSTRUCT_AND_ADMIT');assert.equal(out.retryAllowed,false);
  assert.deepEqual(f.effects,{claims:1,objects:1,owners:0,disposed:1});await assert.rejects(p.once(),/MEMORY_ONCE/);
});
test('HOSTED bridge uses actual observation then trusted proof and reserved plan, each object only once',async()=>{
  const f=await hostedFixture(),original=structuredClone(f.manifest),b=createHostedHandoff(f),out=await b.once(f.input);
  assert.equal(out.outcome,'RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL');
  assert.deepEqual(f.effects,{claims:1,observations:1,owners:2,disposed:1,objectGets:3});
  assert.equal(out.expiresAt,f.manifest.jobPlan.claimBy-480000);assert.equal(out.workflowDispatches,0);assert.equal(out.executionApproved,false);
  assert.deepEqual(f.manifest,original);assert.equal(f.lease.origin,'https://console.sandbox.techlong.cloud');
  await assert.rejects(b.once(f.input),/MEMORY_ONCE/);
});
test('HOSTED reconstruction includes and caches the versioned lineage object',async()=>{
  const f=await hostedFixture({lineage:true}),out=await createHostedHandoff(f).once(f.input);
  assert.equal(out.outcome,'RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL');assert.equal(f.effects.objectGets,4);
  assert.equal(f.effects.observations,1);assert.equal(f.effects.owners,2);
});
for(const field of ['origin','schema','releaseSha256','sourceCommit','expiresAt'])test('HOSTED bridge rejects invalid '+field+' without claiming',async()=>{
  const f=await hostedFixture();f.lease[field]=field==='expiresAt'?f.now():field==='origin'?'http://127.0.0.1:3100':'invalid';
  const out=await createHostedHandoff(f).once(f.input);assert.equal(out.slotClaimAttempted,false);assert.equal(f.effects.claims,0);assert.equal(f.effects.owners,0);
});
for(const failure of ['approval','claim','observe','proof','plan'])test('HOSTED '+failure+' stops without dispatch, compensation or retry',async()=>{
  const f=await hostedFixture();f.setFailure(failure);const b=createHostedHandoff(f),out=await b.once(f.input);
  assert.equal(out.outcome,'HANDOFF_STOPPED_REQUIRES_READBACK_NO_RETRY');assert.equal(out.workflowDispatches,0);assert.equal(out.retryAllowed,false);
  assert(f.effects.owners<=2);assert.equal(f.effects.disposed,1);await assert.rejects(b.once(f.input),/MEMORY_ONCE/);
});
test('corrupt result or delayed full reconstruction cannot write observations or owner records',async()=>{
  for(const delay of [false,true]){
    const f=await hostedFixture();if(delay){const read=f.ports.readObject;f.ports.readObject=async r=>{const v=await read(r);f.tick(150000);return v;};}
    else f.objects.get(f.resultReference.key).value.requestSha256='0'.repeat(64);
    const out=await createHostedHandoff(f).once(f.input);assert.equal(out.outcome,'HANDOFF_STOPPED_REQUIRES_READBACK_NO_RETRY');
    assert.equal(f.effects.observations,0);assert.equal(f.effects.owners,0);
  }
});
test('time lost while saving proposed proof is rechecked before owner submission',async()=>{
  const f=await hostedFixture(),record=f.ports.record;f.ports.record=async(n,v)=>{await record(n,v);if(n==='proposed-attestation')f.tick(420000);};
  const out=await createHostedHandoff(f).once(f.input);assert.equal(out.outcome,'HANDOFF_STOPPED_REQUIRES_READBACK_NO_RETRY');
  assert.equal(f.effects.observations,1);assert.equal(f.effects.owners,0);
});
