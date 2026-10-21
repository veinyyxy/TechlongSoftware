import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {load} from 'js-yaml';
import {PUBLICATION as P,verifyCandidate,grantTemplate,revokeTemplate,verifyOsScan} from '../ops/platform-image-publication-v1/plan.mjs';
import {assertNoAwsContext} from '../ops/platform-image-publication-v1/preflight.mjs';
import {lockedPublisherFoundation} from '../ops/platform-image-recovery-v2/publisher-foundation.mjs';
function metadata(){return {run:{id:P.runId,head_sha:P.sourceCommit,head_branch:'main',event:'push',run_attempt:1,
  status:'completed',conclusion:'success',workflow_id:P.workflowId,path:'.github/workflows/platform-hosting-candidate.yml',repository:{id:P.repositoryId}},
  artifact:{id:P.artifactId,name:P.artifactName,size_in_bytes:P.artifactBytes,digest:P.artifactDigest,expired:false,expires_at:P.artifactExpiresAt,
    workflow_run:{id:P.runId,repository_id:P.repositoryId,head_repository_id:P.repositoryId,head_sha:P.sourceCommit}}};}
const now=Date.parse('2026-10-21T20:00:00Z');
const window={reusableCommit:'a'.repeat(40),startsAtUtc:'2026-10-22T10:00:00Z',expiresAtUtc:'2026-10-22T11:00:00Z'};
test('candidate gate binds official ZIP identity, source, exact first main push and expiry, not a self-signed receipt',()=>{
  const {run,artifact}=metadata();assert.equal(verifyCandidate(run,artifact,now).artifactBytesVerified,false);
  for(const mutate of [v=>{v.run.run_attempt=2;},v=>{v.run.conclusion='failure';},v=>{v.run.head_sha='b'.repeat(40);},v=>{v.run.repository.id=1;},
    v=>{v.artifact.digest='sha256:'+'b'.repeat(64);},v=>{v.artifact.id++;},v=>{v.artifact.expired=true;},v=>{v.artifact.size_in_bytes++;},
    v=>{v.artifact.workflow_run.head_repository_id=1;}]){const v=metadata();mutate(v);assert.throws(()=>verifyCandidate(v.run,v.artifact,now));}
  assert.throws(()=>verifyCandidate(run,artifact,Date.parse(P.artifactExpiresAt)));
});
test('grant proposal changes only trust and same inline time conditions on exactly the new V2 role',()=>{
  const base=lockedPublisherFoundation(),g=grantTemplate(window),r=g.Resources.PlatformImagePublisher.Properties;
  const allow=r.AssumeRolePolicyDocument.Statement.find(s=>s.Effect==='Allow');assert(allow);
  assert.equal(allow.Condition.StringEquals['token.actions.githubusercontent.com:sub'],P.oidcSubject);
  assert.match(allow.Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref'],/@a{40}$/);
  assert.equal(allow.Condition.StringEquals['token.actions.githubusercontent.com:actor_id'],P.actorId);
  for(const s of r.Policies[0].PolicyDocument.Statement)assert.equal(s.Condition.DateLessThan['aws:CurrentTime'],window.expiresAtUtc);
  const restored=structuredClone(g);restored.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument=base.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument;
  restored.Resources.PlatformImagePublisher.Properties.Policies=base.Resources.PlatformImagePublisher.Properties.Policies;assert.deepEqual(restored,base);
  assert.doesNotMatch(JSON.stringify(r.Policies),/iam:|cloudformation:|ecs:|secretsmanager:|ecr:Delete/);
});
test('grant rejects branch refs, zero/long windows, invalid dates and dates beyond bound artifact expiry',()=>{
  for(const d of [{reusableCommit:'refs/heads/main'},{expiresAtUtc:window.startsAtUtc},{expiresAtUtc:'2026-10-22T11:00:01Z'},
    {startsAtUtc:'invalid'},{startsAtUtc:'2026-10-24T18:30:00Z',expiresAtUtc:'2026-10-24T19:00:00Z'}])assert.throws(()=>grantTemplate({...window,...d}));
});
test('revoke proposal denies all ECR permissions as well as closing trust; does not change boundary or other resources',()=>{
  const b=lockedPublisherFoundation(),r=revokeTemplate();
  assert.deepEqual(r.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument,b.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument);
  assert.deepEqual(r.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument,
    {Version:'2012-10-17',Statement:[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]});
  const restored=structuredClone(r);restored.Resources.PlatformImagePublisher.Properties.Policies=b.Resources.PlatformImagePublisher.Properties.Policies;assert.deepEqual(restored,b);
});
function scan(){return {report:{ArtifactName:P.imageConfigDigest,ArtifactType:'container_image',Metadata:{ImageID:P.imageConfigDigest,OS:{Family:'debian',Name:'12.9',EOSL:false}},
  Results:[{Class:'os-pkgs',Packages:Array.from({length:20},(_,i)=>({Name:'synthetic-'+i})),Vulnerabilities:[]}]},database:{Version:2,UpdatedAt:'2026-10-21T19:00:00Z'}};}
test('OS scan gate requires exact loaded config, supported OS, package coverage, fresh DB and zero HIGH/CRITICAL',()=>{
  let v=scan();assert.equal(verifyOsScan(v.report,v.database,now).outcome,'OS_HIGH_CRITICAL_ZERO');
  v.report.Results[0].Vulnerabilities=[{Severity:'HIGH'}];assert.equal(verifyOsScan(v.report,v.database,now).outcome,'HIGH_CRITICAL_FINDINGS');
  for(const change of [x=>{x.report.Metadata.ImageID='other';},x=>{x.report.Metadata.OS.EOSL=true;},x=>{x.report.Results=[];},x=>{x.report.Results[0].Packages=[];},
    x=>{x.database.UpdatedAt='2026-10-10T00:00:00Z';},x=>{x.report.Results[0].Vulnerabilities=[{Severity:'LOW'}];}]){
    v=scan();change(v);assert.throws(()=>verifyOsScan(v.report,v.database,now));
  }
});
test('cloud preflight rejects AWS/OIDC credentials, PR/re-run and Node overrides before any download',()=>{
  const e={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:P.repository,GITHUB_REPOSITORY_ID:String(P.repositoryId),GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'1'};
  assertNoAwsContext(e);
  for(const [k,val]of [['AWS_ACCESS_KEY_ID','synthetic'],['AWS_PROFILE','synthetic'],['ACTIONS_ID_TOKEN_REQUEST_TOKEN','synthetic'],
    ['NODE_OPTIONS','synthetic'],['GITHUB_EVENT_NAME','pull_request'],['GITHUB_RUN_ATTEMPT','2']])assert.throws(()=>assertNoAwsContext({...e,[k]:val}));
});
test('No-AWS preflight workflow reads and tests exact existing image, never builds, requests OIDC, logs in, pushes or changes environments',async()=>{
  const text=await readFile(new URL('../.github/workflows/platform-image-publication-candidate.yml',import.meta.url),'utf8'),w=load(text);
  assert.deepEqual(w.permissions,{contents:'read'});assert.deepEqual(w.jobs['checked-image'].permissions,{contents:'read',actions:'read'});
  assert.equal(w.jobs['checked-image'].environment,undefined);assert(!text.includes('id-token:'));
  assert.match(text,/--network none/);assert.match(text,/--read-only/);assert.match(text,/--ignorefile/);
  assert.doesNotMatch(text,/docker build|docker push|docker login|configure-aws|ignore-unfixed|skip-db-update|secrets\./);
  assert.match(text,/node ops\/platform-image-publication-v1\/preflight.mjs scan/);
  const artifact=w.jobs['checked-image'].steps.find(s=>s.uses?.startsWith('actions/upload-artifact'));
  assert(!artifact.with.path.includes('image.tar'));assert(!artifact.with.path.includes('os-scan.json'));
});
test('previous approved factories remain unchanged; publication proposal is outside hosting runtime',async()=>{
  const files=[['ops/platform-image-recovery-v2/publisher-foundation.mjs','4b3e8c268ebd989f766795671131576e97af05345ba4d65cea26a56455509ba8'],
    ['ops/platform-image-recovery-v1/recovery.mjs','34074420bff9b90da65ef73b3dc945905ef4269c4fd8d694a4f232a989c3f261']];
  for(const [file,h]of files)assert.equal(createHash('sha256').update((await readFile(new URL('../'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n')).digest('hex'),h);
  const start=await readFile(new URL('../ops/platform-hosting-v1/start.mjs',import.meta.url),'utf8');assert(!start.includes('image-publication'));
});
