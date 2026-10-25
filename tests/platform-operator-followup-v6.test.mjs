import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync} from 'node:crypto';
import {load} from 'js-yaml';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {createTrustedPublisherV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {S} from '../ops/platform-cloud-v6/contract.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {makeFollowupReview,verifyFollowupReview,followRunOnceOnce,FOLLOWUP} from '../ops/platform-operator-v6/followup.mjs';
import {LIMITS,intentName} from '../ops/platform-operator-v6/review.mjs';
import {makeReview} from '../ops/platform-operator-v6/review.mjs';
import {createInspectTransport} from '../ops/platform-operator-v6/live.mjs';
import {parseArgs} from '../ops/platform-operator-v6/cli.mjs';
import {platformClosureV6} from '../ops/platform-cloud-v6/closure.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';

async function fixture(){
  const f=await platformFixtureV6({installed:true}),pub=createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,
    frozenSourceCommit:f.frozenSourceCommit,ports:f.ports,now:f.now});
  const review=await f.observedPlan(f.basePlan,'123456789'),reviewRef=await f.resultFor(review.plan,'123456789');
  await pub.attestResult(review.planSha256,reviewRef);const plan=(await pub.publishSuccessor(review.planSha256,reviewRef)).plan,runId='123456790',inspectId='123456791';
  const report={schema:'techlong/cloud-worker-run/v5',jobId:plan.jobId,manifestSha256:f.manifest.manifestSha256,run:f.run(runId),
    result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'},retryAllowed:false};
  const reportRef=await f.store(`worker-v5/${S.instanceId}/${plan.jobId}/${f.manifest.manifestSha256}/run-${runId}-1/run.json`,report);
  const execution=await f.store(`worker-v5/${S.instanceId}/${plan.jobId}/${f.manifest.manifestSha256}/execution-reference-${runId}-v1.json`,
    {executionRun:f.run(runId),executionReportReference:reportRef});
  const ref=await f.resultFor(plan,runId,{outcome:report.result.outcome,cloudReportReference:reportRef,executionReference:execution});
  const input={schema:'techlong/platform-operator-followup-input/v1',plan,runId,workloadExpiresAt:f.manifest.workload.workloadExpiresAt,
    keyPath:path.resolve(tmpdir(),'synthetic-followup-key.pem'),evidenceRoot:path.resolve(tmpdir(),'synthetic-followup-evidence')};
  const m=await makeFollowupReview({input,operatorSourceCommit:f.sourceCommit,createdAt:f.at,
    pins:Array.from({length:20},(_,n)=>({file:`synthetic/${n}.mjs`,sha256:'0'.repeat(64)})),
    key:{length:2000,mtimeMs:1,ctimeMs:1,identity:'synthetic',protectionSha256:'1'.repeat(64),contentRead:false}});
  const records=[],effects=[];let inspectRef;
  const finish=async p=>{
    const body={schema:'techlong/cloud-worker-independent-inspect/v5',outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',jobId:plan.jobId,
      manifestSha256:f.manifest.manifestSha256,receiptSha256:'1'.repeat(64),providerObservationSha256:'2'.repeat(64),run:f.run(inspectId),executionRun:f.run(runId),
      journal:{state:'ALL_SLOTS_CONSUMED'},checkedAt:f.now(),retryAllowed:false,cloudWrites:0,databaseWrites:0,privateControlReads:0};
    const report=await f.store(`worker-v5/${S.instanceId}/${plan.jobId}/${f.manifest.manifestSha256}/run-${inspectId}-1/inspect.json`,{...body,inspectSha256:await sha256Hex(body)});
    inspectRef=await f.resultFor(p,inspectId,{outcome:body.outcome,cloudReportReference:report});
    return {runId:inspectId,url:`https://github.com/${S.repository}/actions/runs/${inspectId}`};
  };
  const io={deadline:f.at+LIMITS.runMs,guard:async()=>{},preflight:async()=>{effects.push('preflight');},claim:async()=>{effects.push('claim');},
    readRun:async id=>{effects.push('run:'+id);return f.rawRun(id);},readObject:f.ports.readObject,
    discoverExecutionResult:async()=>{effects.push('execution-head');return ref;},dispatch:async p=>{effects.push('dispatch');return finish(p);},
    discoverResult:async()=>inspectRef,record:async(name,value)=>{records.push({name,value});},close:async()=>{effects.push('close');}};
  return {...f,input,m,records,effects,io,ref,finish,inspectId,getInspectRef:()=>inspectRef};
}
const run=f=>followRunOnceOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now,sleep:async()=>{}});

