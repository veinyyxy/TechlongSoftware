import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { C, FIRST_PURCHASE_CANDIDATE as F, protocol, firstPurchaseProtocol, selectOverlayPublication, verifyImageReceipt } from '../ops/platform-registration-publish-v1/contract.mjs';
import { verifyLoaded } from '../ops/platform-registration-publish-v1/artifact.mjs';
import { firstPurchaseSourceContext, sourceContext } from '../ops/platform-registration-publish-v1/source.mjs';
import { hash } from '../ops/platform-image-publication-v2/plan.mjs';
import { C as oldPlatform, RETAINED } from '../ops/platform-recovery-image-v1/candidate.mjs';

const read = name => readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const now = Date.parse('2026-11-18T16:22:00Z');
const r={id:C.runId,workflow_id:C.workflowId,head_sha:C.sourceCommit,repository:{id:C.repositoryId},head_branch:'main',
  event:'workflow_dispatch',run_attempt:1,path:'.github/workflows/sandbox-registration-candidate-v1.yml',status:'completed',conclusion:'success'};
const a={id:C.artifactId,name:C.artifactName,size_in_bytes:C.artifactBytes,digest:C.artifactDigest,expires_at:C.artifactExpiresAt,expired:false,
  workflow_run:{id:C.runId,head_sha:C.sourceCommit,repository_id:C.repositoryId,head_repository_id:C.repositoryId}};
const receipt={schema:'techlong/sandbox-registration-overlay-image/v1',orchestrationCommit:C.sourceCommit,runId:String(C.runId),runAttempt:1,
  sourceRecipe:JSON.parse(read('../docs/evidence/sandbox-registration-platform-update.prepared.json')).candidate.sourceRecipe,
  sourceRecipeSha256:C.sourceRecipeSha256,sourceTreeOid:C.sourceTreeOid,archiveFile:'image.tar.gz',archiveBytes:C.archiveBytes,
  archiveSha256:C.archiveSha256,imageConfigDigest:C.imageConfigDigest,scanSummarySha256:C.scanSummarySha256,os:'linux',architecture:'amd64',
  smoke:{networkDisabled:true,closedControl:true,healthAndLogin:true,registrationPageGetOnly:true},awsIdentity:false,registryManifestVerified:false};
const review={schema:'techlong/platform-image-publication-review/v2',candidate:C,reusableCommit:'a'.repeat(40),dispatchCommit:'b'.repeat(40),
  nonce:'c'.repeat(32),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),
  grantStartsAt:new Date(now).toISOString(),grantExpiresAt:new Date(now+3600000).toISOString()};

test('only the sealed registration workflow_dispatch artifact and exact two-file tree match',()=>{
  protocol.verifyCandidate(r,a,now);
  assert.throws(()=>protocol.verifyCandidate({...r,event:'push'},a,now),/REGISTRATION_PRODUCER/);
  assert.throws(()=>protocol.verifyCandidate({...r,run_attempt:2},a,now),/REGISTRATION_PRODUCER/);
  assert.throws(()=>protocol.verifyCandidate(r,{...a,id:a.id+1},now),/REGISTRATION_ARTIFACT_METADATA/);
  assert.throws(()=>protocol.verifyCandidate(r,{...a,digest:'sha256:'+'1'.repeat(64)},now),/REGISTRATION_ARTIFACT_METADATA/);
  assert.throws(()=>protocol.verifyCandidate(r,a,Date.parse(a.expires_at)),/REGISTRATION_ARTIFACT_METADATA/);
  assert.equal(verifyImageReceipt(receipt),receipt);
  assert.throws(()=>verifyImageReceipt({...receipt,sourceTreeOid:'0'.repeat(40)}),/REGISTRATION_RECEIPT/);
  const wrong=structuredClone(receipt);wrong.sourceRecipe.overlay[0].sha256='0'.repeat(64);
  assert.throws(()=>verifyImageReceipt(wrong),/REGISTRATION_RECEIPT/);
});

