import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';

import {ROOT_CLOSURE_V5} from '../ops/cloud-worker/activation/runtime-v5.mjs';
import {ECS_ABSENCE_PUBLICATION_V5 as V,prepareEcsAbsencePublicationV5,assertEcsAbsencePublicationApprovalV5,
  publishEcsAbsenceV5,verifyEcsAbsencePublicationChangeSetV5,ecsAbsenceTrustChangeV5} from '../ops/cloud-worker/ecs-absence-publication-v5.mjs';
const P=V;
const capsule=JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8'));
const now=1800000000000,source={commit:'a'.repeat(40),runtimeClosureSha256:ROOT_CLOSURE_V5,files:Array.from({length:152},(_,i)=>({file:'fixture-'+i,normalizedLfSha256:'f'.repeat(64)}))},
  release={sourceCommit:source.commit,runtimeCommit:source.commit,reusable:{commit:'b'.repeat(40),parent:source.commit},caller:{commit:'c'.repeat(40),parent:'b'.repeat(40)}},
  history={ecsFixVerified:true,historicalSourcePinsVerified:142,oldRecordsAndSlotsPreserved:true,failedReviewRunId:'39149802733'},prestate={main:source.commit,roleId:V.roleId,tableId:P.tableId,templateMatchesOld:true,installedReusable:V.oldReusable,unfinishedDeploymentRuns:0,sourceCiConfirmed:true,
    environment:{environmentId:P.environmentId,requiredReviewerId:14145707,adminBypass:false,mainBranchOnly:true},metadataSha256:'d'.repeat(64)},
  context={source,history,release,prestate,capsule,now};
