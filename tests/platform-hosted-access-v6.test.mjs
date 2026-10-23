import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {H,SCOPE,hash,same,makeReview,validate,suppliedTemplate,readPolicy,verifyAccess,verifySecret,verifyBaseline,
  verifyInstalled,verifyChangeSet,verifiedCreatedArn,changeSetName,install} from '../ops/platform-hosted-access-v6/contract.mjs';
import {P,handoffPolicy} from '../ops/platform-ecs-v1/contract.mjs';
import {accessTemplate,executionPolicy,trust,tags} from '../ops/platform-ecs-v1/templates.mjs';
import {P as OLD} from '../ops/platform-image-publication-v2/plan.mjs';
import {verifyReceipt} from '../ops/platform-hosting-v1/image-artifact.mjs';
import {PRODUCER,RETAINED_IMAGE,bindCandidate,hostedProtocol,runHostedPublisher} from '../ops/platform-hosted-access-v6/publication.mjs';
import {main,sourcePins} from '../ops/platform-hosted-access-v6/local.mjs';
const now=Date.parse('2026-10-23T14:30:00Z'),version='01234567-89ab-4cde-8fab-0123456789ab',arn='arn:aws:secretsmanager:ca-central-1:402010193138:secret:'+H.appName+'-Ab12Cd';
const secret=(id,v,policy,kmsArn=H.kmsArn)=>({arn:id,name:id.slice(id.indexOf(':secret:')+8,-7),kmsArn,deleted:false,rotation:false,
  replicas:0,complete:true,versions:v?[{id:v,stages:['AWSCURRENT']}]:[],stages:v?{[v]:['AWSCURRENT']}:{},policy,tags:[]});
function access(installed=false){const t=installed?suppliedTemplate(arn,version):accessTemplate(H.baseNonce);return {
  stackId:H.stackId,status:installed?'UPDATE_COMPLETE':'CREATE_COMPLETE',stackRoleArn:null,parameters:[],template:t,roleId:H.roleId,roleArn:H.roleArn,
  policyId:H.boundaryId,boundaryArn:H.boundaryArn,roleBoundaryArn:H.boundaryArn,path:'/',maxSessionDuration:3600,roleTags:tags(H.baseNonce),trust:trust(),
  inline:structuredClone(t.Resources.ExecutionRole.Properties.Policies[0].PolicyDocument),boundary:structuredClone(t.Resources.ExecutionBoundary.Properties.PolicyDocument),
  inlineNames:[H.inline],managed:[],listsComplete:true,attachmentCount:0,boundaryUsageCount:1,defaultVersion:installed?'v2':'v1',policyVersions:installed?['v1','v2']:['v1'],
  resources:[{logicalId:'ExecutionRole',type:'AWS::IAM::Role',physicalId:H.role,status:'CREATE_COMPLETE'},
    {logicalId:'ExecutionBoundary',type:'AWS::IAM::ManagedPolicy',physicalId:H.boundaryArn,status:'CREATE_COMPLETE'}]};}
function baseline(){return {source:{Account:H.account,Arn:H.sourceArn,UserId:H.sourceId},access:access(),
  web:secret(P.secretArn,P.secretVersion,handoffPolicy()),controller:secret(H.controllerArn,H.controllerVersion,readPolicy(),null),
  app:null,pendingChangeSets:[],pendingComplete:true,kms:{arn:H.kmsArn,manager:'AWS',enabled:true}};}
function review(){return makeReview({sourceCommit:'a'.repeat(40),nonce:'b'.repeat(32),versionId:version,issuedAt:now,riskSha256:'c'.repeat(64),
  pins:Array.from({length:6},(_,i)=>({file:'synthetic-'+i+'.mjs',sha256:'d'.repeat(64)})),
  ci:{sourceCommit:'a'.repeat(40),path:H.ciPath,attempt:1,runId:123,status:'completed',conclusion:'success'},prestate:baseline(),
  keyMetadata:{length:1675,protectedThreePrincipalAcl:true,keyContentRead:false,aclSha256:'e'.repeat(64)}});}
