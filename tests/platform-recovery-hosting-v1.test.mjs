import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {T,P,BEFORE,IMAGE,canonical,hash,same,beforeTemplate,nextTemplate,lease,verifyObserved,review,validate,request,runOnce,assertReadiness,assertSnapshotTime} from '../ops/platform-recovery-hosting-v1/plan.mjs';
import {H as OLD,template as oldTemplate} from '../ops/platform-hosted-deploy-v6/contract.mjs';
import {RECOVERY_CONTROL_BINDING as B} from '../ops/platform-recovery-control-v1/binding.mjs';
import {hostedRuntimeLeaseV6} from '../lib/deployments/controller-v6/configuration.ts';
import {createCloud} from '../ops/platform-recovery-hosting-v1/cloud.mjs';
import {metadataOnly} from '../ops/platform-recovery-hosting-v1/ci.mjs';
const at=Date.parse('2026-10-26T18:00:00Z'),source='2'.repeat(40),nonce='a'.repeat(32),newDefinition=BEFORE.ids.TaskDefinition.replace(/:8$/,':9');
function manifest(){return review({sourceCommit:source,pins:Array.from({length:12},(_,i)=>({file:'synthetic-'+i+'.mjs',sha256:'b'.repeat(64)})),
  ci:{sourceCommit:source,status:'completed',conclusion:'success',attempt:1},before:{stackId:T.stackId,healthy:true,ids:BEFORE.ids,
    templateSha256:hash(beforeTemplate()),oldLease:BEFORE.oldLease,taskArn:'synthetic-old',supplySha256:'c'.repeat(64),inactive:[]},
  parents:[{rawSha256:'d'.repeat(64)},{rawSha256:'e'.repeat(64)}],compatibility:{sourceCommit:source,imageSource:T.imageSource,protectedCodeUnchanged:true},nonce,issuedAt:at});}
function observed(updated=false){const doc=updated?nextTemplate(source):beforeTemplate(),l=updated?lease(at,source):BEFORE.oldLease,ids={...BEFORE.ids,...(updated?{TaskDefinition:newDefinition}:{})};
  return {raw:{stack:{Stacks:[{StackId:T.stackId,StackStatus:'UPDATE_COMPLETE',DisableRollback:false,Parameters:[{ParameterKey:'ControllerLease',ParameterValue:canonical(l)}]}]},
    resources:{StackResourceSummaries:Object.entries(ids).map(([id,physical])=>({LogicalResourceId:id,PhysicalResourceId:physical,ResourceType:doc.Resources[id].Type,ResourceStatus:'UPDATE_COMPLETE'}))},
    template:{TemplateBody:doc},definition:{taskDefinition:{containerDefinitions:[{image:updated?IMAGE:`${P.account}.dkr.ecr.${P.region}.amazonaws.com/${P.repository}@${OLD.imageDigest}`,
      environment:[{name:'TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT',value:updated?source:BEFORE.source}],secrets:[{name:'synthetic-not-read',valueFrom:'unchanged'}]}]}},
    tasks:{tasks:[{containers:[{imageDigest:updated?T.imageDigest:OLD.imageDigest}]}]},service:{services:[{deploymentConfiguration:{maximumPercent:100,minimumHealthyPercent:0,
      deploymentCircuitBreaker:{enable:true,rollback:false},strategy:'ROLLING',bakeTimeInMinutes:0}}]},events:{StackEvents:[{ResourceType:'AWS::CloudFormation::Stack',PhysicalResourceId:T.stackId,
      ResourceStatus:'UPDATE_COMPLETE',ClientRequestToken:'recovery-hosting-'+nonce,Timestamp:new Date(at+5000).toISOString()}]}},
    extra:{stackPolicy:null,changeSets:[],definitions:{ACTIVE:[ids.TaskDefinition],INACTIVE:[],DELETE_IN_PROGRESS:[]}},l};}
