import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {Q,assertRetiredHosting} from '../ops/platform-hosting-deploy-v1/trial-v2.mjs';
import {P,B,SCOPE,hash,canonical,template,assertInventory} from '../ops/platform-hosting-deploy-v1/contract.mjs';
import {validate,NEXT_SOURCES,NEXT_RISK,NEXT_SLOT,SLOT,CI_PATH,main} from '../ops/platform-hosting-deploy-v1/local.mjs';
import {deployHosting} from '../ops/platform-hosting-deploy-v1/deploy.mjs';
const nonce='1'.repeat(32),issued='2026-10-23T05:00:00.000Z',time=Date.parse(issued);
const clusterArn=`arn:aws:ecs:${P.region}:${P.account}:cluster/${P.cluster}`;
const serviceArn=`arn:aws:ecs:${P.region}:${P.account}:service/${P.cluster}/${P.service}`;
function retired(){return {stack:{StackId:Q.previousStackId,StackStatus:'DELETE_COMPLETE'},
  cluster:{clusters:[{clusterArn,clusterName:P.cluster,status:'INACTIVE',runningTasksCount:0,pendingTasksCount:0,activeServicesCount:0,registeredContainerInstancesCount:0}],failures:[]},
  service:{services:[{serviceArn,serviceName:P.service,status:'INACTIVE',desiredCount:0,runningCount:0,pendingCount:0}],failures:[]},
  definition:{taskDefinitionArn:Q.previousTaskDefinition,family:P.family,status:'INACTIVE'},
  definitions:{ACTIVE:{taskDefinitionArns:[]},INACTIVE:{taskDefinitionArns:[Q.previousTaskDefinition]},DELETE_IN_PROGRESS:{taskDefinitionArns:[]}}};}
function inventory(){return {source:{Account:P.account,Arn:P.sourceArn,UserId:P.sourceId},
  access:{stackId:B.accessStackId,stackStatus:'CREATE_COMPLETE',roleId:B.roleId,roleArn:P.roleArn,boundaryId:B.boundaryId,boundaryArn:P.boundaryArn,defaultVersion:'v1'},
  secret:{arn:P.secretArn,versionId:P.secretVersion},image:{digest:P.imageDigest},hostingNamesAbsent:true,budget:{limitUsd:50},
  network:{vpc:P.vpc},serviceLinkedRoles:[{id:'fixed'}],retiredHosting:assertRetiredHosting(retired())};}
function manifest(){return {schema:'techlong/platform-hosting-deployment-review/v2',sourceCommit:'b'.repeat(40),nonce,
  issuedAt:issued,expiresAt:'2026-10-25T05:00:00.000Z',latestStartAt:'2026-10-25T04:30:00.000Z',constants:{...P},accessBinding:{...B},scope:{...SCOPE},trialBinding:{...Q},
  inventory:inventory(),templateSha256:hash(canonical(template(nonce,true))),sourcePins:NEXT_SOURCES.map(file=>({file,sha256:'c'.repeat(64)})),riskSha256:'c'.repeat(64),
  artifactDirectory:'F:/ChatGPT_workshop/techlong-platform-hosting-review-'+nonce,
  artifactPins:['hosting-template.json','inventory.json','prices.json','service-validation.json'].map(name=>({name,sha256:'d'.repeat(64)})),
  ciReceipt:{file:'F:/ChatGPT_workshop/techlong-platform-hosting-ci-123.json',runId:123,sha256:'e'.repeat(64)}};}
