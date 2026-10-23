import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {C} from '../ops/platform-hosted-publication-v2/candidate.mjs';
import {B} from '../ops/platform-hosted-publication-v2/source-binding.mjs';
import {sourceContext,verifyRetained,verifyFinalInventory} from '../ops/platform-hosted-publication-v2/source-review.mjs';
import {revokeOnce,main,CLOUD_ROOTS} from '../ops/platform-hosted-publication-v2/source.mjs';
import {hash,same} from '../ops/platform-image-publication-v2/plan.mjs';
import {runControlled} from '../ops/platform-image-source-v2/runner.mjs';
import {createGithub} from '../ops/platform-image-source-v2/github.mjs';
import {S as OLD} from '../ops/platform-image-source-v2/review.mjs';
import {RETAINED_IMAGE} from '../ops/platform-hosted-access-v6/publication.mjs';
const now=Date.parse('2026-10-23T18:00:00Z'),head='2'.repeat(40);
const fixtureBinding={reusableCommit:'1'.repeat(40),reusableCiRun:123456789,reusableCiWorkflow:394308354},review=sourceContext(fixtureBinding);
function outer(){return {schema:review.S.schema,issuedAt:'2026-10-23T17:00:00Z',expiresAt:'2026-10-25T17:00:00Z',latestStartAt:'2026-10-25T16:00:00Z',
  nonce:'3'.repeat(32),operatorSourceCommit:head,sourceCiRunId:987654321,callerWorkflowId:123456789,
  sourcePins:Array.from({length:6},(_,i)=>({file:`ops/test-${i}.mjs`,sha256:'4'.repeat(64)})),riskSha256:'5'.repeat(64),
  candidate:{...C},reusableCommit:fixtureBinding.reusableCommit,scope:{...review.S.scope}};}
function approved(){const m=outer(),text=JSON.stringify(m);return {text,approvedSha:hash(text),review};}
function ports(fail){const calls=[],act=n=>async()=>{calls.push(n);if(n===fail)throw Error('SYNTHETIC_'+n);};return {calls,ports:{
  preflight:async()=>{await act('preflight')();return head;},consume:act('consume'),record:async n=>act('record:'+n)(),
  update:async(i,p)=>act(p)(),verify:async(i,p)=>act('verify:'+p)(),dispatch:async()=>{await act('dispatch')();return {runId:123456789};},
  wait:async()=>{await act('wait')();return {id:123456789};},published:async()=>{await act('published')();return {manifestDigest:'sha256:'+'6'.repeat(64)};}}};}