const shared=(copy,m,ack)=>{assert.equal(copy.stack.Stacks[0].StackStatus,'CREATE_COMPLETE');assert(same(copy.template.TemplateBody,oldTemplate(T.nonce)));
  assert.equal(copy.definition.taskDefinition.containerDefinitions[0].environment[0].value,OLD.imageSource);assert.equal(copy.tasks.tasks[0].containers[0].imageDigest,OLD.imageDigest);
  assert.deepEqual(copy.definition.taskDefinition.containerDefinitions[0].secrets,[{name:'synthetic-not-read',valueFrom:'unchanged'}]);
  assert.equal(ack.stackId,T.stackId);return {healthy:true,taskArn:'synthetic-task',taskDefinition:copy.resources.StackResourceSummaries.find(r=>r.LogicalResourceId==='TaskDefinition').PhysicalResourceId};};

test('template changes only exact image/source and public metadata; all 11 resources and immutable Secret versions preserved',()=>{
  const before=beforeTemplate(),next=nextTemplate(source),old=structuredClone(before),newer=structuredClone(next);
  delete old.Metadata;delete newer.Metadata;const c=newer.Resources.TaskDefinition.Properties.ContainerDefinitions[0];c.Image=old.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Image;
  c.Environment.find(e=>e.Name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT').Value=BEFORE.source;assert.deepEqual(newer,old);
  assert.equal(Object.keys(next.Resources).length,11);assert(!Object.values(next.Resources).some(r=>/IAM|SecretsManager|RDS/.test(r.Type)));
  assert.deepEqual(next.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Secrets,before.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Secrets);
  assert.equal(next.Resources.TaskDefinition.Properties.TaskRoleArn,undefined);
});
test('late short lease uses real recovery release and exact source, caps original business basis, never silently renews',()=>{
  const l=lease(at,source);assert.equal(l.expiresAt-at,1800000);assert.equal(l.releaseSha256,hash(B.release));assert.equal(l.sourceCommit,source);
  assert(hostedRuntimeLeaseV6(canonical(l),B.release,at));assert.equal(hostedRuntimeLeaseV6(canonical(l),B.release,l.expiresAt),null);
  for(const t of [NaN,Infinity,-1,T.basisExpiresAt-1799999])assert.throws(()=>lease(t,source));assert.throws(()=>lease(at,'main'));
});
test('review binds scope/pins/template/parent/clock and capped expiry; altered approvals never authorize mutation',()=>{
  const m=manifest();validate(m,m.manifestSha256,at);assert.equal(m.scope.updateStackMax,1);assert.equal(m.scope.normalCfnFailureRollback,true);
  assert(m.latestStartAt<=T.basisExpiresAt-35*60000);assert.equal(m.expiresAt,Math.min(at+T.validMs,T.basisExpiresAt));
  for(const mutate of [m=>m.scope.newIam=1,m=>m.before.ids.TaskDefinition='other',m=>m.templateSha256='0'.repeat(64),m=>m.extra=true]){
    const n=structuredClone(m);mutate(n);assert.throws(()=>validate(n,m.manifestSha256,at));}
  assert.throws(()=>validate(m,'0'.repeat(64),at));assert.throws(()=>validate(m,m.manifestSha256,m.latestStartAt));validate(m,m.manifestSha256,m.expiresAt+1,true);
});
test('exact UpdateStack cannot create identities, change tags, assume a CFN role or disable normal rollback',()=>{
  const r=request(manifest(),at);assert.equal(r.StackName,T.stackId);assert.equal(r.DisableRollback,false);assert.equal(r.RoleARN,undefined);assert.equal(r.Capabilities,undefined);assert.equal(r.Tags,undefined);
  assert.deepEqual(r.Parameters.find(p=>p.ParameterKey==='HostingExpiresAt'),{ParameterKey:'HostingExpiresAt',UsePreviousValue:true});
  const p=JSON.parse(r.StackPolicyDuringUpdateBody);assert.deepEqual(p.Statement.map(s=>s.Resource),['LogicalResourceId/TaskDefinition','LogicalResourceId/Service']);
  assert(same(JSON.parse(r.TemplateBody),nextTemplate(source)));assert.equal(JSON.parse(r.Parameters[1].ParameterValue).issuedAt,at);
});
test('actual values are validated before clone-only shared normalization; original source/template/image receipt unchanged',async()=>{
  for(const updated of [false,true]){const x=observed(updated),raw=canonical(x.raw);const proof=await verifyObserved(x.raw,x.extra,{source,controlLease:x.l,updated,intentAt:at,
    token:'recovery-hosting-'+nonce,priorInactive:[]},shared);assert.equal(canonical(x.raw),raw);assert.equal(proof.imageDigest,updated?T.imageDigest:OLD.imageDigest);}
});
test('template, physical identity, real image/source, lease and update event drift reject before shared verifier',async()=>{
  for(const mutate of [x=>x.raw.template.TemplateBody.Resources.TaskDefinition.Properties.TaskRoleArn='other',
    x=>x.raw.resources.StackResourceSummaries[0].PhysicalResourceId='other',x=>x.raw.definition.taskDefinition.containerDefinitions[0].image='wrong',
    x=>x.raw.definition.taskDefinition.containerDefinitions[0].environment[0].value='other',x=>x.raw.tasks.tasks[0].containers[0].imageDigest=OLD.imageDigest,
    x=>x.raw.events.StackEvents[0].ClientRequestToken='other',x=>x.raw.stack.Stacks[0].StackStatus='UPDATE_FAILED',x=>x.extra.changeSets.push({}),
    x=>x.extra.definitions.ACTIVE.push(BEFORE.ids.TaskDefinition),x=>x.raw.service.services[0].deploymentConfiguration.maximumPercent=200]){
    const x=observed(true);mutate(x);let calls=0;await assert.rejects(verifyObserved(x.raw,x.extra,{source,controlLease:x.l,updated:true,intentAt:at,token:'recovery-hosting-'+nonce},()=>{calls++;}));assert.equal(calls,0);}
});
function runFixture(fail){let clock=at;const m=manifest(),calls=[],events=[],act=n=>{calls.push(n);if(n===fail)throw Error('SYNTHETIC_'+n);};
  const io={assertSource:async()=>act('guard'),assertHumanReady:async()=>act('ready'),snapshot:async()=>{act('snapshot');return {checkedAt:clock,baseline:structuredClone(m.before)};},
    record:async(n,v)=>{act('record:'+n);events.push({n,v});},claim:async()=>act('claim'),update:async()=>{act('update');return {StackId:T.stackId};},
    stack:async()=>{act('stack');return {StackId:T.stackId,StackStatus:'UPDATE_COMPLETE',LastUpdatedTime:new Date(clock).toISOString()};},
    observe:async()=>{act('observe');return {verified:true};},wait:async()=>{clock+=10000;}};
  return {m,io,calls,events,now:()=>clock,time:t=>{clock=t;}};}
test('readiness, exact baseline and fresh source precede permanent claim and only one update',async()=>{
  const f=runFixture(),r=await runOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now});assert.equal(r.outcome,'RECOVERY_HOSTING_METADATA_VERIFIED_ACCEPTANCE_PENDING');
  assert.equal(f.calls.filter(x=>x==='update').length,1);assert(f.calls.indexOf('snapshot')<f.calls.indexOf('claim'));assert(f.calls.indexOf('claim')<f.calls.indexOf('update'));
  assert.equal(r.businessDeploymentAccepted,false);assert.equal(r.workflowDispatched,false);assert.equal(r.controlLease.issuedAt,at);
});
for(const fail of ['ready','snapshot','claim'])test('pre-slot '+fail+' failure never submits update',async()=>{
  const f=runFixture(fail);await assert.rejects(runOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now}));assert(!f.calls.includes('update'));
});
for(const fail of ['record:update-intent','update','record:update-ack','stack','observe'])test('post-slot '+fail+' preserves no-retry outcome without compensating writes',async()=>{
  const f=runFixture(fail),r=await runOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now});assert.equal(r.outcome,'RECOVERY_HOSTING_REQUIRES_INSPECT_NO_RETRY');
  assert.equal(r.retryAllowed,false);assert(f.calls.includes('claim'));assert(f.calls.filter(x=>x==='update').length<=1);
});
test('stale after claim or source-clock rollback fails closed before write; ordinary rollback status is never hidden',async()=>{
  for(const delta of [-1,120001]){const f=runFixture();f.io.claim=async()=>f.time(at+delta);const r=await runOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now});
    assert.equal(r.outcome,'RECOVERY_HOSTING_REQUIRES_INSPECT_NO_RETRY');assert(!f.calls.includes('update'));}
  const f=runFixture();f.io.stack=async()=>({StackId:T.stackId,StackStatus:'UPDATE_ROLLBACK_IN_PROGRESS'});
  assert.equal((await runOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now})).outcome,'RECOVERY_HOSTING_REQUIRES_INSPECT_NO_RETRY');
});
test('old UPDATE_COMPLETE cannot be taken for the new update before observed progress or new timestamp',async()=>{
  const f=runFixture();let seen=0;f.io.stack=async()=>{seen++;return {StackId:T.stackId,StackStatus:seen===2?'UPDATE_IN_PROGRESS':'UPDATE_COMPLETE',LastUpdatedTime:new Date(at-1000).toISOString()};};
  const r=await runOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now});assert.equal(r.outcome,'RECOVERY_HOSTING_METADATA_VERIFIED_ACCEPTANCE_PENDING');assert.equal(seen,3);
});
test('fresh readiness timestamp is an operator attestation, cannot be future/expired or replace approval SHA',async()=>{
  assertReadiness(at,at+1000);for(const t of [NaN,Infinity,at+1,at-180000])assert.throws(()=>assertReadiness(t,at));
  const f=runFixture();await assert.rejects(runOnce({manifest:f.m,approved:'0'.repeat(64),io:f.io,now:f.now}));
});
test('preparation rejects old/future snapshots; historical audit cannot substitute for the runner fresh snapshot',()=>{
  assertSnapshotTime(at,at+1000);assert.throws(()=>assertSnapshotTime(at,at+7200000));assert.throws(()=>assertSnapshotTime(at+1,at));
  assertSnapshotTime(at,at+7200000,true);assert.throws(()=>assertSnapshotTime(NaN,at,true));
});
test('read-only IO refuses update before credentials/metadata; no secret value/database/delete/create or runtime launch path',async()=>{
  const c=createCloud({readOnly:true});try{await assert.rejects(c.update({}),/WRITE_DISABLED/);assert.deepEqual(c.counts,{sts:0,metadata:0,writes:0});}finally{c.close();}
  const text=await readFile('ops/platform-recovery-hosting-v1/cloud.mjs','utf8');assert.doesNotMatch(text,/GetSecretValueCommand|PutSecretValue|DeleteStackCommand|CreateStackCommand|RunTaskCommand|UpdateServiceCommand|new pg\./);
  assert.equal((text.match(/new C\.UpdateStackCommand/g)??[]).length,1);assert.match(text,/maxAttempts:1/);
});
test('CI metadata-only mapping cannot bless application, risk, tests, workflow or operator code drift',()=>{
  metadataOnly(['docs/aws-auto-deployment-w9p-recovery-hosting-code-verified.md']);metadataOnly([]);
  for(const f of ['app/page.tsx','ops/platform-recovery-hosting-v1/plan.mjs',T.riskFile,'tests/platform-recovery-hosting-v1.test.mjs','.github/workflows/'+T.ciFile])assert.throws(()=>metadataOnly([f]));
});
test('No-AWS CI is code-only; no environment, OIDC, private input, image rebuild or deployment commands',async()=>{
  const y=load(await readFile('.github/workflows/'+T.ciFile,'utf8'));assert.deepEqual(y.permissions,{contents:'read'});assert.equal(y.on.workflow_dispatch,undefined);
  for(const job of Object.values(y.jobs)){assert.equal(job.environment,undefined);assert.equal(job.permissions?.['id-token'],undefined);}
  assert.doesNotMatch(JSON.stringify(y),/secrets\.|id-token|configure-aws|RunReviewed|docker build|aws login|source\.mjs/);
});
