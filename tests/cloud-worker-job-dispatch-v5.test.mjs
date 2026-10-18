import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import yaml from 'js-yaml';
import {JOB_DISPATCH_V5 as V,jobDispatchBodyV5,executionObjectV5,prepareJobDispatchV5,assertJobDispatchApprovalV5,
  dispatchJobV5,jobProofFromLogsV5,assertJobReferenceV5,jobDispatchSlotV5,assertInstalledJobWorkflowV5} from '../ops/cloud-worker/job-dispatch-v5.mjs';
import {evidenceKeyV5} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const now=1800000000000,source={commit:'a'.repeat(40),files:Array.from({length:122},(_,i)=>({file:'pin-'+i,normalizedLfSha256:'b'.repeat(64)}))},
  history={verified:true},prestate={main:source.commit,workflowId:V.workflowId,environmentId:V.environmentId,metadataVerified:true,unfinishedRuns:0,
    jobId:V.jobId,jobRowSha256:V.jobRowSha256,snapshotSha256:V.snapshotSha256,activeJobs:1};
const cloud={jobId:V.jobId,manifestSha256:'c'.repeat(64),code:{commitSha:source.commit,closureSha256:V.closureSha256},
  claimBy:now+900000,deadline:now+3600000,workloadExpiresAt:now+7200000,
  reference:{key:evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:'c'.repeat(64)}),versionId:'manifest-v1',sha256:'d'.repeat(64)}};
const executionRun={repository:'veinyyxy/TechlongSoftware',runId:'123',runAttempt:1,commitSha:source.commit},
  execution={jobId:V.jobId,manifestSha256:cloud.manifestSha256,outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',executionRun,
    reference:{key:evidenceKeyV5('run.json',{jobId:V.jobId,manifestSha256:cloud.manifestSha256,run:executionRun}),versionId:'run-v1',sha256:'e'.repeat(64)}};
