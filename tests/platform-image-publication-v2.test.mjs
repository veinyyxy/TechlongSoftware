import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {P,hash,verifyCandidate,validateReview,templates,validateCloud,validateClaims,verifyPublishedManifest} from '../ops/platform-image-publication-v2/plan.mjs';
import {assertArtifactContext} from '../ops/platform-image-publication-v2/artifact.mjs';
import {verifyPreflight,runPublisher,coordinatePublication} from '../ops/platform-image-publication-v2/publish.mjs';
import {verifyInitialSnapshot} from '../ops/platform-image-publication-v2/inspect-aws.mjs';
import {lockedPublisherFoundation} from '../ops/platform-image-recovery-v2/publisher-foundation.mjs';
import {RECOVERY_SCOPE as R} from '../ops/platform-image-recovery-v1/recovery.mjs';
const now=Date.parse('2026-10-22T10:20:00Z');
function review(){return {schema:'techlong/platform-image-publication-review/v2',reusableCommit:'a'.repeat(40),dispatchCommit:'b'.repeat(40),
  nonce:'c'.repeat(32),issuedAt:'2026-10-21T23:30:00Z',expiresAt:'2026-10-23T23:30:00Z',
  grantStartsAt:'2026-10-22T10:00:00Z',grantExpiresAt:'2026-10-22T11:00:00Z',candidate:{...P}};}
function input(){const m=review(),text=JSON.stringify(m);return {text,approvedSha:hash(text),m};}
function env(){return {GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:P.repository,GITHUB_REPOSITORY_ID:String(P.repositoryId),GITHUB_ACTOR_ID:P.actorId,
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),GITHUB_RUN_ID:'1234567890',
  GITHUB_WORKFLOW_REF:`${P.repository}/.github/workflows/${P.callerFile}@refs/heads/main`};}
function proof(){return {schema:'techlong/platform-publication-preflight/v2',outcome:'OS_HIGH_CRITICAL_ZERO',sourceCommit:P.sourceCommit,producerRunId:P.runId,
  artifactId:P.artifactId,artifactZipDigest:P.artifactDigest,archiveSha256:P.archiveSha256,imageConfigDigest:P.imageConfigDigest,
  os:{Family:'alpine',Name:'3.24.1'},packageCount:18,findingSeverityCounts:{HIGH:0,CRITICAL:0},findings:[],findingsTruncated:false,
  ignoredFindingsAllowed:false,ignoreUnfixedAllowed:false,scannerVersion:P.scannerVersion,scannerArchiveSha256:P.scannerSha256,
  reportSha256:'d'.repeat(64),databaseSha256:'e'.repeat(64),databaseMetadataSha256:'f'.repeat(64),
  databaseUpdatedAt:'2026-10-22T10:00:00Z',recordedAtUtc:'2026-10-22T10:19:00Z'};}
function claims(){return {iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',sub:P.subject,repository:P.repository,
  repository_id:String(P.repositoryId),repository_owner_id:P.ownerId,actor_id:P.actorId,ref:'refs/heads/main',event_name:'workflow_dispatch',environment:P.environment,
  run_id:env().GITHUB_RUN_ID,run_attempt:'1',sha:'b'.repeat(40),workflow_ref:env().GITHUB_WORKFLOW_REF,
  job_workflow_ref:`${P.repository}/.github/workflows/${P.reusableFile}@${'a'.repeat(40)}`,job_workflow_sha:'a'.repeat(40),iat:now/1000-30,exp:now/1000+300};}
function manifest(){const imageManifest=JSON.stringify({schemaVersion:2,config:{digest:P.imageConfigDigest},layers:[{digest:'sha256:'+'d'.repeat(64)}]});
  return {images:[{registryId:P.account,repositoryName:P.ecrRepository,imageId:{imageTag:P.targetTag,imageDigest:'sha256:'+hash(imageManifest)},
    imageManifestMediaType:'application/vnd.docker.distribution.manifest.v2+json',imageManifest}],failures:[]};}
function publisherPorts(fail){const calls=[],port=name=>async()=>{calls.push(name);if(name===fail)throw Error('SYNTHETIC_'+name);};
  return {calls,ports:{consume:port('consume'),authenticate:async()=>{await port('authenticate')();return {Account:P.account,
    UserId:P.roleId+':Platform-'+env().GITHUB_RUN_ID+'-1',Arn:`arn:aws:sts::${P.account}:assumed-role/${P.role}/Platform-${env().GITHUB_RUN_ID}-1`};},
    inventory:async()=>{await port('inventory')();return {imageDetails:[]};},login:port('login'),tag:port('tag'),push:port('push'),
    manifest:async()=>{await port('manifest')();return manifest();},save:port('save'),dispose:port('dispose')}};}

