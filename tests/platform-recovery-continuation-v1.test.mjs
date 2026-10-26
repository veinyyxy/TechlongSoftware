import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {W,hash,canonical,lease,review,validate,request,verifyObserved,runOnce,errorCode} from '../ops/platform-recovery-continuation-v1/plan.mjs';
import {validateHostingObjects} from '../ops/platform-recovery-launch-v1/local.mjs';
import {T,BEFORE,IMAGE,nextTemplate} from '../ops/platform-recovery-hosting-v1/plan.mjs';
import {H as OLD} from '../ops/platform-hosted-deploy-v6/contract.mjs';
import {RECOVERY_CONTROL_BINDING as B} from '../ops/platform-recovery-control-v1/binding.mjs';
import {ORIGINAL_REQUEST} from '../ops/platform-recovery-launch-v1/request-evidence.mjs';
import {createCloud,createContinuationCloud} from '../ops/platform-recovery-hosting-v1/cloud.mjs';
import {parseArgs} from '../ops/platform-recovery-continuation-v1/local.mjs';
const at=Date.parse('2026-10-26T21:00:00Z'),source='2'.repeat(40),nonce='a'.repeat(32),inactive=Array.from({length:8},(_,i)=>W.priorDefinition.replace(/:9$/,':'+(i+1)));
function manifest(){return review({sourceCommit:source,pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'b'.repeat(64)})),
  ci:{sourceCommit:source,attempt:1,status:'completed',conclusion:'success'},
  before:{stackId:W.stackId,healthy:true,ids:{...BEFORE.ids,TaskDefinition:W.priorDefinition},oldLease:lease(W.priorAt,W.priorSource),
    templateSha256:hash(nextTemplate(W.priorSource)),taskArn:'synthetic-old',inactive,tags:[],supplySha256:'c'.repeat(64)},
  requestEvidence:{schema:'techlong/original-recovery-request-evidence/v1',...ORIGINAL_REQUEST,basisSha256:B.basisSha256,artifactsVerified:12},
  auth:{length:100,aclSha256:'d'.repeat(64),contentRead:false},parents:Array.from({length:3},()=>({rawSha256:'e'.repeat(64)})),
  compatibility:{sourceCommit:source,imageSource:W.imageSource,protectedCodeUnchanged:true},nonce,issuedAt:at});}
function observed(updated){const d=updated?W.priorDefinition.replace(/:9$/,':10'):W.priorDefinition,s=updated?source:W.priorSource,
  l=lease(updated?at:W.priorAt,s),doc=nextTemplate(s),ids={...BEFORE.ids,TaskDefinition:d};
  return {raw:{stack:{Stacks:[{StackId:W.stackId,StackStatus:'UPDATE_COMPLETE',DisableRollback:false,Tags:[]}]},
    resources:{StackResourceSummaries:Object.entries(ids).map(([k,v])=>({LogicalResourceId:k,PhysicalResourceId:v,ResourceType:doc.Resources[k].Type,ResourceStatus:'UPDATE_COMPLETE'}))},
    template:{TemplateBody:doc},definition:{taskDefinition:{containerDefinitions:[{image:IMAGE,
      environment:[{name:'TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT',value:s}],secrets:[{name:'synthetic',valueFrom:'unchanged-fixed-version'}]}]}},
    tasks:{tasks:[{containers:[{imageDigest:W.imageDigest}]}]},service:{services:[{deploymentConfiguration:{maximumPercent:100,minimumHealthyPercent:0,
      deploymentCircuitBreaker:{enable:true,rollback:false},strategy:'ROLLING',bakeTimeInMinutes:0}}]},
    events:{StackEvents:[{ResourceType:'AWS::CloudFormation::Stack',PhysicalResourceId:W.stackId,ResourceStatus:'UPDATE_COMPLETE',
      ClientRequestToken:updated?'recovery-continuation-'+nonce:W.priorToken,Timestamp:new Date((updated?at:W.priorAt)+1000).toISOString()}]},supply:{synthetic:true}},
    extra:{stackPolicy:null,changeSets:[],definitions:{ACTIVE:[d],INACTIVE:updated?[...inactive,W.priorDefinition]:inactive,DELETE_IN_PROGRESS:[]}},lease:l};}
const shared=copy=>{assert.equal(copy.definition.taskDefinition.containerDefinitions[0].environment[0].value,OLD.imageSource);
  assert.deepEqual(copy.definition.taskDefinition.containerDefinitions[0].secrets,[{name:'synthetic',valueFrom:'unchanged-fixed-version'}]);
  return {healthy:true,taskArn:'synthetic-task',taskDefinition:copy.resources.StackResourceSummaries.find(x=>x.LogicalResourceId==='TaskDefinition').PhysicalResourceId};};
