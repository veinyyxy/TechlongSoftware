import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VERIFY_INSTALL_V5 as V,verifyDispatchBodyV5,prepareProbeV5,assertProbeApprovalV5,dispatchProbeV5,
  assertProbeRunV5,probeProofFromLogsV5} from '../ops/cloud-worker/verify-install-v5.mjs';
const record=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json',import.meta.url),'utf8'));
const publication={key:record.publication.key,versionId:record.publication.versionId,sha256:record.publication.wholeDocumentSha256,
  installationSha256:record.publication.installationSha256};
const now=1800000000000,source={commit:'a'.repeat(40),files:Array.from({length:116},(_,i)=>({file:'test-'+i,normalizedLfSha256:'b'.repeat(64)}))},
  history={activationProofRawSha256:'c'.repeat(64)},prestate={main:source.commit,workflowId:V.workflowId,environmentId:V.environmentId,
    deploymentWorkflowRuns:0,metadataVerified:true};
const context={source,history,prestate,publication,now};
const fixture=async()=>{const m=await prepareProbeV5(context),events=[];let occupied=false,fail=false;
  const io={preflight:async()=>{events.push('preflight');return prestate;},consumeSlot:async()=>{assert.equal(occupied,false);occupied=true;events.push('slot');},
    record:async name=>events.push(name),dispatch:async(request,guard)=>{await guard();events.push('POST');if(fail)throw Error('ACK lost');
      return {workflow_run_id:123,html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/123',run_url:'https://api.github.com/repos/veinyyxy/TechlongSoftware/actions/runs/123'};}};
  return {m,events,io,fail:()=>{fail=true;},run:()=>dispatchProbeV5({manifest:m,approved:m.manifestSha256,source,history,publication,io,now:()=>now})};};
test('dispatch only VerifyInstall with fixed publication, empty business inputs and returned run ID requested',()=>{
  const b=verifyDispatchBodyV5(publication);assert.equal(b.ref,'main');assert.equal(b.return_run_details,true);assert.equal(b.inputs.mode,'VerifyInstall');
  for(const k of ['job','manifest','manifestSha','execution','lineage'])assert.equal(b.inputs[k],'');
  for(const field of ['key','versionId','sha256','installationSha256'])assert.throws(()=>verifyDispatchBodyV5({...publication,[field]:'changed'}));
});
test('fresh approval binds source, history, workflow, all effects, request and precise two-hour dispatch-only window',async()=>{
  const m=await prepareProbeV5(context);assert.equal(m.effects.fixedDatabaseSecretValueReads,1);assert.equal(m.effects.resourceOrDatabaseWrites,0);
  await assertProbeApprovalV5(m,m.manifestSha256,context);
  for(const changed of [{...context,now:m.expiresAt},{...context,source:{...source,commit:'d'.repeat(40)}},{...context,history:{}},
    {...context,prestate:{...prestate,metadataVerified:false}}])await assert.rejects(assertProbeApprovalV5(m,m.manifestSha256,changed));
  await assert.rejects(assertProbeApprovalV5({...m,request:{...m.request,body:{ref:'main',inputs:{mode:'RunOnce'}}}},m.manifestSha256,context));
});
test('expired approval stops before preflight or slot; drifted prestate stops before slot',async()=>{
  const f=await fixture();await assert.rejects(dispatchProbeV5({manifest:f.m,approved:f.m.manifestSha256,source,history,publication,io:f.io,now:()=>f.m.expiresAt}));
  assert.deepEqual(f.events,[]);f.io.preflight=async()=>({...prestate,deploymentWorkflowRuns:1});await assert.rejects(f.run());assert.deepEqual(f.events,[]);
});
test('only slot -> intent -> one POST -> durable exact run ACK, never environment approval',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.runId,'123');assert.equal(r.environmentApprovedByController,false);
  assert.deepEqual(f.events,['preflight','slot','dispatch-intent','POST','dispatch-api-ack','dispatch-result']);
  await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
});
test('lost ACK leaves permanent slot, no fallback or POST retry',async()=>{
  const f=await fixture();f.fail();await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
  assert.ok(!f.events.includes('dispatch-result'));await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='POST').length,1);
});
test('last-second expiry is checked again immediately before POST',async()=>{
  const f=await fixture();let clock=now;f.io.dispatch=async(_,guard)=>{clock=f.m.expiresAt;await guard();f.events.push('POST');};
  await assert.rejects(dispatchProbeV5({manifest:f.m,approved:f.m.manifestSha256,source,history,publication,io:f.io,now:()=>clock}));assert.ok(!f.events.includes('POST'));
});
function run(){return {id:123,workflow_id:V.workflowId,head_sha:source.commit,head_branch:'main',event:'workflow_dispatch',run_attempt:1,
  actor:{id:14145707},triggering_actor:{id:14145707},repository:{id:1323312747},head_repository:{id:1323312747},created_at:new Date(now+1000).toISOString(),
  html_url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/123',status:'completed',conclusion:'success'};}
test('readback binds exact run/head/actor/manual attempt and rejects reruns or unrelated run',async()=>{
  const m=await prepareProbeV5(context);assert.equal(assertProbeRunV5(run(),m,'123').attempt,1);
  for(const change of [{id:124},{workflow_id:2},{head_sha:'d'.repeat(40)},{run_attempt:2},{actor:{id:1}},{event:'push'},{head_branch:'other'}])
    assert.throws(()=>assertProbeRunV5({...run(),...change},m,'123'));
});
function proof(){return {schema:'techlong/cloud-worker-cloud-install-proof/v5',outcome:'CLOUD_IDENTITY_FIXED_BINDING_DATABASE_CATALOG_VERIFIED',
  installationSha256:publication.installationSha256,run:{repository:'veinyyxy/TechlongSoftware',runId:'123',runAttempt:1,commitSha:source.commit},
  frozenSourceCommit:V.runtime,rootClosureSha256:'110f06bcfe0037ffc1bc0e1d4679a6796080564abde42818074807e516b7bb84',
  counters:{bindingReads:1,identityReads:1,databaseSecretReads:1,catalogTransactions:1,controlSecretReads:0,cloudWrites:0,databaseWrites:0},
  controlMaterialOrApplicationVerified:false,workloadDeploymentPerformed:false,retryAllowed:false};}
const log=p=>JSON.stringify(p,null,2).split('\n').map(l=>'2026-10-18T12:00:00.0000000Z '+l).join('\n');
test('timestamped public proof is extracted without saving raw logs; altered counters/duplicates/no proof fail closed',async()=>{
  const m=await prepareProbeV5(context),p=proof();assert.deepEqual(probeProofFromLogsV5('setup noise\n'+log(p),m,'123'),p);
  assert.throws(()=>probeProofFromLogsV5(log(p)+'\n'+log(p),m,'123'));
  assert.throws(()=>probeProofFromLogsV5('success but no proof',m,'123'));
  assert.throws(()=>probeProofFromLogsV5(log({...p,counters:{...p.counters,controlSecretReads:1}}),m,'123'));
  assert.throws(()=>probeProofFromLogsV5(log({...p,frozenSourceCommit:'d'.repeat(40)}),m,'123'));
});
test('controller has one dispatch path, no environment-approval/rerun/cancel/Secret-value/resource write API',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/verify-install-v5.mjs',import.meta.url),'utf8');
  assert.equal((code.match(/return gh\('POST',request.path,request.body\)/g)||[]).length,1);
  assert.doesNotMatch(code,/GetSecretValueCommand|PutSecretValueCommand|ExecuteChangeSetCommand|CreateStackCommand|gh\('PUT'|gh\('PATCH'|gh\('DELETE'|pending_deployments|\/rerun|\/cancel/);
  assert.match(code,/flag:'wx'/);assert.match(code,/await guard\(\);must\(\+\+posts===1/);
});
