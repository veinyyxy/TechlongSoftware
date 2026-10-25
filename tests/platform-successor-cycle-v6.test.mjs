import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NEXT} from '../ops/platform-request-v6/transfer-next.mjs';
import {TRANSFER} from '../ops/platform-request-v6/transfer.mjs';
import {SUCCESSOR_BASE,SUCCESSOR_CYCLE,SUCCESSOR_SLOTS,SUCCESSOR_REVIEW,compileSuccessorReview,parseSuccessorCycleArgs,successorReadiness} from '../ops/platform-review-v6/successor-cycle.mjs';
import {assertTransferredBaseline,assertTransferredReviewQuery,makeTransferredAnchor,createTransferredReviewPublisher} from '../ops/platform-review-v6/transferred-cycle.mjs';
import {makeCycleReview} from '../ops/platform-review-v6/cycle-plan.mjs';
import {parseSuccessorCollectArgs} from '../ops/platform-review-v6/successor-collect-local.mjs';
import {createCycleTransport} from '../ops/platform-review-v6/cycle-transport.mjs';
import {ownerQueryV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {S,resultKeyV6} from '../ops/platform-cloud-v6/contract.mjs';
import {windowLease} from '../ops/platform-hosted-window-v6/contract.mjs';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {successorFixture} from './fixtures/platform-successor-cycle-v6.mjs';
test('fixed new task, fresh four slots, actual revision7/source320 and exact two parents',async()=>{
  const f=await successorFixture();assert.equal(f.m.anchor.jobId,NEXT.newJobId);assert.notEqual(f.m.anchor.jobId,TRANSFER.newJobId);
  assert.equal(f.m.preparation.baseline.ids.TaskDefinition,SUCCESSOR_BASE.definition);assert.equal(f.m.executionProfile.tokenPrefix,'platform-successor-');
  assert.equal(f.m.executionProfile.parentTaskClosureSha256,SUCCESSOR_BASE.taskClosureSha256);
  const slots=[SUCCESSOR_CYCLE.slot,SUCCESSOR_CYCLE.inspectSlot,...Object.values(SUCCESSOR_SLOTS)];assert.equal(new Set(slots).size,4);
  assert.ok(slots.every(v=>v.includes('w8z-')));assert.equal(SUCCESSOR_REVIEW.reader.ledgerJobIds.length,2);
  assert.equal(f.m.scope.iamWrites,0);assert.equal(f.m.scope.s3Puts,0);assert.equal(f.m.scope.parentWorkflowDispatches,0);
});
test('legacy compiler refuses new-job anchor; explicit profile retains full old four/two/two history',async()=>{
  const f=await successorFixture();await assert.rejects(makeCycleReview(f.input));
  await assertTransferredBaseline(f.anchor,f.current,f.profile);
  assert.equal(f.anchor.priorReviewPlanSha256,f.prior.plan_sha);assert.equal(f.anchor.oldJobId,NEXT.oldJobId);
  assert.deepEqual(Object.values(f.anchor.after.ledger).map(v=>v.length),[4,2,2]);
  await assert.rejects(makeTransferredAnchor(f.anchor));
});
for(const change of ['oldHistory','newPlan','newApproval','newAttempt','oldTask','newLease'])test('successor baseline rejects '+change+' without projection or relabel',async()=>{
  const f=await successorFixture(),current=structuredClone(f.current);
  if(change==='oldHistory')current.state.ledger.attempts.pop();
  if(change==='newPlan')current.newLedger.plans.push({plan_sha:'a'.repeat(64)});
  if(change==='newApproval')current.newLedger.approvals.push({plan_sha:'a'.repeat(64)});
  if(change==='newAttempt')current.newLedger.attempts.push({state:'ACKNOWLEDGED'});
  if(change==='oldTask')current.state.jobs.find(j=>j.id===NEXT.oldJobId).payload.extra=true;
  if(change==='newLease')current.state.jobs.find(j=>j.id===NEXT.newJobId).lease_owner='other';
  await assert.rejects(assertTransferredBaseline(f.anchor,current,f.profile));
});
test('review query is new exact job, source, refs and duration; old6a cannot be published',async()=>{
  const f=await successorFixture(),body={...structuredClone(f.prior.body),jobId:NEXT.newJobId,sourceCommit:f.m.sourceCommit,preparedAt:f.at,expiresAt:f.at+7200000};body.inputs.job=NEXT.newJobId;
  const v=await validatePlan(body,f.m.binding.platform,f.at);await assertTransferredReviewQuery(ownerQueryV6('plan',v),f.anchor,f.m.sourceCommit,f.at,f.profile);
  for(const mutate of [p=>{p.jobId=NEXT.oldJobId;p.inputs.job=NEXT.oldJobId;},p=>{p.sourceCommit='0'.repeat(40);},p=>{p.expiresAt--;},p=>{p.inputs.lineage='';}]){
    const b=structuredClone(body);mutate(b);const p=await validatePlan(b,f.m.binding.platform,f.at);
    await assert.rejects(assertTransferredReviewQuery(ownerQueryV6('plan',p),f.anchor,f.m.sourceCommit,f.at,f.profile));}
});
test('wrong root, parent, definition or fake empty-ledger counts cannot compile execution material',async()=>{
  const f=await successorFixture();
  for(const mutate of [p=>{p.baseline.rootEventId='other';},p=>{p.parentTaskClosureSha256='0'.repeat(64);},
    p=>{p.baseline.ids.TaskDefinition=SUCCESSOR_BASE.definition.replace(':7',':6');},p=>{p.newControlCounts.plans=1;},
    p=>{p.jobId=NEXT.oldJobId;},p=>{p.expiresAt++;}]){
    const input=structuredClone(f.input);mutate(input.preparation);await assert.rejects(compileSuccessorReview(input,f.profile));}
});
test('new publisher stops on nonempty new ledger before claim, object reads or owner writes',async()=>{
  const f=await successorFixture(),lease=windowLease(f.at,f.m.sourceCommit),effects=[];
  const p=createTransferredReviewPublisher({anchor:f.anchor,profile:f.profile,sourceCommit:f.m.sourceCommit,lease,now:()=>f.at,ports:{
    assertApproved:async()=>{},assertSource:async()=>{},readLease:async()=>lease,assertTransferEvidence:async()=>{},
    readiness:async()=>({sourceCommit:f.m.sourceCommit,jobId:NEXT.newJobId,checkedAt:f.at,humanReadyUntil:lease.expiresAt,mainFrozen:true,leaseVerified:true,
      publisherAdapterReady:true,controllerReady:true,independentInspectorReady:true,replacementIndependentlyVerified:true,sourceCredentialsReady:true,environmentApprovalPageReady:true}),
    readBaseline:async()=>({...f.current,newLedger:{plans:[{}],approvals:[],attempts:[]}}),claim:async()=>effects.push('claim'),readObject:async()=>effects.push('object'),
    writeOwner:async()=>effects.push('write'),record:async()=>{},dispose:async()=>effects.push('dispose')}});
  const r=await p.once();assert.equal(r.ownerSubmissions,0);assert.deepEqual(effects,['dispose']);await assert.rejects(p.once());
});
test('preconfirmed readiness is fixed to new task and retains truthful no-postupdate-login statement',async()=>{
  const f=await successorFixture(),lease=windowLease(f.at+2000,f.m.sourceCommit),hosting={stackId:f.m.preparation.baseline.stackId,taskDefinition:SUCCESSOR_BASE.definition.replace(':7',':8')};
  const input={manifest:f.m,manifestSha256:f.m.manifestSha256,scope:{sourceCommit:f.m.sourceCommit,jobId:NEXT.newJobId},lease,release:f.m.binding.platform,hosting,checkedAt:f.at+3000,
    online:{schema:'techlong/human-online-before-window/v6',manifestSha256:f.m.manifestSha256,sourceCommit:f.m.sourceCommit,confirmedAt:f.at,humanReadyUntil:f.at+40*60000,
      pageViewedBeforeWindow:true,authenticatedPageRecheckedAfterUpdate:false,notPlanApproval:true}};
  const r=await successorReadiness(input);assert.equal(r.jobId,NEXT.newJobId);assert.equal(r.authenticatedPageRecheckedAfterUpdate,false);
  await assert.rejects(successorReadiness({...input,scope:{...input.scope,jobId:NEXT.oldJobId}}));
});
test('transport discovers only new-job versioned result/manifest; legacy result is rejected',async()=>{
  const f=await platformFixtureV6({installed:true}),id='123456789',sha='a'.repeat(64),objects=new Map();
  const store=async(key,value)=>{const ref={key,versionId:'synthetic-version',sha256:await sha256Hex(value)};objects.set(key,{value,versionId:ref.versionId,encryption:'AES256',contentLength:Buffer.byteLength(canonicalJson(value))});return ref;};
  const manifest=await store(`worker-v5/${S.instanceId}/${NEXT.newJobId}/${sha}/manifest.json`,{synthetic:true}),saved=await store(resultKeyV6(NEXT.newJobId,sha,id),{
    schema:'techlong/platform-cloud-result/v6',mode:'Review',jobId:NEXT.newJobId,manifestSha256:sha,run:{repository:S.repository,runId:id,runAttempt:1,commitSha:f.sourceCommit},cloudReportReference:manifest});
  const summary={mode:'Review',jobId:NEXT.newJobId,manifestSha256:sha,outcome:'REVIEW_PREPARED_NOT_APPROVED',saved,retryAllowed:false};
  const ports={guard:async()=>{},record:async()=>{},readObject:async r=>structuredClone(objects.get(r.key)),readRun:async run=>f.rawRun(run),readJobs:async()=>({total_count:1,jobs:[{
    id:98765,run_id:Number(id),run_attempt:1,head_sha:f.sourceCommit,status:'completed',conclusion:'success'}]}),readLog:async()=>JSON.stringify(summary)};
  const m={sourceCommit:f.sourceCommit,binding:{platform:f.release},anchor:{references:{installation:{key:'synthetic',sha256:sha,versionId:'synthetic'}}}},t=createCycleTransport({manifest:m,ports,cycle:SUCCESSOR_CYCLE});
  t.registerRun(id,'Review');assert.equal((await t.discover(id)).manifestSha256,sha);await t.readObject(manifest);assert.equal(t.counts().s3Gets,2);t.close();
  const old=createCycleTransport({manifest:m,ports});old.registerRun(id,'Review');await assert.rejects(old.discover(id));old.close();
});
test('readonly collector has exact ack, fixed bounds and no execution/profile/DB overrides',async()=>{
  assert.equal(parseSuccessorCollectArgs(['--ci-run','123','--allow-config-read','yes','--output','x'])['--ci-run'],'123');
  for(const a of [['--ci-run','123','--output','x'],['--ci-run','123','--allow-config-read','no','--output','x'],
    ['--ci-run','123','--allow-config-read','yes','--output','x','--profile','other']])assert.throws(()=>parseSuccessorCollectArgs(a));
  assert.throws(()=>parseSuccessorCycleArgs(['--mode','RunReviewed','--manifest','x','--approved-sha','a','--output','x']));
  const s=await readFile(new URL('../ops/platform-review-v6/successor-collect-local.mjs',import.meta.url),'utf8');
  assert.ok(s.indexOf('cloud=await reader.snapshot()')<s.indexOf('database=await readCurrentDatabaseOnce'));
  assert.match(s,/maxMetadata:75/);assert.doesNotMatch(s,/GetSecretValue|UpdateStackCommand|writeOwner|dispatchWorkflow|readAuthV6/);
});
