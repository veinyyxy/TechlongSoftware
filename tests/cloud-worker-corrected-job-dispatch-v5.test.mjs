import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import yaml from 'js-yaml';
import {CORRECTED_JOB_DISPATCH_V5 as V,correctedJobDispatchSlotV5,assertCorrectedJobLayoutV5,prepareCorrectedJobDispatchV5,
  assertCorrectedJobApprovalV5,dispatchCorrectedJobV5,executionObjectV5} from '../ops/cloud-worker/corrected-job-dispatch-v5.mjs';
import {ECS_JOB_DISPATCH_V5 as OLD,prepareEcsJobDispatchV5,ecsJobDispatchSlotV5,assertInstalledEcsJobWorkflowV5} from '../ops/cloud-worker/ecs-job-dispatch-v5.mjs';
import {assertCorrectedAncillaryV5} from '../ops/cloud-worker/corrected-job-metadata-v5.mjs';
import {taskDefinitionPermissionChangeV5} from '../ops/cloud-worker/task-definition-permission-v5.mjs';
import {evidenceBucketPolicyV5} from '../ops/cloud-worker/install/plan-v5.mjs';
import {RECOVERY_ANCHOR_V5 as R} from '../ops/cloud-worker/install/recovery-v5.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {evidenceKeyV5} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
const now=1800000000000,source={commit:'a'.repeat(40),runtimeClosureSha256:V.closureSha256,
  files:Array.from({length:172},(_,i)=>({file:'pin-'+i,normalizedLfSha256:'b'.repeat(64)}))},
  anchor={state:'new',main:'0'.repeat(40),stackStatus:'UPDATE_COMPLETE',roleId:R.roleId,boundaryDefaultVersion:'v1',
    boundaryPolicyId:'fixed-boundary',trustSha256:'c'.repeat(64),foundationResourceIdsSha256:'d'.repeat(64),
    templateSha256:V.templateSha256,inlinePolicySha256:V.inlinePolicySha256},
  history={publicationEvidenceVerified:true,publicationSourcePinsVerified:152,publicationEvidenceFilesVerified:27,
    failedReviewV3Verified:true,ecsFixEvidenceVerified:true,oldReviewSlotsPreserved:true,
    permissionCorrectionEvidenceVerified:true,permissionCorrectionOriginalsVerified:31,permissionCorrectionSourcePinsVerified:164,
    permissionCorrectionRecordCommit:V.correctionRecordCommit,permissionCorrectionManifestSha256:V.correctionManifestSha256,
    failedReviewV4Preserved:true,correctedLayoutAnchor:anchor},
  prestate={main:source.commit,workflowId:V.workflowId,environmentId:V.environmentId,runtimeCommit:V.runtime,reusableCommit:V.reusable,
    metadataVerified:true,metadataSha256:'f'.repeat(64),sourceCiConfirmed:true,unfinishedRuns:0,jobId:V.jobId,
    jobRowSha256:V.jobRowSha256,snapshotSha256:V.snapshotSha256,activeJobs:1,correctedLayout:{...anchor,main:source.commit}},
  cloud={jobId:V.jobId,manifestSha256:'c'.repeat(64),code:{commitSha:source.commit,closureSha256:V.closureSha256},claimBy:now+900000,
    reference:{key:evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:'c'.repeat(64)}),versionId:'manifest-v5',sha256:'d'.repeat(64)}},
  executionRun={repository:'veinyyxy/TechlongSoftware',runId:'123',runAttempt:1,commitSha:source.commit},
  execution={jobId:V.jobId,manifestSha256:cloud.manifestSha256,outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',executionRun,
    reference:{key:evidenceKeyV5('run.json',{jobId:V.jobId,manifestSha256:cloud.manifestSha256,run:executionRun}),versionId:'run-v4',sha256:'e'.repeat(64)}};
