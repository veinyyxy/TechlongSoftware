import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {load} from 'js-yaml';
import {C,protocol} from '../ops/platform-hosted-publication-v2/candidate.mjs';
import {main} from '../ops/platform-hosted-publication-v2/artifact.mjs';
import {inspect,assertArtifactContext} from '../ops/platform-image-publication-v2/artifact.mjs';
import {P,hash,same} from '../ops/platform-image-publication-v2/plan.mjs';
import {PRODUCER,bindCandidate,RETAINED_IMAGE} from '../ops/platform-hosted-access-v6/publication.mjs';
import {verifyReceipt} from '../ops/platform-hosting-v1/image-artifact.mjs';
const now=Date.parse('2026-10-23T17:00:00Z');
const receipt={schema:'techlong/platform-web-image-artifact/v1',sourceCommit:C.sourceCommit,runId:String(C.runId),runAttempt:1,
  imageConfigDigest:C.imageConfigDigest,os:'linux',architecture:'amd64',archiveFile:'image.tar.gz',archiveBytes:307772705,archiveSha256:C.archiveSha256};
const context={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:C.repository,GITHUB_REPOSITORY_ID:String(C.repositoryId),GITHUB_REF:'refs/heads/main',
  GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'push'};

test('hosted candidate matches byte-checked producer receipt, preserves old candidate and original identities',()=>{
  const verifiedArchive=verifyReceipt(receipt,{bytes:receipt.archiveBytes,sha256:C.archiveSha256},{sourceCommit:C.sourceCommit,runId:String(C.runId)});
  assert(same(C,bindCandidate({receipt,verifiedArchive,zipBytes:PRODUCER.artifactBytes,zipDigest:PRODUCER.artifactDigest})));
  assert.equal(P.sourceCommit,'4209fcab429b868e253ea2d7263dfe2189187232');assert.notEqual(C.targetTag,P.targetTag);
  for(const k of ['account','region','roleId','roleArn','stackId','ecrRepository','scannerVersion','scannerSha256'])assert.equal(C[k],P[k]);
  assert(Object.isFrozen(C));assert.equal(protocol.P.imageConfigDigest,C.imageConfigDigest);
});
test('candidate metadata requires exact successful first producer run and unexpired original ZIP',()=>{
  const run={id:C.runId,head_sha:C.sourceCommit,head_branch:'main',event:'push',run_attempt:1,status:'completed',conclusion:'success',
    workflow_id:C.workflowId,path:'.github/workflows/platform-hosting-candidate.yml',repository:{id:C.repositoryId}};
  const artifact={id:C.artifactId,name:C.artifactName,size_in_bytes:C.artifactBytes,digest:C.artifactDigest,expired:false,expires_at:C.artifactExpiresAt,
    workflow_run:{id:C.runId,head_sha:C.sourceCommit,repository_id:C.repositoryId,head_repository_id:C.repositoryId}};
  protocol.verifyCandidate(run,artifact,now);
  for(const a of [{...artifact,id:P.artifactId},{...artifact,size_in_bytes:1},{...artifact,expired:true}])assert.throws(()=>protocol.verifyCandidate(run,a,now));
  assert.throws(()=>protocol.verifyCandidate({...run,run_attempt:2},artifact,now));
  assert.throws(()=>protocol.verifyCandidate(run,artifact,Date.parse(C.artifactExpiresAt)));
});
function image(id=C.imageConfigDigest){return [{Id:id,Os:'linux',Architecture:'amd64',Config:{User:'node',WorkingDir:'/app',
  Cmd:['node','ops/platform-hosting-v1/start.mjs'],Entrypoint:['docker-entrypoint.sh'],Env:['NODE_VERSION=24.18.0','NODE_ENV=production','PORT=3000']}}];}
