import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {P,S,hash,validateOuter,innerReview,updateRequest,validateGithubLayout,verifyRun} from '../ops/platform-image-source-v2/review.mjs';
import {runControlled,prepare,runReviewed} from '../ops/platform-image-source-v2/runner.mjs';
import {verifySnapshot,identity} from '../ops/platform-image-source-v2/aws.mjs';
import {createGithub} from '../ops/platform-image-source-v2/github.mjs';
import {environment} from '../ops/platform-image-source-v2/files.mjs';
import {templates} from '../ops/platform-image-publication-v2/plan.mjs';
import {lockedPublisherFoundation} from '../ops/platform-image-recovery-v2/publisher-foundation.mjs';
import {RECOVERY_SCOPE as R} from '../ops/platform-image-recovery-v1/recovery.mjs';
const now=Date.parse('2026-10-22T01:00:00Z'),head='a'.repeat(40);
function outer(){return {schema:'techlong/platform-image-source-review/v2',issuedAt:'2026-10-22T00:00:00Z',expiresAt:'2026-10-24T00:00:00Z',latestStartAt:'2026-10-23T23:00:00Z',
  nonce:'b'.repeat(32),operatorSourceCommit:head,sourceCiRunId:123456789,callerWorkflowId:987654321,
  sourcePins:Array.from({length:6},(_,i)=>({file:`ops/synthetic-${i}.mjs`,sha256:'c'.repeat(64)})),riskSha256:'d'.repeat(64),candidate:{...P},reusableCommit:S.reusableCommit,scope:{...S.scope}};}
function approved(){const m=outer(),text=JSON.stringify(m);return {text,approvedSha:hash(text)};}
function ports(fail){const calls=[],port=n=>async()=>{calls.push(n);if(n===fail)throw Error('SYNTHETIC_'+n);};return {calls,ports:{
  preflight:async()=>{await port('preflight')();return head;},consume:port('consume'),record:async n=>{calls.push('record:'+n);if('record:'+n===fail)throw Error('SYNTHETIC_ACK');},
  update:async(i,p)=>port('update:'+p)(),verify:async(i,p)=>port('verify:'+p)(),dispatch:async()=>{await port('dispatch')();return {runId:123,url:'https://github.com/synthetic'};},
  wait:async()=>{await port('wait')();return {id:123};},published:async()=>{await port('published')();return {manifestDigest:'sha256:synthetic'};}}};}
