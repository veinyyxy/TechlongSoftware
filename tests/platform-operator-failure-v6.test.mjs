import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {operatorFailure,operatorError,recordedFailure,recordedFailureError} from '../ops/platform-review-v6/operator-failure.mjs';
import {createCycleReads} from '../ops/platform-review-v6/cycle-reads.mjs';
import {createHostedHandoff} from '../ops/platform-review-v6/hosted-handoff.mjs';
import {createCycleRun} from '../ops/platform-review-v6/cycle-run.mjs';
import {operationsFixtureV6} from './fixtures/platform-operations-v6.mjs';
import {cycleFixture} from './fixtures/platform-cycle-v6.mjs';
import {S} from '../ops/platform-cloud-v6/contract.mjs';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
const marker='synthetic-private-password-do-not-emit',payload={synthetic:true};
async function fixture(fault){
  const raw=Buffer.from(canonicalJson(payload)),ref={key:`worker-v5/${S.instanceId}/synthetic/manifest.json`,sha256:await sha256Hex(payload),versionId:'synthetic-version'},
    calls={s3:0,http:0,failures:[]};
  const p=createCycleReads({githubToken:marker,s3:{async send(command){calls.s3++;assert.equal(command.input.VersionId,ref.versionId);
    if(fault==='send')throw Object.assign(Error(marker),{name:'AccessDenied',$metadata:{httpStatusCode:403,attempts:1},request:{authorization:marker}});
    const response={VersionId:ref.versionId,ServerSideEncryption:'AES256',ContentLength:raw.length,Body:Readable.from([raw]),$metadata:{httpStatusCode:200,attempts:1}};
    if(fault==='metadata')response.VersionId='wrong';
    if(fault==='body')response.Body=Readable.from((async function*(){throw Object.assign(Error(marker),{code:'ECONNRESET'});})());
    if(fault==='length')response.ContentLength++;
    if(fault==='json')response.Body=Readable.from([Buffer.from('!'.repeat(raw.length))]);
    if(fault==='oversize'){response.Body=Readable.from([Buffer.alloc(1000001)]);response.ContentLength=1000000;}
    if(fault==='safety'){const b=Buffer.from(JSON.stringify({password:marker}));response.Body=Readable.from([b]);response.ContentLength=b.length;}
    return response;}},fetch:async(url,options)=>{calls.http++;assert.equal(url,'https://api.github.com/repos/'+S.repository+'/actions/runs/12345');
      assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return new Response('{"synthetic":true}',{status:fault==='http'?403:200});},
    onFailure:async f=>{calls.failures.push(f);if(fault==='record')throw Error(marker);}});
  if(fault==='digest'||fault==='record')ref.sha256='0'.repeat(64);return {p,ref,calls};
}
test('redaction emits only allowlisted codes and integer metadata, never raw message/stack/request/cause',()=>{
  const e=Object.assign(Error('postgresql://'+marker),{name:marker,code:marker,Code:marker,stack:marker,
    $metadata:{httpStatusCode:403,attempts:1,requestId:marker},cause:{code:'ECONNRESET',password:marker},request:{headers:{authorization:marker}}});
  const f=operatorFailure(e,marker,marker);assert.equal(f.stage,'UNCLASSIFIED');assert.equal(f.networkCode,'ECONNRESET');
  assert.equal(f.httpStatus,403);assert.equal(f.providerCode,null);assert(!JSON.stringify(f).includes(marker));assert(Object.isFrozen(f));
  assert.equal(operatorFailure({$metadata:{httpStatusCode:999,attempts:999}},'READ_PORT','S3_SEND').httpStatus,null);
});
test('safe cause survives wrappers, and raw or disk-loaded fake failure fields cannot forge a carried failure',()=>{
  const e=operatorError(Object.assign(Error(marker),{name:'SlowDown',$metadata:{httpStatusCode:503,attempts:1}}),'READ_PORT','S3_SEND');
  const f=recordedFailure(e,'HOSTED_HANDOFF','FULL_RECONSTRUCTION'),wrapped=recordedFailureError(f,'HOSTED_DRIVER','HANDOFF_STOPPED');
  assert.equal(operatorFailure(wrapped,'CYCLE_RUN','HOSTED_CONTINUOUS_APPROVAL').providerCode,'SlowDown');
  assert.equal(operatorFailure(recordedFailureError(JSON.parse(JSON.stringify(f)),'HOSTED_DRIVER','HANDOFF_STOPPED'),'CYCLE_RUN','WAIT_WINDOW').providerCode,null);
  assert(!Object.hasOwn(e,'cause'));assert(!e.message.includes(marker));
});
for(const [fault,stage] of Object.entries({send:'S3_SEND',metadata:'S3_METADATA',body:'S3_BODY',length:'S3_BODY',json:'S3_JSON',oversize:'S3_BODY',safety:'S3_SAFETY',digest:'S3_DIGEST',record:'S3_DIGEST'}))
test('read failure captures '+fault+' stage once without retry or raw details',async()=>{
  const f=await fixture(fault);let error;try{await f.p.readObject(f.ref);}catch(e){error=e;}assert(error);
  const d=operatorFailure(error,'CYCLE_TRANSPORT','S3_OBJECT');assert.equal(d.stage,stage);assert.equal(f.calls.s3,1);assert.equal(f.calls.failures.length,1);
  assert.equal(d.diagnosticRecordFailed,fault==='record');assert(!JSON.stringify([d,...f.calls.failures]).includes(marker));
  await assert.rejects(f.p.readObject(f.ref));assert.equal(f.calls.s3,1);assert.equal(f.calls.failures.length,1);f.p.dispose();
});
test('success retains fixed-version metadata/hash and has no failure diagnostics',async()=>{
  const f=await fixture(),r=await f.p.readObject(f.ref);assert.deepEqual(r.value,payload);assert.equal(f.calls.failures.length,0);assert.equal(f.calls.s3,1);f.p.dispose();
});
test('foreign reference is rejected before sending and cannot expose the rejected key',async()=>{
  const f=await fixture();await assert.rejects(f.p.readObject({...f.ref,key:'postgresql://'+marker}));assert.equal(f.calls.s3,0);
  assert(!JSON.stringify(f.calls.failures).includes(marker));f.p.dispose();
});
test('GitHub HTTP status is retained without URL/Authorization/body; failure halts further requests',async()=>{
  const f=await fixture('http');let error;try{await f.p.readRun('12345');}catch(e){error=e;}
  const d=operatorFailure(error,'CYCLE_TRANSPORT','GITHUB_RUN');assert.equal(d.stage,'GITHUB_STATUS');assert.equal(d.httpStatus,403);
  assert(!JSON.stringify(d).includes(marker));await assert.rejects(f.p.readRun('12345'));assert.equal(f.calls.http,1);f.p.dispose();
});
test('HOSTED bridge preserves transport failure stage and blocks all observations/proof/plan writes',async()=>{
  const f=await operationsFixtureV6();f.lease={...f.lease,schema:'techlong/platform-hosted-runtime-lease/v6',origin:'https://console.sandbox.techlong.cloud'};
  f.ports.readObject=async()=>{throw operatorError(Object.assign(Error(marker),{name:'AccessDenied',$metadata:{httpStatusCode:403,attempts:1}}),'READ_PORT','S3_SEND');};
  const r=await createHostedHandoff(f).once({planSha256:f.review.planSha256,resultReference:f.resultReference,manifestReference:f.manifestReference,
    manifestSha256:f.manifest.manifestSha256,runId:'123456789'});
  assert.equal(r.phase,'FULL_RECONSTRUCTION');assert.equal(r.failure.stage,'S3_SEND');assert.equal(r.failure.providerCode,'AccessDenied');
  assert.equal(f.effects.observations,0);assert.equal(f.effects.owners,0);assert.equal(r.retryAllowed,false);assert(!JSON.stringify(r).includes(marker));
});
test('owned outer flow stores safe preflight error and closes without claim or update',async()=>{
  const f=await cycleFixture();let closed=0,claimed=0,updated=0;const r=await createCycleRun({manifest:f.m,approved:f.m.manifestSha256,now:()=>f.at,io:{
    guard:async()=>{},preflight:async()=>{throw operatorError(Object.assign(Error(marker),{code:'ETIMEDOUT'}),'READ_PORT','S3_SEND');},
    claim:async()=>{claimed++;},update:async()=>{updated++;},record:async()=>{},counts:()=>({}),close:async()=>{closed++;}}})();
  assert.equal(r.failure.networkCode,'ETIMEDOUT');assert.equal(r.failure.stage,'S3_SEND');assert.equal(claimed,0);assert.equal(updated,0);assert.equal(closed,1);
});
