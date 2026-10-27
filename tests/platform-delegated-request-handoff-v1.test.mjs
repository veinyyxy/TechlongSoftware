import test from 'node:test';
import assert from 'node:assert/strict';
import {delegatedPublisherFixture} from './fixtures/platform-delegated-publisher-v1.mjs';
import {createRequestHandoffCompiler,nextRequestTarget} from '../ops/platform-delegated-publisher-v1/request-handoff.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
async function fixture(){
  const f=await delegatedPublisherFixture(),manifest=f.objects.get(f.manifestRef.key),result=f.object;
  const expected={sourceCommit:f.sourceCommit,runId:f.runId,planSha256:f.entry.planSha256,resultSha256:await sha256Hex(result.value),manifestSha256:await sha256Hex(manifest.value),
    resultVersionId:result.versionId,manifestVersionId:manifest.versionId};
  const compile=createRequestHandoffCompiler({expected,historicalPlanShas:[f.old.planSha256]});
  // Both the original two-hour controller plan and actual workload have expired.
  f.tick(3*3600000);const input={binding:f.binding,basis:f.basis,snapshot:f.cloneState(),entry:structuredClone(f.entry),requestEvidence:f.requestEvidence,
    run:f.rawRun(f.runId),resultObject:structuredClone(result),manifestObject:structuredClone(manifest),observedAt:f.now(),at:f.now()};
  return {...f,compile,input};
}
test('fixed handoff compiles exact cancellation plus held insert without execution or runtime activation',async()=>{
  const f=await fixture(),before=structuredClone(f.input.snapshot),r=await f.compile(f.input),target=await nextRequestTarget();
  assert.equal(r.target.newJobId,target.newJobId);assert.notEqual(r.target.newJobId,r.target.oldJobId);
  assert.equal(r.physicalWrites,0);assert.equal(r.executionReady,false);assert.equal(r.compatibility.runtimeCompatible,false);
  assert.equal(r.compatibility.bindingPublicationRequired,true);assert.equal(r.effects.controlHistoryWrites,0);assert.deepEqual(f.input.snapshot,before);
  assert(r.program.cancel.text.startsWith('UPDATE public.deployment_jobs'));assert(r.program.insert.text.includes('INSERT INTO public.deployment_jobs'));
  assert.equal(r.program.insert.values[4],Number.MAX_SAFE_INTEGER);assert.equal(JSON.parse(r.program.insert.values[3]).cloudExecutionAuthorized,false);
});
for(const fault of ['freshness','evidence','version','active','history','not-expired','candidate'])test('reject unsafe handoff '+fault,async()=>{
  const f=await fixture(),x=f.input;
  if(fault==='freshness')x.observedAt-=30000;
  if(fault==='evidence')x.manifestObject.value.createdAt++;
  if(fault==='version')x.resultObject.versionId='copied-content-new-version';
  if(fault==='active')x.snapshot.jobs.find(j=>j.id===x.entry.plan.jobId).attempts=1;
  if(fault==='history')x.snapshot.ledger.plans=x.snapshot.ledger.plans.filter(p=>p.plan_sha!==f.old.planSha256);
  if(fault==='not-expired'){x.at=f.at;x.observedAt=f.at;}
  if(fault==='candidate'){const j=structuredClone(x.snapshot.jobs[0]);j.id=(await nextRequestTarget()).newJobId;x.snapshot.jobs.push(j);}
  await assert.rejects(f.compile(x));
});