const context=(mode='Review')=>({mode,source,history,prestate,cloud:mode==='Review'?null:cloud,execution:mode==='Inspect'?execution:null,now});
async function fixture(mode='Review'){
  const c=context(mode),m=await prepareCorrectedJobDispatchV5(c),events=[];let used=false;
  const io={preflight:async()=>prestate,assertLocalSource:async()=>events.push('local'),assertCloudWindow:async()=>{},
    consumeSlot:async()=>{assert.equal(used,false);used=true;events.push('slot');},record:async n=>events.push(n),
    putExecutionReference:async o=>{events.push('PUT');return {key:o.key,versionId:'exact-ack',sha256:await sha256Hex(o.body)};},
    dispatch:async(r,g)=>{await g();events.push('POST');return {workflow_run_id:124,
      html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};}};
  return {c,m,io,events,run:()=>dispatchCorrectedJobV5({manifest:m,approved:m.manifestSha256,context:c,io,now:()=>now})};
}

test('same cloud C/R, seven inputs, effects and original held job; only local schema/risk and independent slots change',async()=>{
  const workflow=yaml.load(await readFile(new URL('../.github/workflows/cloud-worker-execute.yml',import.meta.url),'utf8'));
  for(const mode of ['Review','RunOnce','Inspect']){
    const c=context(mode),m=await prepareCorrectedJobDispatchV5(c),old=await prepareEcsJobDispatchV5(c);
    assert.deepEqual(m.request,old.request);assert.deepEqual(m.effects,old.effects);assert.deepEqual(m.cloud,old.cloud);
    assert.equal(m.expiresAt,old.expiresAt);assert.equal(m.runtimeCommit,OLD.runtime);assert.equal(m.reusableCommit,OLD.reusable);
    assert.equal(m.jobId,OLD.jobId);assert.equal(m.schema,'techlong/cloud-worker-corrected-job-dispatch-review/v5');
    assert.notEqual(m.localPermanentSlot,ecsJobDispatchSlotV5(mode));
    assert.match(m.localPermanentSlot,new RegExp('-'+mode.toLowerCase()+'-v'+(mode==='Review'?'5':'4')+'\\.permanent-slot\\.json$'));
    assertInstalledEcsJobWorkflowV5(workflow,m.request.body);
  }
  assert.throws(()=>correctedJobDispatchSlotV5('Apply'));
});

test('missing correction, originals, historical pins, old failure or prior publication fails closed',async()=>{
  for(const patch of [{permissionCorrectionEvidenceVerified:false},{permissionCorrectionOriginalsVerified:30},
    {permissionCorrectionSourcePinsVerified:163},{permissionCorrectionRecordCommit:'f'.repeat(40)},
    {permissionCorrectionManifestSha256:'f'.repeat(64)},{failedReviewV4Preserved:false},{oldReviewSlotsPreserved:false},
    {publicationEvidenceVerified:false}])await assert.rejects(prepareCorrectedJobDispatchV5({...context(),history:{...history,...patch}}));
  await assert.rejects(prepareCorrectedJobDispatchV5({...context(),source:{...source,files:[]}}));
});

test('corrected layout matches entire independent anchor, permitting only new frozen caller main',()=>{
  assertCorrectedJobLayoutV5(prestate.correctedLayout,anchor,source.commit);
  for(const [k,v]of Object.entries({state:'old',main:'f'.repeat(40),templateSha256:'0'.repeat(64),inlinePolicySha256:'0'.repeat(64),
    roleId:'replaced',boundaryDefaultVersion:'v2',boundaryPolicyId:'replaced',trustSha256:'0'.repeat(64),foundationResourceIdsSha256:'0'.repeat(64)}))
    assert.throws(()=>assertCorrectedJobLayoutV5({...prestate.correctedLayout,[k]:v},anchor,source.commit));
  assert.throws(()=>assertCorrectedJobLayoutV5(prestate.correctedLayout,{...anchor,state:'old'},source.commit));
});

