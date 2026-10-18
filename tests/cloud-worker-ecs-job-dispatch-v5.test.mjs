import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import yaml from 'js-yaml';
import {ECS_JOB_DISPATCH_V5 as V,ecsJobDispatchSlotV5,prepareEcsJobDispatchV5,assertEcsJobDispatchApprovalV5,
  dispatchEcsJobV5,assertInstalledEcsJobWorkflowV5,jobDispatchBodyV5,executionObjectV5} from '../ops/cloud-worker/ecs-job-dispatch-v5.mjs';
import {DNS_JOB_DISPATCH_V5 as OLD,assertInstalledDnsJobWorkflowV5} from '../ops/cloud-worker/dns-job-dispatch-v5.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {evidenceKeyV5} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
const now=1800000000000,source={commit:'a'.repeat(40),runtimeClosureSha256:V.closureSha256,
  files:Array.from({length:159},(_,i)=>({file:'pin-'+i,normalizedLfSha256:'b'.repeat(64)}))},
  history={publicationEvidenceVerified:true,publicationSourcePinsVerified:152,publicationEvidenceFilesVerified:27,
    failedReviewV3Verified:true,ecsFixEvidenceVerified:true,oldReviewSlotsPreserved:true},
  prestate={main:source.commit,workflowId:V.workflowId,environmentId:V.environmentId,runtimeCommit:V.runtime,reusableCommit:V.reusable,
    metadataVerified:true,metadataSha256:'f'.repeat(64),sourceCiConfirmed:true,unfinishedRuns:0,jobId:V.jobId,
    jobRowSha256:V.jobRowSha256,snapshotSha256:V.snapshotSha256,activeJobs:1},
  cloud={jobId:V.jobId,manifestSha256:'c'.repeat(64),code:{commitSha:source.commit,closureSha256:V.closureSha256},claimBy:now+900000,
    reference:{key:evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:'c'.repeat(64)}),versionId:'manifest-v4',sha256:'d'.repeat(64)}},
  executionRun={repository:'veinyyxy/TechlongSoftware',runId:'123',runAttempt:1,commitSha:source.commit},
  execution={jobId:V.jobId,manifestSha256:cloud.manifestSha256,outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',executionRun,
    reference:{key:evidenceKeyV5('run.json',{jobId:V.jobId,manifestSha256:cloud.manifestSha256,run:executionRun}),versionId:'run-v3',sha256:'e'.repeat(64)}};
const context=(mode='Review')=>({mode,source,history,prestate,cloud:mode==='Review'?null:cloud,execution:mode==='Inspect'?execution:null,now});
async function fixture(mode='Review'){
  const c=context(mode),m=await prepareEcsJobDispatchV5(c),events=[];let used=false;
  const io={preflight:async()=>prestate,assertLocalSource:async()=>events.push('local'),assertCloudWindow:async()=>{},
    consumeSlot:async()=>{assert.equal(used,false);used=true;events.push('slot');},record:async n=>events.push(n),
    putExecutionReference:async o=>{events.push('PUT');return {key:o.key,versionId:'actual-ack-version',sha256:await sha256Hex(o.body)};},
    dispatch:async(request,guard)=>{await guard();events.push('POST');return {workflow_run_id:124,
      html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};}};
  return {c,m,io,events,run:()=>dispatchEcsJobV5({manifest:m,approved:m.manifestSha256,context:c,io,now:()=>now})};
}