test('second trial changes metadata only, retains eleven resources, fixed image/access and all closed bindings',()=>{
  const old=template(nonce),next=template(nonce,true);assert.deepEqual(next.Resources,old.Resources);assert.deepEqual(next.Parameters,old.Parameters);
  assert.equal(next.Metadata.ReviewPhase,'W7q');assert.equal(next.Metadata.TrialGeneration,2);assert.equal(next.Metadata.PreviousStackId,Q.previousStackId);
  assert.equal(next.Metadata.CleanupManifestSha256,Q.cleanupManifestSha256);assert.equal(old.Metadata.ReviewPhase,'W7o');
  assert.equal(next.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Image,P.image);assert.equal(Object.keys(next.Resources).length,11);
  assert.throws(()=>template(nonce,'true'));assert.throws(()=>template(nonce,2));
});
test('only exact retired stack/cluster/service/task revision are accepted, not arbitrary INACTIVE resources',()=>{
  const r=assertRetiredHosting(retired());assert.equal(r.generation,2);assert.equal(r.clusterState,'INACTIVE');assert.equal(r.previousTaskDefinitionStatus,'INACTIVE');
  for(const change of [x=>x.stack.StackId+='other',x=>x.stack.StackStatus='CREATE_COMPLETE',x=>x.cluster.clusters[0].status='ACTIVE',
    x=>x.cluster.clusters[0].runningTasksCount=1,x=>x.cluster.clusters[0].registeredContainerInstancesCount=1,x=>x.cluster.clusters[0].clusterArn+='other',
    x=>x.service.services[0].desiredCount=1,x=>x.service.services[0].status='ACTIVE',x=>x.service.services[0].serviceArn+='other',
    x=>x.definition.status='ACTIVE',x=>x.definition.taskDefinitionArn=Q.previousTaskDefinition.replace(':1',':2'),
    x=>x.definitions.ACTIVE.taskDefinitionArns.push(Q.previousTaskDefinition),x=>x.definitions.INACTIVE.taskDefinitionArns.push(Q.previousTaskDefinition.replace(':1',':2')),
    x=>x.definitions.DELETE_IN_PROGRESS.taskDefinitionArns.push(Q.previousTaskDefinition),x=>x.definitions.INACTIVE.nextToken='more',x=>delete x.definitions.ACTIVE]){
    const x=retired();change(x);assert.throws(()=>assertRetiredHosting(x));}
});
test('known retired metadata may disappear, but contradictory or unknown absence is rejected',()=>{
  const x=retired();x.cluster={clusters:[],failures:[{arn:P.cluster,reason:'MISSING'}]};x.service={clusterNotFound:true};x.definition={absent:true};x.definitions.INACTIVE.taskDefinitionArns=[];
  const s=assertRetiredHosting(x);assert.equal(s.clusterState,'MISSING');assert.equal(s.serviceState,'MISSING');assert.equal(s.previousTaskDefinitionStatus,'ABSENT');
  const bad=structuredClone(x);bad.cluster.failures[0].arn='unknown';assert.throws(()=>assertRetiredHosting(bad));
  const conflict=structuredClone(x);conflict.definitions.INACTIVE.taskDefinitionArns=[Q.previousTaskDefinition];assert.throws(()=>assertRetiredHosting(conflict));
  const noFailure=structuredClone(x);noFailure.cluster.failures=[];assert.throws(()=>assertRetiredHosting(noFailure));
});
test('review SHA, generation binding, new source/risk pins and explicit mode cannot cross into legacy approval',async()=>{
  const m=manifest(),raw=JSON.stringify(m);validate(raw,hash(raw),time,true);assert.throws(()=>validate(raw,hash(raw),time));
  assert.throws(()=>validate(raw,'0'.repeat(64),time,true));assert.throws(()=>validate(raw,hash(raw),Date.parse(m.latestStartAt),true));
  for(const change of [x=>x.trialBinding.generation=1,x=>x.trialBinding.cleanupManifestSha256='0'.repeat(64),x=>delete x.trialBinding,
    x=>x.inventory.retiredHosting.activeDefinitions=1,x=>x.inventory.retiredHosting.previousStackId+='other',
    x=>x.scope.cloudFormationCreateStack=2,x=>x.sourcePins.pop(),x=>x.constants.secretVersion='different',x=>x.templateSha256=hash(canonical(template(nonce)))]){
    const x=manifest();change(x);const text=JSON.stringify(x);assert.throws(()=>validate(text,hash(text),time,true));}
  assert(NEXT_SOURCES.includes(NEXT_RISK));assert(NEXT_SOURCES.includes(Q.cleanupObservedFile));assert.notEqual(NEXT_SLOT,SLOT);
  await assert.rejects(main(['DeployTrial2Reviewed','invalid','a'.repeat(64)]),/DEPLOY_ARGUMENTS/);
  await assert.rejects(main(['DeployTrial3Reviewed','invalid','a'.repeat(64)]),/ARGS/);
});
test('retired summary is part of reviewed live baseline; propagation does not silently change it',()=>{
  assertInventory(inventory(),inventory());const changed=inventory();changed.retiredHosting.clusterState='MISSING';assert.throws(()=>assertInventory(changed,inventory()));
  const omitted=inventory();delete omitted.retiredHosting;assert.throws(()=>assertInventory(omitted,inventory()));
});
test('second trial reuses single-create coordinator and still makes no direct login/SQL/Secret call',async()=>{
  const calls=[],records=[],c={counts:{reads:0,writes:0},source:async()=>{},inventory:async()=>inventory(),assertAccessFresh:async()=>{},
    create:async()=>{calls.push('create');c.counts.writes++;return 'new-stack';},stack:async()=>({StackId:'new-stack',StackStatus:'CREATE_COMPLETE'}),observe:async()=>({verified:true})};
  const io={cloud:c,consume:async()=>calls.push('consume'),record:async(name,value)=>records.push({name,value}),pause:async()=>{}};
  const result=await deployHosting({manifest:manifest(),sha:'f'.repeat(64),io,now:()=>time});
  assert.deepEqual(calls,['consume','create']);assert.equal(result.trialGeneration,2);assert.equal(result.awsCalls.writes,1);
  assert.equal(result.applicationAcceptancePassed,false);assert.equal(result.directHttpRequests,0);assert.equal(result.directSqlConnections,0);assert.equal(result.directSecretValueReads,0);
  assert.equal(result.automaticCleanup,false);assert.equal(result.retryAllowed,false);assert(records.some(x=>x.name==='independent-observation'));
  c.inventory=async()=>{const x=inventory();x.retiredHosting.clusterState='MISSING';return x;};calls.length=0;
  await assert.rejects(deployHosting({manifest:manifest(),sha:'f'.repeat(64),io,now:()=>time}));assert.deepEqual(calls,[]);
});
test('cleanup parent is a preserved verified projection, not a claim of current online state',async()=>{
  const text=(await readFile(new URL('../'+Q.cleanupObservedFile,import.meta.url),'utf8')).replaceAll('\r\n','\n'),p=JSON.parse(text);
  assert.equal(hash(text),Q.cleanupObservedSha256);assert.equal(p.status,'HOSTING_CLEANUP_INDEPENDENTLY_VERIFIED');assert.equal(p.targetStackId,Q.previousStackId);
  assert.equal(p.approvedManifest.sha256,Q.cleanupManifestSha256);assert.equal(p.limits.authenticatedApplicationAcceptancePassed,false);
});
test('existing No-AWS workflow tests both generations without deployment, secrets, artifacts or new workflow',async()=>{
  const w=load(await readFile(new URL('../'+CI_PATH,import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read'});
  assert.equal(w.jobs.candidate.environment,undefined);assert.match(JSON.stringify(w),/platform-hosting-trial-v2.test.mjs/);
  assert.doesNotMatch(JSON.stringify(w),/secrets\.|id-token|aws-actions|upload-artifact|workflow_dispatch|docker|DeployTrial2Reviewed/);
  console.log('PLATFORM_HOSTING_SECOND_TRIAL_CONTRACTS_VERIFIED_NO_AWS');
});
