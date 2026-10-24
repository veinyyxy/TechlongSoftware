import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {M,K,H,canonical,observe,permission,rollbackInput,compatibleUpdateDraft,makeReview,validate,recoverOnce} from '../ops/platform-hosted-window-v6/recovery.mjs';
import {windowTemplate,lease} from '../ops/platform-hosted-window-v6/contract.mjs';
const at=Date.parse('2026-10-24T13:00:00Z'),source='a'.repeat(40),nonce='b'.repeat(32);
function fixture(){
  const t=windowTemplate(H.imageSource),ids=Object.fromEntries(Object.keys(t.Resources).map(n=>[n,n==='TaskDefinition'?K.originalDefinition:'fixture-'+n])),
    oldLease=lease(at-7200000),failedLease={...lease(at-3600000),sourceCommit:'c'.repeat(40)},
    tags=[{Key:'Environment',Value:'aws-sandbox'}],creation='2026-10-23T18:58:43.789000+00:00';
  const def={taskDefinitionArn:K.originalDefinition,status:'ACTIVE',containerDefinitions:[{name:'web',image:H.imageDigest,
    environment:[{name:'TECHLONG_PLATFORM_CONTROLLER_LEASE',value:canonical(oldLease)}]}]};
  const svc={serviceArn:'fixture-Service',serviceName:'web',clusterArn:'fixture-Cluster',taskDefinition:K.originalDefinition,
    desiredCount:1,status:'ACTIVE',runningCount:1,pendingCount:0,enableExecuteCommand:false,
    deployments:[{status:'PRIMARY',taskDefinition:K.originalDefinition,rolloutState:'COMPLETED',runningCount:1,pendingCount:0}]};
  const original={stack:{Stacks:[{StackId:K.stackId,StackStatus:'CREATE_COMPLETE',CreationTime:creation,Tags:tags,
    Parameters:[{ParameterKey:'HostingExpiresAt',ParameterValue:K.originalHostingExpiresAt},{ParameterKey:'ControllerLease',ParameterValue:canonical(oldLease)}]}]},
    template:{TemplateBody:t},definition:{taskDefinition:def},service:{services:[svc]}};
  const failedToken='platform-window-'+'d'.repeat(32),failedTemplate=windowTemplate(failedLease.sourceCommit);
  const h={baseline:{ids,tags,oldLease},original,failedToken,failedTemplate,failedLease};
  const root=(id,status,time,token)=>({EventId:id,StackId:K.stackId,PhysicalResourceId:K.stackId,ResourceType:'AWS::CloudFormation::Stack',
    ResourceStatus:status,Timestamp:new Date(time).toISOString(),ClientRequestToken:token});
  const v={observedAt:at,raw:{stack:{Stacks:[{...structuredClone(original.stack.Stacks[0]),StackStatus:'UPDATE_FAILED',DisableRollback:true,
    Parameters:[{ParameterKey:'HostingExpiresAt',ParameterValue:K.originalHostingExpiresAt},{ParameterKey:'ControllerLease',ParameterValue:canonical(failedLease)}]}]},
    resources:{StackResourceSummaries:Object.entries(ids).map(([LogicalResourceId,PhysicalResourceId])=>({LogicalResourceId,PhysicalResourceId,
      ResourceType:t.Resources[LogicalResourceId].Type,ResourceStatus:LogicalResourceId==='TaskDefinition'?'UPDATE_ROLLBACK_COMPLETE':'CREATE_COMPLETE'}))},
    template:{TemplateBody:structuredClone(failedTemplate)},policy:{},changeSets:{Summaries:[]},
    eventHistory:{complete:true,events:[root(M.failedEvent,'UPDATE_FAILED',at-3500000,failedToken),root(M.stableEvent,'CREATE_COMPLETE',at-7200000,'platform-hosted-'+K.originalNonce)]},
    service:{services:[structuredClone(svc)],failures:[]},definition:{taskDefinition:structuredClone(def)},running:{taskArns:['fixture-task']},
    tasks:{tasks:[{taskArn:'fixture-task',taskDefinitionArn:K.originalDefinition,lastStatus:'RUNNING',healthStatus:'HEALTHY',
      containers:[{healthStatus:'HEALTHY',imageDigest:H.imageDigest}]}],failures:[]},
    targets:{TargetHealthDescriptions:[{TargetHealth:{State:'healthy'},Target:{Port:3000}}]},
    definitions:{ACTIVE:{taskDefinitionArns:[K.originalDefinition]},INACTIVE:{taskDefinitionArns:[...H.retiredTaskDefinitions]},DELETE_IN_PROGRESS:{taskDefinitionArns:[]}},
    permission:{truncated:false,evaluations:[{action:'cloudformation:RollbackStack',resource:K.stackId,decision:'allowed',missingContext:[]}]}}};
  const before=observe(v,h,{checkPermission:true}),m=makeReview({sourceCommit:source,pins:Array.from({length:8},(_,i)=>({file:'fixture-'+i,sha256:'e'.repeat(64)})),
    ci:{sourceCommit:source,attempt:1,status:'completed',conclusion:'success'},parents:Array.from({length:10},(_,i)=>({path:'fixture-'+i,rawSha256:'f'.repeat(64)})),
    before,nonce,createdAt:at,compatibility:{executionSourceCommit:source,imageSourceCommit:H.imageSource,protectedRuntimeCodeUnchanged:true}});
  const restored=()=>{const x=structuredClone(v);x.observedAt=at+10000;x.raw.stack.Stacks[0]={...structuredClone(original.stack.Stacks[0]),
    StackStatus:'UPDATE_ROLLBACK_COMPLETE',DisableRollback:true};x.raw.template=structuredClone(original.template);
    x.raw.eventHistory.events.unshift(root('recovery-complete','UPDATE_ROLLBACK_COMPLETE',at+5000,m.request.ClientRequestToken));return x;};
  return {v,h,m,restored};
}
function runner(){const f=fixture(),events=[],records={};let used=false,clock=at,states=['UPDATE_ROLLBACK_IN_PROGRESS','UPDATE_ROLLBACK_COMPLETE'],fail;
  const step=n=>{events.push(n);if(n===fail)throw Error('PRIVATE_PROVIDER_DETAIL');};
  const io={assertSource:async()=>step('source'),snapshot:async p=>{step(p?'before':'after');return p?structuredClone(f.v):f.restored();},
    claim:async()=>{assert.equal(used,false);used=true;step('claim');},record:async(n,v)=>{step('record-'+n);records[n]=v;},
    rollback:async r=>{step('rollback');assert.deepEqual(r,f.m.request);return {StackId:K.stackId};},
    stack:async()=>{step('stack');return {StackId:K.stackId,StackStatus:states.shift()??'UPDATE_ROLLBACK_COMPLETE'};},
    wait:async()=>{step('wait');clock+=10000;}};
  return {...f,io,events,records,fail:n=>{fail=n;},states:s=>{states=s;},run:()=>recoverOnce({manifest:f.m,approved:f.m.manifestSha256,history:f.h,io,now:()=>clock})};
}
test('known failed operation, prior stable event and exact old service are proven without blessing the failed template',()=>{
  const f=fixture(),p=observe(f.v,f.h,{checkPermission:true});assert.equal(p.stackStatus,'UPDATE_FAILED');assert.equal(p.healthy,true);
  assert.equal(p.controlLeaseUnchangedAndExpired,true);assert.equal(p.taskDefinition,K.originalDefinition);
});
test('before gates reject identity, missing prior stable state, intervening operations and incomplete history',()=>{
  for(const change of [x=>{x.stack.Stacks[0].StackId='wrong';},x=>{x.stack.Stacks[0].RoleARN='arbitrary';},x=>{x.stack.Stacks[0].StackStatus='CREATE_FAILED';},
    x=>{x.stack.Stacks[0].DisableRollback=false;},x=>{x.eventHistory.complete=false;},x=>{x.eventHistory.events.pop();},
    x=>{x.eventHistory.events[0].EventId='another-operation';},x=>{x.eventHistory.events[1].ResourceStatus='CREATE_FAILED';},
    x=>{x.resources.StackResourceSummaries.pop();},x=>{x.resources.StackResourceSummaries[0].PhysicalResourceId='moved';},
    x=>{x.resources.StackResourceSummaries[0].ResourceStatus='DELETE_IN_PROGRESS';},x=>{x.template.TemplateBody.Description='changed';},
    x=>{x.stack.Stacks[0].Parameters[1].ParameterValue='{}';},x=>{x.changeSets.Summaries=[{}];},x=>{x.policy={StackPolicyBody:'{}'};}]){
    const f=fixture();change(f.v.raw);assert.throws(()=>observe(f.v,f.h,{checkPermission:true}));}
});
test('health, pinned definition, no new revision and permission checks cannot be replaced with mere stack status',()=>{
  for(const change of [x=>{x.service.services[0].pendingCount=1;},x=>{x.service.services[0].taskDefinition='new';},
    x=>{x.service.services[0].enableExecuteCommand=true;},x=>{x.tasks.tasks[0].healthStatus='UNHEALTHY';},
    x=>{x.targets.TargetHealthDescriptions[0].TargetHealth.State='unhealthy';},x=>{x.definition.taskDefinition.containerDefinitions[0].environment=[];},
    x=>{x.definitions.ACTIVE.taskDefinitionArns.push('unexpected');},x=>{x.definitions.INACTIVE.nextToken='incomplete';},
    x=>{x.permission.evaluations[0].decision='implicitDeny';},x=>{x.permission.evaluations[0].missingContext=['unknown'];}]){
    const f=fixture();change(f.v.raw);assert.throws(()=>observe(f.v,f.h,{checkPermission:true}));}
  assert.throws(()=>permission({truncated:true,evaluations:[]}));
});
test('new review permits one exact rollback, no update/new lease/deploy; 48h review is not a short control window',()=>{
  const {m}=fixture();assert.equal(validate(m,m.manifestSha256,at),m);assert.deepEqual(m.request,rollbackInput(nonce));
  assert.deepEqual(Object.keys(m.request).sort(),['ClientRequestToken','StackName']);assert.equal(m.scope.rollbackStackMax,1);
  assert.equal(m.scope.newUpdateStack,0);assert.equal(m.scope.newLease,0);assert.equal(m.scope.newIam,0);assert.equal(m.scope.workflowDispatches,0);
  assert.equal(m.expiresAt-m.createdAt,48*3600000);assert.equal(m.expiresAt-m.latestStartAt,M.runMs);
  assert.throws(()=>validate(m,'wrong',at));assert.throws(()=>validate(m,m.manifestSha256,m.latestStartAt));
  for(const mutate of [x=>{x.scope.newUpdateStack=1;},x=>{x.request.RoleARN='arbitrary';},x=>{x.request.RetainExceptOnCreate=true;},x=>{x.nonce='short';}]){
    const b=structuredClone(m);mutate(b);assert.throws(()=>validate(b,m.manifestSha256,at));}
});
test('replacement-compatible update is an unexecuted draft using normal rollback, never disable rollback',()=>{
  const r=compatibleUpdateDraft(source,nonce,at);assert.equal(r.DisableRollback,false);assert.equal(r.StackName,K.stackId);
  assert.equal(JSON.parse(r.Parameters[1].ParameterValue).sourceCommit,source);
  assert.equal(JSON.parse(r.Parameters[1].ParameterValue).expiresAt-at,1800000);assert.throws(()=>compatibleUpdateDraft('main',nonce,at));
});
test('recovered means own token, restored old template/parameters, unchanged identity and old expired runtime',()=>{
  const f=fixture(),x=f.restored(),opts={recovered:true,token:f.m.request.ClientRequestToken,intentAt:at};
  assert.equal(observe(x,f.h,opts).stackStatus,'UPDATE_ROLLBACK_COMPLETE');assert.equal(x.raw.stack.Stacks[0].StackStatus,'UPDATE_ROLLBACK_COMPLETE');
  for(const change of [v=>{v.eventHistory.events[0].ClientRequestToken='foreign';},v=>{v.template.TemplateBody=f.h.failedTemplate;},
    v=>{v.stack.Stacks[0].Parameters[1].ParameterValue=canonical(f.h.failedLease);},v=>{v.service.services[0].taskDefinition='new';}]){
    const y=f.restored();change(y.raw);assert.throws(()=>observe(y,f.h,opts));}
});
test('one claim precedes one rollback, evidence persists and metadata success still needs independent inspect',async()=>{
  const f=runner(),r=await f.run();assert.equal(r.outcome,'HOSTED_RECOVERY_STABLE_METADATA_VERIFIED_INSPECT_PENDING');
  assert.equal(r.newLease,false);assert.equal(r.workflowDispatched,false);assert.equal(r.retryAllowed,false);
  assert.ok(f.events.indexOf('claim')<f.events.indexOf('rollback'));assert.equal(f.events.filter(n=>n==='rollback').length,1);
  assert.equal(f.records['rollback-intent'].request.ClientRequestToken,f.m.request.ClientRequestToken);
  await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='rollback').length,1);
});
test('preclaim drift writes nothing; postclaim ambiguity never causes a second rollback, update or cleanup',async()=>{
  const before=runner();before.v.raw.permission.evaluations[0].decision='explicitDeny';await assert.rejects(before.run());assert.equal(before.events.includes('claim'),false);
  for(const point of ['record-rollback-intent','rollback','record-rollback-ack','stack','after','record-observed']){
    const f=runner();f.fail(point);const r=await f.run();assert.equal(r.outcome,'HOSTED_RECOVERY_REQUIRES_INSPECT_NO_RETRY');
    assert.equal(r.retryAllowed,false);assert.ok(f.events.filter(n=>n==='rollback').length<=1);assert.doesNotMatch(canonical(r),/PRIVATE_PROVIDER_DETAIL/);}
});
test('rollback failure/backwards progress stops; early eventual consistency does not resubmit',async()=>{
  for(const s of [['UPDATE_ROLLBACK_FAILED'],['UPDATE_ROLLBACK_IN_PROGRESS','UPDATE_FAILED']]){
    const f=runner();f.states(s);assert.equal((await f.run()).outcome,'HOSTED_RECOVERY_REQUIRES_INSPECT_NO_RETRY');
    assert.equal(f.events.filter(n=>n==='rollback').length,1);}
  const f=runner();f.states(['UPDATE_FAILED','UPDATE_ROLLBACK_IN_PROGRESS','UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS','UPDATE_ROLLBACK_COMPLETE']);
  assert.equal((await f.run()).outcome,'HOSTED_RECOVERY_STABLE_METADATA_VERIFIED_INSPECT_PENDING');
});
test('concrete recovery entry cannot update stack, install IAM, directly delete or fetch any private value',async()=>{
  const text=await readFile(new URL('../ops/platform-hosted-window-v6/recovery-cloud.mjs',import.meta.url),'utf8');
  assert.equal((text.match(/new RollbackStackCommand/g)??[]).length,1);assert.match(text,/maxAttempts:1/);assert.match(text,/counts\.writes===0/);
  assert.doesNotMatch(text,/UpdateStackCommand|DeleteStackCommand|ContinueUpdateRollbackCommand|SetStackPolicyCommand|UpdateServiceCommand|GetSecretValueCommand|from ['"]pg['"]|workflow_dispatch/);
  const local=await readFile(new URL('../ops/platform-hosted-window-v6/recovery-local.mjs',import.meta.url),'utf8');
  assert.match(local,/M\.closureSha/);assert.match(local,/readLocalCiV6/);assert.match(local,/M\.inspectSlot/);
  assert.doesNotMatch(local,/unlink\(|rm\(|rename\(|\.env|\.pem|GetSecretValueCommand/);
});