test('ancillary verification retains preserved IAM, exact DDB identity/schema/TTL and evidence bucket policy',async()=>{
  const capsule=JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8')),
    template=taskDefinitionPermissionChangeV5(capsule).template,a={source:{Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev'},
      preservedIam:{iamLayoutUnchanged:true},journal:{value:{Table:{TableId:R.tableId,DeletionProtectionEnabled:true,TableStatus:'ACTIVE',
        BillingModeSummary:{BillingMode:'PAY_PER_REQUEST'},KeySchema:template.Resources.Journal.Properties.KeySchema}},ttl:{value:{TimeToLiveDescription:{TimeToLiveStatus:'DISABLED'}}}}},
    p={Policy:JSON.stringify(evidenceBucketPolicyV5())};
  assertCorrectedAncillaryV5(a,template,p);
  for(const change of [x=>x.preservedIam.iamLayoutUnchanged=false,x=>x.journal.value.Table.TableId='replaced',
    x=>x.journal.value.Table.GlobalSecondaryIndexes=[{}],x=>x.journal.ttl.value.TimeToLiveDescription.TimeToLiveStatus='ENABLED']){
    const v=structuredClone(a);change(v);assert.throws(()=>assertCorrectedAncillaryV5(v,template,p));
  }
  assert.throws(()=>assertCorrectedAncillaryV5(a,template,{Policy:'{}'}));
});

test('old schema/SHA, changed effects, layout drift, expired approval and CI failure stop before slot',async()=>{
  const f=await fixture();for(const patch of [{schema:'techlong/cloud-worker-ecs-job-dispatch-review/v5'},
    {effects:{...f.m.effects,jobClaims:1}},{localPermanentSlot:ecsJobDispatchSlotV5('Review')}])
    await assert.rejects(assertCorrectedJobApprovalV5({...f.m,...patch},f.m.manifestSha256,f.c,now));
  await assert.rejects(assertCorrectedJobApprovalV5(f.m,'0'.repeat(64),f.c,now));
  await assert.rejects(dispatchCorrectedJobV5({manifest:f.m,approved:f.m.manifestSha256,context:f.c,io:f.io,now:()=>f.m.expiresAt}));
  f.io.preflight=async()=>({...prestate,correctedLayout:{...prestate.correctedLayout,trustSha256:'0'.repeat(64)}});
  await assert.rejects(f.run());assert.deepEqual(f.events,[]);
  await assert.rejects(prepareCorrectedJobDispatchV5({...context(),prestate:{...prestate,sourceCiConfirmed:false}}));
});

test('Review single guarded POST and ACK; permanent slot prevents repeat, no environment approval or job claim',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.runId,'124');assert.equal(r.environmentApprovedByController,false);
  assert.deepEqual(f.events,['slot','dispatch-intent','local','POST','dispatch-api-ack','dispatch-result']);
  assert.equal(f.m.effects.jobClaims,0);assert.equal(f.m.effects.privateManifestConditionalPuts,1);assert.equal(f.m.effects.fixedDatabaseSecretValueReads,1);
  await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
});

test('unknown POST or wrong ACK never retries; local drift or expiry immediately before POST stops',async()=>{
  const f=await fixture();f.io.dispatch=async(r,g)=>{await g();f.events.push('POST');throw Error('unknown');};
  await assert.rejects(f.run());await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
  const g=await fixture();g.io.assertLocalSource=async()=>{throw Error('drift');};await assert.rejects(g.run());assert.ok(!g.events.includes('POST'));
  const h=await fixture();h.io.dispatch=async(r,g)=>{await g();h.events.push('POST');return {workflow_run_id:124,html_url:'wrong'};};
  await assert.rejects(h.run());assert.ok(h.events.includes('dispatch-api-ack'));assert.ok(!h.events.includes('dispatch-result'));
  const j=await fixture();let t=now;j.io.dispatch=async(r,g)=>{t=j.m.expiresAt;await g();j.events.push('POST');};
  await assert.rejects(dispatchCorrectedJobV5({manifest:j.m,approved:j.m.manifestSha256,context:j.c,io:j.io,now:()=>t}));assert.ok(!j.events.includes('POST'));
});

