import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {N,R,knownPair,makeResumeReview,verifyResume,newResumePlan,assertResumeLedger,publishResumeOnce} from '../ops/platform-review-v6/resume.mjs';
import {W,K,H,canonical,normalizeRecoveredSuccess,compatibleInput,makeWindowReview,validateWindow,validateIntent,readyResume,runCompatibleOnce} from '../ops/platform-hosted-window-v6/compatible.mjs';
import {windowTemplate,lease,hash} from '../ops/platform-hosted-window-v6/contract.mjs';
import {resumeFixture,resumedPlan,resumedLedger} from './fixtures/platform-review-resume-v6.mjs';
const at=Date.parse('2026-10-24T15:00:00Z'),source='a'.repeat(40);
function windowFixture(){
  const ids=Object.fromEntries(Object.keys(windowTemplate(H.imageSource).Resources).map(k=>[k,k==='TaskDefinition'?K.originalDefinition:'fixture-'+k]));
  return makeWindowReview({sourceCommit:source,pins:Array.from({length:12},(_,i)=>({file:'fixture-'+i,sha256:'b'.repeat(64)})),
    ci:{sourceCommit:source,attempt:1,status:'completed',conclusion:'success'},baseline:{stackId:K.stackId,stackStatus:'UPDATE_ROLLBACK_COMPLETE',rootEventId:W.recoveryEvent,
      ids,imageDigest:H.imageDigest,healthy:true,stackPolicy:null,templateSha256:hash(canonical(windowTemplate(H.imageSource))),oldLease:lease(at-7200000)},
    publication:{kind:'ReviewResume',sourceCommit:source,jobId:K.jobId,manifestSha256:'c'.repeat(64),rawSha256:'d'.repeat(64),
      preservedPlanHashes:[R.oldPlanSha256,N.priorPlanSha].sort()},parents:[{rawSha256:'e'.repeat(64)},{rawSha256:'f'.repeat(64)}],
    nonce:'b'.repeat(32),createdAt:at,compatibility:{executionSourceCommit:source,imageSourceCommit:H.imageSource,protectedRuntimeCodeUnchanged:true}});
}
function ready(m,now=at){return {outcome:'REVIEW_RESUME_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED',jobId:K.jobId,runtimeSourceCommit:m.sourceCommit,
  oldPlansUnchangedAndExpired:true,preservedPlanHashes:m.publication.preservedPlanHashes,
  planHashes:[...m.publication.preservedPlanHashes,'f'.repeat(64)].sort(),planSha256:'f'.repeat(64),controlCounts:{plans:3,approvals:0,attempts:0},
  heldJobUnchanged:true,executionApproved:false,checkedAt:now,planExpiresAt:now+7200000};}
