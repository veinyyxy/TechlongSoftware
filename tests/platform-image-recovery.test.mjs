import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {load} from 'js-yaml';
import {lockedImageFoundation,IMAGE_FOUNDATION as S} from '../ops/platform-hosting-v1/image-foundation.mjs';
import {RECOVERY_SCOPE as R,recoveryTemplate,templateDigest,assertRecoveryTemplate,assertRecoverySnapshot,recoveryChangeSetRequest,inspectRecoveryChangeSet} from '../ops/platform-image-recovery-v1/recovery.mjs';

function snapshot(){
  const template=lockedImageFoundation();return {
    source:{Account:S.account,Arn:`arn:aws:iam::${S.account}:user/techlong-sandbox-dev`,UserId:'AIDAV3GNMXTZEO7SHLC2X'},
    stack:{id:R.stackId,status:'CREATE_FAILED',disableRollback:true,roleArn:null,parameters:[]},template,
    resources:[{logicalId:'PlatformWebRepository',type:'AWS::ECR::Repository',physicalId:S.repository,status:'CREATE_COMPLETE'},
      {logicalId:'PlatformImageBoundary',type:'AWS::IAM::ManagedPolicy',physicalId:`arn:aws:iam::${S.account}:policy/${S.boundary}`,status:'CREATE_COMPLETE'},
      {logicalId:'PlatformImagePublisher',type:'AWS::IAM::Role',physicalId:S.role,status:'CREATE_FAILED'}],
    repository:{arn:`arn:aws:ecr:${S.region}:${S.account}:repository/${S.repository}`,createdAt:R.repositoryCreatedAt,imageCount:0,noNextPage:true,
      tagMutability:'IMMUTABLE',scanOnPush:true,encryption:'AES256',exclusions:[]},
    boundary:{arn:`arn:aws:iam::${S.account}:policy/${S.boundary}`,policyId:R.boundaryPolicyId,defaultVersion:'v1',attachmentCount:0,boundaryUsageCount:0,
      document:template.Resources.PlatformImageBoundary.Properties.PolicyDocument},role:{state:'ABSENT'}};
}
function proposedChange(action='Modify'){
  return {StackId:R.stackId,ChangeSetName:R.changeSetName,ChangeSetId:`arn:aws:cloudformation:${S.region}:${S.account}:changeSet/${R.changeSetName}/synthetic`,
    Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Parameters:[],Capabilities:['CAPABILITY_NAMED_IAM'],
    Changes:[{Type:'Resource',ResourceChange:{LogicalResourceId:'PlatformImagePublisher',ResourceType:'AWS::IAM::Role',PhysicalResourceId:S.role,Action:action,
      ...(action==='Modify'?{Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:'AssumeRolePolicyDocument',RequiresRecreation:'Never'}}]}:{})}}]};
}
test('recovery changes only principal/action in locked trust; original approved template stays immutable',()=>{
  const old=lockedImageFoundation(),t=recoveryTemplate(),trust=t.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument;
  assert.equal(templateDigest(old),R.originalTemplateSha256);assertRecoveryTemplate(t);
  assert.deepEqual(trust.Statement,[{Sid:'LockedNoSessions',Effect:'Deny',Principal:{AWS:`arn:aws:iam::${S.account}:root`},Action:['sts:AssumeRole']}]);
  const restored=structuredClone(t);restored.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument=old.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument;
  assert.deepEqual(restored,old);assert.equal(old.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement[0].Principal,'*');
});
test('no Allow, wildcard principal regression, privilege change, repository/boundary edit or role replacement in proposal',()=>{
  for(const mutate of [
    t=>{t.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement[0].Effect='Allow';},
    t=>{t.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement[0].Principal='*';},
    t=>{t.Resources.PlatformImagePublisher.Properties.RoleName+='Other';},
    t=>{t.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument.Statement[0].Action.push('iam:PassRole');},
    t=>{t.Resources.PlatformWebRepository.Properties.ImageTagMutability='MUTABLE';},
    t=>{t.Resources.PlatformImageBoundary.Properties.PolicyDocument.Statement[0].Resource='other';},
  ]){const t=recoveryTemplate();mutate(t);assert.throws(()=>assertRecoveryTemplate(t),/TEMPLATE_DRIFT/);}
});
test('snapshot binds exact failed stack, retained object identities, absent role and unused boundary',()=>{
  assertRecoverySnapshot(snapshot());
  for(const mutate of [v=>{v.source.Account='000000000000';},v=>{v.stack.id+='Other';},v=>{v.stack.status='CREATE_COMPLETE';},
    v=>{v.stack.disableRollback=false;},v=>{v.stack.roleArn='unreviewed';},v=>{v.stack.parameters.push({});},
    v=>{v.role.state='PRESENT';},v=>{v.repository.createdAt='2026-10-21T00:00:00Z';},v=>{v.repository.imageCount=1;},
    v=>{v.repository.noNextPage=false;},v=>{v.boundary.policyId+='new';},v=>{v.boundary.defaultVersion='v2';},
    v=>{v.boundary.boundaryUsageCount=1;},v=>{v.boundary.attachmentCount=1;},v=>{v.resources.pop();},
    v=>{v.template=recoveryTemplate();},v=>{v.boundary.document={};}]){
    const v=snapshot();mutate(v);assert.throws(()=>assertRecoverySnapshot(v));
  }
});
test('proposed request only creates an UPDATE change set against exact old StackId, no implicit rollback/grant/import',()=>{
  const r=recoveryChangeSetRequest();assert.equal(r.StackName,R.stackId);assert.equal(r.ChangeSetType,'UPDATE');
  assert.deepEqual(JSON.parse(r.TemplateBody),recoveryTemplate());assert.equal(r.ImportExistingResources,false);assert.equal(r.IncludeNestedStacks,false);
  for(const key of ['RoleARN','TemplateURL','UsePreviousTemplate','ResourcesToImport','OnStackFailure','DisableRollback','DeploymentMode','DeploymentConfig'])assert.equal(r[key],undefined);
});
test('future independent change-set inspection accepts only absent-role Add or non-replacement trust-only Modify',()=>{
  for(const action of ['Add','Modify'])assert.equal(inspectRecoveryChangeSet(proposedChange(action)).executionAuthorized,false);
  for(const mutate of [v=>{v.StackId+='other';},v=>{v.ExecutionStatus='EXECUTE_COMPLETE';},v=>{v.Status='FAILED';},v=>{v.NextToken='more';},
    v=>{v.Changes.push(v.Changes[0]);},v=>{v.Changes[0].ResourceChange.LogicalResourceId='PlatformWebRepository';},
    v=>{v.Changes[0].ResourceChange.Action='Remove';},v=>{v.Changes[0].ResourceChange.Replacement='True';},v=>{v.Changes[0].ResourceChange.Replacement='Conditional';},
    v=>{v.Changes[0].ResourceChange.Details[0].Target.Name='Policies';},v=>{v.Changes[0].ResourceChange.Details[0].Target.RequiresRecreation='Always';},
    v=>{v.RoleARN='unreviewed';}]){const v=proposedChange();mutate(v);assert.throws(()=>inspectRecoveryChangeSet(v));}
});
test('original approved create source, manifest and risk are still byte-pinned; recovery code remains outside original runtime',async()=>{
  for(const [file,sha] of [
    ['ops/platform-hosting-v1/image-foundation.mjs','f4138aaf410ea75b3553a27303ac18145473f85f76758789fcb8bf887984337b'],
    ['ops/aws-sandbox/reviews/platform-image-foundation-w7d.create-review.json','717984e928d0038c861fb175279d3b7c75f5af12842cf7641d2b323c98bcd052'],
    ['docs/aws-platform-hosting-w7d-foundation-creation-review.md','d734303cc84fa0e13388d2893a0d97916a2fd67668aba682414a8123a3d2c168'],
  ])assert.equal(createHash('sha256').update((await readFile(new URL('../'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n')).digest('hex'),sha);
  const start=await readFile(new URL('../ops/platform-hosting-v1/start.mjs',import.meta.url),'utf8');assert(!start.includes('recovery'));
});
test('dedicated code CI has no AWS/OIDC/environment, image export/upload or live recovery',async()=>{
  const w=load(await readFile(new URL('../.github/workflows/platform-image-recovery-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.candidate.environment,undefined);
  const steps=w.jobs.candidate.steps.map(s=>s.run??'').join('\n');assert.match(steps,/platform-image-recovery.test.mjs/);
  assert.doesNotMatch(steps,/aws |configure-aws|CreateChangeSet|ExecuteChangeSet|docker |secrets\./);
  assert(!w.jobs.candidate.steps.some(s=>s.uses?.startsWith('actions/upload-artifact')));
});
