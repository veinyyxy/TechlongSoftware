import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {H,P,IMAGE,RELEASE_SHA,SCOPE,hash,canonical,lease,template,assertBaseline,makeReview,validate,runtime} from '../ops/platform-hosted-deploy-v6/contract.mjs';
import {run} from '../ops/platform-hosted-deploy-v6/run.mjs';
import {H as A,suppliedTemplate,readPolicy} from '../ops/platform-hosted-access-v6/contract.mjs';
import {handoffPolicy} from '../ops/platform-ecs-v1/contract.mjs';
import {hostingTemplate,trust,tags} from '../ops/platform-ecs-v1/templates.mjs';
import {hostedRuntimeLeaseV6} from '../lib/deployments/controller-v6/configuration.ts';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const now=Date.parse('2026-10-23T19:00:00Z'),nonce='b'.repeat(32);
function baseline(){const t=suppliedTemplate(H.appArn,H.appVersion),p=t.Resources.ExecutionBoundary.Properties.PolicyDocument;
  const secret=(arn,version,policy)=>({arn,kmsArn:P.kmsArn,deleted:false,rotation:false,replicas:0,complete:true,
    versions:[{id:version,stages:['AWSCURRENT']}],stages:{[version]:['AWSCURRENT']},policy});
  return {supply:{source:{Account:P.account,Arn:P.sourceArn,UserId:P.sourceId},pendingComplete:true,pendingChangeSets:[],
    access:{stackId:A.stackId,status:'UPDATE_COMPLETE',stackRoleArn:null,parameters:[],template:t,roleId:A.roleId,roleArn:P.roleArn,
      policyId:A.boundaryId,boundaryArn:P.boundaryArn,roleBoundaryArn:P.boundaryArn,path:'/',maxSessionDuration:3600,roleTags:tags(A.baseNonce),trust:trust(),
      inline:structuredClone(p),boundary:structuredClone(p),inlineNames:[P.inline],managed:[],listsComplete:true,attachmentCount:0,boundaryUsageCount:1,
      defaultVersion:'v2',policyVersions:['v1','v2'],resources:[{logicalId:'ExecutionRole',type:'AWS::IAM::Role',physicalId:P.role,status:'CREATE_COMPLETE'},
        {logicalId:'ExecutionBoundary',type:'AWS::IAM::ManagedPolicy',physicalId:P.boundaryArn,status:'UPDATE_COMPLETE'}]},
    web:secret(P.secretArn,P.secretVersion,handoffPolicy()),controller:secret(H.controllerArn,H.controllerVersion,readPolicy(true)),app:secret(H.appArn,H.appVersion,readPolicy(true))},
    hostingNamesAbsent:true,previousStackId:H.previousStackId,previousStackStatus:'DELETE_COMPLETE',
    image:{digest:H.imageDigest,configDigest:H.imageConfigDigest},budget:{limitUsd:50},network:{vpc:P.vpc},certificate:{arn:P.certificate},
    retired:{active:0,deleting:0,running:0}};}
function review(){return makeReview({sourceCommit:'a'.repeat(40),pins:Array.from({length:6},(_,i)=>({file:'synthetic-'+i+'.mjs',sha256:'d'.repeat(64)})),
  ci:{sourceCommit:'a'.repeat(40),runId:123,attempt:1,status:'completed',conclusion:'success',path:H.ciPath},baseline:baseline(),
  pricing:{currency:'USD',estimate:{exampleTwoHoursUsd:0.14,notAHardCap:true}},validation:{validated:true,parameters:['ControllerLease','HostingExpiresAt']},
  parents:Array.from({length:4},()=>({sha256:'e'.repeat(64)})),nonce,issuedAt:now,riskSha256:'c'.repeat(64)});}
function fixture(failure,clock=()=>now){const events=[],records=[],m=review(),text=JSON.stringify(m);let writes=0;
  const action=name=>{events.push(name);if(name===failure)throw Error('HOSTED_DEPLOY_SYNTHETIC');};
  const io={inventory:async()=>{action('inventory');return {baseline:baseline()};},guard:async()=>action('guard'),consume:async()=>action('consume'),
    assertSupply:async()=>action('supply'),create:async(n,e,l)=>{action('create');writes++;assert.equal(n,nonce);assert.deepEqual(l,lease(clock()));
      assert.equal(e,new Date(clock()+H.hostingMs).toISOString());return 'new-stack';},stack:async()=>{action('stack');return {StackId:'new-stack',StackStatus:'CREATE_COMPLETE'};},
    observe:async()=>{action('observe');return {verified:true};},counts:()=>({metadata:0,writes}),record:async(n,v)=>{records.push({name:n,value:v});},pause:async()=>{}};
  return {io,m,text,sha:hash(text),events,records};}