test('two golden expired plans are exact, not a variable plan-count wildcard',async()=>{
  const {m}=await resumeFixture(at);assert.equal(m.oldPlans[1].planSha256,N.priorPlanSha);assert.equal(m.oldPlans[1].actionSha256,N.priorActionSha);
  await knownPair(m.oldPlans,at);assert.equal((await verifyResume(m,m.manifestSha256,at)).manifestSha256,m.manifestSha256);
  for(const change of [x=>x.pop(),x=>x.push(x[0]),x=>{x[1].plan.sourceCommit=source;},x=>{x[1].actionSha256='changed';}]){
    const x=structuredClone(m.oldPlans);change(x);await assert.rejects(knownPair(x,at));}
});
test('resume preparation binds the two-plan read-only proof, metadata, source and exact no-dispatch effects',async()=>{
  const {m}=await resumeFixture(at);assert.equal(m.effects.ownerPlanSqlMax,1);assert.equal(m.effects.s3Puts,0);assert.equal(m.effects.hostedUpdates,0);
  for(const change of [x=>{x.readOnly.controlCounts.plans=1;},x=>{x.readOnly.controlCounts.approvals=1;},x=>{x.readOnly.oldPlans[1].expired=false;},
    x=>{x.readOnly.target.rowSha256='changed';},x=>{x.auth.aclSha256='changed';},x=>{x.references.lineage.versionId='changed';}]){
    const x=structuredClone(m);change(x);await assert.rejects(makeResumeReview(x));}
  await assert.rejects(verifyResume(m,'wrong',at));await assert.rejects(verifyResume(m,m.manifestSha256,m.latestStartAt));
});
test('ledger before is exactly two old plans; after is exactly old+old+new with no approval or attempt',async()=>{
  const {m}=await resumeFixture(at),next=await newResumePlan(resumedPlan(m,at),m,at,at);
  await assertResumeLedger(resumedLedger(m),m,at);await assertResumeLedger(resumedLedger(m,next),m,at,next);
  for(const change of [x=>{x.counts.plans=4;},x=>{x.counts.attempts=1;},x=>{x.entries[1].plan.inputs.lineage='changed';},
    x=>{x.entries[1].attempt={state:'ACKNOWLEDGED'};},x=>{x.entries.pop();}]){
    const x=resumedLedger(m,next);change(x);await assert.rejects(assertResumeLedger(x,m,at,next));}
});
test('new Review cannot restamp an old body, become RunOnce or bind a different source',async()=>{
  const {m}=await resumeFixture(at);for(const change of [p=>{p.mode='RunOnce';},p=>{p.sourceCommit=N.priorSource;},
    p=>{p.inputs.lineage='changed';},p=>{p.expiresAt++;},p=>{p.preparedAt--;}]){
    const p=resumedPlan(m,at);change(p);await assert.rejects(newResumePlan(p,m,at,at));}
});
async function publishRunner(){const f=await resumeFixture(at),events=[],records={};let used=false,fail;
  const step=n=>{events.push(n);if(n===fail)throw Error('PRIVATE_PROVIDER_DETAILS');};
  const io={assertSource:async()=>step('source'),preflight:async()=>step('preflight'),claim:async()=>{assert.equal(used,false);used=true;step('claim');},
    readAuth:async()=>{step('auth');return 'NOT_A_CREDENTIAL';},open:async()=>{step('open');return {ledger:async()=>resumedLedger(f.m),
      readHeldJob:async()=>f.observed,dispose:async()=>step('db-close')};},record:async(n,v)=>{step('record-'+n);records[n]=v;},
    publishReview:async()=>{step('sql');return newResumePlan(resumedPlan(f.m,at),f.m,at,at);},dispose:async()=>step('close')};
  return {...f,io,events,records,fail:n=>{fail=n;},run:()=>publishResumeOnce({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>at})};}