test('real loaded-image receipt adapter is candidate-bound, old digest/default and wrong config rejected',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'techlong-hosted-inspect-test-'));
  try{
    await writeFile(path.join(dir,'verified-artifact.json'),JSON.stringify({archiveBytes:receipt.archiveBytes}));
    await writeFile(path.join(dir,'loaded-inspect.json'),JSON.stringify(image()));
    const r=await main(['inspect',dir],{});assert.equal(r.imageConfigDigest,C.imageConfigDigest);assert.equal(r.archiveSha256,C.archiveSha256);
    await assert.rejects(inspect(dir)); // legacy default remains its original image
    await writeFile(path.join(dir,'loaded-inspect.json'),JSON.stringify(image(P.imageConfigDigest)));
    await assert.rejects(main(['inspect',dir],{}));
    const bad=image();bad[0].Config.Env.push('AWS_ACCESS_KEY_ID=synthetic-not-a-credential');
    await writeFile(path.join(dir,'loaded-inspect.json'),JSON.stringify(bad));await assert.rejects(main(['inspect',dir],{}));
  }finally{
    for(const file of ['verified-artifact.json','loaded-inspect.json'])await unlink(path.join(dir,file));
    await rmdir(dir); // only this test's two files; never recursively remove a path
  }
});
test('preflight cannot gain credentials or accept undocumented CLI modes/extra arguments',async()=>{
  assertArtifactContext(context);
  for(const key of ['AWS_PROFILE','NODE_OPTIONS','ACTIONS_ID_TOKEN_REQUEST_TOKEN'])assert.throws(()=>assertArtifactContext({...context,[key]:'synthetic'}));
  for(const args of [['RunReviewed','not-read'],['prepare','not-read','extra'],['scan','not-read'],['inspect','not-read','a','b']])await assert.rejects(main(args,{}));
});
test('retained inventory and config-linked registry manifest remain mandatory, no pretend empty repository',()=>{
  protocol.verifyInventory({imageDetails:[{registryId:C.account,repositoryName:C.ecrRepository,imageDigest:RETAINED_IMAGE.digest,imageTags:[RETAINED_IMAGE.tag]}]});
  assert.throws(()=>protocol.verifyInventory({imageDetails:[]}));
  const raw=JSON.stringify({schemaVersion:2,config:{digest:C.imageConfigDigest},layers:[{digest:'sha256:'+'a'.repeat(64)}]});
  const response={images:[{registryId:C.account,repositoryName:C.ecrRepository,imageId:{imageTag:C.targetTag,imageDigest:'sha256:'+hash(raw)},
    imageManifest:raw,imageManifestMediaType:'application/vnd.docker.distribution.manifest.v2+json'}]};
  const r=protocol.verifyPublishedManifest(response);assert.notEqual(r.manifestDigest,C.imageConfigDigest);
  response.images[0].imageId.imageTag=P.targetTag;assert.throws(()=>protocol.verifyPublishedManifest(response));
});
test('No-AWS CI loads original bytes and runs all three isolated smokes; cannot publish or get AWS identity',async()=>{
  const text=await readFile('.github/workflows/platform-hosted-publication-candidate.yml','utf8'),ci=load(text);
  assert.deepEqual(ci.permissions,{contents:'read'});assert.equal(ci.on.workflow_dispatch,undefined);
  assert.deepEqual(ci.jobs['exact-image'].permissions,{contents:'read',actions:'read'});
  assert.equal(ci.jobs['exact-image'].environment,undefined);assert.doesNotMatch(text,/id-token:|secrets\.|docker build|docker push|publish\.mjs/);
  assert(ci.jobs['exact-image'].steps.some(s=>s.run?.endsWith('preflight hosted-v2')));
  const shell=await readFile('ops/platform-image-publication-v2/cloud-preflight.sh','utf8');
  assert(shell.includes('hosted-smoke.mjs'));assert(shell.includes('PLATFORM_HOSTING_CONTROL_LEASE_CLOSED'));
  assert(shell.includes('test "$#" -le 2'));assert.doesNotMatch(shell,/docker push|docker login|ignore-unfixed|skip-db-update|aws /);
});