function changeSet(m=review()){return {StackId:H.stackId,StackName:P.accessStack,ChangeSetName:changeSetName(m.nonce),Status:'CREATE_COMPLETE',
  ExecutionStatus:'AVAILABLE',Parameters:[],Capabilities:['CAPABILITY_NAMED_IAM'],Changes:access().resources.map(r=>({Type:'Resource',ResourceChange:{
    LogicalResourceId:r.logicalId,PhysicalResourceId:r.physicalId,ResourceType:r.type,Action:'Modify',Replacement:'False',Scope:['Properties'],
    Details:[{ChangeSource:'DirectModification',Evaluation:'Static',Target:{Attribute:'Properties',Name:r.logicalId==='ExecutionRole'?'Policies':'PolicyDocument',RequiresRecreation:'Never'}}]}}))};}
function fixture(fail){const calls=[],state=baseline(),m=review(),events=[],act=name=>{calls.push(name);if(name===fail)throw Error('HOSTED_SUPPLY_SYNTHETIC_FAILURE');};
  const io={counts:{writes:0},preflight:async()=>{act('preflight');return structuredClone(state);},consume:async()=>act('consume'),
    startWrites:()=>act('start-window'),assertCurrent:async()=>act('guard'),record:async(n,v)=>{events.push({name:n,value:structuredClone(v)});},
    async createEmpty(){act('create');io.counts.writes++;state.app=secret(arn,null,null,null);return arn;},
    async putPolicy(id,p){const stage=id===H.controllerArn?'controller-handoff':same(p,readPolicy())?'protect':'app-handoff';act(stage);io.counts.writes++;
      state[id===H.controllerArn?'controller':'app'].policy=structuredClone(p);},
    async verifyApp(id,m,{empty,handoff}){act(empty?'verify-empty':'verify-app');verifySecret(state.app,{arn:id,version:m.versionId,policy:readPolicy(handoff),empty,kmsDefault:true});},
    async putKey(){act('key-and-put');io.counts.writes++;state.app.versions=[{id:version,stages:['AWSCURRENT']}];state.app.stages={[version]:['AWSCURRENT']};},
    async createChangeSet(){act('create-cs');io.counts.writes++;return 'synthetic-change-set';},
    async reviewChangeSet(){act('review-cs');verifyChangeSet(changeSet(m),suppliedTemplate(arn,version),m,arn);},
    async assertBaseAccess(){act('base-access');verifyAccess(state.access);},
    async executeChangeSet(){act('execute-cs');io.counts.writes++;state.access=access(true);},
    async waitAccess(){act('wait-access');verifyAccess(state.access,{arn,version,installed:true});},
    async verifyControllerSourceOnly(){act('controller-source-only');verifySecret(state.controller,{arn:H.controllerArn,version:H.controllerVersion,policy:readPolicy(),kmsDefault:true});},
    async independentSnapshot(){act('independent');return structuredClone(state);}};
  const text=JSON.stringify(m);return {m,text,sha:hash(text),io,calls,events,state};}

