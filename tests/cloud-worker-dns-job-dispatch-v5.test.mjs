import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import yaml from 'js-yaml';
import {DNS_JOB_DISPATCH_V5 as V,dnsJobDispatchSlotV5,prepareDnsJobDispatchV5,assertDnsJobDispatchApprovalV5,
  dispatchDnsJobV5,assertInstalledDnsJobWorkflowV5,jobDispatchBodyV5,executionObjectV5} from '../ops/cloud-worker/dns-job-dispatch-v5.mjs';
import {JOB_DISPATCH_V5 as OLD,assertInstalledJobWorkflowV5} from '../ops/cloud-worker/job-dispatch-v5.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {evidenceKeyV5} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
const now=1800000000000,source={commit:'a'.repeat(40),runtimeClosureSha256:V.closureSha256,
  files:Array.from({length:142},(_,i)=>({file:'pin-'+i,normalizedLfSha256:'b'.repeat(64)}))},
  history={publicationEvidenceVerified:true,publicationSourcePinsVerified:134,oldReviewSlotsPreserved:true},
  prestate={main:source.commit,workflowId:V.workflowId,environmentId:V.environmentId,runtimeCommit:V.runtime,reusableCommit:V.reusable,
    metadataVerified:true,metadataSha256:'f'.repeat(64),sourceCiConfirmed:true,unfinishedRuns:0,jobId:V.jobId,
    jobRowSha256:V.jobRowSha256,snapshotSha256:V.snapshotSha256,activeJobs:1},
  cloud={jobId:V.jobId,manifestSha256:'c'.repeat(64),code:{commitSha:source.commit,closureSha256:V.closureSha256},claimBy:now+900000,
    reference:{key:evidenceKeyV5('manifest.json',{jobId:V.jobId,manifestSha256:'c'.repeat(64)}),versionId:'manifest-v3',sha256:'d'.repeat(64)}},
  executionRun={repository:'veinyyxy/TechlongSoftware',runId:'123',runAttempt:1,commitSha:source.commit},
  execution={jobId:V.jobId,manifestSha256:cloud.manifestSha256,outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',executionRun,
    reference:{key:evidenceKeyV5('run.json',{jobId:V.jobId,manifestSha256:cloud.manifestSha256,run:executionRun}),versionId:'run-v2',sha256:'e'.repeat(64)}};
