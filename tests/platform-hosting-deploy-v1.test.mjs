import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {P,B,SCOPE,hash,canonical,template,assertAccess,assertInventory} from '../ops/platform-hosting-deploy-v1/contract.mjs';
import {hostingTemplate} from '../ops/platform-ecs-v1/templates.mjs';
import {assertRuntime,assertGroups} from '../ops/platform-hosting-deploy-v1/cloud.mjs';
import {deployHosting} from '../ops/platform-hosting-deploy-v1/deploy.mjs';
import {SOURCES,ARTIFACTS,RISK,CI_PATH,validate,main} from '../ops/platform-hosting-deploy-v1/local.mjs';
const nonce='a'.repeat(32),issued='2026-10-23T02:00:00.000Z',time=Date.parse(issued);
const access=()=>({stackId:B.accessStackId,stackStatus:'CREATE_COMPLETE',roleId:B.roleId,roleArn:P.roleArn,boundaryId:B.boundaryId,boundaryArn:P.boundaryArn,defaultVersion:'v1'});
const inventory=()=>({source:{Account:P.account,Arn:P.sourceArn,UserId:P.sourceId},access:access(),secret:{arn:P.secretArn,versionId:P.secretVersion},image:{digest:P.imageDigest},hostingNamesAbsent:true,budget:{limitUsd:50},network:{vpc:P.vpc},serviceLinkedRoles:[{id:'reviewed'}]});
const manifest=()=>({schema:'techlong/platform-hosting-deployment-review/v1',sourceCommit:'b'.repeat(40),nonce,issuedAt:issued,expiresAt:'2026-10-25T02:00:00.000Z',latestStartAt:'2026-10-25T01:30:00.000Z',
  constants:{...P},accessBinding:{...B},scope:{...SCOPE},templateSha256:hash(canonical(template(nonce))),sourcePins:SOURCES.map(file=>({file,sha256:'c'.repeat(64)})),riskSha256:'c'.repeat(64),
  artifactDirectory:'F:/ChatGPT_workshop/techlong-platform-hosting-review-'+nonce,artifactPins:ARTIFACTS.map(name=>({name,sha256:'d'.repeat(64)})),inventory:inventory(),
  ciReceipt:{file:'F:/ChatGPT_workshop/techlong-platform-hosting-ci-123.json',runId:123,sha256:'e'.repeat(64)}});
function runtime(){const p=hostingTemplate().Resources.TaskDefinition.Properties,c=p.ContainerDefinitions[0],ids={Service:'service-arn',TaskDefinition:'td-arn',TargetGroup:'tg-arn',TaskSecurityGroup:'sg-task',AlbSecurityGroup:'sg-alb'};
  return {ids,service:{serviceArn:ids.Service,status:'ACTIVE',serviceName:P.service,taskDefinition:ids.TaskDefinition,desiredCount:1,runningCount:1,pendingCount:0,launchType:'FARGATE',platformVersion:'1.4.0',enableExecuteCommand:false,
    deployments:[{rolloutState:'COMPLETED'}],loadBalancers:[{targetGroupArn:ids.TargetGroup,containerName:'web',containerPort:3000}],networkConfiguration:{awsvpcConfiguration:{assignPublicIp:'ENABLED',subnets:[...P.subnets],securityGroups:[ids.TaskSecurityGroup]}}},
  definition:{taskDefinitionArn:ids.TaskDefinition,family:P.family,executionRoleArn:P.roleArn,networkMode:'awsvpc',cpu:'512',memory:'1024',requiresCompatibilities:['FARGATE'],runtimePlatform:{cpuArchitecture:'X86_64',operatingSystemFamily:'LINUX'},
    containerDefinitions:[{name:'web',image:P.image,user:'1000:1000',readonlyRootFilesystem:false,linuxParameters:{initProcessEnabled:true,capabilities:{drop:['ALL']}},environment:c.Environment.map(e=>({name:e.Name,value:e.Value})),secrets:[{name:'DATABASE_URL',valueFrom:c.Secrets[0].ValueFrom}]}]},
  task:{lastStatus:'RUNNING',healthStatus:'HEALTHY',taskDefinitionArn:ids.TaskDefinition,launchType:'FARGATE',containers:[{imageDigest:P.imageDigest,networkInterfaces:[{privateIpv4Address:'172.31.0.1'}]}]},
  targets:[{Target:{Id:'172.31.0.1',Port:3000},TargetHealth:{State:'healthy'}}]};}
