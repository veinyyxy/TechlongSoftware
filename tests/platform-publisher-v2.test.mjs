import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {load} from 'js-yaml';
import {PUBLISHER_V2 as V,lockedPublisherFoundation,assertPublisherTemplate,createPublisherRequest,assertPublisherPreconditions} from '../ops/platform-image-recovery-v2/publisher-foundation.mjs';
import {recoveryTemplate,RECOVERY_SCOPE as R,inspectRecoveryChangeSet} from '../ops/platform-image-recovery-v1/recovery.mjs';
import {lockedImageFoundation,IMAGE_FOUNDATION as S} from '../ops/platform-hosting-v1/image-foundation.mjs';

function preconditions(){
  const old=lockedImageFoundation();return {
    retainedSnapshot:{source:{Account:S.account,Arn:`arn:aws:iam::${S.account}:user/techlong-sandbox-dev`,UserId:'AIDAV3GNMXTZEO7SHLC2X'},
      stack:{id:R.stackId,status:'CREATE_FAILED',disableRollback:true,roleArn:null,parameters:[]},template:old,
      resources:[{logicalId:'PlatformWebRepository',type:'AWS::ECR::Repository',physicalId:S.repository,status:'CREATE_COMPLETE'},
        {logicalId:'PlatformImageBoundary',type:'AWS::IAM::ManagedPolicy',physicalId:V.boundaryArn,status:'CREATE_COMPLETE'},
        {logicalId:'PlatformImagePublisher',type:'AWS::IAM::Role',physicalId:S.role,status:'CREATE_FAILED'}],role:{state:'ABSENT'},
      repository:{arn:V.repositoryArn,createdAt:R.repositoryCreatedAt,imageCount:0,noNextPage:true,tagMutability:'IMMUTABLE',scanOnPush:true,encryption:'AES256',exclusions:[]},
      boundary:{arn:V.boundaryArn,policyId:R.boundaryPolicyId,defaultVersion:'v1',attachmentCount:0,boundaryUsageCount:0,
        document:old.Resources.PlatformImageBoundary.Properties.PolicyDocument}},
    newStack:{state:'ABSENT'},newRole:{state:'ABSENT'},
    retainedChangeSet:{ChangeSetId:V.retainedChangeSetId,StackId:R.stackId,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE'},
    changeSetList:{complete:true,ids:[V.retainedChangeSetId]}};
}

test('proposal owns exactly one new-name role, references retained ECR/boundary and creates neither',()=>{
  const t=lockedPublisherFoundation();assertPublisherTemplate(t);
  assert.deepEqual(Object.keys(t.Resources),['PlatformImagePublisher']);
  const r=t.Resources.PlatformImagePublisher;assert.equal(r.Type,'AWS::IAM::Role');
  assert.equal(r.Properties.RoleName,V.role);assert.notEqual(V.role,S.role);
  assert.equal(r.Properties.PermissionsBoundary,V.boundaryArn);
  assert.equal(t.Outputs.ExistingRepositoryArn.Value,V.repositoryArn);
  assert.equal(t.Outputs.ExistingBoundaryArn.Value,V.boundaryArn);
});

test('role is the exact already-validated no-Allow trust/ECR-only candidate except name and literal boundary reference',()=>{
  const a=lockedPublisherFoundation().Resources.PlatformImagePublisher,b=structuredClone(recoveryTemplate().Resources.PlatformImagePublisher);
  b.Properties.RoleName=V.role;b.Properties.PermissionsBoundary=V.boundaryArn;assert.deepEqual(a,b);
  assert.equal(a.Properties.AssumeRolePolicyDocument.Statement.length,1);
  assert.equal(a.Properties.AssumeRolePolicyDocument.Statement[0].Effect,'Deny');
  assert.deepEqual(a.Properties.AssumeRolePolicyDocument.Statement[0].Principal,{AWS:`arn:aws:iam::${S.account}:root`});
  assert.deepEqual(a.Properties.AssumeRolePolicyDocument.Statement[0].Action,['sts:AssumeRole']);
  assert.equal(a.Properties.MaxSessionDuration,3600);
});

test('candidate rejects grant, old role takeover, permission drift, extra resources, macros and destructive policy',()=>{
  for(const edit of [
    t=>{t.Resources.PlatformImagePublisher.Properties.RoleName=S.role;},
    t=>{t.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement[0].Effect='Allow';},
    t=>{t.Resources.PlatformImagePublisher.Properties.PermissionsBoundary='other';},
    t=>{t.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument.Statement[1].Action.push('iam:PassRole');},
    t=>{t.Resources.ECR=lockedImageFoundation().Resources.PlatformWebRepository;},
    t=>{t.Resources.Boundary=lockedImageFoundation().Resources.PlatformImageBoundary;},
    t=>{t.Transform='unreviewed';},t=>{t.Resources.PlatformImagePublisher.DeletionPolicy='Delete';},
  ]){const t=lockedPublisherFoundation();edit(t);assert.throws(()=>assertPublisherTemplate(t),/TEMPLATE_DRIFT/);}
});

test('future create is new stack only with DisableRollback true; never executes old plan or imports resources',()=>{
  const r=createPublisherRequest();assert.equal(r.StackName,V.stack);assert.notEqual(r.StackName,S.stack);
  assert.equal(r.DisableRollback,true);assert.deepEqual(r.Capabilities,['CAPABILITY_NAMED_IAM']);
  assert.deepEqual(JSON.parse(r.TemplateBody),lockedPublisherFoundation());assert.deepEqual(r.Parameters,[]);
  assert.deepEqual(Object.keys(r).sort(),['StackName','ClientRequestToken','TemplateBody','Capabilities','DisableRollback','Parameters','Tags'].sort());
});

test('preconditions preserve old failure/evidence objects and independently require new stack/role absent',()=>{
  assert.equal(assertPublisherPreconditions(preconditions()).executionAuthorized,false);
  for(const edit of [v=>{v.newRole.state='PRESENT';},v=>{v.newStack.state='PRESENT';},v=>{v.retainedSnapshot.role.state='PRESENT';},
    v=>{v.retainedSnapshot.boundary.boundaryUsageCount=1;},v=>{v.retainedSnapshot.repository.imageCount=1;},
    v=>{v.retainedChangeSet.ExecutionStatus='EXECUTE_COMPLETE';},v=>{v.retainedChangeSet.ChangeSetId+='other';},
    v=>{v.changeSetList.complete=false;},v=>{v.changeSetList.ids.push('other');}]){
    const v=preconditions();edit(v);assert.throws(()=>assertPublisherPreconditions(v));
  }
});

test('W7e approved module stays immutable and its rejected three-change scope remains rejected',async()=>{
  const s=(await readFile(new URL('../ops/platform-image-recovery-v1/recovery.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(s).digest('hex'),'34074420bff9b90da65ef73b3dc945905ef4269c4fd8d694a4f232a989c3f261');
  const v={StackId:R.stackId,ChangeSetName:R.changeSetName,ChangeSetId:V.retainedChangeSetId,
    Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Parameters:[],Capabilities:['CAPABILITY_NAMED_IAM'],
    Changes:['PlatformImageBoundary','PlatformImagePublisher','PlatformWebRepository'].map(id=>({Type:'Resource',ResourceChange:{LogicalResourceId:id,Action:'Modify'}}))};
  assert.throws(()=>inspectRecoveryChangeSet(v),/CHANGE_COUNT/);
});

test('dedicated CI covers v2 proposal without AWS/OIDC, environment, Docker, artifact publication or runtime wiring',async()=>{
  const w=load(await readFile(new URL('../.github/workflows/platform-image-recovery-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.candidate.environment,undefined);
  assert(w.on.push.paths.includes('ops/platform-image-recovery-v2/**'));
  const steps=w.jobs.candidate.steps.map(s=>s.run??'').join('\n');assert.match(steps,/platform-publisher-v2.test.mjs/);
  assert.doesNotMatch(steps,/aws |configure-aws|CreateStack|ExecuteChangeSet|docker |secrets\./);
  assert(!w.jobs.candidate.steps.some(s=>s.uses?.startsWith('actions/upload-artifact')));
  const start=await readFile(new URL('../ops/platform-hosting-v1/start.mjs',import.meta.url),'utf8');assert(!start.includes('recovery-v2'));
});
