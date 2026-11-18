import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { C, protocol, verifyImageReceipt } from '../ops/platform-registration-publish-v1/contract.mjs';
import { verifyLoaded } from '../ops/platform-registration-publish-v1/artifact.mjs';
import { hash } from '../ops/platform-image-publication-v2/plan.mjs';

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