test('actual W5n caller and runtime use the new exact C/R and unchanged seven external inputs; old dispatcher rejects new R',async()=>{
  const workflow=yaml.load(await readFile(new URL('../.github/workflows/cloud-worker-execute.yml',import.meta.url),'utf8')),
    reusable=await readFile(new URL('../.github/workflows/cloud-worker-job.yml',import.meta.url),'utf8');
  assert.ok(reusable.includes(V.runtime));assert.ok(!reusable.includes(OLD.runtime));
  const object=executionObjectV5(cloud,execution),ref={key:object.key,versionId:'exact-version',sha256:await sha256Hex(object.body)};
  for(const body of [jobDispatchBodyV5('Review'),jobDispatchBodyV5('RunOnce',cloud),jobDispatchBodyV5('Inspect',cloud,ref)]){
    assertInstalledEcsJobWorkflowV5(workflow,body);assert.throws(()=>assertInstalledDnsJobWorkflowV5(workflow,body));
    assert.throws(()=>assertInstalledEcsJobWorkflowV5(workflow,{...body,inputs:{...body.inputs,installationSha:V.installationSha256}}));
  }
  const old=structuredClone(workflow);old.jobs.reviewed.uses=old.jobs.reviewed.uses.replace(V.reusable,OLD.reusable);
  assert.throws(()=>assertInstalledEcsJobWorkflowV5(old));
});

test('new schema binds actual ECS publication, original held job, same effects and disjoint Review-v4/RunOnce-Inspect-v3 slots',async()=>{
  for(const mode of ['Review','RunOnce','Inspect']){
    const m=await prepareEcsJobDispatchV5(context(mode));assert.equal(m.runtimeCommit,V.runtime);assert.equal(m.reusableCommit,V.reusable);
    assert.equal(m.jobId,OLD.jobId);assert.equal(m.schema,'techlong/cloud-worker-ecs-job-dispatch-review/v5');
    assert.match(m.localPermanentSlot,new RegExp('-'+mode.toLowerCase()+'-v'+(mode==='Review'?'4':'3')+'\\.permanent-slot\\.json$'));
  }
  const m=await prepareEcsJobDispatchV5(context());assert.equal(m.effects.jobClaims,0);assert.equal(m.effects.privateManifestConditionalPuts,1);
  assert.equal(m.effects.fixedDatabaseSecretValueReads,1);assert.equal(m.effects.controlSecretReads,0);assert.equal(m.effects.dynamoDbWrites,0);
  assert.throws(()=>ecsJobDispatchSlotV5('VerifyInstall'));
});

test('unverified publication/failure/fix history, old closure/CI/trust and changed job fail closed',async()=>{
  const c=context();for(const x of [{history:{}},{history:{...history,oldReviewSlotsPreserved:false}},
    {history:{...history,failedReviewV3Verified:false}},{history:{...history,ecsFixEvidenceVerified:false}},
    {history:{...history,publicationEvidenceFilesVerified:26}},{source:{...source,runtimeClosureSha256:OLD.closureSha256}},
    {source:{...source,files:[]}},{prestate:{...prestate,sourceCiConfirmed:false}},{prestate:{...prestate,reusableCommit:OLD.reusable}},
    {prestate:{...prestate,metadataSha256:'bad'}},{prestate:{...prestate,activeJobs:2}},
    {prestate:{...prestate,jobRowSha256:'0'.repeat(64)}}])await assert.rejects(prepareEcsJobDispatchV5({...c,...x}));
});

test('old schema/SHA, altered effects/slot and expiry or fresh metadata drift consume no slot or network effect',async()=>{
  const f=await fixture();for(const patch of [{schema:'techlong/cloud-worker-dns-job-dispatch-review/v5'},
    {runtimeCommit:OLD.runtime},{localPermanentSlot:f.m.localPermanentSlot.replace('-v4.','-v3.')},{effects:{...f.m.effects,jobClaims:1}}])
    await assert.rejects(assertEcsJobDispatchApprovalV5({...f.m,...patch},f.m.manifestSha256,f.c,now));
  await assert.rejects(assertEcsJobDispatchApprovalV5(f.m,'0'.repeat(64),f.c,now));
  await assert.rejects(dispatchEcsJobV5({manifest:f.m,approved:f.m.manifestSha256,context:f.c,io:f.io,now:()=>f.m.expiresAt}));
  assert.deepEqual(f.events,[]);f.io.preflight=async()=>({...prestate,metadataSha256:'0'.repeat(64)});
  await assert.rejects(f.run());assert.deepEqual(f.events,[]);
});

