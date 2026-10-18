import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TASK_DEFINITION_PERMISSION_V5 as V,taskDefinitionPermissionChangeV5,prepareTaskDefinitionPermissionV5,
  assertTaskDefinitionPermissionApprovalV5,verifyTaskDefinitionPermissionChangeSetV5,assertTaskDefinitionLayoutV5,
  applyTaskDefinitionPermissionV5} from '../ops/cloud-worker/task-definition-permission-v5.mjs';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
const capsule=JSON.parse(await readFile(new URL('../ops/cloud-worker/material/public-capsule-v5.json',import.meta.url),'utf8')),
  change=taskDefinitionPermissionChangeV5(capsule),now=1800000000000,
  source={commit:'a'.repeat(40),runtimeClosureSha256:V.closureSha256,files:Array.from({length:164},(_,i)=>({file:'pin-'+i,normalizedLfSha256:'b'.repeat(64)}))},
  history={permissionFailureEvidenceVerified:true,failedReviewSourcePinsVerified:159,oldReviewSlotsPreserved:true},
  layout={state:'old',main:source.commit,stackStatus:'UPDATE_COMPLETE',roleId:V.roleId,boundaryDefaultVersion:'v1',
    boundaryPolicyId:'old-boundary-id',trustSha256:'c'.repeat(64),foundationResourceIdsSha256:'d'.repeat(64),
    templateSha256:V.oldTemplateSha256,inlinePolicySha256:await sha256Hex(change.oldTemplate.Resources.WorkerRole.Properties.Policies[0].PolicyDocument)},
  prestate={main:source.commit,sourceCiConfirmed:true,unfinishedRuns:0,runtimeCommit:V.runtime,reusableCommit:V.reusable,roleId:V.roleId,layout},
  context={source,history,prestate,capsule,now};