test('Grant only opens same ECR and immutable reusable; Revoke restores locked baseline',()=>{
  const raw=JSON.stringify(review);assert.deepEqual(protocol.validateReview(raw,hash(raw),now),review);
  const altered=JSON.stringify({...review,candidate:{...C,targetTag:'wrong-tag'}});
  assert.throws(()=>protocol.validateReview(altered,hash(altered),now),/REGISTRATION_REVIEW_FIELDS/);
  const t=protocol.templates(review);
  for(const template of [t.grant,t.revoke])assert.deepEqual(Object.keys(template.Resources),['PlatformImagePublisher']);
  const g=t.grant.Resources.PlatformImagePublisher.Properties, v=t.revoke.Resources.PlatformImagePublisher.Properties;
  assert.equal(g.PermissionsBoundary,v.PermissionsBoundary);
  const allow=g.AssumeRolePolicyDocument.Statement.find(s=>s.Effect==='Allow');
  assert.equal(allow.Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref'],`${C.repository}/.github/workflows/${C.reusableFile}@${review.reusableCommit}`);
  for(const p of g.Policies[0].PolicyDocument.Statement) {
    assert.equal(p.Condition.DateLessThan['aws:CurrentTime'],review.grantExpiresAt);
    assert.ok(p.Action.every(s=>s.startsWith('ecr:')&&!s.includes('Delete')));
  }
  assert.ok(v.AssumeRolePolicyDocument.Statement.every(s=>s.Effect!=='Allow'));
  assert.deepEqual(v.Policies[0].PolicyDocument.Statement,[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]);
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:C.repository,GITHUB_REPOSITORY_ID:String(C.repositoryId),GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:review.dispatchCommit,GITHUB_ACTOR_ID:C.actorId,GITHUB_RUN_ID:'44349999999',
    GITHUB_WORKFLOW_REF:`${C.repository}/.github/workflows/${C.callerFile}@refs/heads/main`};
  protocol.validateCloud(env,review,now);
  assert.throws(()=>protocol.validateCloud({...env,DATABASE_URL:'fixture-only'},review,now),/REGISTRATION_CLOUD_BOUNDARY/);
  assert.throws(()=>protocol.validateCloud({...env,GITHUB_RUN_ATTEMPT:'2'},review,now),/REGISTRATION_CLOUD_CONTEXT/);
});

test('loaded candidate, immutable workflow gate and no build/deploy paths',()=>{
  const image={Id:C.imageConfigDigest,Os:'linux',Architecture:'amd64',Config:{User:'node',WorkingDir:'/app',Cmd:['node','ops/platform-hosting-v1/start.mjs'],
    Entrypoint:['docker-entrypoint.sh'],Env:['NODE_VERSION=24.18.0','NODE_ENV=production','PORT=3000']}};
  verifyLoaded([image]);
  assert.throws(()=>verifyLoaded([{...image,Config:{...image.Config,Env:[...image.Config.Env,'DATABASE_URL=fixture']}}]),/REGISTRATION_LOADED_IMAGE/);
  const reusable=read(`../.github/workflows/${C.reusableFile}`), script=read('../ops/platform-registration-publish-v1/preflight.sh');
  assert.match(reusable,/environment: techlong-sandbox-deploy/);
  assert.match(reusable,/job_workflow_sha/);
  assert.ok(reusable.indexOf('preflight.sh')<reusable.indexOf('cloud.mjs'));
  assert.match(script,/docker load/);assert.match(script,/--network none/);
  assert.doesNotMatch(script,/docker build|hosted-smoke|--hosted-controller|docker push/);
  const caller=new URL(`../.github/workflows/${C.callerFile}`,import.meta.url);
  if(existsSync(caller))assert.match(read(`../.github/workflows/${C.callerFile}`),new RegExp(`${C.reusableFile}@[0-9a-f]{40}`));
});

