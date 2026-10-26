import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {C,RETAINED,protocol,verifyRetained,verifyFinalInventory} from '../ops/platform-recovery-image-v1/candidate.mjs';
import {B} from '../ops/platform-recovery-image-v1/source-binding.mjs';
import {sourceContext} from '../ops/platform-recovery-image-v1/source-review.mjs';
import {main,revokeOnce,CLOUD_ROOTS} from '../ops/platform-recovery-image-v1/source.mjs';
import {main as artifact} from '../ops/platform-recovery-image-v1/artifact.mjs';
import {main as cloud} from '../ops/platform-recovery-image-v1/cloud.mjs';
import {P,hash,publicationProtocol} from '../ops/platform-image-publication-v2/plan.mjs';
import {runControlled} from '../ops/platform-image-source-v2/runner.mjs';
import {createGithub} from '../ops/platform-image-source-v2/github.mjs';
import {createAws} from '../ops/platform-image-source-v2/aws.mjs';
const now=Date.parse('2026-10-26T15:00:00Z'),head='2'.repeat(40),binding={reusableCommit:'1'.repeat(40),reusableCiRun:123456789,reusableCiWorkflow:12345};
const review=sourceContext(binding);
function outer(){return {schema:review.S.schema,issuedAt:'2026-10-26T14:00:00Z',expiresAt:'2026-10-28T14:00:00Z',latestStartAt:'2026-10-28T13:00:00Z',
  nonce:'3'.repeat(32),operatorSourceCommit:head,sourceCiRunId:987654321,callerWorkflowId:123456789,
  sourcePins:Array.from({length:6},(_,i)=>({file:'ops/synthetic-'+i+'.mjs',sha256:'4'.repeat(64)})),riskSha256:'5'.repeat(64),
  candidate:{...C},reusableCommit:binding.reusableCommit,scope:{...review.S.scope}};}
function approved(){const text=JSON.stringify(outer());return {text,approvedSha:hash(text),review};}
const oldImages=()=>RETAINED.map(x=>({registryId:C.account,repositoryName:C.ecrRepository,imageDigest:x.digest,imageTags:[x.tag]}));
function ports(fail){const calls=[],act=n=>async()=>{calls.push(n);if(n===fail)throw Error('SYNTHETIC_'+n);};return {calls,ports:{
  preflight:async()=>{await act('preflight')();return head;},consume:act('consume'),record:async n=>act('record:'+n)(),
  update:async(i,p)=>act(p)(),verify:async(i,p)=>act('verify:'+p)(),dispatch:async()=>{await act('dispatch')();return {runId:123456789};},
  wait:async()=>{await act('wait')();return {id:123456789};},published:async()=>{await act('published')();return {manifestDigest:'sha256:'+'6'.repeat(64)};}}};}