test('outer approval has 48h validity but no installed window until explicit execution',()=>{
  const {text,approvedSha}=approved(),m=validateOuter(text,approvedSha,now),inner=innerReview(m,head,now);
  assert.equal(inner.grantStartsAt,new Date(now).toISOString());assert.equal(Date.parse(inner.grantExpiresAt)-now,3600000);
  assert.equal(inner.reusableCommit,S.reusableCommit);assert.equal(m.scope.cloudFormationUpdateStack,2);
  assert.throws(()=>validateOuter(text+' ',approvedSha,now));assert.throws(()=>validateOuter(text,approvedSha,Date.parse(m.latestStartAt)+1));
  for(const change of [m=>{m.scope.cloudFormationUpdateStack=3;},m=>{m.candidate.artifactId=1;},m=>{m.reusableCommit=head;},m=>{m.latestStartAt=m.expiresAt;}]){
    const m=outer();change(m);const t=JSON.stringify(m);assert.throws(()=>validateOuter(t,hash(t),now));
  }
});
test('CFN writes target only exact healthy V2 ARN, no direct IAM, RoleARN, tags, deletion or managed version operations',()=>{
  const m=innerReview(outer(),head,now),g=updateRequest(m,'grant'),r=updateRequest(m,'revoke');
  for(const x of [g,r]){assert.equal(x.StackName,P.stackId);assert.equal(x.DisableRollback,true);assert.equal(x.Tags,undefined);assert.equal(x.RoleARN,undefined);
    assert.deepEqual(Object.keys(JSON.parse(x.TemplateBody).Resources),['PlatformImagePublisher']);}
  assert.equal(JSON.parse(r.TemplateBody).Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument.Statement[0].Effect,'Deny');
  assert.notEqual(g.ClientRequestToken,r.ClientRequestToken);assert.throws(()=>updateRequest(m,'delete'));
});
test('controller saves ACK before observing, always independently verifies revoke, no implicit retry',async()=>{
  const x=ports();const r=await runControlled({...approved(),ports:x.ports,now:()=>now});assert.equal(r.outcome,'PUBLISHED_AND_INDEPENDENTLY_LOCKED');
  assert(x.calls.indexOf('record:dispatch-ack')<x.calls.indexOf('wait'));
  assert.equal(x.calls.filter(c=>c==='update:grant').length,1);assert.equal(x.calls.filter(c=>c==='update:revoke').length,1);
  for(const fail of ['update:grant','verify:grant','dispatch','record:dispatch-ack','wait','update:revoke','verify:revoke','published']){
    const y=ports(fail),result=await runControlled({...approved(),ports:y.ports,now:()=>now});
    assert.equal(result.outcome,'REQUIRES_INDEPENDENT_INSPECT');assert(y.calls.includes('verify:revoke'));assert.equal(y.calls.filter(c=>c==='update:revoke').length,1);
    if(fail!=='published')assert(!y.calls.some(c=>c==='retry'));
  }
});
test('no consume or cloud writes when approval or preflight fails',async()=>{
  const x=ports('preflight');await assert.rejects(runControlled({...approved(),ports:x.ports,now:()=>now}));assert.deepEqual(x.calls,['preflight']);
  const y=ports();await assert.rejects(runControlled({...approved(),approvedSha:'0'.repeat(64),ports:y.ports,now:()=>now}));assert.deepEqual(y.calls,[]);
  await assert.rejects(runReviewed('not-read',undefined),/SOURCE_NEW_APPROVAL_REQUIRED/);await assert.rejects(prepare('outside.json'),/SOURCE_PREPARE_OUTPUT/);
});
function snapshot(expected=lockedPublisherFoundation()){
  const base=lockedPublisherFoundation().Resources.PlatformImagePublisher.Properties,t=expected.Resources.PlatformImagePublisher.Properties;
  return {source:{Account:P.account,Arn:`arn:aws:iam::${P.account}:user/techlong-sandbox-dev`,UserId:'AIDAV3GNMXTZEO7SHLC2X'},
    stack:{Stacks:[{StackId:P.stackId,StackStatus:'UPDATE_COMPLETE',Parameters:[]}]},template:{TemplateBody:JSON.stringify(expected)},
    resources:{StackResourceSummaries:[{LogicalResourceId:'PlatformImagePublisher',ResourceType:'AWS::IAM::Role',PhysicalResourceId:P.role,ResourceStatus:'UPDATE_COMPLETE'}]},
    role:{Role:{RoleId:P.roleId,Arn:P.roleArn,Path:'/',MaxSessionDuration:3600,PermissionsBoundary:{PermissionsBoundaryArn:base.PermissionsBoundary},AssumeRolePolicyDocument:t.AssumeRolePolicyDocument}},
    inline:{PolicyDocument:t.Policies[0].PolicyDocument},inlineNames:{PolicyNames:['OnlyPlatformWebRepository'],IsTruncated:false},managed:{AttachedPolicies:[],IsTruncated:false},
    boundary:{Policy:{Arn:base.PermissionsBoundary,PolicyId:R.boundaryPolicyId,DefaultVersionId:'v1',AttachmentCount:0,PermissionsBoundaryUsageCount:1}},
    boundaryVersion:{PolicyVersion:{VersionId:'v1',IsDefaultVersion:true,Document:base.Policies[0].PolicyDocument}},changeSets:{Summaries:[]},
    repository:{repositories:[{registryId:P.account,repositoryName:P.ecrRepository,repositoryArn:`arn:aws:ecr:${P.region}:${P.account}:repository/${P.ecrRepository}`,createdAt:R.repositoryCreatedAt,
      imageTagMutability:'IMMUTABLE',imageScanningConfiguration:{scanOnPush:true},encryptionConfiguration:{encryptionType:'AES256'}}]},images:{imageDetails:[]},
    provider:{Url:'token.actions.githubusercontent.com',ClientIDList:['sts.amazonaws.com']},repositoryPolicyPresent:false,
    registry:{registryId:P.account,scanningConfiguration:{scanType:'BASIC',rules:[]}}};
}
test('post-update verification accepts only expected true RoleId/template/trust/inline/boundary, never normalizes away permission differences',()=>{
  const m=innerReview(outer(),head,now),t=templates(m);
  assert.equal(verifySnapshot(snapshot(t.revoke),t.revoke).locked,true);assert.equal(verifySnapshot(snapshot(t.grant),t.grant).locked,false);
  for(const change of [v=>{v.role.Role.RoleId='replacement';},v=>{v.inline.PolicyDocument=lockedPublisherFoundation().Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument;},
    v=>{v.boundary.Policy.DefaultVersionId='v2';},v=>{v.changeSets.Summaries=[{ChangeSetId:'other'}];},v=>{v.provider.ClientIDList.push('other');}]){
    const v=snapshot(t.revoke);change(v);assert.throws(()=>verifySnapshot(v,t.revoke));
  }
  assert.throws(()=>identity({Account:P.account,Arn:P.roleArn}),/SOURCE_IDENTITY/);
});
function layout(){return {user:{id:14145707,login:'veinyyxy'},repo:{id:P.repositoryId,full_name:P.repository,owner:{id:14145707}},
  oidc:{use_default:true,use_immutable_subject:true,sub_claim_prefix:'repo:veinyyxy@14145707/TechlongSoftware@1323312747'},environment:{id:24613410405,name:P.environment,
    can_admins_bypass:false,deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
    protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{type:'User',reviewer:{id:14145707}}]}]},
  branches:{total_count:1,branch_policies:[{name:'main',type:'branch'}]}};}