test('RunOnce preserves exact successful cloud manifest, claimBy and source; expired or drifted cloud blocks submission',async()=>{
  const m=await prepareCorrectedJobDispatchV5(context('RunOnce'));assert.equal(m.expiresAt,cloud.claimBy);assert.equal(m.effects.workloadResources,7);
  for(const patch of [{now:cloud.claimBy},{source:{...source,commit:'f'.repeat(40)}}])await assert.rejects(prepareCorrectedJobDispatchV5({...context('RunOnce'),...patch}));
  const f=await fixture('RunOnce');f.io.assertCloudWindow=async()=>{throw Error('expired');};await assert.rejects(f.run());assert.ok(!f.events.includes('POST'));
});

test('Inspect uses exact conditional Put ACK and digest; unknown Put stops without POST, compensation or retry',async()=>{
  const f=await fixture('Inspect');let version;
  f.io.dispatch=async(r,g)=>{await g();version=JSON.parse(r.body.inputs.execution).versionId;f.events.push('POST');return {
    workflow_run_id:124,html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};};
  await f.run();assert.equal(version,'exact-ack');assert.ok(f.events.indexOf('execution-reference-ack')<f.events.indexOf('POST'));
  assert.ok(executionObjectV5(cloud,execution).key);
  const g=await fixture('Inspect');g.io.putExecutionReference=async()=>{g.events.push('PUT');throw Error('unknown');};
  await assert.rejects(g.run());await assert.rejects(g.run());assert.equal(g.events.filter(v=>v==='PUT').length,1);assert.ok(!g.events.includes('POST'));
});

test('local continuation is explicit new verifier/slots, keeps original source/history and does not call old preflight or IAM mutators',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/corrected-job-dispatch-local-v5.mjs',import.meta.url),'utf8'),
    metadata=await readFile(new URL('../ops/cloud-worker/corrected-job-metadata-v5.mjs',import.meta.url),'utf8');
  for(const marker of ['IMMUTABLE_CORRECTION_RECORD','CORRECTION_ORIGINAL','CORRECTION_CHECKPOINT','CORRECTION_HISTORICAL_SOURCE_PIN',
    'CORRECTION_PLAN_AND_INSPECT','ONLY_EXPLICIT_CONTINUATION_CHANGE','SOURCE_CI_NOT_PASSED','OBSERVE_FROZEN_SOURCE','OBSERVE_PERMANENT_SLOT'])assert.ok(code.includes(marker));
  assert.doesNotMatch(code+metadata,/GetSecretValueCommand|CreateStackCommand|ExecuteChangeSetCommand|PutRolePolicyCommand|\/rerun|\/cancel|common\.preflight|layoutIo\.preflight/);
  assert.match(code,/flag:'wx'/);assert.match(metadata,/layoutIo\.readLayout\('new'\)/);assert.match(metadata,/readOnly:true/);
  assert.match(metadata,/allowed\.has\(q\.constructor\.name\)/);assert.match(metadata,/assessContinuationSecretV5/);assert.match(metadata,/verifyNeonCatalogV5/);
  const old=await readFile(new URL('../ops/cloud-worker/activation/local-io-v5.mjs',import.meta.url),'utf8');
  assert.match(old,/same\(decode\(inline\.PolicyDocument\),workerPermissionsV5\(capsule\)\)/);
});

test('unsupported local mode and duplicate/extra arguments fail before I/O',async()=>{
  const {mainCorrectedJobDispatchV5}=await import('../ops/cloud-worker/corrected-job-dispatch-local-v5.mjs');
  for(const args of [['--mode','Apply','--output','unused'],['--mode','Prepare','--mode','Dispatch','--output','unused'],
    ['--mode','Prepare','--cloud-mode','Review','--output','unused','--approved-sha','0'.repeat(64)]])await assert.rejects(mainCorrectedJobDispatchV5(args));
});