test('only the replacement seal can select the first-purchase publisher; retain the existing four ECR images',()=>{
  const old=JSON.parse(read('../docs/evidence/sandbox-first-purchase-activation.prepared.json')).candidate.recipe;
  const {replacement}=JSON.parse(read('../docs/evidence/sandbox-first-purchase-replacement.prepared.json'));
  const sourceRecipe={...old,overlay:old.overlay.map(x=>x.path===replacement.path?replacement:x)};
  const t=Date.parse('2026-11-18T18:40:00Z');
  const reviewText=JSON.stringify({...review,candidate:F,issuedAt:new Date(t).toISOString(),expiresAt:new Date(t+3600000).toISOString(),
    grantStartsAt:new Date(t).toISOString(),grantExpiresAt:new Date(t+3600000).toISOString()});
  assert.equal(F.artifactId,14457164929);
  assert.equal(selectOverlayPublication(reviewText,hash(reviewText),t).protocol,firstPurchaseProtocol);
  assert.equal(selectOverlayPublication(JSON.stringify(review),hash(JSON.stringify(review)),now).protocol,protocol);
  for(const m of [{...F,artifactId:C.artifactId},{...F,artifactId:14454594785},{...F,targetTag:C.targetTag},{...F,sourceTreeOid:C.sourceTreeOid}]) {
    const raw=JSON.stringify({...JSON.parse(reviewText),candidate:m});assert.throws(()=>selectOverlayPublication(raw,hash(raw),t),/REGISTRATION_REVIEW_FIELDS/);
  }
  const f={...receipt,schema:'techlong/sandbox-first-purchase-overlay-image/v1',orchestrationCommit:F.sourceCommit,runId:String(F.runId),
    sourceRecipe,sourceRecipeSha256:F.sourceRecipeSha256,sourceTreeOid:F.sourceTreeOid,archiveBytes:F.archiveBytes,archiveSha256:F.archiveSha256,
    imageConfigDigest:F.imageConfigDigest,scanSummarySha256:F.scanSummarySha256,smoke:{...receipt.smoke,firstPurchaseSyntheticCallback:{
      outcome:'SANDBOX_FIRST_PURCHASE_SYNTHETIC_CALLBACK_PASSED',validOutOfScopeIgnored:true,liveModeIgnored:true,badSignatureRejected:true,exactRouteOnly:true,workerClosed:true}}};
  assert.equal(firstPurchaseProtocol.verifyImageReceipt(f),f);
  assert.throws(()=>firstPurchaseProtocol.verifyImageReceipt({...f,sourceRecipe:old}),/REGISTRATION_RECEIPT/);
  assert.throws(()=>firstPurchaseProtocol.verifyImageReceipt({...f,smoke:receipt.smoke}),/REGISTRATION_RECEIPT/);
  assert.throws(()=>verifyImageReceipt(f),/REGISTRATION_RECEIPT/);
  firstPurchaseProtocol.verifyCandidate({...r,id:F.runId,head_sha:F.sourceCommit,workflow_id:F.workflowId},
    {...a,id:F.artifactId,name:F.artifactName,digest:F.artifactDigest,expires_at:F.artifactExpiresAt,size_in_bytes:F.artifactBytes,
      workflow_run:{...a.workflow_run,id:F.runId,head_sha:F.sourceCommit}},t);
  const reg=JSON.parse(read('../docs/evidence/sandbox-first-purchase-activation.prepared.json')).scope.observedWebRegistryManifest;
  const oldDigest=JSON.parse(read('../docs/evidence/sandbox-registration-ecr-publication.prepared.json')).target.oldPlatformDigestToPreserve;
  const image=(imageDigest,tag)=>({imageDigest,imageTags:[tag],registryId:F.account,repositoryName:F.ecrRepository});
  const retained=[...RETAINED.map(i=>image(i.digest,i.tag)),image(oldDigest,oldPlatform.targetTag),image(reg,C.targetTag)];
  assert.ok(firstPurchaseProtocol.verifyRetained({imageDetails:retained}));
  assert.throws(()=>firstPurchaseProtocol.verifyRetained({imageDetails:retained.slice(0,-1)}),/REGISTRATION_ECR_BASE_COUNT/);
  const newDigest='sha256:'+'e'.repeat(64);
  assert.ok(firstPurchaseProtocol.verifyFinalInventory({imageDetails:[...retained,image(newDigest,F.targetTag)]},newDigest));
  assert.deepEqual(firstPurchaseProtocol.templates(JSON.parse(reviewText)).revoke,protocol.templates(review).revoke);
});

test('the original manual caller routes each fixed artifact to its own reviewed reusable pin',()=>{
  const selector=load(read(`../.github/workflows/${C.callerFile}`));
  const old=sourceContext(), next=firstPurchaseSourceContext();
  assert.equal(old.P,C);assert.equal(next.P,F);assert.notEqual(next.S.intentFile,old.S.intentFile);
  assert.deepEqual(Object.keys(selector.on),['workflow_dispatch']);
  assert.deepEqual(Object.keys(selector.jobs),['reviewed-publication','reviewed-first-purchase-publication']);
  const reusable=`${C.repository}/.github/workflows/${C.reusableFile}@`;
  for(const [name,{P,S}] of [['reviewed-publication',old],['reviewed-first-purchase-publication',next]]) {
    const job=selector.jobs[name];
    assert.ok(job.if.endsWith(`fromJSON(inputs.review_json).candidate.artifactId == ${P.artifactId}`));
    assert.match(job.if,/github.ref == 'refs\/heads\/main'.*github.run_attempt == 1/);
    assert.equal(job.uses,reusable+S.reusableCommit);
    assert.deepEqual(job.permissions,{contents:'read',actions:'read','id-token':'write'});
    assert.deepEqual(Object.keys(job.with).sort(),['review_json','review_sha']);
  }
  assert.equal(old.S.reusableCommit,'0b076037eaf04f9a47957548ebe36a454546d641');
  assert.equal(next.S.reusableCiRun,44374702310);
});