test('GitHub layout rejects wrong token actor, legacy subject, review bypass or extra branch',()=>{
  validateGithubLayout(layout());for(const change of [v=>{v.user.id=1;},v=>{v.oidc.use_immutable_subject=false;},v=>{v.environment.can_admins_bypass=true;},
    v=>{v.branches.total_count=2;}]){const v=layout();change(v);assert.throws(()=>validateGithubLayout(v));}
});
test('actual GitHub transport sends existing credential only to fixed official API and exactly one dispatch with durable run identity',async()=>{
  const calls=[],gh=createGithub({credential:()=> 'synthetic-not-a-real-credential',fetcher:async(url,opts)=>{
    calls.push({url,opts});if(opts.method==='GET')return new Response(JSON.stringify({object:{sha:head}}));
    return new Response(JSON.stringify({workflow_run_id:123,html_url:`https://github.com/${P.repository}/actions/runs/123`,
      run_url:`https://api.github.com/repos/${P.repository}/actions/runs/123`}),{status:200});}});
  const m=innerReview(outer(),head,now);await gh.dispatch(m,'synthetic','a'.repeat(64));await assert.rejects(gh.dispatch(m,'synthetic','a'.repeat(64)),/DISPATCH_ONCE/);
  const posts=calls.filter(c=>c.opts.method==='POST');assert.equal(posts.length,1);assert.equal(new URL(posts[0].url).origin,'https://api.github.com');assert.equal(posts[0].opts.redirect,'error');
  assert.equal(JSON.parse(posts[0].opts.body).return_run_details,true);gh.close();
});
test('run observation is exact actor/caller/source/reusable/attempt and cannot follow a rerun',()=>{
  const r={id:123,workflow_id:456,repository:{id:P.repositoryId},head_sha:head,head_branch:'main',event:'workflow_dispatch',run_attempt:1,
    path:'.github/workflows/'+P.callerFile,display_title:'Platform ECR synthetic',actor:{id:14145707},triggering_actor:{id:14145707},
    referenced_workflows:[{sha:S.reusableCommit,path:`${P.repository}/.github/workflows/${P.reusableFile}@${S.reusableCommit}`}]};
  const expected={id:123,workflowId:456,head};verifyRun(r,expected);assert.throws(()=>verifyRun({...r,run_attempt:2},expected));
});
test('published caller is fixed R and dispatch-only; Source CI never gets OIDC/environment/AWS or executes production CLI',async()=>{
  const caller=load(await readFile(new URL('../.github/workflows/'+P.callerFile,import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(caller.on),['workflow_dispatch']);assert.deepEqual(caller.permissions,{});
  assert.equal(caller.jobs['reviewed-publication'].uses,`${P.repository}/.github/workflows/${P.reusableFile}@${S.reusableCommit}`);
  const text=await readFile(new URL('../.github/workflows/'+S.sourceCiFile,import.meta.url),'utf8'),ci=load(text);
  assert.deepEqual(ci.permissions,{contents:'read'});assert(!text.includes('id-token:'));assert(!text.includes('environment:'));
  assert.doesNotMatch(text,/RunReviewed|cli\.mjs|docker build|docker push|secrets\./);
  const source=await readFile(new URL('../ops/platform-image-source-v2/aws.mjs',import.meta.url),'utf8');
  assert.match(source,/maxAttempts:1/);assert.equal((source.match(/new cfnApi.UpdateStackCommand/g)??[]).length,1);
  assert.doesNotMatch(source,/PutRolePolicyCommand|UpdateAssumeRolePolicyCommand|CreatePolicyVersionCommand|DeleteStackCommand|GetSecretValueCommand/);
});
test('Source refuses endpoint, inherited credentials, alternate git trees and Node injection',()=>{
  environment({});for(const k of ['AWS_PROFILE','AWS_ACCESS_KEY_ID','AWS_ENDPOINT_URL','GIT_WORK_TREE','NODE_OPTIONS'])assert.throws(()=>environment({[k]:'synthetic'}));
});