async function fixture(){
  const m=await prepareEcsAbsencePublicationV5(context),events=[];let occupied=false,failure;
  const io={preflight:async()=>{events.push('preflight');return prestate;},consumeSlot:async()=>{assert.equal(occupied,false);occupied=true;events.push('slot');},
    assertLocalSource:async()=>{},record:async name=>events.push(name),counts:()=>({}),
    publishRelease:async(_,guard)=>{await guard();events.push('push');if(failure==='push')throw Error('Unknown push ACK');return {main:release.caller.commit};},
    verifyLayout:async(_,state,head,label)=>{events.push(label);if(failure===label)throw Error('Layout drift');return {state,head};},
    createChangeSet:async(_,guard)=>{await guard();events.push('create');if(failure==='create')throw Error('Unknown Create ACK');return {changeSetId:'fixed'};},
    waitChangeSet:async()=>{events.push('verify-change');if(failure==='verify-change')throw Error('Not trust-only');return {};},
    executeChangeSet:async(_,__,guard)=>{await guard();events.push('execute');if(failure==='execute')throw Error('Unknown Execute ACK');return {};},
    waitFoundation:async()=>{events.push('wait');if(failure==='wait')throw Error('Pending');},syncLocalMain:async()=>events.push('sync')};
  return {m,events,io,fail:phase=>{failure=phase;},run:()=>publishEcsAbsenceV5({manifest:m,approved:m.manifestSha256,context,io,now:()=>now})};
}
test('new execution-review schema binds only three remote writes, one local FF, exact ACK rule and no deployment authority',async()=>{
  const m=await prepareEcsAbsencePublicationV5(context),{manifestSha256,...body}=m;
  assert.equal(await sha256Hex(body),manifestSha256);assert.equal(m.permanentSlot,P.slot);assert.equal(m.preparationIsNotExecutionApproval,true);
  assert.equal(m.effects.preparedMainFastForward,1);assert.equal(m.effects.foundationChangeSetCreate,1);assert.equal(m.effects.foundationChangeSetExecute,1);
  for(const k of ['permissionExpansion','newIamResources','secretValueReads','workflowDispatches','jobClaims','workloadCreates','automaticWriteRetries'])assert.equal(m.effects[k],0);
  assert.match(m.actions.foundation.execute.ChangeSetName,/ONLY_EXACT_ARN_RETURNED/);assert.ok(m.actions.foundation.execute.ClientRequestToken);
  await assertEcsAbsencePublicationApprovalV5(m,m.manifestSha256,context,now);
});
test('old preparation SHA/schema, wrong SHA, expired time, weaker protection, source/history/action drift fail before any effect',async()=>{
  const f=await fixture();for(const m of [{...f.m,schema:'techlong/cloud-worker-dns-fix-publication-plan/v5'},
    {...f.m,effects:{...f.m.effects,workflowDispatches:1}},{...f.m,source:{...source,commit:'e'.repeat(40)}}])
    await assert.rejects(publishEcsAbsenceV5({manifest:m,approved:m.manifestSha256,context,io:f.io,now:()=>now}));
  await assert.rejects(publishEcsAbsenceV5({manifest:f.m,approved:'f'.repeat(64),context,io:f.io,now:()=>now}));
  await assert.rejects(publishEcsAbsenceV5({manifest:f.m,approved:f.m.manifestSha256,context,io:f.io,now:()=>f.m.expiresAt}));
  assert.deepEqual(f.events,[]);
  for(const changed of [{history:{}},{prestate:{...prestate,unfinishedDeploymentRuns:1}},{prestate:{...prestate,sourceCiConfirmed:false}},
    {prestate:{...prestate,environment:{...prestate.environment,adminBypass:true}}}])
    await assert.rejects(assertEcsAbsencePublicationApprovalV5(f.m,f.m.manifestSha256,{...context,...changed},now));
});
test('fresh drifted preflight consumes no slot and cannot publish',async()=>{
  const f=await fixture();f.io.preflight=async()=>({...prestate,metadataSha256:'e'.repeat(64)});
  await assert.rejects(f.run());assert.deepEqual(f.events,[]);
});
test('one permanent slot then push -> old layout -> create -> exact review -> old layout -> execute -> new readback -> local FF',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.outcome,'ECS_ABSENCE_VERSION_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  assert.equal(r.independentInspectRequired,true);assert.equal(r.workflowDispatched,false);
  for(const [a,b]of [['slot','push'],['push','before-create'],['before-create','create'],['create','verify-change'],
    ['verify-change','before-execute'],['before-execute','execute'],['execute','wait'],['wait','final-layout'],['final-layout','sync']])
    assert.ok(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='push').length,1);
});
test('each ambiguous write/verification halts without later effects, compensation, rollback or retry',async()=>{
  const phases=['push','before-create','create','verify-change','before-execute','execute','wait','final-layout'];
  for(const phase of phases){const f=await fixture();f.fail(phase);const result=await f.run();
    assert.equal(result.outcome,'ECS_ABSENCE_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY');assert.equal(result.retryAllowed,false);
    assert.equal(f.events.includes('sync'),false);assert.ok(f.events.filter(v=>v==='push').length<=1);
    if(['push','before-create'].includes(phase))assert.equal(f.events.includes('create'),false);
    if(['push','before-create','create','verify-change','before-execute'].includes(phase))assert.equal(f.events.includes('execute'),false);
    await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='push').length,1);
  }
});
test('last-second expiration before write stops after the slot and never falls through',async()=>{
  const f=await fixture();let clock=now;f.io.publishRelease=async(_,guard)=>{clock=f.m.expiresAt;await guard();f.events.push('push');};
  const result=await publishEcsAbsenceV5({manifest:f.m,approved:f.m.manifestSha256,context,io:f.io,now:()=>clock});
  assert.match(result.outcome,/PARTIAL/);assert.ok(f.events.includes('slot'));assert.equal(f.events.includes('push'),false);assert.equal(f.events.includes('create'),false);
});
function change(m){const id='arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+m.actions.foundation.create.ChangeSetName+'/12345678-1234-1234-1234-123456789abc';
  return {id,d:{StackId:V.stackId,ChangeSetId:id,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[{ResourceChange:{Action:'Modify',LogicalResourceId:'WorkerRole',
    PhysicalResourceId:V.roleName,ResourceType:'AWS::IAM::Role',Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:'AssumeRolePolicyDocument',RequiresRecreation:'Never'},
      Evaluation:'Static',ChangeSource:'DirectModification'}]}}]}};}
