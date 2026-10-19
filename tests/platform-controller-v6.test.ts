import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_SCOPE as S, PLATFORM_RELEASE, parseAction, validatePlan } from '../lib/deployments/controller-v6/contract.ts';
import { createPlatformController, projectStatus, type ControlLedger } from '../lib/deployments/controller-v6/controller.ts';
import { createControlHandlers } from '../lib/deployments/controller-v6/http.ts';
import { createNeonControlLedger } from '../lib/deployments/controller-v6/ledger.ts';
import { controlPlanFixture, TEST_RELEASE, TEST_NOW } from './fixtures/platform-controller-v6.ts';

async function setup() {
  const fixture=await controlPlanFixture(),v=await validatePlan(fixture,TEST_RELEASE,TEST_NOW),calls:string[]=[];
  const entry={...v,riskSha256:fixture.riskSha256,attempt:null as null|{state:string;runId:string|null;status:null;conclusion:null;proofSha256:null}};
  const ledger:ControlLedger={async load(){calls.push('load');return structuredClone(entry);},async status(){calls.push('status');return [];},
    async begin(){calls.push('begin');if(entry.attempt)throw Error('occupied');entry.attempt={state:'SUBMISSION_STARTED',runId:null,status:null,conclusion:null,proofSha256:null};},
    async assertLive(){calls.push('assertLive');},async acknowledge(_sha,ack){calls.push('ack');entry.attempt!.state='ACKNOWLEDGED';entry.attempt!.runId=ack.runId;},
    async unknown(){calls.push('unknown');if(entry.attempt?.state==='SUBMISSION_STARTED')entry.attempt.state='UNKNOWN';},async observe(){calls.push('observeSaved');}};
  const action={operation:'approve_and_dispatch' as const,planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:fixture.riskSha256};
  const github={async dispatch(_p:unknown,guard:()=>Promise<void>,onAck:(v:{runId:string;url:string})=>Promise<void>){calls.push('github');await guard();
    const ack={runId:'123',url:`https://github.com/${S.repository}/actions/runs/123`};await onAck(ack);return ack;},
  async observe(){calls.push('githubRead');return {runId:'123',url:`https://github.com/${S.repository}/actions/runs/123`,status:'completed',conclusion:'success'};}};
  return {fixture,entry,calls,ledger,action,github,create:(release=TEST_RELEASE)=>createPlatformController({enabled:()=>true,release,ledger:()=>ledger,github:()=>github,now:()=>TEST_NOW})};
}
test('unpublished release stops all store/credential/network access despite enabled boolean',async()=>{
  const f=await setup(),c=f.create(PLATFORM_RELEASE);assert.equal((await c.status(S.instanceId)).enabled,false);
  await assert.rejects(c.act(S.instanceId,'usr_'+'a'.repeat(24),f.action),/NOT_ACTIVATED/);assert.deepEqual(f.calls,[]);
});
test('strict capsule and browser action reject secrets, old jobs, drift, expired plans or arbitrary workflow',async()=>{
  const p=await controlPlanFixture();
  for(const patch of [{jobId:S.completedJob},{expiresAt:TEST_NOW},{sourceCommit:'main'},{releaseSha256:'0'.repeat(64)},{token:'NEVER'}])
    await assert.rejects(validatePlan({...p,...patch},TEST_RELEASE,TEST_NOW));
  for(const patch of [{workflow:'other.yml'},{privateKey:'NEVER'},{operation:'retry'}])assert.throws(()=>parseAction({operation:'observe',planSha256:'a'.repeat(64),...patch}));
});
test('approval and permanent intent precede credentials; exact ACK is durable before return; no second submission',async()=>{
  const f=await setup(),c=f.create();const result=await c.act(S.instanceId,'usr_'+'a'.repeat(24),f.action);
  assert.equal(result.runId,'123');assert.deepEqual(f.calls,['load','begin','github','assertLive','ack']);
  await assert.rejects(c.act(S.instanceId,'usr_'+'a'.repeat(24),f.action));assert.equal(f.calls.filter(x=>x==='github').length,1);
});
test('unknown POST consumes permanent slot and never automatically retries or overwrites a saved ACK',async()=>{
  for(const ackFirst of [false,true]){const f=await setup();f.github.dispatch=async(_p,guard,onAck)=>{await guard();if(ackFirst)await onAck({runId:'123',url:'unused'});throw Error('RAW_PRIVATE_PROVIDER_MESSAGE');};
    await assert.rejects(f.create().act(S.instanceId,'usr_'+'a'.repeat(24),f.action),{message:'CONTROL_REQUIRES_READBACK_NO_RETRY'});
    assert.equal(f.entry.attempt?.state,ackFirst?'ACKNOWLEDGED':'UNKNOWN');assert.equal(f.calls.filter(x=>x==='begin').length,1);}
});
test('store begin failure does not touch credentials/network; expired plan stops before intent',async()=>{
  const f=await setup();f.ledger.begin=async()=>{throw Error('ambiguous commit');};await assert.rejects(f.create().act(S.instanceId,'usr_'+'a'.repeat(24),f.action));
  assert.equal(f.calls.includes('github'),false);const expired=await setup();expired.entry.plan.expiresAt=TEST_NOW;
  await assert.rejects(expired.create().act(S.instanceId,'usr_'+'a'.repeat(24),expired.action),/EXPIRED/);assert.deepEqual(expired.calls,['load']);
});
test('expired plan observation is exact-run only and does not turn GitHub success into deployment verification',async()=>{
  const f=await setup();await f.create().act(S.instanceId,'usr_'+'a'.repeat(24),f.action);
  const c=createPlatformController({enabled:()=>true,release:TEST_RELEASE,ledger:()=>f.ledger,github:()=>f.github,now:()=>TEST_NOW+999999});
  const result=await c.act(S.instanceId,'usr_'+'a'.repeat(24),{operation:'observe',planSha256:f.action.planSha256});
  assert.match(result.outcome,/NOT_DEPLOYMENT_ATTESTATION/);assert.equal(f.calls.filter(x=>x==='begin').length,1);
  const view=projectStatus({...f.action,jobId:f.fixture.jobId,mode:'Inspect',sourceCommit:f.fixture.sourceCommit,expiresAt:TEST_NOW,
    state:'OBSERVED',runId:'123',status:'completed',conclusion:'success',proofSha256:null,privateData:'NEVER_OUTPUT'});
  assert.equal(view.deploymentVerified,false);assert.equal(view.evidenceAttested,false);assert.doesNotMatch(JSON.stringify(view),/NEVER_OUTPUT/);
});
test('HTTP enforces origin/admin/closed gate/body limit and never leaks provider diagnostics',async()=>{
  let calls=0;const ctx={params:Promise.resolve({instanceId:S.instanceId})};
  const h=createControlHandlers({authorize:async()=>({account:{user:{id:'usr_'+'a'.repeat(24)}},response:null}),enabled:()=>false,
    status:async()=>({enabled:false,plans:[]}),act:async()=>{calls++;throw Error('PRIVATE_VALUE');}});
  assert.equal((await h.POST(new Request('https://local.test/api',{method:'POST'}),ctx)).status,403);
  assert.equal((await h.POST(new Request('https://local.test/api',{method:'POST',headers:{origin:'https://local.test'}}),ctx)).status,409);
  const get=await h.GET(new Request('https://local.test/api'),ctx);assert.equal(get.headers.get('cache-control'),'no-store');assert.equal(calls,0);
  const active=createControlHandlers({authorize:async()=>({account:{user:{id:'usr_'+'a'.repeat(24)}},response:null}),enabled:()=>true,status:async()=>null,
    act:async()=>{calls++;throw Error('PRIVATE_VALUE');}});
  const post=(body:string)=>active.POST(new Request('https://local.test/api',{method:'POST',headers:{origin:'https://local.test','content-type':'application/json'},body}),ctx);
  assert.equal((await post('x'.repeat(2050))).status,413);
  const failed=await post(JSON.stringify({operation:'observe',planSha256:'a'.repeat(64)}));assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/PRIVATE_VALUE/);
});
test('Neon adapter rejects owner credentials and non-TLS endpoints before network',async()=>{
  for(const url of ['postgresql://owner:p@example.neon.tech/db?sslmode=require','postgresql://techlong_deployment_controller_v6:p@evil.test/db?sslmode=require',
    'postgresql://techlong_deployment_controller_v6:p@example.neon.tech/db'])await assert.rejects(createNeonControlLedger(()=>url).status(),/DATABASE_BINDING/);
});