test('new lineage is explicit and requires official original main push/artifact, never the blocked Debian image',()=>{
  const run={id:P.runId,head_sha:P.sourceCommit,head_branch:'main',event:'push',run_attempt:1,status:'completed',conclusion:'success',workflow_id:P.workflowId,
    path:'.github/workflows/platform-hosting-candidate.yml',repository:{id:P.repositoryId}};
  const artifact={id:P.artifactId,name:P.artifactName,size_in_bytes:P.artifactBytes,digest:P.artifactDigest,expired:false,expires_at:P.artifactExpiresAt,
    workflow_run:{id:P.runId,head_sha:P.sourceCommit,repository_id:P.repositoryId,head_repository_id:P.repositoryId}};
  verifyCandidate(run,artifact,now);
  for(const delta of [{id:12371098858},{digest:'sha256:'+'0'.repeat(64)},{expired:true},{size_in_bytes:1}])assert.throws(()=>verifyCandidate(run,{...artifact,...delta},now));
  assert.throws(()=>verifyCandidate({...run,run_attempt:2},artifact,now));assert.throws(()=>verifyCandidate(run,artifact,Date.parse(P.artifactExpiresAt)));
});
test('review binds exact bytes, whole new candidate, two immutable commits and bounded dates; no generic approval',()=>{
  const {text,approvedSha}=input();assert.equal(validateReview(text,approvedSha,now).candidate.roleId,P.roleId);
  assert.throws(()=>validateReview(text+' ',approvedSha,now));
  for(const modify of [m=>{m.candidate.artifactId=12371098858;},m=>{m.reusableCommit='main';},m=>{m.nonce='arbitrary';},
    m=>{m.extra=true;},m=>{m.expiresAt='2026-10-25T00:00:00Z';},m=>{m.grantExpiresAt='2026-10-22T11:00:01Z';},m=>{m.issuedAt='invalid';}]){
    const m=review();modify(m);const t=JSON.stringify(m);assert.throws(()=>validateReview(t,hash(t),now));
  }
});
test('grant/revoke alter only same V2 role trust and inline, keep exact boundary and no CFN/IAM authority in publisher',()=>{
  const b=lockedPublisherFoundation(),t=templates(review()),r=t.grant.Resources.PlatformImagePublisher.Properties;
  const c=r.AssumeRolePolicyDocument.Statement.at(-1).Condition;
  assert.equal(c.StringEquals['token.actions.githubusercontent.com:job_workflow_ref'],claims().job_workflow_ref);
  assert.equal(c.StringEquals['token.actions.githubusercontent.com:sub'],P.subject);
  for(const s of r.Policies[0].PolicyDocument.Statement)assert.equal(s.Condition.DateLessThan['aws:CurrentTime'],review().grantExpiresAt);
  assert.deepEqual(t.revoke.Resources.PlatformImagePublisher.Properties.Policies[0].PolicyDocument,
    {Version:'2012-10-17',Statement:[{Sid:'LockedDenyAllEcr',Effect:'Deny',Action:['ecr:*'],Resource:'*'}]});
  for(const v of [t.grant,t.revoke]){v.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument=b.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument;
    v.Resources.PlatformImagePublisher.Properties.Policies=b.Resources.PlatformImagePublisher.Properties.Policies;assert.deepEqual(v,b);}
});
test('cloud and JWT require exact actor/branch/first dispatch/caller/reusable immutable SHA and no inherited credentials',()=>{
  validateCloud(env(),review(),now);validateClaims(claims(),env(),review(),now);
  for(const [k,v] of [['GITHUB_RUN_ATTEMPT','2'],['GITHUB_SHA','d'.repeat(40)],['GITHUB_EVENT_NAME','push'],['GITHUB_ACTOR_ID','1'],
    ['AWS_PROFILE','synthetic'],['DOCKER_HOST','synthetic'],['NODE_OPTIONS','synthetic']])assert.throws(()=>validateCloud({...env(),[k]:v},review(),now));
  for(const [k,v] of [['job_workflow_sha','d'.repeat(40)],['sub','legacy'],['actor_id','1'],['run_id','123'],['exp',now/1000-1],
    ['job_workflow_ref','refs/heads/main'],['environment','other']])assert.throws(()=>validateClaims({...claims(),[k]:v},env(),review(),now));
  assert.throws(()=>validateCloud(env(),review(),Date.parse(review().grantExpiresAt)-60000));
});
test('preflight refuses stale, incomplete, wrong-image, ignored, unfixed or nonzero scans before any session',()=>{
  verifyPreflight(proof(),now);
  for(const change of [p=>{p.imageConfigDigest='other';},p=>{p.findingSeverityCounts.HIGH=1;},p=>{p.ignoreUnfixedAllowed=true;},
    p=>{p.findingsTruncated=true;},p=>{p.os.EOSL=true;},p=>{p.recordedAtUtc='2026-10-22T10:00:00Z';},p=>{p.packageCount=0;},p=>{p.databaseUpdatedAt='2026-10-19T00:00:00Z';}]){
    const p=proof();change(p);assert.throws(()=>verifyPreflight(p,now));
  }
});
test('publisher consumes once before one auth/login/tag/push and reads actual config-linked registry manifest; not a revoke claim',async()=>{
  const {ports,calls}=publisherPorts();const r=await runPublisher({...input(),env:env(),preflight:proof(),ports,now});
  assert.deepEqual(calls,['consume','authenticate','inventory','login','tag','push','manifest','save','dispose']);
  assert.equal(r.pushProcessCalls,1);assert.equal(r.iamRevokeProved,false);assert.equal(r.outcome,'IMAGE_PUBLISHED_REVOKE_NOT_YET_PROVED');
  assert.notEqual(r.manifestDigest,r.imageConfigDigest);
});
test('publisher rejects before consume on bad review and never retries failures or leaves local auth undisposed',async()=>{
  let x=publisherPorts();await assert.rejects(runPublisher({...input(),approvedSha:'0'.repeat(64),env:env(),preflight:proof(),ports:x.ports,now}));assert.deepEqual(x.calls,[]);
  for(const stage of ['authenticate','inventory','login','push','manifest']){
    x=publisherPorts(stage);await assert.rejects(runPublisher({...input(),env:env(),preflight:proof(),ports:x.ports,now}));
    assert.equal(x.calls.at(-1),'dispose');assert.equal(x.calls.filter(v=>v===stage).length,1);
  }
  x=publisherPorts();x.ports.inventory=async()=>({imageDetails:[{imageDigest:'existing'}]});
  await assert.rejects(runPublisher({...input(),env:env(),preflight:proof(),ports:x.ports,now}),/REPOSITORY_NOT_EMPTY/);assert(!x.calls.includes('push'));
});
test('registry response requires full raw-manifest hash plus exact tag/repository/account and config, not merely Docker stdout',()=>{
  verifyPublishedManifest(manifest());
  for(const change of [r=>{r.images[0].imageId.imageTag='latest';},r=>{r.images[0].registryId='other';},r=>{r.images[0].imageManifest+=' ';},
    r=>{r.failures=[{failureCode:'synthetic'}];},r=>{r.images[0].imageManifestMediaType='application/vnd.oci.image.index.v1+json';}]){
    const r=manifest();change(r);assert.throws(()=>verifyPublishedManifest(r));
  }
});
test('Source coordinator boundary always attempts revoke and independent Locked verification, including ambiguous grant/dispatch errors',async()=>{
  for(const failure of [null,'grant','verifyGrant','dispatchAndWait']){
    const calls=[],ports=Object.fromEntries(['preflight','consume','grant','verifyGrant','dispatchAndWait','revoke','verifyLocked'].map(k=>[k,async()=>{
      calls.push(k);if(k===failure)throw Error('synthetic');return {outcome:'synthetic'};} ]));
    const invoke=()=>coordinatePublication({...input(),ports,now});if(failure)await assert.rejects(invoke());else await invoke();
    assert.deepEqual(calls.slice(-2),['revoke','verifyLocked']);assert.equal(calls.filter(k=>k==='grant').length,1);
  }
  const ports=Object.fromEntries(['preflight','consume','grant','verifyGrant','dispatchAndWait','revoke'].map(k=>[k,async()=>{}]));
  ports.verifyLocked=async()=>{throw Error('LOCK_NOT_PROVED');};await assert.rejects(coordinatePublication({...input(),ports,now}),/LOCK_NOT_PROVED/);
});
test('No-AWS preflight has no AWS/OIDC/environment/publish authority; reusable is workflow_call only and checks out OIDC-derived source',async()=>{
  const ciText=await readFile(new URL('../.github/workflows/platform-image-publication-v2-candidate.yml',import.meta.url),'utf8'),ci=load(ciText);
  assert.deepEqual(ci.permissions,{contents:'read'});assert.equal(ci.jobs['exact-image'].environment,undefined);assert(!ciText.includes('id-token:'));
  assert.doesNotMatch(ciText,/publish\.mjs|secrets\./);
  const w=load(await readFile(new URL('../.github/workflows/platform-image-publish-job-v2.yml',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(w.on),['workflow_call']);assert.deepEqual(w.permissions,{});assert.equal(w.jobs.publish.environment,P.environment);
  assert.equal(w.jobs.publish.steps.find(s=>s.uses?.startsWith('actions/checkout')).with.ref,'${{ steps.source.outputs.sha }}');
  assert(w.jobs.publish.steps[0].run.includes('c.job_workflow_sha'));assert(!w.jobs.publish.steps[0].run.includes('console.log(token)'));
  const shell=await readFile(new URL('../ops/platform-image-publication-v2/cloud-preflight.sh',import.meta.url),'utf8');
  assert.match(shell,/--network none/);assert.match(shell,/--ignorefile/);assert.doesNotMatch(shell,/docker push|docker login|ignore-unfixed|skip-db-update|aws /);
  assertArtifactContext({...env(),GITHUB_EVENT_NAME:'push'});assert.throws(()=>assertArtifactContext({...env(),GITHUB_EVENT_NAME:'push',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic'}));
});
test('real publisher adapter isolates Docker auth and cannot fall back to Source profiles, default AWS providers, IAM or deployment',async()=>{
  const source=await readFile(new URL('../ops/platform-image-publication-v2/publish.mjs',import.meta.url),'utf8');
  assert.match(source,/DurationSeconds:900/);assert.match(source,/maxAttempts:1/);assert.match(source,/DOCKER_CONFIG:dockerDir/);
  assert.match(source,/auths:\{\[P.registry\]:\{\}\}/);assert.match(source,/await unlink\(path.join\(dockerDir,'config.json'\)\)/);
  assert.doesNotMatch(source,/defaultProvider|fromIni|credential-provider|['"]\.env|@aws-sdk\/client-(iam|ecs|cloudformation)|rm\(.*recursive/);
  const inspector=await readFile(new URL('../ops/platform-image-publication-v2/inspect-aws.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(inspector,/UpdateStackCommand|PutRolePolicyCommand|UpdateAssumeRolePolicyCommand|GetSecretValueCommand|AssumeRoleWithWebIdentityCommand/);
});
function snapshot(){const t=lockedPublisherFoundation(),r=t.Resources.PlatformImagePublisher.Properties;
  return {source:{Account:P.account,Arn:`arn:aws:iam::${P.account}:user/techlong-sandbox-dev`,UserId:'AIDAV3GNMXTZEO7SHLC2X'},
    stack:{Stacks:[{StackId:P.stackId,StackStatus:'CREATE_COMPLETE',Parameters:[]}]},template:{TemplateBody:JSON.stringify(t)},
    resources:{StackResourceSummaries:[{LogicalResourceId:'PlatformImagePublisher',ResourceType:'AWS::IAM::Role',PhysicalResourceId:P.role,ResourceStatus:'CREATE_COMPLETE'}]},
    role:{Role:{RoleId:P.roleId,Arn:P.roleArn,Path:'/',MaxSessionDuration:3600,PermissionsBoundary:{PermissionsBoundaryArn:r.PermissionsBoundary},AssumeRolePolicyDocument:r.AssumeRolePolicyDocument}},
    inline:{PolicyDocument:r.Policies[0].PolicyDocument},inlineNames:{PolicyNames:['OnlyPlatformWebRepository'],IsTruncated:false},managed:{AttachedPolicies:[],IsTruncated:false},
    boundary:{Policy:{Arn:r.PermissionsBoundary,PolicyId:R.boundaryPolicyId,DefaultVersionId:'v1',AttachmentCount:0,PermissionsBoundaryUsageCount:1}},
    boundaryVersion:{PolicyVersion:{VersionId:'v1',IsDefaultVersion:true,Document:r.Policies[0].PolicyDocument}},
    repository:{repositories:[{registryId:P.account,repositoryName:P.ecrRepository,repositoryArn:`arn:aws:ecr:${P.region}:${P.account}:repository/${P.ecrRepository}`,
      createdAt:R.repositoryCreatedAt,imageTagMutability:'IMMUTABLE',imageScanningConfiguration:{scanOnPush:true},encryptionConfiguration:{encryptionType:'AES256'}}]},images:{imageDetails:[]}};}
test('new readonly guard requires actual RoleId, no-Allow trust, unchanged boundary/inline/template and empty immutable ECR',()=>{
  verifyInitialSnapshot(snapshot());const scalar=snapshot();scalar.role.Role.AssumeRolePolicyDocument.Statement[0].Action='sts:AssumeRole';verifyInitialSnapshot(scalar);
  for(const change of [v=>{v.role.Role.RoleId='replacement';},v=>{v.role.Role.AssumeRolePolicyDocument.Statement.push({Effect:'Allow'});},
    v=>{v.boundary.Policy.PermissionsBoundaryUsageCount=0;},v=>{v.images.nextToken='omitted';},v=>{v.managed.IsTruncated=true;},v=>{v.resources.NextToken='omitted';},
    v=>{v.repository.repositories[0].imageTagMutability='MUTABLE';}]){const v=snapshot();change(v);assert.throws(()=>verifyInitialSnapshot(v));}
});