const context=(mode='Review')=>({mode,source,history,prestate,cloud:mode==='Review'?null:cloud,execution:mode==='Inspect'?execution:null,now});
async function fixture(mode='Review'){
  const c=context(mode),m=await prepareJobDispatchV5(c),events=[];let consumed=false,failed=false;
  const io={preflight:async()=>{events.push('preflight');return prestate;},assertCloudWindow:async()=>{},
    consumeSlot:async()=>{assert.equal(consumed,false);consumed=true;events.push('slot');},record:async n=>events.push(n),
    putExecutionReference:async object=>{events.push('PUT');return {key:object.key,versionId:'actual-put-version',sha256:await sha256Hex(object.body)};},
    dispatch:async(request,guard)=>{await guard();events.push('POST');if(failed)throw Error('unknown ACK');
      return {workflow_run_id:124,html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};}};
  return {c,m,events,io,fail:()=>{failed=true;},run:()=>dispatchJobV5({manifest:m,approved:m.manifestSha256,context:c,io,now:()=>now})};
}
test('Review binds the real held job and installed S3 version; no manifest/execution/lineage input',()=>{
  const body=jobDispatchBodyV5('Review');assert.equal(body.ref,'main');assert.equal(body.return_run_details,true);
  assert.equal(body.inputs.job,V.jobId);assert.equal(body.inputs.installationSha,undefined);
  assert.deepEqual(JSON.parse(body.inputs.installation),V.publication);
  for(const k of ['manifest','manifestSha','execution','lineage'])assert.equal(body.inputs[k],'');
  assert.throws(()=>jobDispatchBodyV5('VerifyInstall'));assert.throws(()=>jobDispatchBodyV5('Review',cloud));
});
test('all three dispatch bodies match the real installed external schema; runtime-only SHA is rejected externally',async()=>{
  const workflow=yaml.load(await readFile(new URL('../.github/workflows/cloud-worker-execute.yml',import.meta.url),'utf8'));
  const object=executionObjectV5(cloud,execution),ref={key:object.key,versionId:'actual-version',sha256:await sha256Hex(object.body)};
  for(const body of [jobDispatchBodyV5('Review'),jobDispatchBodyV5('RunOnce',cloud),jobDispatchBodyV5('Inspect',cloud,ref)]){
    assertInstalledJobWorkflowV5(workflow,body);
    assert.throws(()=>assertInstalledJobWorkflowV5(workflow,{...body,inputs:{...body.inputs,installationSha:V.installationSha256}}));
  }
  const altered=structuredClone(workflow);altered.jobs.reviewed.with.installationSha='f'.repeat(64);
  assert.throws(()=>assertInstalledJobWorkflowV5(altered));
});
test('only a fresh approval can name the new Review-v2 slot; old slot is not reused or reset',async()=>{
  const m=await prepareJobDispatchV5(context());assert.equal(m.localPermanentSlot,jobDispatchSlotV5('Review'));
  assert.match(m.localPermanentSlot,/-review-v2\.permanent-slot\.json$/);assert.match(jobDispatchSlotV5('RunOnce'),/-runonce-v1\.permanent-slot\.json$/);
  await assert.rejects(assertJobDispatchApprovalV5({...m,localPermanentSlot:m.localPermanentSlot.replace('-v2.','-v1.')},m.manifestSha256,context(),now));
});
test('RunOnce and Inspect use exact versioned cloud manifest; execution object is separate and fixed',()=>{
  const b=jobDispatchBodyV5('RunOnce',cloud);assert.equal(b.inputs.manifestSha,cloud.manifestSha256);assert.equal(b.inputs.execution,'');
  const o=executionObjectV5(cloud,execution);assert.deepEqual(o.body,{executionRun,executionReportReference:execution.reference});
  assert.match(o.key,/execution-reference-123-v1\.json$/);
  assert.throws(()=>jobDispatchBodyV5('RunOnce',{...cloud,jobId:'job_'+'0'.repeat(24)}));
  assert.throws(()=>jobDispatchBodyV5('RunOnce',{...cloud,reference:{...cloud.reference,key:'wrong'}}));
  for(const change of [{outcome:'FAILED'},{executionRun:{...executionRun,commitSha:'f'.repeat(40)}},{reference:cloud.reference}])
    assert.throws(()=>executionObjectV5(cloud,{...execution,...change}));
});
test('fresh approval binds effects, caller, all history, prestate and 2h local dispatch window',async()=>{
  const c=context(),m=await prepareJobDispatchV5(c);await assertJobDispatchApprovalV5(m,m.manifestSha256,c,now);
  assert.equal(m.effects.privateManifestConditionalPuts,1);assert.equal(m.effects.jobClaims,0);assert.equal(m.effects.controlSecretReads,0);
  for(const changed of [{...c,history:{}},{...c,source:{...source,commit:'f'.repeat(40)}},{...c,prestate:{...prestate,unfinishedRuns:1}},
    {...c,prestate:{...prestate,jobRowSha256:'0'.repeat(64)}}])await assert.rejects(assertJobDispatchApprovalV5(m,m.manifestSha256,changed,now));
  await assert.rejects(assertJobDispatchApprovalV5(m,m.manifestSha256,c,m.expiresAt));
  await assert.rejects(assertJobDispatchApprovalV5({...m,effects:{...m.effects,jobClaims:1}},m.manifestSha256,c,now));
});
test('RunOnce deadline is capped by cloud claimBy and source cannot move between modes',async()=>{
  const c=context('RunOnce'),m=await prepareJobDispatchV5(c);assert.equal(m.expiresAt,cloud.claimBy);
  await assert.rejects(prepareJobDispatchV5({...c,now:cloud.claimBy}));
  await assert.rejects(prepareJobDispatchV5({...c,cloud:{...cloud,code:{...cloud.code,commitSha:'f'.repeat(40)}}}));
  assert.equal(m.effects.durableJournalWrites,5);assert.equal(m.effects.createStackCalls,1);assert.equal(m.effects.workloadResources,7);
});
test('expired or drifted approval stops before slot and POST',async()=>{
  const f=await fixture();await assert.rejects(dispatchJobV5({manifest:f.m,approved:f.m.manifestSha256,context:f.c,io:f.io,now:()=>f.m.expiresAt}));
  assert.deepEqual(f.events,[]);f.io.preflight=async()=>({...prestate,activeJobs:2});await assert.rejects(f.run());assert.deepEqual(f.events,[]);
});
test('Review consumes its own slot before exactly one POST and never approves the environment',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.runId,'124');assert.equal(r.environmentApprovedByController,false);
  assert.deepEqual(f.events,['preflight','slot','dispatch-intent','POST','dispatch-api-ack','dispatch-result']);
  await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
});
test('unknown POST result is not retried and consumed slot is preserved',async()=>{
  const f=await fixture();f.fail();await assert.rejects(f.run());await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
});
test('Inspect alone permits one exact conditional execution-reference object and dynamic ACK version',async()=>{
  const f=await fixture('Inspect');let submitted;
  f.io.dispatch=async(request,guard)=>{await guard();submitted=JSON.parse(request.body.inputs.execution);return {workflow_run_id:124,
    html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};};
  await f.run();assert.equal(submitted.versionId,'actual-put-version');assert.equal(submitted.sha256,await sha256Hex(f.m.executionObject.body));
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('PUT'));assert.ok(f.events.includes('execution-reference-ack'));
  const g=await fixture('Inspect');g.io.putExecutionReference=async()=>{g.events.push('PUT');throw Error('unknown Put ACK');};
  await assert.rejects(g.run());await assert.rejects(g.run());assert.equal(g.events.filter(v=>v==='PUT').length,1);assert.ok(!g.events.includes('POST'));
});
test('expiry is checked again immediately before submission; cloud window failure never POSTs',async()=>{
  const f=await fixture('RunOnce');f.io.assertCloudWindow=async()=>{throw Error('expired cloud window');};
  await assert.rejects(f.run());assert.ok(!f.events.includes('POST'));
});
test('timestamped log parser requires one exact mode proof without raw logs or credentials',()=>{
  const p={mode:'Review',manifestSha256:cloud.manifestSha256,saved:cloud.reference,executionApproved:false},
    log=JSON.stringify(p,null,2).split('\n').map(l=>'2026-10-18T12:00:00.0000000Z '+l).join('\n');
  assert.deepEqual(jobProofFromLogsV5(log,'Review'),p);assert.throws(()=>jobProofFromLogsV5(log+'\n'+log,'Review'));
  assert.throws(()=>jobProofFromLogsV5(log,'RunOnce'));assert.throws(()=>jobProofFromLogsV5(JSON.stringify({...p,executionApproved:true},null,2),'Review'));
  assert.throws(()=>assertJobReferenceV5({...cloud.reference,versionId:'bad/version'},cloud.reference.key));
});
test('local adapter has no claim/Secret-value/IAM/CFN write, environment approval, rerun or raw log persistence',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/job-dispatch-local-v5.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/GetSecretValueCommand|CreateStackCommand|ExecuteChangeSetCommand|PutRolePolicyCommand|pending_deployments|\/rerun|\/cancel/);
  assert.equal((code.match(/new PutObjectCommand/g)||[]).length,1);assert.match(code,/IfNoneMatch:'\*'/);assert.match(code,/flag:'wx'/);
  assert.match(code,/maxAttempts:1/);assert.match(code,/record\('execution-object-put-api-ack'/);assert.match(code,/OBSERVE_PERMANENT_SLOT/);
});