test('W8g binds published image, explicit hosted command, three exact immutable versions and no task role',()=>{
  const t=template(nonce),c=t.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  assert.equal(c.Image,IMAGE);assert.deepEqual(c.Command,['node','ops/platform-hosting-v1/start.mjs','--hosted-controller']);
  assert.equal(c.Secrets.length,3);assert(c.Secrets.every(s=>!s.ValueFrom.includes('AWSCURRENT')&&/::[a-f0-9-]{36}$/.test(s.ValueFrom)));
  assert.equal(t.Resources.TaskDefinition.Properties.TaskRoleArn,undefined);assert.equal(Object.keys(t.Resources).length,11);
  assert(Object.values(t.Resources).every(r=>!/^AWS::(?:IAM|SecretsManager|RDS)::/.test(r.Type)));
  const original=hostingTemplate();for(const k of Object.keys(t.Resources).filter(k=>k!=='TaskDefinition'))assert.deepEqual(t.Resources[k],original.Resources[k]);
  const env=Object.fromEntries(c.Environment.map(x=>[x.Name,x.Value]));assert.equal(env.AWS_APPLY_ENABLED,'false');assert.equal(env.DEPLOYMENT_WORKER_ENABLED,'false');
  assert.equal(env.TECHLONG_PLATFORM_REQUEST_WINDOW_V6,'');assert.equal(env.TECHLONG_PLATFORM_CONTROLLER_ENABLED,'true');
  assert.deepEqual(env.TECHLONG_PLATFORM_CONTROLLER_LEASE,{Ref:'ControllerLease'});assert.equal(env.TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT,H.imageSource);
  assert(new RegExp(t.Parameters.HostingExpiresAt.AllowedPattern).test(new Date(now).toISOString()));assert.throws(()=>template('bad'));
});
test('late lease matches real installed release and runtime schema, not operator metadata HEAD; never exceeds 30 minutes',async()=>{
  const l=lease(now);assert.equal(RELEASE_SHA,await sha256Hex(B.platform));assert.equal(l.sourceCommit,H.imageSource);assert.equal(l.expiresAt-now,1800000);
  assert(hostedRuntimeLeaseV6(canonical(l),B.platform,now));assert.equal(hostedRuntimeLeaseV6(canonical(l),B.platform,l.expiresAt),null);
  assert.equal(hostedRuntimeLeaseV6(canonical({...l,expiresAt:l.expiresAt+1}),B.platform,now),null);assert.throws(()=>lease(NaN));
});
test('baseline requires W8d exact roles and versions, prior deletion, accurate ECR config and unchanged 50USD target',()=>{
  assertBaseline(baseline());for(const change of [x=>x.supply.access.defaultVersion='v1',x=>x.supply.app.versions[0].id='other',
    x=>x.supply.pendingChangeSets.push({}),x=>x.hostingNamesAbsent=false,x=>x.previousStackStatus='CREATE_COMPLETE',
    x=>x.image.digest=P.imageDigest,x=>x.image.configDigest='other',x=>x.budget.limitUsd=10,x=>x.retired.active=1]){
    const b=baseline();change(b);assert.throws(()=>assertBaseline(b));}
});
test('raw SHA, whole scope, template, parent evidence and 48-hour approval are bound; audit grants no replay',()=>{
  const m=review(),text=JSON.stringify(m);validate(text,hash(text),now);assert.deepEqual(m.scope,SCOPE);
  assert.equal(m.expiresAt-m.issuedAt,48*3600000);assert.equal(m.latestStartAt,m.expiresAt-1800000);
  for(const change of [x=>x.scope.createStackMax=2,x=>x.constants.slot+='other',x=>x.templateSha256='0'.repeat(64),x=>x.extra=true]){
    const v=structuredClone(m);change(v);const raw=JSON.stringify(v);assert.throws(()=>validate(raw,hash(raw),now));}
  assert.throws(()=>validate(text,'0'.repeat(64),now));assert.throws(()=>validate(text,hash(text),m.latestStartAt));validate(text,hash(text),m.expiresAt+1,true);
});
test('successful deployment does one CreateStack and independent metadata; no business, token or final acceptance claims',async()=>{
  const f=fixture(),r=await run({...f,now:()=>now});assert.equal(r.outcome,'HOSTING_METADATA_VERIFIED_CONTROL_ACCEPTANCE_PENDING');
  assert.equal(f.events.filter(e=>e==='create').length,1);assert(f.events.indexOf('inventory')<f.events.indexOf('consume'));
  assert.equal(r.controlLease.issuedAt,now);assert.equal(r.hostingExpiresAt,new Date(now+7200000).toISOString());
  assert.equal(r.automaticCleanup,false);assert.equal(r.controlAcceptancePassed,false);assert.equal(r.directSecretValueReads,0);
});
test('expired approval, unavailable Source or baseline drift cannot consume slot or create resources',async()=>{
  for(const failure of ['inventory','guard']){const f=fixture(failure);await assert.rejects(run({...f,now:()=>now}));assert(!f.events.includes('consume'));assert(!f.events.includes('create'));}
  const f=fixture();f.io.inventory=async()=>{const b=baseline();b.image.configDigest='other';return {baseline:b};};
  await assert.rejects(run({...f,now:()=>now}));assert(!f.events.includes('consume'));await assert.rejects(run({...fixture(),now:()=>now+49*3600000}));
});
test('post-slot supply failure, unknown ACK, terminal stack or observation failure never retries, deletes or resets',async()=>{
  for(const fail of ['supply','create','observe']){const f=fixture(fail),r=await run({...f,now:()=>now});assert.equal(r.outcome,'HOSTING_REQUIRES_INSPECT_NO_RETRY');
    assert.equal(r.retryAllowed,false);assert(f.events.includes('consume'));assert(f.events.filter(e=>e==='create').length<=1);assert(f.events.includes('observe'));}
  const f=fixture();f.io.stack=async()=>({StackId:'new-stack',StackStatus:'CREATE_FAILED'});assert.equal((await run({...f,now:()=>now})).retryAllowed,false);
});
test('lease is derived after final access read; clock rollback and overrun after permanent consumption fail closed',async()=>{
  let at=now;const f=fixture(undefined,()=>at);f.io.assertSupply=async()=>{at+=60000;};
  const r=await run({...f,now:()=>at});assert.equal(r.controlLease.issuedAt,now+60000);
  for(const delta of [-1,21*60000]){at=now;const f=fixture(undefined,()=>at);f.io.assertSupply=async()=>{at+=delta;};
    const r=await run({...f,now:()=>at});assert.equal(r.outcome,'HOSTING_REQUIRES_INSPECT_NO_RETRY');assert(!f.events.includes('create'));}
});
function physical(){const expected=template(nonce).Resources.TaskDefinition.Properties,c=expected.ContainerDefinitions[0],controlLease=lease(now),
  ids={Service:'service',TaskDefinition:'new-definition',TargetGroup:'target',TaskSecurityGroup:'sg-task'};
  return {ids,nonce,controlLease,service:{serviceArn:ids.Service,status:'ACTIVE',serviceName:P.service,taskDefinition:ids.TaskDefinition,desiredCount:1,runningCount:1,pendingCount:0,
    launchType:'FARGATE',platformVersion:'1.4.0',enableExecuteCommand:false,deployments:[{rolloutState:'COMPLETED'}],loadBalancers:[{targetGroupArn:ids.TargetGroup,containerName:'web',containerPort:3000}],
    networkConfiguration:{awsvpcConfiguration:{assignPublicIp:'ENABLED',subnets:P.subnets,securityGroups:[ids.TaskSecurityGroup]}}},
    definition:{taskDefinitionArn:ids.TaskDefinition,family:P.family,executionRoleArn:P.roleArn,networkMode:'awsvpc',cpu:'512',memory:'1024',requiresCompatibilities:['FARGATE'],
      runtimePlatform:{cpuArchitecture:'X86_64',operatingSystemFamily:'LINUX'},containerDefinitions:[{name:'web',image:IMAGE,command:c.Command,user:'1000:1000',readonlyRootFilesystem:false,
        linuxParameters:c.LinuxParameters,environment:c.Environment.map(e=>({name:e.Name,value:typeof e.Value==='string'?e.Value:canonical(controlLease)})),
        secrets:c.Secrets.map(s=>({name:s.Name,valueFrom:s.ValueFrom}))}]},task:{lastStatus:'RUNNING',healthStatus:'HEALTHY',taskDefinitionArn:ids.TaskDefinition,launchType:'FARGATE',
      containers:[{imageDigest:H.imageDigest,networkInterfaces:[{privateIpv4Address:'172.31.1.10'}]}]},targets:[{Target:{Id:'172.31.1.10',Port:3000},TargetHealth:{State:'healthy'}}]};}