test('supply changes only two existing policy documents, preserving all Web permissions, trust, identities and tags',()=>{
  const t=suppliedTemplate(arn,version),base=accessTemplate(H.baseNonce),p=t.Resources.ExecutionBoundary.Properties.PolicyDocument;
  assert.equal(p.Statement.length,9);assert.deepEqual(p.Statement.slice(0,5),executionPolicy().Statement);
  for(const s of p.Statement.slice(5))assert(!Array.isArray(s.Resource)&&!s.Resource.includes('*'));
  for(const [i,id,v]of [[5,H.controllerArn,H.controllerVersion],[7,arn,version]]){
    assert.equal(p.Statement[i].Resource,id);assert.equal(p.Statement[i].Condition.StringEquals['secretsmanager:VersionId'],v);
    assert.equal(p.Statement[i+1].Condition.StringEquals['kms:EncryptionContext:SecretARN'],id);
    assert.equal(p.Statement[i+1].Condition.StringEquals['kms:EncryptionContext:SecretVersionId'],v);
  }
  t.Resources.ExecutionBoundary.Properties.PolicyDocument=base.Resources.ExecutionBoundary.Properties.PolicyDocument;
  t.Resources.ExecutionRole.Properties.Policies=base.Resources.ExecutionRole.Properties.Policies;assert.deepEqual(t,base);
  for(const bad of [arn+'x',arn.replace('ca-central-1','us-east-1'),H.controllerArn,arn.replace('402010193138','111111111111')])assert.throws(()=>suppliedTemplate(bad,version));
  assert.throws(()=>suppliedTemplate(arn,'AWSCURRENT'));assert.deepEqual(readPolicy(true).Statement[1],readPolicy().Statement[1]);
});
test('baseline refuses unexpected identity, policies, versions, attachments, names and pending operations',()=>{
  verifyBaseline(baseline());
  for(const change of [v=>{v.access.roleId='other';},v=>{v.access.stackRoleArn=H.roleArn;},v=>{v.access.managed=[{}];},
    v=>{v.access.boundary.Statement.push({Effect:'Allow',Action:'*',Resource:'*'});},v=>{v.controller.stages={};},v=>{v.app={};},
    v=>{v.pendingChangeSets=[{}];},v=>{v.web.rotation=true;},v=>{v.access.policyVersions=['v1','v2'];}]){const v=baseline();change(v);assert.throws(()=>verifyBaseline(v));}
});
test('approval is exact SHA, fixed seven-write scope and bounded window; audits do not authorize replay',()=>{
  const m=review(),text=JSON.stringify(m);validate(text,hash(text),now);assert.deepEqual(m.scope,SCOPE);
  for(const change of [m=>{m.scope.topLevelAwsWritesMax=8;},m=>{m.constants.slot+='-new';},m=>{m.appArnBinding='wildcard';},m=>{m.extra=true;}]){
    const x=structuredClone(m);change(x);const s=JSON.stringify(x);assert.throws(()=>validate(s,hash(s),now));}
  assert.throws(()=>validate(text,'0'.repeat(64),now));assert.throws(()=>validate(text,hash(text),m.latestStartAt+1));
  validate(text,hash(text),m.expiresAt+100000,true);assert.throws(()=>validate(text,hash(text),now-1));
});
test('strict Change Set rejects replacement, other resources/properties, imports, nested stacks or altered template',()=>{
  verifyChangeSet(changeSet(),suppliedTemplate(arn,version),review(),arn);
  for(const change of [c=>{c.Changes[0].ResourceChange.Replacement='Conditional';},c=>{c.Changes.push(c.Changes[0]);},
    c=>{c.Changes[1].ResourceChange.LogicalResourceId='OtherBoundary';},
    c=>{c.IncludeNestedStacks=true;},c=>{c.ImportExistingResources=true;},c=>{c.Capabilities.push('CAPABILITY_AUTO_EXPAND');},
    c=>{c.Changes[0].ResourceChange.Details[0].Target.Name='AssumeRolePolicyDocument';},c=>{c.ExecutionStatus='EXECUTE_COMPLETE';}]){
    const c=changeSet();change(c);assert.throws(()=>verifyChangeSet(c,suppliedTemplate(arn,version),review(),arn));}
  const t=suppliedTemplate(arn,version);t.Resources.ExecutionRole.Properties.MaxSessionDuration=7200;assert.throws(()=>verifyChangeSet(changeSet(),t,review(),arn));
  const m=review(),sha=hash(JSON.stringify(m)),ack={arn,nonce:m.nonce,versionId:version,manifestSha256:sha};assert.equal(verifiedCreatedArn(ack,m,sha),arn);
  for(const change of [a=>{a.manifestSha256='0'.repeat(64);},a=>{a.versionId='other';},a=>{a.nonce='other';},a=>{a.arn=H.controllerArn;}]){
    const a=structuredClone(ack);change(a);assert.throws(()=>verifiedCreatedArn(a,m,sha));}
});
test('installer protects empty Secret before one key load, executes exact IAM delta before read handoffs, and independently observes',async()=>{
  const f=fixture(),r=await install({...f,now:()=>now});assert.equal(r.outcome,'SUPPLY_METADATA_INDEPENDENTLY_VERIFIED');
  assert.equal(r.topLevelWritesAttempted,7);assert.equal(r.awsCalls.writes,7);assert.equal(r.hostingDeployed,false);
  assert(f.calls.indexOf('key-and-put')>f.calls.indexOf('verify-empty'));assert(f.calls.indexOf('controller-handoff')>f.calls.indexOf('wait-access'));
  assert(f.calls.indexOf('app-handoff')>f.calls.indexOf('controller-handoff'));assert.equal(f.calls.filter(x=>x==='consume').length,1);
  verifyInstalled(f.state,arn,version);assert.equal(f.events.at(-1).name,'result');assert(!JSON.stringify(f.events).includes('PRIVATE KEY'));
});
test('each write failure stops that attempt, never retries or compensates, always independently reads after slot consumption',async()=>{
  for(const stage of ['start-window','create','protect','key-and-put','create-cs','review-cs','execute-cs','wait-access','controller-handoff','app-handoff']){
    const f=fixture(stage),r=await install({...f,now:()=>now});assert.equal(r.outcome,'SUPPLY_REQUIRES_INSPECT_NO_RETRY',stage);
    assert.equal(f.calls.filter(x=>x===stage).length,1);assert(f.calls.includes('independent'));assert.equal(r.retryAllowed,false);
    assert(!f.calls.some(x=>/delete|rollback|revoke|retry/.test(x)));
  }
});
test('expired/drifted preflight never consumes; ambiguous intent never writes; clock rollback stops later phases',async()=>{
  let f=fixture();await assert.rejects(install({...f,sha:'0'.repeat(64),now:()=>now}));assert.deepEqual(f.calls,[]);
  f=fixture();f.io.preflight=async()=>{const v=baseline();v.access.roleId='other';return v;};await assert.rejects(install({...f,now:()=>now}));assert(!f.calls.includes('consume'));
  f=fixture('consume');await assert.rejects(install({...f,now:()=>now}));assert(!f.calls.includes('create'));
  f=fixture();let clock=now;const old=f.io.createEmpty;f.io.createEmpty=async m=>{const x=await old(m);clock=now-1;return x;};
  const r=await install({...f,now:()=>clock});assert.equal(r.outcome,'SUPPLY_REQUIRES_INSPECT_NO_RETRY');assert(!f.calls.includes('protect'));assert(f.calls.includes('independent'));
});
function candidate(){const receipt={schema:'techlong/platform-web-image-artifact/v1',sourceCommit:PRODUCER.sourceCommit,runId:String(PRODUCER.runId),
  runAttempt:1,imageConfigDigest:'sha256:'+'d'.repeat(64),os:'linux',architecture:'amd64',archiveFile:'image.tar.gz',archiveBytes:1000,archiveSha256:'e'.repeat(64)};
  const verifiedArchive=verifyReceipt(receipt,{bytes:1000,sha256:receipt.archiveSha256},{sourceCommit:PRODUCER.sourceCommit,runId:String(PRODUCER.runId)});
  return bindCandidate({receipt,verifiedArchive,zipDigest:PRODUCER.artifactDigest,zipBytes:PRODUCER.artifactBytes});}