test('public approval binds the future exact result key and cannot outlive the unchanged workload TTL',async()=>{
  const f=await fixture();await verifyFollowupReview(f.m,f.m.manifestSha256,f.now(),true);
  assert.equal(f.m.expiresAt,f.input.workloadExpiresAt);assert.equal(f.m.effects.s3LatestHeadsMax,2);
  assert.equal(f.m.lastStartAt,f.m.expiresAt-LIMITS.runMs);assert.equal(f.m.policy.requiresHumanEnvironmentApproval,true);
  for(const changed of [{...f.m,resultKey:f.m.resultKey+'other'},{...f.m,effects:{...f.m.effects,runOnceDispatches:1}},
    {...f.m,policy:{...f.m.policy,minInspectReserveMs:0}},{...f.m,input:{...f.input,runId:'999999'}}])
    await assert.rejects(verifyFollowupReview(changed,f.m.manifestSha256,f.now()));
  const v6=await makeReview({...f.m,input:{schema:'techlong/platform-operator-input/v6',plan:f.input.plan,runId:f.input.runId,
    resultReference:f.ref,keyPath:f.input.keyPath,evidenceRoot:f.input.evidenceRoot}});
  assert.equal(intentName(f.m),intentName(v6),'follow-up cannot reopen the ordinary Inspect slot');
  const refreshed=await makeFollowupReview({...f.m,createdAt:f.at+1000});assert.equal(intentName(refreshed),intentName(f.m));
});
for(const fault of ['wrong-sha','expired','late-start','historical'])test('no port is touched for '+fault,async()=>{
  const f=await fixture();let approved=f.m.manifestSha256,at=f.now();
  if(fault==='wrong-sha')approved='0'.repeat(64);
  if(fault==='expired')at=f.m.expiresAt;
  if(fault==='late-start')at=f.m.lastStartAt;
  if(fault==='historical'){f.m=await makeFollowupReview({...f.m,operatorSourceCommit:'a'.repeat(40)});approved=f.m.manifestSha256;}
  await assert.rejects(followRunOnceOnce({manifest:f.m,approved,io:f.io,now:()=>at}));assert.deepEqual(f.effects,[]);
});
test('pending RunOnce is waited on, then separate Inspect starts in the same invocation without ledger writes',async()=>{
  const f=await fixture(),before=f.writes.length;let polls=0;
  f.io.readRun=async id=>{f.effects.push('run:'+id);return id===f.input.runId&&polls++===0?{...f.rawRun(id),status:'in_progress',conclusion:null}:f.rawRun(id);};
  const result=await run(f);assert.equal(result.independentCloudAcceptanceVerified,true);assert.equal(result.inspectRunId,f.inspectId);
  assert.equal(result.proofImported,false);assert.equal(f.writes.length,before);assert.equal(result.platformLedgerWrites,0);
  assert.equal(f.effects.filter(v=>v==='dispatch').length,1);assert.equal(f.effects.filter(v=>v==='claim').length,1);
  assert(f.effects.indexOf('execution-head')>f.effects.lastIndexOf('run:'+f.input.runId));
  const notice=f.records.find(r=>r.name==='awaiting-human-environment').value;assert.equal(notice.requiresHumanApproval,true);
  assert.equal(notice.runId,f.inspectId);assert.equal(f.effects.at(-1),'close');
});
for(const patch of [{status:'completed',conclusion:'failure'},{run_attempt:2},{actor:{id:1}},{head_sha:'0'.repeat(40)}])
test('RunOnce failure or identity drift cannot discover a result or dispatch',async()=>{
  const f=await fixture();f.io.readRun=async()=>({...f.rawRun(f.input.runId),...patch});const r=await run(f);
  assert.equal(r.independentCloudAcceptanceVerified,false);assert(!f.effects.includes('execution-head'));assert(!f.effects.includes('dispatch'));
});
test('the remaining inspection reserve is enforced before slot and while waiting',async()=>{
  const f=await fixture();f.io.deadline=f.at+FOLLOWUP.reserveMs;const r=await run(f);assert.equal(r.claimAttempted,false);
  assert.deepEqual(f.effects,['close']);
  const g=await fixture();g.io.readRun=async id=>{g.tick(LIMITS.runMs);return {...g.rawRun(id),status:'waiting',conclusion:null};};
  const stopped=await run(g);assert.equal(stopped.phase,'WAIT_RUNONCE');assert(!g.effects.includes('dispatch'));assert(!g.effects.includes('execution-head'));
});
test('a valid but different supplied TTL is rejected against the fully verified cloud manifest',async()=>{
  const f=await fixture();f.m=await makeFollowupReview({...f.m,input:{...f.input,workloadExpiresAt:f.input.workloadExpiresAt+60000}});
  const r=await run(f);assert.equal(r.safeCode,'PLATFORM_OPERATOR_FOLLOWUP_MANIFEST_TTL_DRIFT');assert(!f.effects.includes('dispatch'));
});
test('authenticated GitHub success with INSPECT_REQUIRED content does not automatically follow up',async()=>{
  const f=await fixture(),original=f.objects.get(f.ref.key).value,report=f.objects.get(original.cloudReportReference.key).value;
  report.result.outcome='INSPECT_REQUIRED_NO_RETRY';const reportRef=await f.store(original.cloudReportReference.key,report);
  const executionRef=await f.store(original.executionReference.key,{executionRun:f.run(f.input.runId),executionReportReference:reportRef});
  const ref=await f.store(f.ref.key,{...original,outcome:report.result.outcome,cloudReportReference:reportRef,executionReference:executionRef});
  f.io.discoverExecutionResult=async()=>ref;const r=await run(f);
  assert.equal(r.safeCode,'PLATFORM_OPERATOR_FOLLOWUP_RUNONCE_NOT_SUCCEEDED');assert(!f.effects.includes('dispatch'));
});
test('bounded nonterminal waiting cannot cause a result lookup, RunOnce retry or Inspect dispatch',async()=>{
  const f=await fixture();let gets=0;f.io.readRun=async id=>{gets++;return {...f.rawRun(id),status:'waiting',conclusion:null};};
  const r=await run(f);assert.equal(gets,LIMITS.maxPolls);assert.equal(r.independentCloudAcceptanceVerified,false);
  assert(!f.effects.includes('execution-head'));assert(!f.effects.includes('dispatch'));
});
for(const fault of ['preflight','claim','readRun','discoverExecutionResult','readObject','dispatch','discoverResult'])
test('ambiguous '+fault+' is never retried, compensated or exposed',async()=>{
  const f=await fixture();let count=0;f.io[fault]=async()=>{count++;throw Error('synthetic-private-marker');};
  const r=await run(f);assert.equal(r.independentCloudAcceptanceVerified,false);assert.equal(r.retryAllowed,false);assert.equal(count,1);
  assert(!JSON.stringify(r).includes('synthetic-private-marker'));assert.equal(f.effects.at(-1),'close');
});
test('unknown dispatch ACK preserves the known run, with no polling/re-dispatch after failure',async()=>{
  const f=await fixture();f.io.dispatch=async p=>{await f.finish(p);throw Error('synthetic cleanup failed');};
  f.io.knownAck=()=>({runId:f.inspectId,url:`https://github.com/${S.repository}/actions/runs/${f.inspectId}`});
  const r=await run(f);assert.equal(r.ack.runId,f.inspectId);assert(!f.effects.includes('run:'+f.inspectId));
});

