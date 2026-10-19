import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import yaml from 'js-yaml';
import {APPROVAL_HANDOFF_V5 as V,handoffSlotV5,assertHandoffBudgetV5,prepareHandoffV5,assertHandoffApprovalV5,dispatchHandoffV5,
  reviewToRunOnceHandoffV5,runOnceHandoffScopeV5} from '../ops/cloud-worker/approval-handoff-v5.mjs';
import {prepareCorrectedJobDispatchV5,correctedJobDispatchSlotV5} from '../ops/cloud-worker/corrected-job-dispatch-v5.mjs';
import {assertInstalledEcsJobWorkflowV5} from '../ops/cloud-worker/ecs-job-dispatch-v5.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {evidenceKeyV5} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
const now=1800000000000,source={commit:'a'.repeat(40),runtimeClosureSha256:V.closureSha256,
  files:Array.from({length:179},(_,i)=>({file:'pin-'+i,normalizedLfSha256:'b'.repeat(64)}))},
  anchor={state:'new',main:'0'.repeat(40),stackStatus:'UPDATE_COMPLETE',roleId:'AROAV3GNMXTZK5O45RG24',boundaryDefaultVersion:'v1',
    templateSha256:V.templateSha256,inlinePolicySha256:V.inlinePolicySha256},
  history={publicationEvidenceVerified:true,publicationSourcePinsVerified:152,publicationEvidenceFilesVerified:27,
    failedReviewV3Verified:true,ecsFixEvidenceVerified:true,oldReviewSlotsPreserved:true,
    permissionCorrectionEvidenceVerified:true,permissionCorrectionOriginalsVerified:31,permissionCorrectionSourcePinsVerified:164,
    permissionCorrectionRecordCommit:V.correctionRecordCommit,permissionCorrectionManifestSha256:V.correctionManifestSha256,
    failedReviewV4Preserved:true,correctedLayoutAnchor:anchor,expiredRunOnceEvidenceVerified:true,previousAttemptSourcePinsVerified:172,
    previousRunOnceRunId:V.previousRunId,previousReviewRunId:V.previousReviewRunId,previousRunOnceLocalSlotPreserved:true,
    previousFailureCheckpointSha256:V.failureCheckpointSha256},
  prestate={main:source.commit,workflowId:V.workflowId,environmentId:V.environmentId,runtimeCommit:V.runtime,reusableCommit:V.reusable,
    metadataVerified:true,metadataSha256:'f'.repeat(64),sourceCiConfirmed:true,unfinishedRuns:0,jobId:V.jobId,
    jobRowSha256:V.jobRowSha256,snapshotSha256:V.snapshotSha256,activeJobs:1,correctedLayout:{...anchor,main:source.commit},
    newAttemptJournal:{tableId:'ea69c69e-1c48-481a-83f0-36393c196d9f',allFiveAbsent:true,transactionalFiveEntrySnapshot:true}},
  cloud={jobId:V.jobId,manifestSha256:'c'.repeat(64),code:{commitSha:source.commit,closureSha256:V.closureSha256},claimBy:now+900000,
    reference:{key:evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:'c'.repeat(64)}),versionId:'manifest-v6',sha256:'d'.repeat(64)}},
  executionRun={repository:'veinyyxy/TechlongSoftware',runId:'123',runAttempt:1,commitSha:source.commit},
  execution={jobId:V.jobId,manifestSha256:cloud.manifestSha256,outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',executionRun,
    reference:{key:evidenceKeyV5('run.json',{jobId:V.jobId,manifestSha256:cloud.manifestSha256,run:executionRun}),versionId:'run-v5',sha256:'e'.repeat(64)}};