test('new template preserves all eleven draft resources and parameters; binds real access identity with metadata only',()=>{
  const t=template(nonce),draft=hostingTemplate();assert.deepEqual(t.Resources,draft.Resources);assert.deepEqual(t.Parameters,draft.Parameters);assert.equal(Object.keys(t.Resources).length,11);
  assert.equal(t.Metadata.ExecutionRoleId,B.roleId);assert.equal(t.Metadata.BoundaryId,B.boundaryId);assert.equal(t.Metadata.ReviewNonce,nonce);
  assert(new RegExp(t.Parameters.HostingExpiresAt.AllowedPattern).test(issued));assert(!new RegExp(t.Parameters.HostingExpiresAt.AllowedPattern).test('tomorrow'));
  assert(Object.values(t.Resources).every(r=>!/^AWS::(?:IAM|SecretsManager|RDS)::/.test(r.Type)));assert.throws(()=>template('bad'));
});
test('actual access IDs and frozen successful parent evidence are bound, not recreated',async()=>{
  const o=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/platform-ecs-w7n.observed.json',import.meta.url),'utf8'));
  assert.equal(o.productionRun.outcome,'ACCESS_HANDOFF_INDEPENDENTLY_VERIFIED');assert.equal(o.productionRun.stackId,B.accessStackId);
  assert.equal(o.productionRun.roleId,B.roleId);assert.equal(o.productionRun.boundaryId,B.boundaryId);assert.equal(o.productionRun.manifest.sha256,B.parentManifestSha256);
  assertAccess(access());const changed=access();changed.roleId='different';assert.throws(()=>assertAccess(changed));
});
test('runtime checks require exact image/Secret/env/role, one healthy task and matching target IP',()=>{
  assertRuntime(runtime());for(const change of [x=>x.definition.taskRoleArn='unexpected',x=>x.definition.containerDefinitions[0].secrets[0].valueFrom='other',
    x=>x.definition.containerDefinitions[0].environment.push({name:'AWS_ACCESS_KEY_ID',value:'not-real'}),x=>x.task.containers[0].imageDigest='other',
    x=>x.service.enableExecuteCommand=true,x=>x.service.networkConfiguration.awsvpcConfiguration.securityGroups=['sg-other'],x=>x.targets[0].Target.Id='other',
    x=>x.task.overrides={taskRoleArn:'other'}]){const x=runtime();change(x);assert.throws(()=>assertRuntime(x));}
});
test('physical SG rules reject any wider inbound, IPv6 or outbound rule',()=>{
  const ids=runtime().ids,rule=(port,peer)=>({IpProtocol:'tcp',FromPort:port,ToPort:port,IpRanges:peer?[]:[{CidrIp:'0.0.0.0/0'}],UserIdGroupPairs:peer?[{GroupId:peer,UserId:P.account}]:[]});
  const groups=[{GroupId:ids.TaskSecurityGroup,VpcId:P.vpc,IpPermissions:[rule(3000,ids.AlbSecurityGroup)],IpPermissionsEgress:[rule(443)]},
    {GroupId:ids.AlbSecurityGroup,VpcId:P.vpc,IpPermissions:[rule(443)],IpPermissionsEgress:[rule(3000,ids.TaskSecurityGroup)]}];assertGroups(groups,ids);
  groups[0].IpPermissions.push(rule(3000));assert.throws(()=>assertGroups(groups,ids));
});
function ioFor(failure,clock=()=>time){const events=[],records=[],c={counts:{reads:0,writes:0},source:async()=>{events.push('source');if(failure==='source')throw Error('expired');},
  inventory:async()=>{events.push('preflight');const x=inventory();if(failure==='preflight')x.access.roleId='other';return x;},
  assertAccessFresh:async()=>{events.push('access');if(failure==='access')throw Error('drift');},
  create:async(n,e)=>{events.push('create');c.counts.writes++;assert.equal(n,nonce);assert.equal(e,new Date(clock()+2*3600000).toISOString());if(failure==='create')throw Error('ACK unknown');return 'stack-arn';},
  stack:async()=>({StackId:'stack-arn',StackStatus:failure==='terminal'?'CREATE_FAILED':'CREATE_COMPLETE'}),
  observe:async()=>{events.push('observe');if(failure==='observe')throw Error('unavailable');return {verified:failure!=='create'};}};
  return {events,records,cloud:c,consume:async()=>events.push('consume'),record:async(n,v)=>records.push({name:n,value:v}),pause:async()=>{}};}