async function fixture(){
  const m=await prepareTaskDefinitionPermissionV5(context),events=[];let used=false;
  const newLayout={...layout,state:'new',templateSha256:m.actions.templateSha256,inlinePolicySha256:m.actions.inlinePolicySha256},
    ref={changeSetId:'arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+m.actions.create.ChangeSetName+'/11111111-2222-3333-4444-555555555555',stackId:V.stackId};
  const io={preflight:async()=>prestate,consumeSlot:async()=>{assert.equal(used,false);used=true;events.push('slot');},
    record:async n=>events.push(n),assertLocalSource:async()=>{},
    createChangeSet:async(r,g)=>{await g();events.push('CREATE');return ref;},waitChangeSet:async()=>{events.push('VERIFY');return ref;},
    readLayout:async state=>{events.push(state);return state==='old'?layout:newLayout;},
    executeChangeSet:async(r,m,g)=>{await g();events.push('EXECUTE');return ref;},waitFoundation:async()=>events.push('WAIT'),
    counts:()=>({secretValueReads:0,workflowDispatches:0,automaticWriteRetries:0})};
  return {m,io,events,newLayout,ref,run:()=>applyTaskDefinitionPermissionV5({manifest:m,approved:m.manifestSha256,context,io,now:()=>now})};
}
test('exact installed baseline changes only one inline Resource, preserving condition/trust/boundary/actions and fixed C/R',async()=>{
  assert.equal(await sha256Hex(change.oldTemplate),V.oldTemplateSha256);
  const copy=structuredClone(change.template),index=change.onlyChange.statementIndex;
  assert.deepEqual(copy.Resources.WorkerRole.Properties.Policies[0].PolicyDocument.Statement[index],{
    Effect:'Allow',Action:'ecs:DescribeTaskDefinition',Resource:'*',Condition:{StringEquals:{'aws:RequestedRegion':'ca-central-1'}}});
  copy.Resources.WorkerRole.Properties.Policies[0].PolicyDocument.Statement[index].Resource=V.oldResource;
  assert.equal(canonicalJson(copy),canonicalJson(change.oldTemplate));
  const m=await prepareTaskDefinitionPermissionV5(context);assert.equal(m.runtimeCommit,V.runtime);assert.equal(m.reusableCommit,V.reusable);
  assert.equal(m.effects.foundationChangeSetCreate,1);assert.equal(m.effects.foundationChangeSetExecute,1);assert.equal(m.effects.gitPublication,0);
  assert.equal(m.effects.workflowDispatches,0);assert.equal(m.effects.secretValueReads,0);assert.equal(m.effects.persistentPermissionChange,true);
  assert.equal(m.actions.onlyChange.notTenantFilteredByIam,true);assert.equal(m.expiresAt-now,7200000);
});
test('missing failure/source/CI/layout history, stale SHA/schema, drifted actions and expired approval fail before slots or writes',async()=>{
  const f=await fixture();for(const patch of [{history:{}},{source:{...source,files:[]}},{source:{...source,runtimeClosureSha256:'0'.repeat(64)}},
    {prestate:{...prestate,sourceCiConfirmed:false}},{prestate:{...prestate,reusableCommit:'f'.repeat(40)}},
    {prestate:{...prestate,layout:{...layout,boundaryDefaultVersion:'v2'}}}])await assert.rejects(prepareTaskDefinitionPermissionV5({...context,...patch}));
  for(const patch of [{schema:'old-schema'},{effects:{...f.m.effects,workflowDispatches:1}},{actions:{...f.m.actions,create:{...f.m.actions.create,StackName:'other'}}}])
    await assert.rejects(assertTaskDefinitionPermissionApprovalV5({...f.m,...patch},f.m.manifestSha256,context,now));
  await assert.rejects(assertTaskDefinitionPermissionApprovalV5(f.m,'0'.repeat(64),context,now));
  await assert.rejects(applyTaskDefinitionPermissionV5({manifest:f.m,approved:f.m.manifestSha256,context,io:f.io,now:()=>f.m.expiresAt}));
  f.io.preflight=async()=>({...prestate,unfinishedRuns:1});await assert.rejects(f.run());assert.deepEqual(f.events,[]);
});
test('ChangeSet verifier admits only exact create ACK ARN/full template and single non-replacing WorkerRole Policies modification',async()=>{
  const f=await fixture(),id=f.ref.changeSetId,d={ChangeSetId:id,StackId:V.stackId,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',
    Changes:[{ResourceChange:{Action:'Modify',LogicalResourceId:'WorkerRole',PhysicalResourceId:V.roleName,ResourceType:'AWS::IAM::Role',Replacement:'False',Scope:['Properties'],
      Details:[{Target:{Attribute:'Properties',Name:'Policies',RequiresRecreation:'Never'},ChangeSource:'DirectModification',Evaluation:'Static'}]}}]};
  verifyTaskDefinitionPermissionChangeSetV5(d,f.m,id,change.template);
  for(const alter of [x=>x.Changes.push(x.Changes[0]),x=>x.Changes[0].ResourceChange.Replacement='True',
    x=>x.Changes[0].ResourceChange.Details[0].Target.Name='AssumeRolePolicyDocument',x=>x.Changes[0].ResourceChange.LogicalResourceId='Boundary',
    x=>x.ChangeSetId=id.replace('taskdef-read','other'),x=>x.NextToken='more']){
    const v=structuredClone(d);alter(v);assert.throws(()=>verifyTaskDefinitionPermissionChangeSetV5(v,f.m,id,change.template));
  }
  assert.throws(()=>verifyTaskDefinitionPermissionChangeSetV5(d,f.m,id,change.oldTemplate));
});
test('one permanent slot then Create/strict verify/old readback/Execute/new readback; no retry or additional effect',async()=>{
  const f=await fixture(),r=await f.run();assert.equal(r.outcome,'TASK_DEFINITION_READ_CORRECTED_REQUIRES_INDEPENDENT_INSPECT');
  assert.ok(f.events.indexOf('slot')<f.events.indexOf('CREATE'));assert.ok(f.events.indexOf('VERIFY')<f.events.indexOf('EXECUTE'));
  assert.ok(f.events.indexOf('old')<f.events.indexOf('EXECUTE'));assert.ok(f.events.indexOf('EXECUTE')<f.events.indexOf('new'));
  await assert.rejects(f.run());assert.equal(f.events.filter(e=>e==='CREATE').length,1);assert.equal(f.events.filter(e=>e==='EXECUTE').length,1);
});
test('each ambiguous stage halts without compensation, later writes or automatic retry; expiration rechecked immediately before writes',async()=>{
  for(const method of ['assertLocalSource','createChangeSet','waitChangeSet','readLayout','executeChangeSet','waitFoundation']){
    const f=await fixture();f.io[method]=async()=>{throw Error('unknown');};const r=await f.run();
    assert.equal(r.outcome,'TASK_DEFINITION_PERMISSION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY');assert.equal(r.retryAllowed,false);
    if(['assertLocalSource','createChangeSet','waitChangeSet','readLayout'].includes(method))assert.ok(!f.events.includes('EXECUTE'));
    await assert.rejects(f.run());
  }
  const f=await fixture();let t=now;f.io.createChangeSet=async(r,g)=>{t=f.m.expiresAt;await g();f.events.push('CREATE');};
  const r=await applyTaskDefinitionPermissionV5({manifest:f.m,approved:f.m.manifestSha256,context,io:f.io,now:()=>t});
  assert.equal(r.retryAllowed,false);assert.ok(!f.events.includes('CREATE'));
});
test('new layout may differ only by exact template/inline digests; trust, main, boundary identity and resource identity drift reject',async()=>{
  const f=await fixture();assertTaskDefinitionLayoutV5(layout,f.m,'old');assertTaskDefinitionLayoutV5(f.newLayout,f.m,'new');
  for(const [key,value]of Object.entries({trustSha256:'0'.repeat(64),main:'f'.repeat(40),boundaryPolicyId:'replaced',foundationResourceIdsSha256:'0'.repeat(64),
    inlinePolicySha256:'0'.repeat(64),templateSha256:'0'.repeat(64),state:'old'}))assert.throws(()=>assertTaskDefinitionLayoutV5({...f.newLayout,[key]:value},f.m,'new'));
});
test('local entry exposes only two CFN write constructors, fresh paths/slot and exact evidence; unsupported modes fail before I/O',async()=>{
  const code=await readFile(new URL('../ops/cloud-worker/task-definition-permission-local-v5.mjs',import.meta.url),'utf8');
  for(const marker of ['TASKDEF_HISTORICAL_SOURCE_PIN','TASKDEF_FAILURE_ORIGINAL','TASKDEF_EXACT_CREATE_ACK','TASKDEF_EXACT_LAYOUT','TASKDEF_INSPECT_BINDING'])assert.ok(code.includes(marker));
  assert.equal((code.match(/new cf.CreateChangeSetCommand/g)||[]).length,1);assert.equal((code.match(/new cf.ExecuteChangeSetCommand/g)||[]).length,1);
  assert.doesNotMatch(code,/PutRolePolicyCommand|CreatePolicyVersionCommand|GetSecretValueCommand|new cf.CreateStackCommand|\.dispatch\(|\.putExecutionReference\(|\['push'/);
  assert.match(code,/maxAttempts:1/);assert.match(code,/flag:'wx'/);
  const {mainTaskDefinitionPermissionV5}=await import('../ops/cloud-worker/task-definition-permission-local-v5.mjs');
  await assert.rejects(mainTaskDefinitionPermissionV5(['--mode','RunOnce','--output','F:/ChatGPT_workshop/techlong-w5p-not-created']));
});
