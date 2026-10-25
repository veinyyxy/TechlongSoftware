import test from 'node:test';
import assert from 'node:assert/strict';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {createCycleTransport,reviewSummaryFromLog,boundedText} from '../ops/platform-review-v6/cycle-transport.mjs';
import {CYCLE,CYCLE_SCOPE} from '../ops/platform-review-v6/cycle-plan.mjs';
import {S,resultKeyV6} from '../ops/platform-cloud-v6/contract.mjs';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
async function fixture(){
  const f=await platformFixtureV6({installed:true}),objects=new Map(),effects={gets:0,runs:0,jobs:0,logs:0},records=[],id='123456789';
  const store=async(key,value)=>{const ref={key,versionId:'synthetic-version',sha256:await sha256Hex(value)};
    objects.set(key,{value,versionId:ref.versionId,encryption:'AES256',contentLength:Buffer.byteLength(canonicalJson(value))});return ref;};
  const installation=await store(`worker-v5/${S.instanceId}/installation/synthetic.json`,{synthetic:true}),lineage=await store(`worker-v5/${S.instanceId}/lineage/synthetic.json`,[]);
  const sha='a'.repeat(64),manifestReference=await store(`worker-v5/${S.instanceId}/${CYCLE.jobId}/${sha}/manifest.json`,{synthetic:true});
  const resultReference=await store(resultKeyV6(CYCLE.jobId,sha,id),{schema:'techlong/platform-cloud-result/v6',mode:'Review',jobId:CYCLE.jobId,manifestSha256:sha,
    run:{repository:S.repository,runId:id,runAttempt:1,commitSha:f.sourceCommit},cloudReportReference:manifestReference});
  const summary={mode:'Review',jobId:CYCLE.jobId,manifestSha256:sha,outcome:'REVIEW_PREPARED_NOT_APPROVED',saved:resultReference,retryAllowed:false};
  const m={sourceCommit:f.sourceCommit,binding:{platform:f.release},anchor:{references:{installation,lineage}}};
  const ports={guard:async()=>{},record:async(n,v)=>records.push({n,v}),readObject:async r=>{effects.gets++;return structuredClone(objects.get(r.key));},
    readRun:async run=>{effects.runs++;return f.rawRun(run);},readJobs:async()=>{effects.jobs++;return {total_count:1,jobs:[{id:98765,run_id:Number(id),
      run_attempt:1,head_sha:f.sourceCommit,status:'completed',conclusion:'success'}]};},readLog:async()=>{effects.logs++;return 'timestamp '+JSON.stringify(summary)+'\n';}};
  return {m,ports,effects,records,objects,summary,installation,lineage,manifestReference,resultReference,id};
}
test('four versioned objects only, logs are a locator, repeated root reconstruction hits cache',async()=>{
  const f=await fixture(),t=createCycleTransport({manifest:f.m,ports:f.ports});t.registerRun(f.id,'Review');
  await t.readObject(f.installation);await t.readObject(f.lineage);const refs=await t.discover(f.id);
  assert.deepEqual(refs,{resultReference:f.resultReference,manifestReference:f.manifestReference,manifestSha256:f.summary.manifestSha256});
  await t.readObject(refs.manifestReference);await t.readObject(f.resultReference);await t.readObject(f.installation);
  assert.equal(f.effects.gets,4);assert.equal(f.effects.jobs,1);assert.equal(f.effects.logs,1);assert.equal(t.counts().s3Gets,4);
  assert(f.records.some(r=>r.n==='review-result-discovery'&&r.v.logIsLocatorNotProof===true));
  await assert.rejects(t.discover(f.id),/DISCOVER_ONCE/);t.close();await assert.rejects(t.readRun(f.id),/TRANSPORT_CLOSED/);
});
test('unregistered and second same-mode runs cannot be read',async()=>{
  const f=await fixture(),t=createCycleTransport({manifest:f.m,ports:f.ports});await assert.rejects(t.readRun(f.id));assert.equal(f.effects.runs,0);
  t.registerRun(f.id,'Review');assert.throws(()=>t.registerRun('123456790','Review'));t.registerRun('123456790','RunOnce');
});
for(const failure of ['run','job','log','digest','result-job','result-run'])test('bad '+failure+' discovery never expands the object allowlist',async()=>{
  const f=await fixture();
  if(failure==='run'){const original=f.ports.readRun;f.ports.readRun=async id=>({...await original(id),run_attempt:2});}
  if(failure==='job')f.ports.readJobs=async()=>({total_count:1,jobs:[{id:98765,run_id:1}]});
  if(failure==='log')f.ports.readLog=async()=>JSON.stringify(f.summary)+'\n'+JSON.stringify(f.summary);
  if(failure==='digest')f.objects.get(f.resultReference.key).value.extra='changed';
  if(['result-job','result-run'].includes(failure)){
    const item=f.objects.get(f.resultReference.key);if(failure==='result-job')item.value.jobId='job_'+'0'.repeat(24);else item.value.run.commitSha='0'.repeat(40);
    f.summary.saved.sha256=await sha256Hex(item.value);f.ports.readLog=async()=>JSON.stringify(f.summary);
  }
  const t=createCycleTransport({manifest:f.m,ports:f.ports});t.registerRun(f.id,'Review');await assert.rejects(t.discover(f.id));
  await assert.rejects(t.readObject(f.manifestReference),/S3_REFERENCE_ALLOWLIST/);
});
test('summary is unique, exact-shaped, current-job/run bound and bounded',async()=>{
  const f=await fixture();assert.deepEqual(reviewSummaryFromLog(JSON.stringify(f.summary),CYCLE.jobId,f.id),f.summary);
  for(const v of [{...f.summary,retryAllowed:true},{...f.summary,extra:true},{...f.summary,outcome:'deployed'}])
    assert.throws(()=>reviewSummaryFromLog(JSON.stringify(v),CYCLE.jobId,f.id));
  assert.throws(()=>reviewSummaryFromLog(JSON.stringify(f.summary),CYCLE.jobId,'99'));
  assert.throws(()=>reviewSummaryFromLog('x'.repeat(CYCLE_SCOPE.downloadedLogBytesMax+1),CYCLE.jobId,f.id));
});
test('HTTP body limit is enforced without persisting the raw log',async()=>{
  assert.equal(await boundedText(new Response('safe'),4),'safe');await assert.rejects(boundedText(new Response('oversize'),4),/HTTP_SIZE/);
  await assert.rejects(boundedText(new Response('error',{status:403}),100),/HTTP_RESPONSE/);
});
test('transport source binding is cloned, not mutable through caller data',async()=>{
  const f=await fixture(),t=createCycleTransport({manifest:f.m,ports:f.ports});t.registerRun(f.id,'Review');f.m.sourceCommit='0'.repeat(40);
  const refs=await t.discover(f.id);assert.equal(refs.manifestSha256,f.summary.manifestSha256);
});