test('only source/metadata and lease change; image/roles/secrets/all infrastructure remain unchanged',()=>{
  const before=nextTemplate(W.priorSource),after=nextTemplate(source),c=after.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  c.Environment.find(x=>x.Name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT').Value=W.priorSource;after.Metadata.ExecutionSource=W.priorSource;
  assert.deepEqual(after,before);assert.equal(Object.keys(after.Resources).length,11);assert.notEqual(W.slot,T.slot);assert.notEqual(W.inspectSlot,T.inspectSlot);
  const m=manifest(),r=request(m,at);assert.equal(r.DisableRollback,false);assert.equal(r.RoleARN,undefined);assert.equal(r.Capabilities,undefined);assert.equal(r.Tags,undefined);
  assert.deepEqual(r.Parameters[0],{ParameterKey:'HostingExpiresAt',UsePreviousValue:true});assert.equal(JSON.parse(r.Parameters[1].ParameterValue).issuedAt,at);
});
test('review binds revision9, original request provenance, readonly preflight, exact source and unchanged deadline',()=>{
  const m=manifest();validate(m,m.manifestSha256,at);assert.equal(m.scope.sqlQueriesMax,45);assert.equal(m.scope.databaseWrites,0);
  assert.equal(m.scope.neonReadonlyPreflight,true);assert.equal(m.requestEvidence.transactionAt,1792970812292);
  assert(m.latestStartAt<=T.basisExpiresAt-35*60000);assert.equal(m.expiresAt,Math.min(at+T.validMs,T.basisExpiresAt));
  for(const change of [m=>m.before.ids.TaskDefinition=BEFORE.ids.TaskDefinition,m=>m.requestEvidence.transactionAt+=3036,m=>m.scope.newIam=1,m=>m.slot=T.slot]){
    const n=structuredClone(m);change(n);assert.throws(()=>validate(n,n.manifestSha256,at));}
  assert.throws(()=>validate(m,'0'.repeat(64),at));assert.throws(()=>validate(m,m.manifestSha256,m.latestStartAt));
});
test('same strict verifier accepts actual-before9 and newer-after10 without changing raw evidence',async()=>{
  for(const updated of [false,true]){const x=observed(updated),before=canonical(x.raw);const p=await verifyObserved(x.raw,x.extra,{updated,source,controlLease:x.lease,
    intentAt:at,token:'recovery-continuation-'+nonce},shared);assert.equal(canonical(x.raw),before);assert.equal(p.healthy,true);}
});
test('only current known old revision9 may be in managed deletion after this continuation',async()=>{
  const x=observed(true);x.extra.definitions.DELETE_IN_PROGRESS=[W.priorDefinition];
  await verifyObserved(x.raw,x.extra,{updated:true,source,controlLease:x.lease,intentAt:at,token:'recovery-continuation-'+nonce},shared);
  x.extra.definitions.DELETE_IN_PROGRESS=[BEFORE.ids.TaskDefinition];await assert.rejects(verifyObserved(x.raw,x.extra,{updated:true,source,controlLease:x.lease,
    intentAt:at,token:'recovery-continuation-'+nonce},shared));
});
for(const fault of ['revision','source','template','event','policy','extraDefinition'])test('reject '+fault+' drift before shared normalization',async()=>{
  const x=observed(true);if(fault==='revision')x.raw.resources.StackResourceSummaries.find(x=>x.LogicalResourceId==='TaskDefinition').PhysicalResourceId=W.priorDefinition;
  if(fault==='source')x.raw.definition.taskDefinition.containerDefinitions[0].environment[0].value=W.priorSource;
  if(fault==='template')x.raw.template.TemplateBody.Resources.TaskDefinition.Properties.TaskRoleArn='unexpected';
  if(fault==='event')x.raw.events.StackEvents[0].ClientRequestToken=W.priorToken;
  if(fault==='policy')x.extra.stackPolicy={unexpected:true};if(fault==='extraDefinition')x.extra.definitions.ACTIVE.push(W.priorDefinition);
  let calls=0;await assert.rejects(verifyObserved(x.raw,x.extra,{updated:true,source,controlLease:x.lease,intentAt:at,token:'recovery-continuation-'+nonce},()=>{calls++;}));assert.equal(calls,0);
});
function runFixture(fail){const m=manifest(),calls=[];let clock=at;const act=n=>{calls.push(n);if(n===fail)throw Error('SYNTHETIC_'+n);};
  const io={assertSource:async()=>act('source'),assertHumanReady:async()=>act('human'),snapshot:async()=>{act('snapshot');return {baseline:structuredClone(m.before),checkedAt:clock};},
    confirmNeon:async()=>{act('neon');return {neonReadinessVerified:true,writes:0,queries:12,checkedAt:clock};},record:async n=>act('record:'+n),claim:async()=>act('claim'),
    update:async()=>{act('update');return {StackId:W.stackId};},stack:async()=>{act('stack');return {StackId:W.stackId,StackStatus:'UPDATE_COMPLETE',LastUpdatedTime:new Date(clock)};},
    observe:async()=>{act('observe');return {proof:{healthy:true},counts:{writes:1}};},wait:async()=>{clock+=10000;}};
  return {m,io,calls,now:()=>clock,time:v=>{clock=v;}};}
const run=f=>runOnce({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:f.now});
test('AWS and complete readonly Neon readiness both precede one permanent claim and one UpdateStack',async()=>{
  const f=runFixture(),r=await run(f);assert.equal(r.outcome,'RECOVERY_CONTINUATION_METADATA_VERIFIED_ACCEPTANCE_PENDING');
  assert(f.calls.indexOf('snapshot')<f.calls.indexOf('neon'));assert(f.calls.indexOf('neon')<f.calls.indexOf('claim'));
  assert(f.calls.indexOf('claim')<f.calls.indexOf('update'));assert.equal(f.calls.filter(x=>x==='update').length,1);assert.equal(r.businessDeploymentAccepted,false);
});
for(const fail of ['human','snapshot','neon','claim','update','record:update-ack','stack','observe'])test('failure '+fail+' never retries or compensates',async()=>{
  const f=runFixture(fail),r=await run(f);assert(r.outcome.includes('STOPPED'));assert.equal(r.retryAllowed,false);assert(f.calls.filter(x=>x==='update').length<=1);
  if(['human','snapshot','neon','claim'].includes(fail))assert(!f.calls.includes('update'));
});
test('stale facts, false Neon readiness or missing fresh completion time cannot authorize an update',async()=>{
  for(const n of [{neonReadinessVerified:false,writes:0,queries:12,checkedAt:at},{neonReadinessVerified:true,writes:1,queries:12,checkedAt:at},
    {neonReadinessVerified:true,writes:0,queries:46,checkedAt:at}]){const f=runFixture();f.io.confirmNeon=async()=>n;await run(f);assert(!f.calls.includes('claim'));}
  const f=runFixture();f.io.claim=async()=>f.time(at+120001);await run(f);assert(!f.calls.includes('update'));
});
test('both transport constructors stay readonly before identity/credentials even with supplied override-like fields',async()=>{
  for(const factory of [createCloud,createContinuationCloud]){const c=factory({readOnly:true,validator:()=>true,endpoint:'https://invalid.example'});
    try{await assert.rejects(c.update({}),/WRITE_DISABLED/);assert.deepEqual(c.counts,{sts:0,metadata:0,writes:0});}finally{c.close();}}
});
test('new CLI never accepts scope/profile/endpoint/slot overrides; --check is side-effect free',()=>{
  for(const a of [[],['--mode','RunReviewed','--output','F:/bad'],['--mode','Snapshot','--output','F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-test','--profile','root']])assert.throws(()=>parseArgs(a));
  const p=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-recovery-continuation-v1/local.mjs','--check'],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.awsCalls+r.sqlConnections+r.privateReads+r.slotsConsumed,0);
});
test('Review preparation requires matching continuation intent/source and its independent inspection outcome',()=>{
  const m=manifest(),intent={manifestSha256:m.manifestSha256,intentAt:at,request:request(m,at),controlLease:lease(at,source)},
    inspection={outcome:'RECOVERY_CONTINUATION_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',cloudWrites:0,proof:{controlLease:intent.controlLease},
      controlAcceptancePassed:false,businessDeploymentAccepted:false};
  validateHostingObjects(m,intent,inspection,source);
  assert.throws(()=>validateHostingObjects(m,intent,{...inspection,outcome:'RECOVERY_HOSTING_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING'},source));
  assert.throws(()=>validateHostingObjects(m,intent,inspection,W.priorSource));
  assert.throws(()=>validateHostingObjects(m,{...intent,intentAt:at+1},inspection,source));
  assert.equal(errorCode(Error('RECOVERY_CONTINUATION_SOURCE')),'RECOVERY_CONTINUATION_SOURCE');
  assert.equal(errorCode(Error('UNTRUSTED_UPPERCASE_SECRET')),null);
});