test('Review consumes v4 once before guarded POST, saves exact ACK and never approves environment',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.runId,'124');assert.equal(r.environmentApprovedByController,false);
  assert.deepEqual(f.events,['slot','dispatch-intent','local','POST','dispatch-api-ack','dispatch-result']);await assert.rejects(f.run());
  assert.equal(f.events.filter(v=>v==='POST').length,1);
});

test('unknown POST, local drift and wrong ACK halt without write retries',async()=>{
  const f=await fixture();f.io.dispatch=async(r,g)=>{await g();f.events.push('POST');throw Error('unknown ACK');};
  await assert.rejects(f.run());await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
  const g=await fixture();g.io.assertLocalSource=async()=>{throw Error('local drift');};await assert.rejects(g.run());assert.ok(!g.events.includes('POST'));
  const h=await fixture();h.io.dispatch=async(r,g)=>{await g();h.events.push('POST');return {workflow_run_id:124,html_url:'wrong'};};
  await assert.rejects(h.run());assert.ok(h.events.includes('dispatch-api-ack'));assert.ok(!h.events.includes('dispatch-result'));
});

test('RunOnce retains frozen caller/new closure and original claimBy; expired cloud window never dispatches',async()=>{
  const c=context('RunOnce'),m=await prepareEcsJobDispatchV5(c);assert.equal(m.expiresAt,cloud.claimBy);assert.equal(m.effects.workloadResources,7);
  for(const patch of [{now:cloud.claimBy},{source:{...source,commit:'f'.repeat(40)}},
    {cloud:{...cloud,code:{...cloud.code,closureSha256:OLD.closureSha256}}}])await assert.rejects(prepareEcsJobDispatchV5({...c,...patch}));
  const f=await fixture('RunOnce');f.io.assertCloudWindow=async()=>{throw Error('expired');};await assert.rejects(f.run());assert.ok(!f.events.includes('POST'));
});

test('Inspect binds exact conditional Put ACK before POST; ambiguous Put never dispatches or retries',async()=>{
  const f=await fixture('Inspect');let version;
  f.io.dispatch=async(r,g)=>{await g();version=JSON.parse(r.body.inputs.execution).versionId;f.events.push('POST');return {
    workflow_run_id:124,html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};};
  await f.run();assert.equal(version,'actual-ack-version');assert.ok(f.events.indexOf('slot')<f.events.indexOf('PUT'));
  assert.ok(f.events.indexOf('execution-reference-ack')<f.events.indexOf('POST'));
  const g=await fixture('Inspect');g.io.putExecutionReference=async()=>{g.events.push('PUT');throw Error('unknown Put');};
  await assert.rejects(g.run());await assert.rejects(g.run());assert.equal(g.events.filter(v=>v==='PUT').length,1);assert.ok(!g.events.includes('POST'));
});

test('local adapter preserves immutable publication/history/fix evidence and guards current pins; no install/Secret/claim/rerun mutation path',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/ecs-job-dispatch-local-v5.mjs',import.meta.url),'utf8');
  for(const name of ['IMMUTABLE_PUBLICATION_RECORD','HISTORICAL_SOURCE_PIN','PUBLISHED_WORKFLOW_PIN','HISTORICAL_ORIGINAL',
    'SOURCE_CI_NOT_PASSED','FROZEN_LOCAL_SOURCE','FAILED_REVIEW_V3_PRESERVED','HISTORICAL_FIX_PIN','OBSERVE_PERMANENT_SLOT','OBSERVE_FROZEN_SOURCE'])assert.ok(code.includes(name));
  assert.match(code,/flag:'wx'/);assert.match(code,/maxAttempts:1/);assert.match(code,/publication\.evidenceFiles\.length===27/);
  assert.doesNotMatch(code,/GetSecretValueCommand|CreateStackCommand|ExecuteChangeSetCommand|PutRolePolicyCommand|pending_deployments|\/rerun|\/cancel/);
  assert.equal((code.match(/new PutObjectCommand/g)||[]).length,1);assert.match(code,/IfNoneMatch:'\*'/);
  assert.match(code,/record\('execution-object-put-api-ack'/);
});