test('real ChangeSet shape must bind exact create ACK ARN/name/stack and complete template, with non-replacing trust-only details',async()=>{
  const m=await prepareEcsAbsencePublicationV5(context),c=change(m),t=JSON.parse(m.actions.foundation.create.TemplateBody);
  assert.equal(verifyEcsAbsencePublicationChangeSetV5(c.d,m,c.id,t).replacement,false);
  for(const mutate of [d=>{d.Changes[0].ResourceChange.Action='Add';},d=>{d.Changes[0].ResourceChange.Replacement='True';},
    d=>{d.Changes[0].ResourceChange.Details[0].Target.Name='Policies';},d=>{d.ChangeSetId=d.ChangeSetId.replace('12345678','87654321');},d=>{d.NextToken='more';}]){
    const d=structuredClone(c.d);mutate(d);assert.throws(()=>verifyEcsAbsencePublicationChangeSetV5(d,m,c.id,t));}
  const different=structuredClone(t);different.Resources.WorkerRole.Properties.MaxSessionDuration=7200;
  assert.throws(()=>verifyEcsAbsencePublicationChangeSetV5(c.d,m,c.id,different));
});
test('adapter has precisely one non-force push, one Create and one Execute path; no other cloud, Secret, environment or dispatch writes',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/ecs-absence-publication-local-v5.mjs',import.meta.url),'utf8');
  assert.equal((code.match(/new CreateChangeSetCommand/g)||[]).length,1);assert.equal((code.match(/new ExecuteChangeSetCommand/g)||[]).length,1);
  assert.equal((code.match(/gitLocalV5\(\['push'/g)||[]).length,1);assert.match(code,/maxAttempts:1/);assert.match(code,/flag:'wx'/);
  assert.doesNotMatch(code,/GetSecretValueCommand|PutObjectCommand|PutRolePolicyCommand|UpdateAssumeRolePolicyCommand|CreateStackCommand|DeleteStackCommand|force-with-lease|--force|pending_deployments|\/dispatches|\/rerun/);
  assert.match(code,/record\('changeset-create-api-ack'/);assert.match(code,/record\('changeset-execute-api-ack'/);
  assert.match(code,/ECS_ABSENCE_PUBLICATION_PARTIAL_OR_DRIFT_METADATA_ONLY_NO_RETRY/);assert.match(code,/ECS_ABSENCE_VERSION_INDEPENDENTLY_VERIFIED_NO_DISPATCH/);
  assert.equal(canonicalJson(context).includes('password'),false);
});


test('transition uses currently installed R463, a distinct slot/schema and only one exact trust value',async()=>{
  const change=ecsAbsenceTrustChangeV5(capsule,release.reusable.commit),copy=structuredClone(change.template);
  copy.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[change.onlyChange.key]=change.onlyChange.oldValue;
  assert.deepEqual(copy,change.oldTemplate);
  assert.ok(change.onlyChange.oldValue.endsWith('@46312fff06d60e9e4ca96be6bb8d82ce1ce3d109'));
  const m=await prepareEcsAbsencePublicationV5(context);
  assert.equal(m.schema,'techlong/cloud-worker-ecs-absence-publication-review/v5');
  assert.match(m.permanentSlot,/ecs-absence-release-v1/);assert.doesNotMatch(m.permanentSlot,/dns-normalization/);
  assert.equal(m.actions.foundation.create.ChangeSetName,'ecs-absence-v5-'+release.caller.commit.slice(0,24));
  for(const changed of [{prestate:{...prestate,installedReusable:'7c02d9db3a39fc2f926848a593eb804b642bd1e5'}},
    {history:{...history,oldRecordsAndSlotsPreserved:false}},{source:{...source,runtimeClosureSha256:V.oldClosure}}])
    await assert.rejects(prepareEcsAbsencePublicationV5({...context,...changed}));
});