const context=(mode='Review')=>({mode,source,history,prestate,cloud:mode==='Review'?null:cloud,execution:mode==='Inspect'?execution:null,now});
async function fixture(mode='Review'){
  const c=context(mode),m=await prepareHandoffV5(c),events=[];let used=false;
  const io={preflight:async()=>prestate,assertLocalSource:async()=>events.push('local'),assertCloudWindow:async()=>{},
    consumeSlot:async()=>{assert.equal(used,false);used=true;events.push('slot');},record:async n=>events.push(n),
    putExecutionReference:async o=>{events.push('PUT');return {key:o.key,versionId:'actual-ack',sha256:await sha256Hex(o.body)};},
    dispatch:async(r,g)=>{await g();events.push('POST');return {workflow_run_id:124,html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};}};
  return {c,m,events,io,run:()=>dispatchHandoffV5({manifest:m,approved:m.manifestSha256,context:c,io,now:()=>now})};
}
function rawRun(m,status='completed',conclusion='success'){
  return {id:124,workflow_id:V.workflowId,head_sha:m.source.commit,head_branch:'main',event:'workflow_dispatch',run_attempt:1,
    actor:{id:14145707},triggering_actor:{id:14145707},repository:{id:1323312747},head_repository:{id:1323312747},
    created_at:new Date(m.preparedAt+1).toISOString(),html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',status,conclusion};
}

test('new independent slots/schema retain all cloud inputs/effects/time bounds and fixed C/R',async()=>{
  const workflow=yaml.load(await readFile(new URL('../.github/workflows/cloud-worker-execute.yml',import.meta.url),'utf8'));
  for(const mode of ['Review','RunOnce','Inspect']){
    const c=context(mode),m=await prepareHandoffV5(c),old=await prepareCorrectedJobDispatchV5(c);
    assert.deepEqual(m.request,old.request);assert.deepEqual(m.effects,old.effects);assert.equal(m.expiresAt,old.expiresAt);
    assert.equal(m.runtimeCommit,V.runtime);assert.equal(m.reusableCommit,V.reusable);assert.notEqual(m.localPermanentSlot,correctedJobDispatchSlotV5(mode));
    assert.match(m.localPermanentSlot,new RegExp('-'+mode.toLowerCase()+'-v'+(mode==='Review'?'6':'5')+'\\.permanent-slot\\.json$'));
    assert.equal(m.approvalHandoff.cloudClaimWindowChanged,false);assert.equal(m.approvalHandoff.automaticDispatch,false);assertInstalledEcsJobWorkflowV5(workflow,m.request.body);
  }
  assert.throws(()=>handoffSlotV5('Handoff'));
});

test('prior failure evidence/old slot/history and current transactional empty journal are mandatory',async()=>{
  for(const patch of [{expiredRunOnceEvidenceVerified:false},{previousAttemptSourcePinsVerified:171},{previousRunOnceRunId:'other'},
    {previousReviewRunId:'other'},{previousRunOnceLocalSlotPreserved:false},{previousFailureCheckpointSha256:'0'.repeat(64)}])
    await assert.rejects(prepareHandoffV5({...context(),history:{...history,...patch}}));
  for(const p of [{...prestate,newAttemptJournal:null},{...prestate,newAttemptJournal:{...prestate.newAttemptJournal,allFiveAbsent:false}}])
    await assert.rejects(prepareHandoffV5({...context(),prestate:p}));
});

test('8-minute threshold narrows RunOnce without extending original claimBy; stale window cannot prepare',async()=>{
  assertHandoffBudgetV5('RunOnce',cloud,cloud.claimBy-V.minimumRunOnceRemainingMs);
  assert.throws(()=>assertHandoffBudgetV5('RunOnce',cloud,cloud.claimBy-V.minimumRunOnceRemainingMs+1));
  await assert.rejects(prepareHandoffV5({...context('RunOnce'),now:cloud.claimBy-479999}));
  const m=await prepareHandoffV5(context('RunOnce'));assert.equal(m.expiresAt,cloud.claimBy);
  assert.doesNotThrow(()=>assertHandoffBudgetV5('Inspect',cloud,cloud.claimBy+1));
});

test('approval rejects old schema/actions, wrong SHA, expired plan and insufficient time before I/O',async()=>{
  const f=await fixture('RunOnce');
  await assert.rejects(assertHandoffApprovalV5({...f.m,schema:'techlong/cloud-worker-corrected-job-dispatch-review/v5'},f.m.manifestSha256,f.c,now));
  await assert.rejects(assertHandoffApprovalV5(f.m,'0'.repeat(64),f.c,now));
  await assert.rejects(dispatchHandoffV5({manifest:f.m,approved:f.m.manifestSha256,context:f.c,io:f.io,now:()=>cloud.claimBy-479999}));
  assert.deepEqual(f.events,[]);
});

test('fresh preflight consuming time stops before local slot; last-moment source-check delay stops before POST',async()=>{
  const f=await fixture('RunOnce');let t=now;f.io.preflight=async()=>{t=cloud.claimBy-479999;return prestate;};
  await assert.rejects(dispatchHandoffV5({manifest:f.m,approved:f.m.manifestSha256,context:f.c,io:f.io,now:()=>t}));assert.deepEqual(f.events,[]);
  const g=await fixture('RunOnce');let clock=cloud.claimBy-480001;g.io.assertLocalSource=async()=>{clock+=2;};
  await assert.rejects(dispatchHandoffV5({manifest:g.m,approved:g.m.manifestSha256,context:g.c,io:g.io,now:()=>clock}));
  assert.ok(g.events.includes('slot'));assert.ok(!g.events.includes('POST'));
});

test('only one guarded POST; consumed slot and unknown/wrong ACK never authorize retry or environment approval',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.environmentApprovedByController,false);await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='POST').length,1);
  const g=await fixture();g.io.dispatch=async(r,guard)=>{await guard();g.events.push('POST');throw Error('unknown');};
  await assert.rejects(g.run());await assert.rejects(g.run());assert.equal(g.events.filter(x=>x==='POST').length,1);
  const h=await fixture();h.io.dispatch=async(r,guard)=>{await guard();return {workflow_run_id:124,html_url:'wrong'};};await assert.rejects(h.run());assert.ok(h.events.includes('dispatch-api-ack'));
});