test('W8b adapter keeps legacy defaults and requires bound archive evidence, exact producer and exact retained old image',()=>{
  const c=candidate(),p=hostedProtocol(c);assert.equal(OLD.sourceCommit,'4209fcab429b868e253ea2d7263dfe2189187232');assert.equal(c.sourceCommit,PRODUCER.sourceCommit);
  assert.equal(c.roleId,OLD.roleId);assert.equal(c.ecrRepository,OLD.ecrRepository);assert.notEqual(c.targetTag,OLD.targetTag);
  assert.throws(()=>bindCandidate({receipt:{},verifiedArchive:{},zipDigest:PRODUCER.artifactDigest,zipBytes:PRODUCER.artifactBytes}));
  assert.throws(()=>hostedProtocol({...c,sourceCommit:OLD.sourceCommit}));assert.throws(()=>hostedProtocol({...c,roleId:'other'}));
  p.verifyInventory({imageDetails:[{registryId:c.account,repositoryName:c.ecrRepository,imageDigest:RETAINED_IMAGE.digest,imageTags:[RETAINED_IMAGE.tag]}]});
  for(const v of [{imageDetails:[]},{nextToken:'more',imageDetails:[]},{imageDetails:[{imageDigest:RETAINED_IMAGE.digest,imageTags:['latest']}]}])assert.throws(()=>p.verifyInventory(v));
});
test('W8b candidate uses the original one-push protocol with retained image, never deletes or pretends repository is empty',async()=>{
  const c=candidate(),p=hostedProtocol(c),m={schema:'techlong/platform-image-publication-review/v2',reusableCommit:'1'.repeat(40),dispatchCommit:'2'.repeat(40),
    nonce:'3'.repeat(32),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),grantStartsAt:new Date(now).toISOString(),
    grantExpiresAt:new Date(now+3600000).toISOString(),candidate:c},text=JSON.stringify(m),calls=[];
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:c.repository,GITHUB_REPOSITORY_ID:String(c.repositoryId),GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:m.dispatchCommit,GITHUB_ACTOR_ID:c.actorId,GITHUB_RUN_ID:'123456789',
    GITHUB_WORKFLOW_REF:`${c.repository}/.github/workflows/${c.callerFile}@refs/heads/main`};
  const proof={schema:'techlong/platform-publication-preflight/v2',outcome:'OS_HIGH_CRITICAL_ZERO',sourceCommit:c.sourceCommit,producerRunId:c.runId,
    artifactId:c.artifactId,artifactZipDigest:c.artifactDigest,archiveSha256:c.archiveSha256,imageConfigDigest:c.imageConfigDigest,os:{Family:'alpine',Name:'3.24.0',EOSL:false},
    packageCount:20,findingSeverityCounts:{HIGH:0,CRITICAL:0},findings:[],findingsTruncated:false,ignoredFindingsAllowed:false,ignoreUnfixedAllowed:false,
    scannerVersion:c.scannerVersion,scannerArchiveSha256:c.scannerSha256,reportSha256:'a'.repeat(64),databaseSha256:'b'.repeat(64),databaseMetadataSha256:'c'.repeat(64),
    recordedAtUtc:new Date(now).toISOString(),databaseUpdatedAt:new Date(now).toISOString()};
  const imageManifest=JSON.stringify({schemaVersion:2,config:{digest:c.imageConfigDigest},layers:[{}]});
  const ports={consume:async()=>calls.push('consume'),authenticate:async()=>({Account:c.account,UserId:c.roleId+':Platform-123456789-1',
    Arn:`arn:aws:sts::${c.account}:assumed-role/${c.role}/Platform-123456789-1`}),inventory:async()=>({imageDetails:[{registryId:c.account,repositoryName:c.ecrRepository,
      imageDigest:RETAINED_IMAGE.digest,imageTags:[RETAINED_IMAGE.tag]}]}),login:async()=>calls.push('login'),tag:async()=>calls.push('tag'),push:async()=>calls.push('push'),
    manifest:async()=>({images:[{registryId:c.account,repositoryName:c.ecrRepository,imageId:{imageTag:c.targetTag,imageDigest:'sha256:'+hash(imageManifest)},
      imageManifest,imageManifestMediaType:'application/vnd.docker.distribution.manifest.v2+json'}]}),save:async()=>calls.push('save'),dispose:async()=>calls.push('dispose')};
  const r=await runHostedPublisher({text,approvedSha:hash(text),env,preflight:proof,ports,now},c);assert.equal(r.pushProcessCalls,1);assert.equal(r.iamRevokeProved,false);
  assert.deepEqual(calls,['consume','login','tag','push','save','dispose']);assert.equal(r.sourceCommit,PRODUCER.sourceCommit);
  const grant=p.templates(m).grant;assert(grant.Resources.PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement.some(s=>s.Effect==='Allow'&&
    s.Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref'].includes(c.reusableFile)));
});
test('new CI is content-read only and cannot invoke installer/actual publisher; malformed CLI cannot perform I/O',async()=>{
  const yaml=load(await readFile(H.ciPath,'utf8'));assert.deepEqual(yaml.permissions,{contents:'read'});assert.equal(yaml.on.workflow_dispatch,undefined);
  const steps=yaml.jobs.candidate.steps.map(s=>s.run??'').join('\n');assert(!/RunReviewed|AssumeRole|GetSecretValue|docker push|aws /.test(steps));
  await assert.rejects(main(['RunReviewed','not-a-reviewed-manifest','0'.repeat(64)]));
  assert.equal(typeof sourcePins,'function');
});