for(const late of [false,true])test('real transport: '+(late?'time consumed by App checks blocks POST but still revokes token':'pins two versions and dispatches once'),async()=>{
  const f=await fixture(),requests=[],heads=[],records=[],pem=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const permissions={actions:'write',contents:'read',metadata:'read'},account={id:Number(S.ownerId),login:'veinyyxy',type:'User'};
  const io=createInspectTransport(f.m,{now:f.now,deadline:f.at+LIMITS.runMs,guard:async()=>{},source:{credentials:async()=>({}),close:async()=>{},counts:()=>({})},
    keyMetadata:async()=>f.m.key,readKey:async()=>pem,claim:async()=>{},loadReadCredential:async()=>'synthetic-read-credential',dispose:async()=>{},
    record:async(name,value)=>{records.push({name,value});},getObject:f.ports.readObject,headObject:async key=>{
      heads.push(key);const o=f.objects.get(key);return {versionId:o.versionId,encryption:o.encryption,contentLength:o.contentLength,
        checksumSHA256:Buffer.from(await sha256Hex(o.value),'hex').toString('base64')};},
    fetch:async(url,options)=>{
      const u=new URL(url),p=u.pathname;requests.push({path:p,method:options.method});assert.equal(u.origin,'https://api.github.com');
      assert.equal(options.redirect,'manual');
      if(p==='/app')return Response.json({id:Number(S.appId),slug:'techlong-sandbox-controller',name:'Techlong Sandbox Controller',external_url:'https://github.com/'+S.repository,
        html_url:'https://github.com/apps/techlong-sandbox-controller',owner:account,permissions,events:[]});
      if(p===`/app/installations/${S.installationId}`)return Response.json({id:Number(S.installationId),app_id:Number(S.appId),app_slug:'techlong-sandbox-controller',
        account,target_id:Number(S.ownerId),target_type:'User',permissions,events:[],repository_selection:'selected',suspended_at:null});
      if(p.endsWith('/access_tokens'))return Response.json({token:'synthetic-installation-credential',permissions,expires_at:new Date(f.now()+3600000).toISOString()},{status:201});
      if(p==='/installation/token')return new Response(null,{status:204});
      if(p==='/installation/repositories')return Response.json({total_count:1,repositories:[{id:Number(S.repositoryId),full_name:S.repository,owner:account}]});
      if(p==='/users/techlong-sandbox-controller%5Bbot%5D')return Response.json({id:Number(S.candidateBotId),login:'techlong-sandbox-controller[bot]',type:'Bot'});
      if(p.endsWith('/git/ref/heads/main')){if(late)f.tick(LIMITS.runMs-FOLLOWUP.reserveMs);return Response.json({object:{sha:f.sourceCommit}});}
      if(p.endsWith('/actions/workflows/'+S.workflowFile))return Response.json({id:Number(B.platform.workflowId),state:'active',path:'.github/workflows/'+S.workflowFile});
      if(p.endsWith('/dispatches')){
        const inputs=JSON.parse(options.body).inputs;assert.equal(inputs.mode,'Inspect');
        await f.finish({...f.input.plan,mode:'Inspect',inputs});
        return Response.json({workflow_run_id:Number(f.inspectId),html_url:`https://github.com/${S.repository}/actions/runs/${f.inspectId}`,
          run_url:`https://api.github.com/repos/${S.repository}/actions/runs/${f.inspectId}`});
      }
      if(p.includes('/actions/runs/'))return Response.json(f.rawRun(p.split('/').at(-1)));
      throw Error('UNEXPECTED_SYNTHETIC_ROUTE');
    }});
  f.io=io;const result=await run(f);
  if(late){
    assert.equal(result.independentCloudAcceptanceVerified,false);assert.equal(result.safeCode,'PLATFORM_OPERATOR_FOLLOWUP_INSUFFICIENT_WINDOW');
    assert.equal(requests.filter(v=>v.path.endsWith('/dispatches')).length,0);assert.equal(requests.filter(v=>v.path==='/installation/token').length,1);
    assert.equal(heads.length,1);return;
  }
  assert.equal(result.independentCloudAcceptanceVerified,true);
  assert.equal(heads.length,2);assert.equal(new Set(heads).size,2);assert.equal(heads[0],f.m.resultKey);
  assert.equal(requests.filter(v=>v.path.endsWith('/dispatches')).length,1);assert.equal(requests.filter(v=>v.path==='/installation/token').length,1);
  assert(!requests.some(v=>/pending_deployments|rerun/.test(v.path)));
  const counts=records.find(v=>v.name==='capability-counts').value;assert.equal(counts.s3LatestHeads,2);assert.equal(counts.s3VersionedGets,7);
  assert.equal(counts.inspectDispatches,1);assert.equal(counts.keyReads,1);assert.equal(counts.executionResultHeads,1);
  await assert.rejects(io.discoverExecutionResult(f.input.runId));
  let actualHeads=0;const ordinary=createInspectTransport({input:{...f.input,resultReference:f.ref},schema:'techlong/platform-operator-inspect-review/v6'},
    {guard:async()=>{},headObject:async()=>{actualHeads++;}});
  await assert.rejects(ordinary.discoverExecutionResult(f.input.runId));assert.equal(actualHeads,0);
});
test('CLI/No-AWS CI cover the follow-up, while the deployed cloud closure and human environment gate stay unchanged',async()=>{
  assert.equal(parseArgs(['prepare-followup','--input','public.json']).command,'prepare-followup');
  assert.equal(parseArgs(['follow-runonce','--manifest','review.json','--approved-sha','a'.repeat(64),'--human-ready','yes']).command,'follow-runonce');
  const closure=await platformClosureV6();assert.equal(closure.closureSha256,B.platform.closureSha256);assert.equal(closure.pinCount,81);
  const ci=load(await readFile(new URL('../.github/workflows/platform-cloud-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(ci.permissions,{contents:'read'});assert(ci.jobs.candidate.steps.some(s=>s.run?.includes('tests/platform-operator-followup-v6.test.mjs')));
  const worker=load(await readFile(new URL('../.github/workflows/cloud-worker-platform-job-v6.yml',import.meta.url),'utf8'));
  assert.equal(worker.jobs.single.environment,'techlong-sandbox-deploy');
});