test('hosted review has separate lineage/slot, 48h human window, one-hour actual grant and exact candidate/resources',()=>{
  const a=approved(),m=review.validateOuter(a.text,a.approvedSha,now),inner=review.innerReview(m,head,now);
  assert.equal(Date.parse(inner.grantExpiresAt)-now,3600000);assert.notEqual(review.S.intentFile,OLD.intentFile);
  assert.equal(m.scope.cloudFormationUpdateStack,2);assert.equal(m.scope.topLevelDockerPush,1);assert.equal(m.scope.awsSecretValueReads,0);
  assert(same(m.candidate,C));assert.equal(inner.reusableCommit,fixtureBinding.reusableCommit);
  assert.throws(()=>review.validateOuter(a.text+' ',a.approvedSha,now));
  for(const change of [m=>{m.scope.topLevelDockerPush=2;},m=>{m.schema='techlong/platform-image-source-review/v2';},
    m=>{m.candidate.imageConfigDigest='sha256:'+'0'.repeat(64);},m=>{m.reusableCommit=OLD.reusableCommit;},m=>{m.latestStartAt=m.expiresAt;}]){
    const m=outer();change(m);const t=JSON.stringify(m);assert.throws(()=>review.validateOuter(t,hash(t),now));
  }
});
test('real binding is closed until immutable reusable CI is recorded; no branch or legacy fallback',async()=>{
  if(B.reusableCommit){const r=sourceContext();assert.equal(r.S.reusableCommit,B.reusableCommit);
    const caller=load(await readFile('.github/workflows/'+C.callerFile,'utf8'));
    assert.equal(caller.jobs['reviewed-publication'].uses,`${C.repository}/.github/workflows/${C.reusableFile}@${B.reusableCommit}`);
  }else assert.throws(()=>sourceContext(),/BINDING_NOT_READY/);
  for(const b of [{...fixtureBinding,reusableCommit:'main'},{...fixtureBinding,reusableCiRun:null},{...fixtureBinding,reusableCiWorkflow:1}])assert.throws(()=>sourceContext(b));
  await assert.rejects(main(['RunReviewed','not-read']));await assert.rejects(main(['RunReviewed','not-read','not-a-sha']));
});
test('existing Source coordinator always attempts exactly one revoke plus independent readback on every ambiguous phase',async()=>{
  const x=ports();assert.equal((await runControlled({...approved(),ports:x.ports,now:()=>now})).outcome,'PUBLISHED_AND_INDEPENDENTLY_LOCKED');
  for(const fail of ['record:inner-review','grant','verify:grant','dispatch','record:dispatch-ack','wait','revoke','verify:revoke','published']){
    const y=ports(fail),r=await runControlled({...approved(),ports:y.ports,now:()=>now});
    assert.equal(r.outcome,'REQUIRES_INDEPENDENT_INSPECT');assert.equal(y.calls.filter(c=>c==='revoke').length,1);
    assert(y.calls.includes('verify:revoke'));assert.equal(r.retryAllowed,false);
  }
});
test('failed preflight or ambiguous slot consumes no grant authority and never starts compensation writes',async()=>{
  for(const stage of ['preflight','consume']){const x=ports(stage);await assert.rejects(runControlled({...approved(),ports:x.ports,now:()=>now}));
    assert(!x.calls.includes('grant'));assert(!x.calls.includes('revoke'));}
  const x=ports();await assert.rejects(runControlled({...approved(),approvedSha:'0'.repeat(64),ports:x.ports,now:()=>now}));assert.deepEqual(x.calls,[]);
});
test('cleanup audit/settle failure cannot suppress the one revoke request; no record or write replay',async()=>{
  for(const fail of ['revoke-wait-error','revoke-intent','revoke-ack']){
    const calls=[],aws={settled:async()=>{calls.push('settled');throw Error('SYNTHETIC_SETTLE');},update:async(i,p)=>{calls.push(p);return {stackId:C.stackId};}};
    const record=async n=>{calls.push('record:'+n);if(n===fail)throw Error('SYNTHETIC_RECORD');};
    const invoke=()=>revokeOnce(aws,record,review.innerReview(outer(),head,now));
    if(fail==='revoke-ack')await assert.rejects(invoke());else await invoke();
    assert.equal(calls.filter(c=>c==='revoke').length,1);assert.equal(calls.filter(c=>c==='record:'+fail).length,1);
  }
});
test('same existing CFN role gets only fixed-date trust/inline, with no boundary/identity or deployment change',()=>{
  const inner=review.innerReview(outer(),head,now),g=review.updateRequest(inner,'grant'),r=review.updateRequest(inner,'revoke');
  for(const req of [g,r]){assert.equal(req.StackName,C.stackId);assert.equal(req.DisableRollback,true);assert.equal(req.RoleARN,undefined);assert.equal(req.Tags,undefined);
    assert.deepEqual(Object.keys(JSON.parse(req.TemplateBody).Resources),['PlatformImagePublisher']);}
  const role=JSON.parse(g.TemplateBody).Resources.PlatformImagePublisher.Properties;
  assert(role.AssumeRolePolicyDocument.Statement.some(s=>s.Effect==='Allow'&&s.Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref']===
    `${C.repository}/.github/workflows/${C.reusableFile}@${fixtureBinding.reusableCommit}`));
  const locked=JSON.parse(r.TemplateBody).Resources.PlatformImagePublisher.Properties;
  assert(locked.AssumeRolePolicyDocument.Statement.every(s=>s.Effect!=='Allow'));assert.equal(locked.Policies[0].PolicyDocument.Statement[0].Sid,'LockedDenyAllEcr');
  assert.equal(role.PermissionsBoundary,locked.PermissionsBoundary);assert(g.ClientRequestToken.startsWith('platform-hosted-publication-v2-'));
});
function oldImage(){return {registryId:C.account,repositoryName:C.ecrRepository,imageDigest:RETAINED_IMAGE.digest,imageTags:[RETAINED_IMAGE.tag]};}
test('prestate requires the retained image; final independent inventory requires exactly old plus raw-manifest-linked new image',()=>{
  verifyRetained({imageDetails:[oldImage()]});const digest='sha256:'+'7'.repeat(64),fresh={registryId:C.account,repositoryName:C.ecrRepository,imageDigest:digest,imageTags:[C.targetTag]};
  verifyFinalInventory({imageDetails:[fresh,oldImage()]},digest);
  for(const v of [{imageDetails:[]},{imageDetails:[fresh]},{imageDetails:[oldImage()]},{nextToken:'more',imageDetails:[fresh,oldImage()]},
    {imageDetails:[{...fresh,imageTags:['latest']},oldImage()]},{imageDetails:[fresh,oldImage(),oldImage()]}])assert.throws(()=>verifyFinalInventory(v,digest));
});
test('shared GitHub transport dispatches only new fixed caller, one POST, exact returned ACK; old caller cannot leak through',async()=>{
  const calls=[],gh=createGithub({context:review,credential:()=> 'synthetic-not-a-credential',fetcher:async(url,opt)=>{
    calls.push({url,opt});return new Response(JSON.stringify(opt.method==='GET'?{object:{sha:head}}:{workflow_run_id:123456789,
      html_url:`https://github.com/${C.repository}/actions/runs/123456789`,run_url:`https://api.github.com/repos/${C.repository}/actions/runs/123456789`}));}});
  const inner=review.innerReview(outer(),head,now);await gh.dispatch(inner,'synthetic','a'.repeat(64));await assert.rejects(gh.dispatch(inner,'synthetic','a'.repeat(64)));
  const post=calls.find(c=>c.opt.method==='POST');assert(post.url.endsWith('/'+C.callerFile+'/dispatches'));assert.equal(post.opt.redirect,'error');
  assert.equal(calls.filter(c=>c.opt.method==='POST').length,1);gh.close();
});
test('new immutable reusable validates new claims/source/candidate/preflight before shared one-session publisher; No-AWS CI never calls it',async()=>{
  const text=await readFile('.github/workflows/'+C.reusableFile,'utf8'),w=load(text);
  assert.deepEqual(Object.keys(w.on),['workflow_call']);assert.equal(w.jobs.publish.environment,C.environment);assert.deepEqual(w.permissions,{});
  assert.equal(w.jobs.publish.steps.find(s=>s.uses?.startsWith('actions/checkout')).with.ref,'${{ steps.source.outputs.sha }}');
  assert(text.includes('c.job_workflow_sha'));assert(text.includes('platform-image-hosted-publish-job-v2.yml@'));
  assert(text.includes('publication hosted-v2'));assert(text.includes('ops/platform-hosted-publication-v2/cloud.mjs'));
  assert(!text.includes('run: node ops/platform-image-publication-v2/publish.mjs'));
  const ci=load(await readFile('.github/workflows/platform-hosted-publication-candidate.yml','utf8'));
  const cmds=Object.values(ci.jobs).flatMap(j=>j.steps.map(s=>s.run??'')).join('\n');
  assert.doesNotMatch(cmds,/RunReviewed|source\.mjs|cloud\.mjs|docker push|aws /);assert.equal(ci.jobs['exact-image'].environment,undefined);
  assert(CLOUD_ROOTS.includes('.github/workflows/'+C.reusableFile));assert(!CLOUD_ROOTS.includes('ops/platform-hosted-publication-v2/source-binding.mjs'));
});