test('read-only handoff waits for exact Review, reconstructs once then only prepares an unapproved RunOnce',async()=>{
  const f=await fixture(),events=[];let clock=now,n=0;
  const r=await reviewToRunOnceHandoffV5({manifest:f.m,runId:'124',now:()=>clock,io:{
    readRun:async()=>rawRun(f.m,n++?'completed':'in_progress'),sleep:async ms=>{clock+=ms;events.push('wait');},
    observe:async()=>{events.push('observe');return {outcome:'CLOUD_REVIEW_RECONSTRUCTED_NOT_EXECUTION_APPROVAL'};},
    prepareRunOnce:async()=>{events.push('prepare');return {outcome:'PREPARED_NOT_DISPATCHED',cloudMode:'RunOnce',workflowDispatches:0,slotConsumed:false};}}});
  assert.deepEqual(events,['wait','observe','prepare']);assert.equal(r.automaticDispatches,0);assert.equal(r.environmentApprovedByController,false);
});

test('wrong run/head/actor/attempt is rejected before observing or preparing',async()=>{
  const f=await fixture();for(const patch of [{id:999},{head_sha:'f'.repeat(40)},{actor:{id:1}},{run_attempt:2}]){
    let effect=false;await assert.rejects(reviewToRunOnceHandoffV5({manifest:f.m,runId:'124',io:{readRun:async()=>({...rawRun(f.m),...patch}),
      observe:async()=>{effect=true;},prepareRunOnce:async()=>{effect=true;}}}));assert.equal(effect,false);
  }
});