async function workflow(file,template){try{return await readFile('.github/workflows/'+file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;return readFile('ops/platform-recovery-image-v1/'+template,'utf8');}}

test('candidate matches the real W9n archive/ZIP evidence; old candidate/default and all identities unchanged',async()=>{
  const r=JSON.parse(await readFile('ops/aws-sandbox/reviews/platform-recovery-hosted-bootstrap-v1.prepared.json','utf8'));
  assert.equal(C.sourceCommit,r.sourceCommit);assert.equal(C.runId,Number(r.candidate.producerRunId));
  for(const [key,other] of [['artifactId','artifactId'],['artifactBytes','artifactBytes'],['artifactDigest','artifactDigest'],
    ['imageConfigDigest','imageConfigDigest'],['archiveSha256','archiveSha256']])assert.equal(C[key],r.candidate[other]);
  assert.equal(P.sourceCommit,'4209fcab429b868e253ea2d7263dfe2189187232');assert.notEqual(C.targetTag,P.targetTag);
  assert.equal(protocol.P.targetTag,C.targetTag);
  for(const key of ['account','region','role','roleArn','roleId','stackId','ecrRepository'])assert.equal(C[key],P[key]);
  for(const change of [{roleId:'other'},{callerFile:'arbitrary.yml'},{reusableFile:'arbitrary.yml'}])assert.throws(()=>publicationProtocol({...C,...change}));
});
test('preflight requires BOTH exact retained images, no extra image, tag drift or pagination',()=>{
  verifyRetained({imageDetails:oldImages()});
  for(const v of [{imageDetails:[]},{imageDetails:oldImages().slice(0,1)},{imageDetails:[...oldImages(),oldImages()[0]]},
    {imageDetails:oldImages(),nextToken:'more'},{imageDetails:oldImages().map((x,i)=>i?x:{...x,imageTags:['latest']})}])assert.throws(()=>verifyRetained(v));
});
test('producer metadata is exact successful first attempt and original unexpired ZIP, not a newer build',()=>{
  const run={id:C.runId,head_sha:C.sourceCommit,head_branch:'main',event:'push',run_attempt:1,status:'completed',conclusion:'success',
    workflow_id:C.workflowId,path:'.github/workflows/platform-hosting-candidate.yml',repository:{id:C.repositoryId}};
  const artifact={id:C.artifactId,name:C.artifactName,size_in_bytes:C.artifactBytes,digest:C.artifactDigest,expired:false,expires_at:C.artifactExpiresAt,
    workflow_run:{id:C.runId,head_sha:C.sourceCommit,repository_id:C.repositoryId,head_repository_id:C.repositoryId}};
  protocol.verifyCandidate(run,artifact,now);
  for(const patch of [{id:P.artifactId},{digest:P.artifactDigest},{expired:true},{size_in_bytes:1}])assert.throws(()=>protocol.verifyCandidate(run,{...artifact,...patch},now));
  assert.throws(()=>protocol.verifyCandidate({...run,run_attempt:2},artifact,now));assert.throws(()=>protocol.verifyCandidate(run,artifact,Date.parse(C.artifactExpiresAt)));
});
test('final inventory preserves both old images plus exactly one tag/manifest-linked new image',()=>{
  const digest='sha256:'+'7'.repeat(64),fresh={registryId:C.account,repositoryName:C.ecrRepository,imageDigest:digest,imageTags:[C.targetTag]};
  verifyFinalInventory({imageDetails:[fresh,...oldImages()]},digest);
  for(const v of [{imageDetails:oldImages()},{imageDetails:[fresh,...oldImages().slice(0,1)]},
    {imageDetails:[{...fresh,imageTags:['latest']},...oldImages()]},{imageDetails:[fresh,...oldImages()],nextToken:'more'}])assert.throws(()=>verifyFinalInventory(v,digest));
  assert.throws(()=>verifyFinalInventory({imageDetails:[fresh,...oldImages()]},RETAINED[0].digest));
});
test('new review has separate permanent slot, 48h approval/one-hour grant and exact immutable candidate',()=>{
  const a=approved(),m=review.validateOuter(a.text,a.approvedSha,now),inner=review.innerReview(m,head,now);
  assert.equal(review.S.intentFile,'techlong-recovery-image-v1.source.intent.json');assert.equal(Date.parse(inner.grantExpiresAt)-now,3600000);
  assert.equal(m.scope.cloudFormationUpdateStack,2);assert.equal(m.scope.githubWorkflowDispatch,1);assert.equal(m.scope.topLevelDockerPush,1);
  assert.equal(m.scope.awsSecretValueReads,0);assert.equal(m.scope.deployments,0);
  for(const change of [m=>{m.scope.topLevelDockerPush=2;},m=>{m.candidate.archiveSha256='0'.repeat(64);},m=>{m.reusableCommit='main';},
    m=>{m.schema='techlong/platform-hosted-image-source-review/v2';}]){const bad=outer();change(bad);const text=JSON.stringify(bad);assert.throws(()=>review.validateOuter(text,hash(text),now));}
  assert.throws(()=>review.validateOuter(a.text,a.approvedSha,Date.parse(m.latestStartAt)+1));
});
test('real Source is closed before file, credential or network discovery until exact reusable CI binding',async()=>{
  if(!B.reusableCommit){assert.throws(()=>sourceContext(),/BINDING_NOT_READY/);
    for(const mode of ['Prepare','RunReviewed','Inspect'])await assert.rejects(main([mode,'not-read',mode==='Prepare'?'123456789':'a'.repeat(64)]),/BINDING_NOT_READY/);
  }else {const r=sourceContext();assert.equal(r.S.reusableCommit,B.reusableCommit);
    const caller=load(await workflow(C.callerFile,'caller-pending.yml.txt'));assert.equal(caller.jobs['reviewed-publication'].uses,`${C.repository}/.github/workflows/${C.reusableFile}@${B.reusableCommit}`);}
  await assert.rejects(main(['RunReviewed','not-read','wrong']));
  await assert.rejects(artifact(['prepare','not-read','unexpected'],{}));await assert.rejects(cloud(['not-read'],{}));
});
test('one grant/dispatch and one immediate revoke on success, no implicit extra publication',async()=>{
  const x=ports();const r=await runControlled({...approved(),ports:x.ports,now:()=>now});assert.equal(r.outcome,'PUBLISHED_AND_INDEPENDENTLY_LOCKED');
  assert(x.calls.indexOf('record:dispatch-ack')<x.calls.indexOf('wait'));
  for(const phase of ['consume','grant','dispatch','revoke','verify:revoke','published'])assert.equal(x.calls.filter(x=>x===phase).length,1);
});
for(const fail of ['record:inner-review','grant','verify:grant','dispatch','record:dispatch-ack','wait','revoke','verify:revoke','published'])
  test('ambiguous '+fail+' always attempts one revoke/readback and never retries',async()=>{
    const x=ports(fail),r=await runControlled({...approved(),ports:x.ports,now:()=>now});assert.equal(r.outcome,'REQUIRES_INDEPENDENT_INSPECT');
    assert.equal(x.calls.filter(c=>c==='revoke').length,1);assert(x.calls.includes('verify:revoke'));assert.equal(r.retryAllowed,false);
  });
test('wrong approval or pre-slot failure causes no grant/revoke or durable action',async()=>{
  const x=ports();await assert.rejects(runControlled({...approved(),approvedSha:'0'.repeat(64),ports:x.ports,now:()=>now}));assert.deepEqual(x.calls,[]);
  for(const stage of ['preflight','consume']){const x=ports(stage);await assert.rejects(runControlled({...approved(),ports:x.ports,now:()=>now}));assert(!x.calls.includes('grant')&&!x.calls.includes('revoke'));}
});
test('recording failures cannot suppress the profile one-revoke request to the exact existing stack',async()=>{
  for(const fail of ['revoke-wait-error','revoke-intent','revoke-ack']){const calls=[],aws={settled:async()=>{throw Error('SYNTHETIC');},update:async(i,p)=>{calls.push(p);return {stackId:C.stackId};}};
    const record=async n=>{if(n===fail)throw Error('SYNTHETIC');};const invoke=()=>revokeOnce(aws,record,review.innerReview(outer(),head,now));
    if(fail==='revoke-ack')await assert.rejects(invoke());else await invoke();assert.deepEqual(calls,['revoke']);}
});
test('grant edits only original role trust/inline; exact new reusable pin, no identity, boundary or ECS change',()=>{
  const inner=review.innerReview(outer(),head,now),g=review.updateRequest(inner,'grant'),r=review.updateRequest(inner,'revoke');
  for(const req of [g,r]){assert.equal(req.StackName,C.stackId);assert.equal(req.DisableRollback,true);assert.equal(req.RoleARN,undefined);assert.equal(req.Tags,undefined);
    assert.deepEqual(Object.keys(JSON.parse(req.TemplateBody).Resources),['PlatformImagePublisher']);}
  const role=JSON.parse(g.TemplateBody).Resources.PlatformImagePublisher.Properties,locked=JSON.parse(r.TemplateBody).Resources.PlatformImagePublisher.Properties;
  assert(role.AssumeRolePolicyDocument.Statement.some(s=>s.Effect==='Allow'&&s.Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref']===`${C.repository}/.github/workflows/${C.reusableFile}@${binding.reusableCommit}`));
  assert(locked.AssumeRolePolicyDocument.Statement.every(s=>s.Effect!=='Allow'));assert.equal(role.PermissionsBoundary,locked.PermissionsBoundary);
  assert.equal(locked.Policies[0].PolicyDocument.Statement[0].Sid,'LockedDenyAllEcr');
});
test('cloud and OIDC validation bind new caller/reusable identities, never normalize an old workflow',()=>{
  const m=review.innerReview(outer(),head,now),env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:C.repository,GITHUB_REPOSITORY_ID:String(C.repositoryId),
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:head,GITHUB_ACTOR_ID:C.actorId,
    GITHUB_RUN_ID:'123456789',GITHUB_WORKFLOW_REF:`${C.repository}/.github/workflows/${C.callerFile}@refs/heads/main`};
  protocol.validateCloud(env,m,now);
  assert.throws(()=>protocol.validateCloud({...env,GITHUB_WORKFLOW_REF:`${C.repository}/.github/workflows/${P.callerFile}@refs/heads/main`},m,now));
  const claims={iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',sub:C.subject,repository:C.repository,
    repository_id:String(C.repositoryId),repository_owner_id:C.ownerId,actor_id:C.actorId,ref:'refs/heads/main',event_name:'workflow_dispatch',
    environment:C.environment,run_id:env.GITHUB_RUN_ID,run_attempt:'1',sha:head,workflow_ref:env.GITHUB_WORKFLOW_REF,
    job_workflow_ref:`${C.repository}/.github/workflows/${C.reusableFile}@${m.reusableCommit}`,job_workflow_sha:m.reusableCommit,
    exp:Math.floor(now/1000)+600,iat:Math.floor(now/1000)};
  protocol.validateClaims(claims,env,m,now);
  assert.throws(()=>protocol.validateClaims({...claims,job_workflow_ref:`${C.repository}/.github/workflows/${P.reusableFile}@${m.reusableCommit}`},env,m,now));
});
test('raw registry manifest must link to new config and exact tag; config digest is not accepted as registry hash',()=>{
  const raw=JSON.stringify({schemaVersion:2,config:{digest:C.imageConfigDigest},layers:[{digest:'sha256:'+'8'.repeat(64)}]});
  const image={registryId:C.account,repositoryName:C.ecrRepository,imageId:{imageTag:C.targetTag,imageDigest:'sha256:'+hash(raw)},
    imageManifest:raw,imageManifestMediaType:'application/vnd.docker.distribution.manifest.v2+json'};
  assert.equal(protocol.verifyPublishedManifest({images:[image]}).manifestDigest,'sha256:'+hash(raw));
  assert.throws(()=>protocol.verifyPublishedManifest({images:[{...image,imageId:{...image.imageId,imageDigest:C.imageConfigDigest}}]}));
  assert.throws(()=>protocol.verifyPublishedManifest({images:[{...image,imageManifest:raw.replace(C.imageConfigDigest,P.imageConfigDigest)}]}));
});
test('shared GitHub adapter can POST only this caller once; no old caller dispatch',async()=>{
  const calls=[],gh=createGithub({context:review,credential:()=> 'synthetic',fetcher:async(url,o)=>{calls.push({url,o});return new Response(JSON.stringify(o.method==='GET'?{object:{sha:head}}:
    {workflow_run_id:123456789,html_url:`https://github.com/${C.repository}/actions/runs/123456789`,run_url:`https://api.github.com/repos/${C.repository}/actions/runs/123456789`}));}});
  const inner=review.innerReview(outer(),head,now);await gh.dispatch(inner,'synthetic','a'.repeat(64));await assert.rejects(gh.dispatch(inner,'synthetic','a'.repeat(64)));
  assert.equal(calls.filter(c=>c.o.method==='POST').length,1);assert(calls.find(c=>c.o.method==='POST').url.endsWith(C.callerFile+'/dispatches'));gh.close();
});
test('protected reusable validates immutable identity then original bytes/three smokes/scan before one STS session',async()=>{
  const text=await workflow(C.reusableFile,'publish-job.yml.txt'),w=load(text);assert.deepEqual(Object.keys(w.on),['workflow_call']);
  assert.deepEqual(w.permissions,{});assert.equal(w.jobs.publish.environment,C.environment);assert.equal(w.jobs.publish.permissions['id-token'],'write');
  assert.equal(w.jobs.publish.steps.find(s=>s.uses?.startsWith('actions/checkout')).with.ref,'${{ steps.source.outputs.sha }}');
  assert(text.includes(C.reusableFile+'@'));assert(text.includes('c.job_workflow_sha'));assert(text.includes('ops/platform-recovery-image-v1/preflight.sh publication'));
  const shell=await readFile('ops/platform-recovery-image-v1/preflight.sh','utf8');for(const s of ['--network none','hosted-smoke.mjs','CONTROL_LEASE_CLOSED','--exit-code 1'])assert(shell.includes(s));
  assert.doesNotMatch(shell,/docker build|docker push|docker login|aws sts|ignore-unfixed|skip-db-update/);assert(CLOUD_ROOTS.includes('.github/workflows/'+C.reusableFile));
});
test('candidate CI has no OIDC/environment/AWS or production dispatch and loads the existing image, never rebuilds',async()=>{
  const text=await readFile('.github/workflows/platform-recovery-image-candidate.yml','utf8'),w=load(text);
  assert.deepEqual(w.permissions,{contents:'read'});for(const j of Object.values(w.jobs)){assert.equal(j.environment,undefined);assert.equal(j.permissions?.['id-token'],undefined);}
  const cmds=Object.values(w.jobs).flatMap(j=>j.steps.map(s=>s.run??'')).join('\n');
  assert.doesNotMatch(cmds,/RunReviewed|node (?:--\S+ )?ops\/[^ \n]*(?:source|cloud)\.mjs\b|docker push|docker build|aws /);
  assert(cmds.includes('preflight.sh preflight'));assert.equal(w.on.workflow_dispatch,undefined);
});
test('read-only preparation rejects update before credentials and bounds GitHub reads before network',async()=>{
  const aws=await createAws({protocol,readOnly:true,metadataLimit:15,stsLimit:1});
  try{await assert.rejects(aws.update({},'grant'),/SOURCE_READ_ONLY/);assert.deepEqual(aws.counts,{sts:0,metadata:0,writes:0});}finally{aws.close();}
  let requests=0;const gh=createGithub({context:review,maxGets:1,credential:()=> 'synthetic',fetcher:async()=>{requests++;return new Response('{"id":14145707,"login":"veinyyxy"}');}});
  await gh.readIdentity();await assert.rejects(gh.readIdentity(),/SOURCE_GITHUB_READ_BUDGET/);assert.equal(requests,1);gh.close();
});