test('physical verification requires explicit command, exact lease/secrets/image, no role or override and healthy target match',()=>{
  const good=physical();good.definition.containerDefinitions[0].linuxParameters={initProcessEnabled:true,capabilities:{drop:['ALL']}};runtime(good);
  for(const change of [x=>x.definition.containerDefinitions[0].command=[],x=>x.definition.containerDefinitions[0].secrets.pop(),
    x=>x.definition.taskRoleArn=P.roleArn,x=>x.task.containers[0].imageDigest=P.imageDigest,x=>x.targets[0].Target.Id='other',
    x=>x.task.overrides={containerOverrides:[{command:['other']}]},x=>x.definition.containerDefinitions[0].environment[0].value='other']){
    const x=structuredClone(good);change(x);assert.throws(()=>runtime(x));}
});
test('credential-free CI and production adapter have no direct private reads, retries, deletes or other mutation commands',async()=>{
  const w=load(await readFile(new URL('../'+H.ciPath,import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read'});
  assert.doesNotMatch(JSON.stringify(w),/secrets\.|id-token|aws-actions|upload-artifact|workflow_dispatch|docker|RunReviewed/);
  const src=await readFile(new URL('../ops/platform-hosted-deploy-v6/cloud.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/GetSecretValueCommand|RunTaskCommand|UpdateStackCommand|DeleteStackCommand|PutResourcePolicyCommand|new pg\./);
  assert.match(src,/maxAttempts:1/);assert.match(src,/DisableRollback:true,TimeoutInMinutes:20/);assert.equal((src.match(/new C\.CreateStackCommand/g)??[]).length,1);
});