test('failed or still-waiting Review never prepares; bounded read-only wait has no fallback dispatch',async()=>{
  const f=await fixture();let count=0;
  const r=await reviewToRunOnceHandoffV5({manifest:f.m,runId:'124',io:{readRun:async()=>rawRun(f.m,'completed','failure'),
    observe:async()=>({outcome:'WAITING_OR_UNSUCCESSFUL_NO_RETRY'}),prepareRunOnce:async()=>{count++;}}});
  assert.equal(r.outcome,'HANDOFF_REVIEW_UNSUCCESSFUL_NO_DISPATCH');assert.equal(count,0);
  let clock=now;const waiting=await reviewToRunOnceHandoffV5({manifest:f.m,runId:'124',now:()=>clock,io:{readRun:async()=>rawRun(f.m,'waiting',null),
    sleep:async ms=>{clock+=ms;},observe:async()=>{count++;},prepareRunOnce:async()=>{count++;}}});
  assert.equal(waiting.outcome,'HANDOFF_REVIEW_NOT_COMPLETE_NO_DISPATCH');assert.equal(count,0);assert.equal(clock-now,V.handoffWaitMs);
});

test('handoff never accepts an already-dispatched result or another cloud mode',async()=>{
  const f=await fixture();await assert.rejects(reviewToRunOnceHandoffV5({manifest:{...f.m,mode:'RunOnce'},runId:'124',io:{}}));
  await assert.rejects(reviewToRunOnceHandoffV5({manifest:f.m,runId:'124',io:{readRun:async()=>rawRun(f.m),observe:async()=>({outcome:'CLOUD_REVIEW_RECONSTRUCTED_NOT_EXECUTION_APPROVAL'}),
    prepareRunOnce:async()=>({outcome:'DISPATCHED',cloudMode:'RunOnce',workflowDispatches:1,slotConsumed:true})}}));
});

test('Inspect still binds exact conditional Put ACK and digest before single POST',async()=>{
  const f=await fixture('Inspect');let version;f.io.dispatch=async(r,g)=>{await g();version=JSON.parse(r.body.inputs.execution).versionId;return {
    workflow_run_id:124,html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};};
  await f.run();assert.equal(version,'actual-ack');assert.ok(f.events.indexOf('execution-reference-ack')<f.events.indexOf('dispatch-api-ack'));
});

test('generated scope is exact SHA/resources/original times and omits raw private configuration',async()=>{
  const m=await prepareHandoffV5(context('RunOnce')),cm={manifestSha256:cloud.manifestSha256,code:cloud.code,jobPlan:{claimBy:cloud.claimBy,deadline:now+3600000},
    workload:{stackName:'exact-stack',parentStackId:'exact-parent',requestSha256:'d'.repeat(64),workloadExpiresAt:now+7200000,request:{OnFailure:'ROLLBACK'},
      template:{Resources:Object.fromEntries(Array.from({length:7},(_,n)=>['R'+n,{Type:'AWS::Logs::LogGroup',Properties:{RawPrivate:'DO_NOT_RENDER'}}]))}}};
  const text=runOnceHandoffScopeV5(m,cm);assert.ok(text.includes(m.manifestSha256));assert.ok(text.includes(new Date(cloud.claimBy).toISOString()));
  assert.ok(text.includes('ROLLBACK'));assert.ok(!text.includes('DO_NOT_RENDER'));
});

test('new local adapter uses read-only DDB and fixed prior evidence, never alters legacy code or dispatches from handoff callback',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/approval-handoff-local-v5.mjs',import.meta.url),'utf8');
  for(const marker of ['FAILURE_CHECKPOINT','FAILURE_ORIGINAL','PREVIOUS_ATTEMPT_GIT_PIN','OBSERVE_FROZEN_SOURCE','JOURNAL_NOT_EMPTY_NO_NEW_ATTEMPT'])assert.ok(code.includes(marker));
  assert.match(code,/TransactGetItemsCommand/);assert.match(code,/flag:'wx'/);assert.doesNotMatch(code,/GetSecretValueCommand|CreateStackCommand|PutItemCommand|ExecuteChangeSetCommand|\/rerun|\/cancel/);
  const {mainHandoffV5}=await import('../ops/cloud-worker/approval-handoff-local-v5.mjs');
  await assert.rejects(mainHandoffV5(['--mode','Apply','--output','unused']));
  await assert.rejects(mainHandoffV5(['--mode','Handoff','--dispatch-directory','unused','--output','unused']));
});