test('one reviewed publication claim precedes owner read and one SQL; no automatic second submission',async()=>{
  const f=await publishRunner(),r=await f.run();assert.equal(r.outcome,'REVIEW_RESUME_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  assert.ok(f.events.indexOf('claim')<f.events.indexOf('auth'));assert.equal(f.events.filter(x=>x==='sql').length,1);
  await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='sql').length,1);
  for(const point of ['auth','open','sql']){const t=await publishRunner();t.fail(point);const v=await t.run();
    assert.equal(v.outcome,'REVIEW_RESUME_PARTIAL_OR_UNKNOWN_NO_RETRY');assert.equal(v.retryAllowed,false);assert.doesNotMatch(canonical(v),/PRIVATE_PROVIDER/);}
});
test('only actual successful rollback state is normalized on a clone for legacy verification',()=>{
  const raw={stack:{Stacks:[{StackId:K.stackId,StackStatus:'UPDATE_ROLLBACK_COMPLETE'}]},resources:{StackResourceSummaries:Array.from({length:11},(_,i)=>
    ({LogicalResourceId:i===0?'TaskDefinition':'fixture-'+i,ResourceStatus:i===0?'UPDATE_ROLLBACK_COMPLETE':'CREATE_COMPLETE'}))}};
  const original=structuredClone(raw),copy=normalizeRecoveredSuccess(raw);assert.deepEqual(raw,original);assert.equal(copy.stack.Stacks[0].StackStatus,'CREATE_COMPLETE');
  for(const status of ['UPDATE_FAILED','UPDATE_ROLLBACK_FAILED','UPDATE_IN_PROGRESS','CREATE_FAILED']){
    const x=structuredClone(raw);x.stack.Stacks[0].StackStatus=status;assert.throws(()=>normalizeRecoveredSuccess(x));}
  raw.resources.StackResourceSummaries[1].ResourceStatus='UPDATE_ROLLBACK_COMPLETE';assert.throws(()=>normalizeRecoveredSuccess(raw));
});
test('new request explicitly enables normal failure rollback, replacing only public source and lease',()=>{
  const m=windowFixture(),r=compatibleInput(m,at);assert.equal(r.DisableRollback,false);assert.equal(r.StackName,K.stackId);
  assert.equal(r.ClientRequestToken,'platform-window-compatible-'+m.nonce);assert.equal(JSON.parse(r.Parameters[1].ParameterValue).issuedAt,at);
  assert.deepEqual(r.Parameters[0],{ParameterKey:'HostingExpiresAt',UsePreviousValue:true});
  assert.deepEqual(Object.keys(r).sort(),['ClientRequestToken','DisableRollback','Parameters','StackName','StackPolicyDuringUpdateBody','TemplateBody']);
  assert.equal(JSON.parse(r.TemplateBody).Metadata.ImageSource,H.imageSource);assert.doesNotMatch(r.StackPolicyDuringUpdateBody,/Update:Delete/);
});
test('compatible review binds recovered state and cannot inherit old slots, old two-plan or failed-stack permission',()=>{
  const m=windowFixture();validateWindow(m,m.manifestSha256,at);assert.equal(m.scope.normalFailureRollback,true);assert.equal(m.scope.operatorAdditionalRollback,0);
  for(const change of [x=>{x.baseline.stackStatus='UPDATE_FAILED';},x=>{x.baseline.rootEventId='unknown';},
    x=>{x.publication.kind='ReviewRefresh';},x=>{x.scope.normalFailureRollback=false;}]){
    const x=structuredClone(m);change(x);assert.throws(()=>validateWindow(x,m.manifestSha256,at));}
  assert.notEqual(W.slot,K.slot);assert.notEqual(W.inspectSlot,K.inspectSlot);assert.throws(()=>validateWindow(m,m.manifestSha256,m.latestStartAt));
});
test('independent inspect binds the exact intent, lease, source and request, including normal rollback',()=>{
  const m=windowFixture(),request=compatibleInput(m,at),intent={manifestSha256:m.manifestSha256,intentAt:at,request,
    controlLease:JSON.parse(request.Parameters[1].ParameterValue)};validateIntent(m,intent);
  for(const change of [x=>{x.request.DisableRollback=true;},x=>{x.request.ClientRequestToken='legacy';},
    x=>{x.controlLease.sourceCommit=R.oldSource;},x=>{x.intentAt++;}]){const x=structuredClone(intent);change(x);assert.throws(()=>validateIntent(m,x));}
});
test('fresh independent exact three-plan proof required; old entries may not be hidden or approvals already consumed',()=>{
  const m=windowFixture(),r=ready(m);readyResume(r,m,at);
  for(const change of [x=>{x.controlCounts.plans=2;},x=>{x.controlCounts.approvals=1;},x=>{x.controlCounts.attempts=1;},
    x=>{x.planHashes.pop();},x=>{x.oldPlansUnchangedAndExpired=false;},x=>{x.runtimeSourceCommit=N.priorSource;},
    x=>{x.checkedAt=at-80*60000;},x=>{x.planExpiresAt=at+39*60000;}]){const x=structuredClone(r);change(x);assert.throws(()=>readyResume(x,m,at));}
});
function windowRunner(){const m=windowFixture(),events=[],records={};let clock=at,used=false,fail,states=['UPDATE_IN_PROGRESS','UPDATE_COMPLETE'];
  const step=n=>{events.push(n);if(n===fail)throw Error('PRIVATE_PROVIDER_DETAILS');};
  const io={assertSource:async()=>step('source'),reviewReady:async()=>{step('review');return ready(m,clock);},
    snapshot:async()=>{step('snapshot');return {checkedAt:clock,baseline:m.baseline};},claim:async()=>{assert.equal(used,false);used=true;step('claim');},
    record:async(n,v)=>{step('record-'+n);records[n]=v;},enableWrite:async()=>step('enable'),update:async r=>{step('update');assert.equal(r.DisableRollback,false);return {StackId:K.stackId};},
    stack:async()=>{step('stack');return {StackId:K.stackId,StackStatus:states.shift()??'UPDATE_COMPLETE'};},wait:async()=>{step('wait');clock+=10000;},
    observe:async()=>{step('observe');return {fixture:true};}};
  return {m,events,io,records,fail:n=>{fail=n;},states:s=>{states=s;},run:()=>runCompatibleOnce({manifest:m,approved:m.manifestSha256,io,now:()=>clock})};}
