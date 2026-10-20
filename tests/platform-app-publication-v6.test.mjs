import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
import {U,makeAppPublicationReviewV6,validateAppPublicationApprovalV6,verifyAppChangeSetV6,reconcilePublicationLayoutV6,publishAppOnceV6} from '../ops/platform-publication-v6/plan.mjs';
import {FROZEN_V6 as F} from '../ops/platform-activation-v6/publication.mjs';
import {cloudWorkflowsV6} from '../ops/platform-cloud-v6/workflows.mjs';
import {CLOUD_V6 as C,S} from '../ops/platform-cloud-v6/contract.mjs';
const now=Date.parse('2026-10-20T17:00:00Z');
async function fixture(){
  const parent='a'.repeat(40),objects={reusable:{parent,commit:'b'.repeat(40),tree:'c'.repeat(40),blob:'d'.repeat(40),file:U.reusable},
    caller:{parent:'b'.repeat(40),commit:'e'.repeat(40),tree:'f'.repeat(40),blob:'1'.repeat(40),file:U.caller}};
  const texts=cloudWorkflowsV6({...F,reusableCommit:objects.reusable.commit});
  objects.reusable.normalizedLfSha256=await sha256Hex(texts.reusable);objects.caller.normalizedLfSha256=await sha256Hex(texts.caller);
  const trust={Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Federated:'arn:aws:iam::402010193138:oidc-provider/token.actions.githubusercontent.com'},
    Action:'sts:AssumeRoleWithWebIdentity',Condition:{StringEquals:{'token.actions.githubusercontent.com:actor_id':S.ownerId,
      'token.actions.githubusercontent.com:aud':'sts.amazonaws.com','token.actions.githubusercontent.com:environment':C.environment,
      'token.actions.githubusercontent.com:job_workflow_ref':`${S.repository}/.github/workflows/cloud-worker-job.yml@${F.oldReusable}`,
      'token.actions.githubusercontent.com:ref':'refs/heads/main','token.actions.githubusercontent.com:repository_id':S.repositoryId,
      'token.actions.githubusercontent.com:repository_owner_id':S.ownerId,'token.actions.githubusercontent.com:sub':C.oidcSubject}}}]};
  const template={Resources:{WorkerRole:{Type:'AWS::IAM::Role',Properties:{RoleName:U.roleName,AssumeRolePolicyDocument:trust,Policies:[{unchanged:true}]}},Other:{unchanged:true}}};
  const prestate={source:{Account:'402010193138',Arn:U.sourceArn,UserId:U.sourceUserId},main:parent,
    foundation:{stackId:F.stackId,status:'UPDATE_COMPLETE',roleArn:null,parameters:[],template,resources:Array.from({length:5},(_,i)=>({logicalId:'synthetic'+i}))},
    iam:{roleId:C.roleId,arn:C.roleArn,name:U.roleName,trust,inline:[{name:'ExactSandboxWorkerV5',document:{unchanged:true}}],attached:[],
      boundary:{documentSha256:'a'.repeat(64),defaultVersion:'v1',document:{unchanged:true}}},
    environment:{environmentId:24613410405,requiredReviewerId:14145707,adminBypass:false,mainBranchOnly:true},
    oidc:{use_default:true,use_immutable_subject:true,sub_claim_prefix:'repo:veinyyxy@14145707/TechlongSoftware@1323312747'},unfinishedDeploymentRuns:0,oldDeploymentRunIds:['123']};
  const input={parent,objects,pins:Array.from({length:10},(_,i)=>({file:'synthetic-'+i,sha256:'a'.repeat(64)})),
    ci:{runId:'123',jobId:'456',sourceCommit:parent,attempt:1,status:'completed',conclusion:'success'},prestate,createdAt:now};
  const m=await makeAppPublicationReviewV6(input);return {input,m};
}
function layout(m,state='old'){
  const p=structuredClone(m.prestate);p.main=m.objects.caller.commit;
  if(state==='new'){p.foundation.template=JSON.parse(m.actions.create.TemplateBody);p.iam.trust=p.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument;}
  return p;
}
async function runner(){
  const {m}=await fixture(),events=[];let occupied=false,fail,clock=now,layouts=0;
  const step=n=>{events.push(n);if(fail===n)throw Error('Synthetic unknown '+n);};
  const ref={id:'arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+m.actions.create.ChangeSetName+'/12345678-abcd-1234-abcd-123456789012',stackId:F.stackId};
  const io={assertLocal:async()=>step('local'),preflight:async()=>{step('preflight');return structuredClone(m.prestate);},
    consume:async()=>{assert.equal(occupied,false);occupied=true;step('slot');},record:async n=>step(n),push:async()=>step('push'),verifyWorkflows:async()=>{step('workflows');return [];},
    layout:async()=>{step('layout');return layout(m,++layouts<3?'old':'new');},create:async()=>{step('create');return ref;},
    waitChangeSet:async()=>step('verify-change-set'),execute:async()=>step('execute'),waitFoundation:async()=>step('wait-stack'),fastForward:async()=>step('ff')};
  return {m,events,io,ref,at:v=>{clock=v;},fail:n=>{fail=n;},run:()=>publishAppOnceV6({manifest:m,approved:m.manifestSha256,io,now:()=>clock})};
}
test('48h manifest binds two manual workflows and only actor/reusable trust changes; no deployment or credential authority',async()=>{
  const {m}=await fixture();await validateAppPublicationApprovalV6(m,m.manifestSha256,now);assert.equal(m.expiresAt-now,48*3600000);
  assert.equal(m.effects.newManualWorkflowFiles,2);assert.equal(m.actions.trustChanges.length,2);assert.equal(m.actions.execute.DisableRollback,true);
  for(const k of ['secretValueReads','appKeyReads','appTokens','dispatches','newIamResources','iamPermissionExpansion','environmentWrites','neonConnections','workloadCreates','automaticWriteRetries'])assert.equal(m.effects[k],0);
  const t=JSON.parse(m.actions.create.TemplateBody);assert.deepEqual(t.Resources.Other,m.prestate.foundation.template.Resources.Other);
  assert.deepEqual(t.Resources.WorkerRole.Properties.Policies,m.prestate.foundation.template.Resources.WorkerRole.Properties.Policies);
  assert.equal(t.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:actor_id'],S.candidateBotId);
});
test('wrong/expired/future approval, action or scope drift reject; expired Inspect remains read-only',async()=>{
  const {m}=await fixture();for(const [approved,at] of [['wrong',now],[m.manifestSha256,m.expiresAt],[m.manifestSha256,now-1]])await assert.rejects(validateAppPublicationApprovalV6(m,approved,at));
  for(const patch of [{effects:{...m.effects,dispatches:1}},{extraApproval:true},{expiresAt:m.expiresAt+1},{actions:{...m.actions,execute:{...m.actions.execute,DisableRollback:false}}}])
    await assert.rejects(validateAppPublicationApprovalV6({...m,...patch},m.manifestSha256,now));
  await validateAppPublicationApprovalV6(m,undefined,m.expiresAt+1,true);
});
test('prestate rejects wrong Source, replacement role, active runs, attached policy, custom stack role or parameters',async()=>{
  const {input}=await fixture();for(const fn of [p=>{p.source.UserId='other';},p=>{p.iam.roleId='other';},p=>{p.unfinishedDeploymentRuns=1;},
    p=>{p.iam.attached=[{}];},p=>{p.foundation.parameters=[{}];},p=>{p.foundation.roleArn='other';},p=>{p.environment.adminBypass=true;},p=>{p.oidc.use_immutable_subject=false;}]){
    const p=structuredClone(input.prestate);fn(p);await assert.rejects(makeAppPublicationReviewV6({...input,prestate:p}));
  }
});
test('only exact successful CREATE Change Set ARN/template and one static nonreplacement trust Modify may execute',async()=>{
  const f=await runner(),m=f.m,d={ChangeSetId:f.ref.id,ChangeSetName:m.actions.create.ChangeSetName,Description:m.actions.create.Description,Capabilities:['CAPABILITY_NAMED_IAM'],
    StackId:F.stackId,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[{ResourceChange:{Action:'Modify',LogicalResourceId:'WorkerRole',PhysicalResourceId:U.roleName,
      ResourceType:'AWS::IAM::Role',Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:'AssumeRolePolicyDocument',RequiresRecreation:'Never'},ChangeSource:'DirectModification',Evaluation:'Static'}]}}]};
  const t=JSON.parse(m.actions.create.TemplateBody);assert.equal(verifyAppChangeSetV6(d,m,f.ref.id,t).changedLogicalId,'WorkerRole');
  for(const fn of [x=>{x.NextToken='next';},x=>{x.ChangeSetId=x.ChangeSetId+'x';},x=>{x.ExecutionStatus='EXECUTE_IN_PROGRESS';},x=>{x.Changes.push(x.Changes[0]);},
    x=>{x.Changes[0].ResourceChange.Replacement='True';},x=>{x.Changes[0].ResourceChange.Details[0].Target.Name='Policies';},x=>{x.Changes[0].ResourceChange.Details[0].Evaluation='Dynamic';},
    x=>{x.Capabilities=[];}]){const x=structuredClone(d);fn(x);assert.throws(()=>verifyAppChangeSetV6(x,m,f.ref.id,t));}
  const changed=structuredClone(t);changed.Resources.Other.unchanged=false;assert.throws(()=>verifyAppChangeSetV6(d,m,f.ref.id,changed));
});
test('post-push old/new layout allows exactly main and two trust claims, never permission/environment/resource drift',async()=>{
  const {m}=await fixture();for(const state of ['old','new'])assert.equal(reconcilePublicationLayoutV6(layout(m,state),m,state).remainingLayoutUnchanged,true);
  for(const fn of [p=>{p.main=m.parent;},p=>{p.iam.boundary.defaultVersion='v2';},p=>{p.environment.adminBypass=true;},
    p=>{p.foundation.resources[0].logicalId='changed';},p=>{p.oldDeploymentRunIds.push('new');},p=>{p.iam.inline[0].document.changed=true;}]){
    const p=layout(m,'new');fn(p);assert.throws(()=>reconcilePublicationLayoutV6(p,m,'new'));
  }
});
test('one permanent slot precedes push/create/strict-check/execute/readback/FF, each only once',async()=>{
  const f=await runner(),r=await f.run();assert.match(r.outcome,/REQUIRES_INDEPENDENT_INSPECT/);assert.equal(r.workflowDispatched,false);
  for(const [a,b] of [['slot','push'],['push','create'],['create','verify-change-set'],['verify-change-set','execute'],['execute','wait-stack'],['wait-stack','ff']])
    assert.ok(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());for(const n of ['push','create','execute','ff'])assert.equal(f.events.filter(x=>x===n).length,1);
});
test('every partial/ambiguous push, Create, Execute, ACK, layout or FF stops with no replay/compensation',async()=>{
  for(const phase of ['push','push-ack','workflows','published-workflows','layout','create','create-ack','verify-change-set','execute','execute-ack','wait-stack','post-layout','final-workflows','ff','local-main-ack']){
    const f=await runner();f.fail(phase);const r=await f.run();assert.match(r.outcome,/PARTIAL_OR_UNKNOWN/);assert.equal(r.retryAllowed,false);
    await assert.rejects(f.run());for(const n of ['push','create','execute','ff'])assert.ok(f.events.filter(x=>x===n).length<=1);
    if(['push','push-ack','workflows','published-workflows','layout','create','create-ack','verify-change-set'].includes(phase))assert.equal(f.events.includes('execute'),false);
  }
});
test('approval, local-source and preflight drift reject before slot; post-slot expiry rejects before first write',async()=>{
  const f=await runner();await assert.rejects(publishAppOnceV6({manifest:f.m,approved:'wrong',io:f.io,now:()=>now}));assert.deepEqual(f.events,[]);
  const s=await runner();s.fail('local');await assert.rejects(s.run());assert.equal(s.events.includes('slot'),false);
  const p=await runner();p.io.preflight=async()=>({...p.m.prestate,main:'f'.repeat(40)});await assert.rejects(p.run());assert.equal(p.events.includes('slot'),false);
  const e=await runner(),consume=e.io.consume;e.io.consume=async v=>{await consume(v);e.at(e.m.expiresAt);};assert.match((await e.run()).outcome,/PARTIAL/);assert.equal(e.events.includes('push'),false);
});
test('workflow hashes reject content drift; exact caller pins real R while reusable has no self-hash cycle or automatic events',async()=>{
  const {m,input}=await fixture(),texts=cloudWorkflowsV6({...F,reusableCommit:m.objects.reusable.commit});
  const changed=structuredClone(input);changed.objects.caller.normalizedLfSha256='0'.repeat(64);await assert.rejects(makeAppPublicationReviewV6(changed));
  assert.ok(texts.caller.includes('@'+m.objects.reusable.commit));assert.equal(texts.reusable.includes(m.objects.reusable.commit),false);
  assert.doesNotMatch(texts.caller,/\n  (push|schedule|pull_request):/);assert.match(texts.caller,/workflow_dispatch:/);assert.match(texts.reusable,/environment: techlong-sandbox-deploy/);
});
test('expiry during a writer final read is checked again before its submission, with slot retained',async()=>{
  const f=await runner();f.io.push=async(m,guard)=>{f.events.push('writer-final-read');f.at(m.expiresAt);await guard();f.events.push('real-submit');};
  assert.match((await f.run()).outcome,/PARTIAL/);assert.equal(f.events.includes('slot'),true);assert.equal(f.events.includes('real-submit'),false);
});
test('concurrent policy drift before Execute or after stack completion prevents Execute or local FF respectively',async()=>{
  for(const driftAt of [2,3]){const f=await runner(),original=f.io.layout;let n=0;
    f.io.layout=async()=>{const p=await original();if(++n===driftAt)p.iam.boundary.defaultVersion='v99';return p;};
    assert.match((await f.run()).outcome,/PARTIAL/);assert.equal(f.events.includes('ff'),false);
    assert.equal(f.events.includes('execute'),driftAt===3);
  }
});
test('adapter has exactly one non-force push, Create and Execute and no private-key/Secret/SQL/dispatch/delete writer',async()=>{
  const code=await readFile(new URL('../ops/platform-publication-v6/local.mjs',import.meta.url),'utf8');
  for(const x of ['CreateChangeSetCommand','ExecuteChangeSetCommand'])assert.equal((code.match(new RegExp('new '+x,'g'))??[]).length,1);
  assert.equal((code.match(/'push','--porcelain'/g)??[]).length,1);assert.match(code,/flag:'wx',flush:true/);assert.match(code,/maxAttempts:1/);
  assert.doesNotMatch(code,/--force|--delete|DeleteChangeSetCommand|UpdateAssumeRolePolicyCommand|GetSecretValueCommand|\.pem|signAppJwt|DATABASE_URL|new pg\.|method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
  assert.match(code,/ChangeSetName:ref.id/);assert.match(code,/DETAILS_WITHHELD/);
});
