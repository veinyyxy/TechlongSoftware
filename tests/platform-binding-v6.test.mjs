import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {J,bindingCandidateV6,renderBindingV6,makeBindingReviewV6,verifyBindingApprovalV6,publishBindingOnceV6} from '../ops/platform-binding-v6/plan.mjs';
import {FROZEN_V6 as F} from '../ops/platform-activation-v6/publication.mjs';
import {CLOUD_V6 as C} from '../ops/platform-cloud-v6/contract.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6} from '../lib/deployments/controller-v6/installed-binding.ts';
import {CONTROL_ORIGIN_V6,CONTROL_RISK_PATH_V6,localRuntimeLeaseV6,verifiedRuntimeLeaseV6,assertControllerDatabaseUrlV6,assertControllerNeonTransportV6} from '../lib/deployments/controller-v6/configuration.ts';
import {createPlatformController} from '../lib/deployments/controller-v6/controller.ts';
import {createControlHandlers} from '../lib/deployments/controller-v6/http.ts';
import {controlPlanFixture,TEST_RELEASE,TEST_NOW} from './fixtures/platform-controller-v6.ts';
import {validatePlan,CONTROL_SCOPE as S} from '../lib/deployments/controller-v6/contract.ts';
const at=Date.parse('2026-10-20T18:00:00Z');
const fixture=JSON.parse(await readFile(new URL('./fixtures/platform-binding-template-v6.json',import.meta.url),'utf8'));
async function review(){
  const parent='a'.repeat(40),riskSha256='b'.repeat(64),t=structuredClone(fixture.template);
  const prestate={layout:{main:parent,source:{Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
    foundation:{stackId:F.stackId,status:'UPDATE_COMPLETE',template:t,resources:Array.from({length:5},(_,i)=>({id:'synthetic'+i}))},
    iam:{roleId:C.roleId,arn:C.roleArn,trust:t.Resources.WorkerRole.Properties.AssumeRolePolicyDocument,
      boundary:{defaultVersion:'v1',documentSha256:J.boundarySha256},inline:[{document:fixture.inlineDocument}]},
    environment:{environmentId:24613410405,adminBypass:false,mainBranchOnly:true},unfinishedDeploymentRuns:0},
    workflows:[{id:J.reusableId,state:'active',sha256:'c'.repeat(64)},{id:J.workflowId,state:'active',sha256:'d'.repeat(64)}],newWorkflowUnfinishedRuns:0,closureSha256:F.closureSha256};
  const input={parent,object:{parent,commit:'c'.repeat(40),tree:'d'.repeat(40),blob:'e'.repeat(40),file:J.target,sha256:await sha256Hex(await renderBindingV6(riskSha256))},
    pins:Array.from({length:15},(_,i)=>({file:'synthetic-'+i,sha256:'a'.repeat(64)})),ci:{runId:'123',sourceCommit:parent,attempt:1,status:'completed',conclusion:'success'},
    prestate,riskSha256,createdAt:at};
  return {input,m:await makeBindingReviewV6(input)};
}
async function runner(){const {m}=await review(),events=[];let used=false,clock=at,fail;
  const step=n=>{events.push(n);if(fail===n)throw Error('Synthetic unknown');};
  const io={assertLocal:async()=>step('local'),preflight:async()=>{step('preflight');return structuredClone(m.prestate);},claim:async()=>{assert.equal(used,false);used=true;step('slot');},
    push:async()=>step('push'),record:async n=>step(n),verifyRemote:async()=>{step('readback');return {};},fastForward:async()=>step('ff')};
  return {m,io,events,fail:n=>{fail=n;},at:n=>{clock=n;},run:()=>publishBindingOnceV6({manifest:m,approved:m.manifestSha256,io,now:()=>clock})};}
test('rendered public binding pins actual workflow/R, frozen runtime, release/risk hash and no own future SHA',async()=>{
  const risk='a'.repeat(64),candidate=await bindingCandidateV6(risk),text=await renderBindingV6(risk);
  assert.equal(candidate.platform.workflowId,'390829326');assert.equal(candidate.platform.reusableCommit,J.reusable);
  assert.equal(candidate.publisher.releaseSha256,await sha256Hex(candidate.platform));assert.equal(candidate.publisher.frozenSourceCommit,F.sourceCommit);
  assert.equal(candidate.platform.riskSha256,risk);assert.equal(CONTROL_RISK_PATH_V6,J.riskFile);
  const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded=(await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'))).INSTALLED_BINDING_V6;
  assert.deepEqual(loaded,candidate);assert.ok(Object.isFrozen(loaded)&&Object.isFrozen(loaded.platform)&&Object.isFrozen(loaded.publisher));
  assert.ok(Object.isFrozen(INSTALLED_BINDING_V6.platform));assert.equal('sourceCommit' in candidate.platform,false);
});
test('48h exact approval is only a one-file public binding publication, not provisioning or dispatch',async()=>{
  const {m}=await review();await verifyBindingApprovalV6(m,m.manifestSha256,at);assert.equal(m.expiresAt-at,48*3600000);
  for(const k of ['awsWrites','sqlConnections','secretValueReads','privateKeyReads','appTokens','workflowDispatches','serverStarts','businessWrites','automaticRetries'])assert.equal(m.effects[k],0);
  for(const [sha,t] of [['wrong',at],[m.manifestSha256,m.expiresAt],[m.manifestSha256,at-1]])await assert.rejects(verifyBindingApprovalV6(m,sha,t));
  for(const patch of [{effects:{...m.effects,serverStarts:1}},{extraGrant:true},{expiresAt:m.expiresAt+1},{actions:{...m.actions,force:true}}])await assert.rejects(verifyBindingApprovalV6({...m,...patch},m.manifestSha256,at));
  await verifyBindingApprovalV6(m,undefined,m.expiresAt+1,true);
});
test('wrong Source, trust, live template, policy, workflow or active run cannot become a binding review',async()=>{
  const {input}=await review();for(const fn of [p=>{p.layout.source.UserId='other';},p=>{p.layout.iam.roleId='other';},
    p=>{p.layout.iam.trust.Statement.push({Effect:'Allow'});},p=>{p.layout.foundation.template.Description='drift';},
    p=>{p.layout.iam.boundary.defaultVersion='v2';},p=>{p.layout.iam.inline[0].document={};},p=>{p.workflows[1].id='1';},p=>{p.newWorkflowUnfinishedRuns=1;}]){
    const p=structuredClone(input.prestate);fn(p);await assert.rejects(makeBindingReviewV6({...input,prestate:p}));
  }
});
test('slot precedes one non-force push, strict readback and local FF; repeated execution cannot submit again',async()=>{
  const f=await runner(),r=await f.run();assert.match(r.outcome,/REQUIRES_INDEPENDENT_INSPECT/);assert.equal(r.runtimeStarted,false);
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('push'));assert.ok(f.events.indexOf('readback')<f.events.indexOf('ff'));
  await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='push').length,1);
});
test('ambiguous push/ACK/readback/FF or expiry after slot never retries or compensates',async()=>{
  for(const phase of ['push','push-ack','readback','published-binding','ff','local-main-ack']){const f=await runner();f.fail(phase);assert.match((await f.run()).outcome,/PARTIAL_OR_UNKNOWN/);
    await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='push').length,1);}
  const f=await runner(),claim=f.io.claim;f.io.claim=async()=>{await claim();f.at(f.m.expiresAt);};assert.match((await f.run()).outcome,/PARTIAL/);assert.equal(f.events.includes('push'),false);
  const p=await runner();p.io.preflight=async()=>({...p.m.prestate,closureSha256:'0'.repeat(64)});await assert.rejects(p.run());assert.equal(p.events.includes('slot'),false);
});
test('short local lease requires exact fields, origin/source/time and release digest; no environment-only activation',async()=>{
  const release=await bindingCandidateV6('a'.repeat(64)).then(x=>x.platform),lease={schema:'techlong/platform-local-runtime-lease/v6',releaseSha256:await sha256Hex(release),
    origin:CONTROL_ORIGIN_V6,sourceCommit:'a'.repeat(40),issuedAt:at,expiresAt:at+1800000};
  assert.equal((await verifiedRuntimeLeaseV6(JSON.stringify(lease),release,at)).sourceCommit,lease.sourceCommit);
  for(const p of [{origin:'https://public.invalid'},{sourceCommit:'main'},{expiresAt:at+1800001},{issuedAt:at+1},{expiresAt:at},{extraPermission:true}])
    assert.equal(localRuntimeLeaseV6(JSON.stringify({...lease,...p}),release,at),null);
  assert.equal(await verifiedRuntimeLeaseV6(JSON.stringify({...lease,releaseSha256:'0'.repeat(64)}),release,at),null);
  assert.equal(localRuntimeLeaseV6(JSON.stringify(lease),INSTALLED_BINDING_V6.platform,NaN),null);
});
test('runtime verification rejects before ledger or key; source mismatch rejects before durable submission',async()=>{
  const p=await controlPlanFixture(),v=await validatePlan(p,TEST_RELEASE,TEST_NOW),calls=[],entry={...v,riskSha256:p.riskSha256,attempt:null};
  const ledger={load:async()=>{calls.push('load');return entry;},begin:async()=>calls.push('begin')},github={dispatch:async()=>calls.push('key')};
  const action={operation:'approve_and_dispatch',planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:p.riskSha256};
  const c=createPlatformController({enabled:()=>true,release:TEST_RELEASE,ledger:()=>ledger,github:()=>github,now:()=>TEST_NOW,
    verifyRuntime:async()=>{throw Error('expired lease');}});await assert.rejects(c.act(S.instanceId,'usr_'+'a'.repeat(24),action));assert.deepEqual(calls,[]);
  const d=createPlatformController({enabled:()=>true,release:TEST_RELEASE,ledger:()=>ledger,github:()=>github,now:()=>TEST_NOW,sourceCommit:()=> '0'.repeat(40)});
  await assert.rejects(d.act(S.instanceId,'usr_'+'a'.repeat(24),action),/SOURCE_MISMATCH/);assert.deepEqual(calls,['load']);
});
test('lease/source is rechecked after authentication latency before any dispatch POST',async()=>{
  const p=await controlPlanFixture(),v=await validatePlan(p,TEST_RELEASE,TEST_NOW),calls=[];let source=p.sourceCommit;
  const ledger={load:async()=>({...v,riskSha256:p.riskSha256,attempt:null}),begin:async()=>calls.push('begin'),unknown:async()=>calls.push('unknown')};
  const github={dispatch:async(_p,guard)=>{source='0'.repeat(40);await guard();calls.push('POST');}};
  const c=createPlatformController({enabled:()=>true,release:TEST_RELEASE,ledger:()=>ledger,github:()=>github,now:()=>TEST_NOW,sourceCommit:()=>source});
  await assert.rejects(c.act(S.instanceId,'usr_'+'a'.repeat(24),{operation:'approve_and_dispatch',planSha256:v.planSha256,actionSha256:v.actionSha256,riskSha256:p.riskSha256}));
  assert.deepEqual(calls,['begin','unknown']);
});
test('local-origin HTTP rejects remote GET and POST before admin/database authorization',async()=>{
  let auth=0;const h=createControlHandlers({origin:()=>CONTROL_ORIGIN_V6,enabled:()=>true,authorize:async()=>{auth++;return {account:null,response:null};},status:async()=>null,act:async()=>null});
  const ctx={params:Promise.resolve({instanceId:S.instanceId})};assert.equal((await h.GET(new Request('https://public.invalid/api'),ctx)).status,403);
  assert.equal((await h.POST(new Request('https://public.invalid/api',{method:'POST',headers:{origin:'https://public.invalid'}}),ctx)).status,403);assert.equal(auth,0);
  assert.equal((await h.GET(new Request(CONTROL_ORIGIN_V6+'/api'),ctx)).status,401);assert.equal(auth,1);
});
test('dedicated DB parser rejects owner, other endpoint/database, weaker TLS and injected options before any network',async()=>{
  const base='postgresql://techlong_deployment_controller_v6:fake-only@ep-fixture.ca-central-1.aws.neon.tech/neondb?sslmode=verify-full';
  for(const url of [base,base.replace('techlong_deployment_controller_v6:','neondb_owner:'),base.replace('verify-full','require'),base+'&options=unsafe',base.replace('/neondb?','/other?')])await assert.rejects(assertControllerDatabaseUrlV6(url));
});
test('HTTP database transport rejects shared probe fetch overrides and alternate endpoints without mutating globals',()=>{
  const host='ep-fixture.ca-central-1.aws.neon.tech',url='https://api.ca-central-1.aws.neon.tech/sql';
  assert.equal(assertControllerNeonTransportV6(host,{fetchFunction:undefined,fetchEndpoint:()=>url}),url);
  assert.throws(()=>assertControllerNeonTransportV6(host,{fetchFunction:()=>{},fetchEndpoint:()=>url}));
  assert.throws(()=>assertControllerNeonTransportV6(host,{fetchFunction:undefined,fetchEndpoint:'https://evil.invalid/sql'}));
});
test('binding adapter exposes only GET metadata and one Git push, no runtime/private/SQL/cloud writer',async()=>{
  const code=await readFile(new URL('../ops/platform-binding-v6/local.mjs',import.meta.url),'utf8');assert.equal((code.match(/'push','--porcelain'/g)??[]).length,1);
  assert.match(code,/flag:'wx',flush:true/);assert.doesNotMatch(code,/--force|\.pem|GetSecretValueCommand|new pg\.|CreateChangeSetCommand|ExecuteChangeSetCommand|method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
  const component=await readFile(new URL('../components/admin/DeploymentControlPanel.tsx',import.meta.url),'utf8');assert.ok(component.includes(CONTROL_RISK_PATH_V6));
});