test('one normal update derives fresh lease after checks, never deploys a business task or claims control acceptance',async()=>{
  const f=windowRunner(),r=await f.run();assert.equal(r.outcome,'COMPATIBLE_WINDOW_METADATA_VERIFIED_ACCEPTANCE_PENDING');
  assert.equal(r.normalFailureRollback,true);assert.equal(r.controlAcceptancePassed,false);assert.equal(r.workflowDispatched,false);
  assert.ok(f.events.indexOf('claim')<f.events.indexOf('update'));assert.equal(f.events.filter(x=>x==='update').length,1);
  await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='update').length,1);
});
test('automatic AWS rollback is not operator success, retry, or permission for a RollbackStack call',async()=>{
  for(const states of [['UPDATE_IN_PROGRESS','UPDATE_ROLLBACK_IN_PROGRESS'],['UPDATE_IN_PROGRESS','UPDATE_ROLLBACK_COMPLETE'],['UPDATE_FAILED']]){
    const f=windowRunner();f.states(states);const r=await f.run();assert.equal(r.outcome,'COMPATIBLE_WINDOW_REQUIRES_INSPECT_NO_RETRY');
    assert.equal(r.retryAllowed,false);assert.equal(f.events.filter(x=>x==='update').length,1);assert.equal(f.events.includes('observe'),false);}
  for(const point of ['record-update-intent','update','record-update-ack','stack','observe']){const f=windowRunner();f.fail(point);
    assert.equal((await f.run()).outcome,'COMPATIBLE_WINDOW_REQUIRES_INSPECT_NO_RETRY');assert.ok(f.events.filter(x=>x==='update').length<=1);}
});
test('preclaim Review and baseline drift do not open an update capability',async()=>{
  const f=windowRunner();f.io.reviewReady=async()=>({...ready(f.m),controlCounts:{plans:2,approvals:0,attempts:0}});
  await assert.rejects(f.run());assert.equal(f.events.includes('claim'),false);
  const t=windowRunner();t.io.snapshot=async()=>({baseline:{},checkedAt:at});await assert.rejects(t.run());assert.equal(t.events.includes('update'),false);
});
test('concrete entries have no hidden owner fallback, new permission installation, deletion, dispatch or recovery retry capability',async()=>{
  const cloud=await readFile(new URL('../ops/platform-hosted-window-v6/compatible-cloud.mjs',import.meta.url),'utf8');
  assert.equal((cloud.match(/new UpdateStackCommand/g)??[]).length,1);assert.match(cloud,/maxAttempts:1/);assert.match(cloud,/request\.DisableRollback===false/);
  assert.doesNotMatch(cloud,/RollbackStackCommand|DeleteStackCommand|SetStackPolicyCommand|UpdateServiceCommand|GetSecretValueCommand|from ['"]pg['"]/);
  const pub=await readFile(new URL('../ops/platform-review-v6/resume-local.mjs',import.meta.url),'utf8');assert.match(pub,/assertResumeLedger/);
  assert.doesNotMatch(pub,/PutObjectCommand|DeleteObjectCommand|GetSecretValueCommand|workflow_dispatch|createPrivateKey|unlink\(|\.query\(['"]UPDATE/);
});