test('exactly one CreateStack, late-derived two-hour time and independent metadata; never HTTP/SQL or acceptance claim',async()=>{
  const io=ioFor(null),r=await deployHosting({manifest:manifest(),sha:'f'.repeat(64),io,now:()=>time});assert.equal(r.outcome,'HOSTING_METADATA_VERIFIED_APPLICATION_ACCEPTANCE_PENDING');
  assert.equal(io.events.filter(e=>e==='create').length,1);assert(io.events.indexOf('preflight')<io.events.indexOf('consume'));assert(io.events.includes('observe'));
  assert.equal(r.hostingExpiresAt,'2026-10-23T04:00:00.000Z');assert.equal(r.applicationAcceptancePassed,false);assert.equal(r.directSecretValueReads,0);assert.equal(r.directSqlConnections,0);assert.equal(r.directHttpRequests,0);assert.equal(r.automaticCleanup,false);
});
test('ambiguous create, terminal failure, role drift or independent-read failure never triggers another write or cleanup',async()=>{
  for(const failure of ['create','terminal','access','observe']){const io=ioFor(failure),r=await deployHosting({manifest:manifest(),sha:'f'.repeat(64),io,now:()=>time});
    assert.equal(r.outcome,'HOSTING_REQUIRES_REVIEW_NO_RETRY');assert.equal(r.retryAllowed,false);assert(io.events.filter(e=>e==='create').length<=1);assert(io.events.includes('observe'));assert(io.records.some(r=>r.name==='result'));}
});
test('Source/preflight failure cannot consume the intent or submit CreateStack',async()=>{
  for(const failure of ['source','preflight']){const io=ioFor(failure);await assert.rejects(deployHosting({manifest:manifest(),sha:'f'.repeat(64),io,now:()=>time}));assert(!io.events.includes('consume'));assert(!io.events.includes('create'));}
});
test('time overrun after intent consumption fails closed, keeps attempt and still observes',async()=>{
  let now=time;const io=ioFor(null,()=>now);io.cloud.assertAccessFresh=async()=>{now+=21*60000;};const r=await deployHosting({manifest:manifest(),sha:'f'.repeat(64),io,now:()=>now});
  assert.equal(r.outcome,'HOSTING_REQUIRES_REVIEW_NO_RETRY');assert(io.events.includes('consume'));assert(!io.events.includes('create'));assert(io.events.includes('observe'));
});
test('fresh inventory cannot replace reviewed network or service-linked identity; hosting must remain absent',()=>{
  assertInventory(inventory(),inventory());for(const change of [x=>x.network.vpc='other',x=>x.serviceLinkedRoles[0].id='recreated',x=>x.hostingNamesAbsent=false]){
    const x=inventory();change(x);assert.throws(()=>assertInventory(x,inventory()));}
});
test('raw SHA, scope, actual RoleId, template, pins and 48h/30m window are binding',async()=>{
  const m=manifest(),raw=JSON.stringify(m);validate(raw,hash(raw),time);assert.throws(()=>validate(raw,'0'.repeat(64),time));assert.throws(()=>validate(raw,hash(raw),Date.parse(m.latestStartAt)));
  for(const change of [x=>x.scope.cloudFormationCreateStack=2,x=>x.accessBinding.roleId='other',x=>x.constants.secretVersion='other',x=>x.templateSha256='0'.repeat(64),x=>x.sourcePins.pop(),x=>x.artifactPins.pop()]){
    const x=structuredClone(m);change(x);const text=JSON.stringify(x);assert.throws(()=>validate(text,hash(text),time));}
  await assert.rejects(main(['DeployReviewed','invalid','a'.repeat(64)]),/DEPLOY_ARGUMENTS/);assert(SOURCES.includes(RISK));
});
test('No-AWS CI has no credentials, deploy dispatch, uploads, billing or image build',async()=>{
  const w=load(await readFile(new URL('../'+CI_PATH,import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.candidate.environment,undefined);
  assert.doesNotMatch(JSON.stringify(w),/secrets\.|id-token|aws-actions|upload-artifact|workflow_dispatch|docker|DeployReviewed/);
  const c=await readFile(new URL('../ops/platform-hosting-deploy-v1/cloud.mjs',import.meta.url),'utf8');assert.doesNotMatch(c,/GetSecretValueCommand|RunTaskCommand|UpdateStackCommand|DeleteStackCommand|PutResourcePolicyCommand|new pg\./);
  assert.match(c,/DisableRollback:true,TimeoutInMinutes:20/);assert.doesNotMatch(c,/CAPABILITY_NAMED_IAM/);console.log('PLATFORM_HOSTING_DEPLOYMENT_CONTRACTS_VERIFIED_NO_AWS');
});