const context=(mode='Review')=>({mode,source,history,prestate,cloud:mode==='Review'?null:cloud,execution:mode==='Inspect'?execution:null,now});
async function fixture(mode='Review'){
  const c=context(mode),m=await prepareDnsJobDispatchV5(c),events=[];let used=false;
  const io={preflight:async()=>prestate,assertLocalSource:async()=>events.push('local'),assertCloudWindow:async()=>{},
    consumeSlot:async()=>{assert.equal(used,false);used=true;events.push('slot');},record:async n=>events.push(n),
    putExecutionReference:async o=>{events.push('PUT');return {key:o.key,versionId:'actual-ack-version',sha256:await sha256Hex(o.body)};},
    dispatch:async(request,guard)=>{await guard();events.push('POST');return {workflow_run_id:124,
      html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};}};
  return {c,m,io,events,run:()=>dispatchDnsJobV5({manifest:m,approved:m.manifestSha256,context:c,io,now:()=>now})};
}
test('actual W5k workflow accepts the unchanged seven-input contract for all modes; historical dispatcher rejects new R',async()=>{
  const workflow=yaml.load(await readFile(new URL('../.github/workflows/cloud-worker-execute.yml',import.meta.url),'utf8'));
  assert.notEqual(V.runtime,OLD.runtime);assert.notEqual(V.reusable,OLD.reusable);
  const object=executionObjectV5(cloud,execution),ref={key:object.key,versionId:'exact-version',sha256:await sha256Hex(object.body)};
  for(const body of [jobDispatchBodyV5('Review'),jobDispatchBodyV5('RunOnce',cloud),jobDispatchBodyV5('Inspect',cloud,ref)]){
    assertInstalledDnsJobWorkflowV5(workflow,body);assert.throws(()=>assertInstalledJobWorkflowV5(workflow,body));
    assert.throws(()=>assertInstalledDnsJobWorkflowV5(workflow,{...body,inputs:{...body.inputs,installationSha:V.installationSha256}}));
  }
  const old=structuredClone(workflow);old.jobs.reviewed.uses=old.jobs.reviewed.uses.replace(V.reusable,OLD.reusable);
  assert.throws(()=>assertInstalledDnsJobWorkflowV5(old));
});
test('new schema binds actual publication, original held job, exact C/R and disjoint permanent slots',async()=>{
  for(const mode of ['Review','RunOnce','Inspect']){
    const m=await prepareDnsJobDispatchV5(context(mode));assert.equal(m.runtimeCommit,V.runtime);assert.equal(m.reusableCommit,V.reusable);
    assert.equal(m.jobId,OLD.jobId);assert.notEqual(m.localPermanentSlot,undefined);
    assert.match(m.localPermanentSlot,new RegExp('-'+mode.toLowerCase()+'-v'+(mode==='Review'?'3':'2')+'\\.permanent-slot\\.json$'));
  }
  const m=await prepareDnsJobDispatchV5(context());assert.equal(m.effects.jobClaims,0);assert.equal(m.effects.privateManifestConditionalPuts,1);
  assert.equal(m.effects.fixedDatabaseSecretValueReads,1);assert.equal(m.effects.controlSecretReads,0);assert.equal(m.effects.dynamoDbWrites,0);
  assert.throws(()=>dnsJobDispatchSlotV5('VerifyInstall'));
});
test('unverified history, stale source closure/CI/trust, job drift and changed metadata cannot prepare',async()=>{
  const c=context();for(const x of [{history:{}},{history:{...history,oldReviewSlotsPreserved:false}},
    {source:{...source,runtimeClosureSha256:OLD.closureSha256}},{source:{...source,files:[]}},
    {prestate:{...prestate,sourceCiConfirmed:false}},{prestate:{...prestate,reusableCommit:OLD.reusable}},
    {prestate:{...prestate,metadataSha256:'bad'}},{prestate:{...prestate,activeJobs:2}},
    {prestate:{...prestate,jobRowSha256:'0'.repeat(64)}}])await assert.rejects(prepareDnsJobDispatchV5({...c,...x}));
});
test('old approvals, source/history/action/effect drift and expiry are rejected before any slot or network',async()=>{
  const f=await fixture();for(const patch of [{schema:'techlong/cloud-worker-job-dispatch-review/v5'},
    {runtimeCommit:OLD.runtime},{localPermanentSlot:f.m.localPermanentSlot.replace('-v3.','-v2.')},{effects:{...f.m.effects,jobClaims:1}}])
    await assert.rejects(assertDnsJobDispatchApprovalV5({...f.m,...patch},f.m.manifestSha256,f.c,now));
  await assert.rejects(dispatchDnsJobV5({manifest:f.m,approved:f.m.manifestSha256,context:f.c,io:f.io,now:()=>f.m.expiresAt}));
  assert.deepEqual(f.events,[]);f.io.preflight=async()=>({...prestate,metadataSha256:'0'.repeat(64)});
  await assert.rejects(f.run());assert.deepEqual(f.events,[]);
});
test('Review consumes only v3 before one guarded POST, persists exact ACK and never approves environment',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.runId,'124');assert.equal(r.environmentApprovedByController,false);
  assert.deepEqual(f.events,['slot','dispatch-intent','local','POST','dispatch-api-ack','dispatch-result']);await assert.rejects(f.run());
  assert.equal(f.events.filter(v=>v==='POST').length,1);
});
test('unknown POST, local source drift or wrong ACK stops; no automatic write retries',async()=>{
  const f=await fixture();f.io.dispatch=async(r,g)=>{await g();f.events.push('POST');throw Error('unknown ACK');};
  await assert.rejects(f.run());await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
  const g=await fixture();g.io.assertLocalSource=async()=>{throw Error('local drift');};await assert.rejects(g.run());assert.ok(!g.events.includes('POST'));
  const h=await fixture();h.io.dispatch=async(r,g)=>{await g();h.events.push('POST');return {workflow_run_id:124,html_url:'wrong'};};
  await assert.rejects(h.run());assert.ok(h.events.includes('dispatch-api-ack'));assert.ok(!h.events.includes('dispatch-result'));
});
test('RunOnce uses same frozen caller, new closure and original cloud claimBy with no new code publication',async()=>{
  const c=context('RunOnce'),m=await prepareDnsJobDispatchV5(c);assert.equal(m.expiresAt,cloud.claimBy);assert.equal(m.effects.workloadResources,7);
  for(const patch of [{now:cloud.claimBy},{source:{...source,commit:'f'.repeat(40)}},
    {cloud:{...cloud,code:{...cloud.code,closureSha256:OLD.closureSha256}}}])await assert.rejects(prepareDnsJobDispatchV5({...c,...patch}));
  const f=await fixture('RunOnce');f.io.assertCloudWindow=async()=>{throw Error('cloud window expired');};await assert.rejects(f.run());assert.ok(!f.events.includes('POST'));
});
test('Inspect alone binds exact execution conditional Put ACK, then POST; ambiguous Put never dispatches',async()=>{
  const f=await fixture('Inspect');let version;
  f.io.dispatch=async(r,g)=>{await g();version=JSON.parse(r.body.inputs.execution).versionId;f.events.push('POST');return {
    workflow_run_id:124,html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/124',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/124'};};
  await f.run();assert.equal(version,'actual-ack-version');assert.ok(f.events.indexOf('slot')<f.events.indexOf('PUT'));
  assert.ok(f.events.indexOf('execution-reference-ack')<f.events.indexOf('POST'));
  const g=await fixture('Inspect');g.io.putExecutionReference=async()=>{g.events.push('PUT');throw Error('unknown Put');};
  await assert.rejects(g.run());await assert.rejects(g.run());assert.equal(g.events.filter(v=>v==='PUT').length,1);assert.ok(!g.events.includes('POST'));
});
test('local adapter pins historical Git and originals, published workflows, current CI/source and has no install/Secret/claim/rerun path',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/dns-job-dispatch-local-v5.mjs',import.meta.url),'utf8');
  assert.match(code,/IMMUTABLE_PUBLICATION_RECORD/);assert.match(code,/HISTORICAL_SOURCE_PIN/);assert.match(code,/PUBLISHED_WORKFLOW_PIN/);
  assert.match(code,/HISTORICAL_ORIGINAL/);assert.match(code,/SOURCE_CI_NOT_PASSED/);assert.match(code,/FROZEN_LOCAL_SOURCE/);
  assert.match(code,/flag:'wx'/);assert.match(code,/maxAttempts:1/);assert.match(code,/OBSERVE_PERMANENT_SLOT/);
  assert.doesNotMatch(code,/GetSecretValueCommand|CreateStackCommand|ExecuteChangeSetCommand|PutRolePolicyCommand|pending_deployments|\/rerun|\/cancel/);
  assert.equal((code.match(/new PutObjectCommand/g)||[]).length,1);assert.match(code,/IfNoneMatch:'\*'/);
  assert.match(code,/record\('execution-object-put-api-ack'/);assert.match(code,/OBSERVE_FROZEN_SOURCE/);
});
