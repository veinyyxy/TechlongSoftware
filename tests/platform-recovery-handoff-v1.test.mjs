import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {H,hash,lease,review,validate,request,verifyObserved,verifyInspection} from '../ops/platform-recovery-handoff-v1/plan.mjs';
import {beginSession,attachIntent,authorizeReview,assertReviewSession} from '../ops/platform-recovery-handoff-v1/session.mjs';
import {runOnce} from '../ops/platform-recovery-handoff-v1/operation.mjs';
import {createHandoffCloud} from '../ops/platform-recovery-hosting-v1/cloud.mjs';
import {validateHostingObjects} from '../ops/platform-recovery-launch-v1/local.mjs';
import {parseArgs} from '../ops/platform-recovery-handoff-v1/local.mjs';
import {BEFORE,nextTemplate,IMAGE} from '../ops/platform-recovery-hosting-v1/plan.mjs';
import {RECOVERY_CONTROL_BINDING as B} from '../ops/platform-recovery-control-v1/binding.mjs';
import {ORIGINAL_REQUEST} from '../ops/platform-recovery-launch-v1/request-evidence.mjs';
const at=Date.parse('2026-10-27T01:00:00Z'),source='2'.repeat(40),nonce='a'.repeat(32),
  inactive=Array.from({length:9},(_,i)=>H.priorDefinition.replace(/:10$/,':'+(i+1)));
function manifest(){const pins=Array.from({length:20},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'b'.repeat(64)}));return review({sourceCommit:source,pins,reviewPins:pins,
  ci:{sourceCommit:source,testedSourceCommit:source,attempt:1,status:'completed',conclusion:'success'},
  before:{stackId:H.stackId,ids:{...BEFORE.ids,TaskDefinition:H.priorDefinition},templateSha256:hash(nextTemplate(H.priorSource)),
    oldLease:lease(H.priorAt,H.priorSource),taskArn:'synthetic',inactive,tags:[],supplySha256:'c'.repeat(64),healthy:true},
  parents:[{file:H.parentFile,rawSha256:H.parentSha256},{file:'synthetic-snapshot',rawSha256:'d'.repeat(64)},{file:'synthetic-state',rawSha256:'e'.repeat(64)}],
  requestEvidence:{schema:'techlong/original-recovery-request-evidence/v1',...ORIGINAL_REQUEST,basisSha256:B.basisSha256,artifactsVerified:12},
  compatibility:{sourceCommit:source,imageSource:H.imageSource,protectedCodeUnchanged:true},auth:{contentRead:false,length:100,aclSha256:'f'.repeat(64)},nonce,issuedAt:at});}
const intent=m=>({manifestSha256:m.manifestSha256,intentAt:at,request:request(m,at),controlLease:lease(at,source)});
const inspection=(m,i)=>({outcome:'RECOVERY_HANDOFF_HOSTING_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING',cloudWrites:0,counts:{sts:1,metadata:40,writes:0},
  proof:{stackId:H.stackId,stackStatus:'UPDATE_COMPLETE',healthy:true,dnsAliasVerified:true,executionSource:source,imageDigest:H.imageDigest,controlLease:i.controlLease,
    taskDefinition:H.priorDefinition.replace(/:10$/,':11'),resources:Object.entries(m.before.ids).map(([id,v])=>({id,type:nextTemplate(source).Resources[id].Type,
      physicalId:id==='TaskDefinition'?H.priorDefinition.replace(/:10$/,':11'):v,status:'UPDATE_COMPLETE'}))},
  controlAcceptancePassed:false,businessDeploymentAccepted:false});
const child=(m,i,x,t)=>({sourceCommit:m.sourceCommit,action:{operation:'PublishReview'},createdAt:t,hostingManifestSha256:m.manifestSha256,
  hostingIntentFile:m.outputs.run+'/update-intent.json',pins:m.reviewPins,ci:m.ci,auth:m.auth,requestEvidence:m.requestEvidence});
test('outer approval fixes exact target, late lease, total effects, outputs, slots and internal derivation',()=>{
  const m=manifest();validate(m,m.manifestSha256,at);assert.equal(m.effects.sqlQueriesMax,145);assert.equal(m.effects.configReadsMax,2);
  assert.equal(m.effects.updateStackMax,1);assert.equal(m.effects.publishPlanSubmissionsMax,1);assert.equal(m.effects.dispatches,0);
  assert.equal(m.session.chainMs,720000);assert.equal(m.session.reviewStartMarginMs,1020000);assert.equal(m.session.reviewEveryGuardMarginMs,900000);
  assert.equal(m.slot,H.slot);assert.equal(m.derivedReview.newHumanApproval,false);assert.equal(m.outputs.run.endsWith(nonce),true);
  const r=request(m,at);assert.equal(r.DisableRollback,false);assert.equal(r.RoleARN,undefined);assert.equal(r.Capabilities,undefined);assert.equal(r.Tags,undefined);
  assert.equal(JSON.parse(r.Parameters[1].ParameterValue).issuedAt,at);assert.equal(r.Parameters[0].UsePreviousValue,true);
});
for(const key of ['effects','slots','session','ci','request','baseline','derivation','outputs'])test('reject outer '+key+' tampering before all ports',async()=>{
  const m=structuredClone(manifest());if(key==='effects')m.effects.publishPlanSubmissionsMax=2;if(key==='slots')m.slot='old';
  if(key==='session')m.session.chainMs++;if(key==='ci')m.ci.testedSourceCommit='0'.repeat(40);if(key==='request')m.requestEvidence.transactionAt++;
  if(key==='baseline')m.before.ids.TaskDefinition=BEFORE.ids.TaskDefinition;if(key==='derivation')m.derivedReview.source='input';if(key==='outputs')m.outputs.run+='-changed';
  const calls=[];await assert.rejects(runOnce({manifest:m,approved:m.manifestSha256,readyAt:at,now:()=>at,io:{record:async()=>calls.push('record')}}));assert.deepEqual(calls,[]);
});
test('single real reply survives a four-minute continuous update but cannot be replaced by a new clock',()=>{
  const m=manifest(),i=intent(m),x=inspection(m,i),ticket=beginSession(m,m.manifestSha256,at,at);attachIntent(ticket,i,at);
  const t=at+4*60000,c=child(m,i,x,t);authorizeReview(ticket,c,i,x,t);
  assert.throws(()=>authorizeReview(ticket,c,i,x,t));
  assertReviewSession(ticket,{review:c,lease:i.controlLease,readyAt:at,at:t});
  assert.throws(()=>assertReviewSession(ticket,{review:c,lease:i.controlLease,readyAt:t,at:t}));
  assert.throws(()=>assertReviewSession({}, {review:c,lease:i.controlLease,readyAt:at,at:t}));
  assert.throws(()=>assertReviewSession(JSON.parse(JSON.stringify(ticket)),{review:c,lease:i.controlLease,readyAt:at,at:t}));
  assert.throws(()=>assertReviewSession(ticket,{review:c,lease:i.controlLease,readyAt:at,at:at+H.chainMs}));
  assert.throws(()=>beginSession(m,m.manifestSha256,at-180000,at));
});
for(const fault of ['source','intent','mode','scope','time','inspection'])test('derived '+fault+' mismatch cannot authorize legacy publisher',()=>{
  const m=manifest(),i=intent(m),x=inspection(m,i),ticket=beginSession(m,m.manifestSha256,at,at);attachIntent(ticket,i,at);const c=child(m,i,x,at);
  if(fault==='source')c.sourceCommit=H.priorSource;if(fault==='intent')c.hostingIntentFile='other';if(fault==='mode')c.action.operation='AdvanceReview';
  if(fault==='scope')c.pins=[];if(fault==='time')c.createdAt=at+1;if(fault==='inspection')x.proof.healthy=false;
  assert.throws(()=>authorizeReview(ticket,c,i,x,at));
});
test('new hosting evidence can be used by later manual Advance only with exact matching inspection',()=>{
  const m=manifest(),i=intent(m),x=inspection(m,i);validateHostingObjects(m,i,x,source);
  assert.throws(()=>validateHostingObjects(m,i,{...x,outcome:'RECOVERY_CONTINUATION_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING'},source));
  assert.throws(()=>validateHostingObjects(m,i,x,H.priorSource));verifyInspection(m,i,x);
});
function fixture(fail){const m=manifest(),calls=[];let clock=at,actualIntent;
  const act=n=>{calls.push(n);if(n===fail)throw Error('RECOVERY_HANDOFF_SYNTHETIC');};
  const io={assertSource:async()=>act('source'),verifyCi:async()=>act('ci'),
    cloud:{snapshot:async()=>{act('snapshot');return {baseline:m.before,checkedAt:clock};},update:async()=>{act('update');clock+=4*60000;return {StackId:H.stackId};},
      stack:async()=>{act('stack');return {StackId:H.stackId,StackStatus:'UPDATE_COMPLETE',LastUpdatedTime:new Date(clock)};},observe:async()=>{act('observe');return {synthetic:true};}},
    confirmNeon:async()=>{act('neon');return {neonReadinessVerified:true,writes:0,queries:12,checkedAt:clock};},
    claim:async()=>act('claim'),record:async(n,v)=>{act('record:'+n);if(n==='update-intent')actualIntent=v;},wait:async()=>{clock+=10000;},
    inspect:async()=>{act('inspect');return inspection(m,actualIntent);},publish:async(c,ticket)=>{act('publish');assertReviewSession(ticket,{review:c,lease:actualIntent.controlLease,readyAt:at,at:clock});
      return {outcome:'REVIEW_PUBLISHED_REQUIRES_HUMAN_APPROVAL',submissions:1,dispatches:0,planSha256:'1'.repeat(64)};},close:async()=>act('close')};
  return {m,io,calls,now:()=>clock,tick:n=>clock+=n};}
const run=f=>runOnce({manifest:f.m,approved:f.m.manifestSha256,readyAt:at,io:f.io,now:f.now,derive:async(m,binding,basis,i,x,t)=>child(m,i,x,t)});
test('one approved chain does one update, independent inspect and immediate publication without another reply',async()=>{
  const f=fixture(),r=await run(f);assert.equal(r.outcome,'HANDOFF_REVIEW_PUBLISHED_REQUIRES_HUMAN_APPROVAL');assert.equal(r.updates,1);
  assert(f.calls.indexOf('neon')<f.calls.indexOf('claim'));assert(f.calls.indexOf('update')<f.calls.indexOf('inspect'));assert(f.calls.indexOf('inspect')<f.calls.indexOf('publish'));
  assert.equal(f.calls.filter(v=>v==='publish').length,1);assert.equal(f.calls.at(-1),'close');assert.equal(r.workflowDispatched,false);
});
for(const fail of ['ci','snapshot','neon','claim','update','record:update-ack','stack','observe','inspect','publish'])test('chain failure '+fail+' never retries, renews or compensates',async()=>{
  const f=fixture(fail),r=await run(f);assert(r.outcome.includes('STOPPED'));assert.equal(r.retryAllowed,false);
  assert(f.calls.filter(x=>x==='update').length<=1);assert(f.calls.filter(x=>x==='publish').length<=1);
  if(fail!=='publish')assert(!f.calls.includes('publish'));assert.equal(f.calls.at(-1),'close');
});
test('elapsed chain or bad independent proof prevents publishing; old UPDATE_COMPLETE is not mistaken for success',async()=>{
  const f=fixture();f.io.inspect=async()=>{f.tick(H.chainMs);return inspection(f.m,intent(f.m));};assert((await run(f)).outcome.includes('STOPPED'));assert(!f.calls.includes('publish'));
  const g=fixture();g.io.inspect=async()=>({...inspection(g.m,intent(g.m)),cloudWrites:1});await run(g);assert(!g.calls.includes('publish'));
  const h=fixture();h.io.cloud.stack=async()=>({StackId:H.stackId,StackStatus:'UPDATE_COMPLETE',LastUpdatedTime:new Date(at-1)});
  await run(h);assert(!h.calls.includes('inspect'));assert(!h.calls.includes('publish'));
});
test('slow permanent slot claim makes original AWS and Neon facts stale, preventing the update',async()=>{
  const f=fixture();f.io.claim=async()=>f.tick(120001);const r=await run(f);assert(r.outcome.includes('STOPPED'));assert.equal(r.claimed,true);assert(!f.calls.includes('update'));
});
test('facts are checked again immediately before UpdateStack, even when the new intent is still fresh',async()=>{
  const f=fixture(),record=f.io.record;f.io.cloud.snapshot=async()=>({baseline:f.m.before,checkedAt:at-119000});
  f.io.record=async(n,v)=>{await record(n,v);if(n==='update-intent')f.tick(2000);};
  const r=await run(f);assert.equal(r.code,'RECOVERY_HANDOFF_STALE');assert(!f.calls.includes('update'));
});
test('only revision10 baseline and the exact newer source/image/template/event reach shared verifier',async()=>{
  for(const updated of [false,true]){const d=updated?H.priorDefinition.replace(/:10$/,':11'):H.priorDefinition,s=updated?source:H.priorSource,
    t=updated?at:H.priorAt,token=updated?'recovery-handoff-'+nonce:H.priorToken,doc=nextTemplate(s);
    const raw={stack:{Stacks:[{StackId:H.stackId,StackStatus:'UPDATE_COMPLETE',DisableRollback:false}]},resources:{StackResourceSummaries:Object.entries({...BEFORE.ids,TaskDefinition:d})
      .map(([k,id])=>({LogicalResourceId:k,PhysicalResourceId:id,ResourceType:doc.Resources[k].Type,ResourceStatus:'UPDATE_COMPLETE'}))},template:{TemplateBody:doc},
      definition:{taskDefinition:{containerDefinitions:[{image:IMAGE,environment:[{name:'TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT',value:s}]}]}},tasks:{tasks:[{containers:[{imageDigest:H.imageDigest}]}]},
      service:{services:[{deploymentConfiguration:{maximumPercent:100,minimumHealthyPercent:0,deploymentCircuitBreaker:{enable:true,rollback:false},strategy:'ROLLING',bakeTimeInMinutes:0}}]},
      events:{StackEvents:[{ResourceType:'AWS::CloudFormation::Stack',PhysicalResourceId:H.stackId,ResourceStatus:'UPDATE_COMPLETE',ClientRequestToken:token,Timestamp:new Date(t+1000).toISOString()}]}};
    const extra={stackPolicy:null,changeSets:[],definitions:{ACTIVE:[d],INACTIVE:inactive,DELETE_IN_PROGRESS:[]}},before=hash(raw);
    await verifyObserved(raw,extra,{updated,source,controlLease:lease(t,s),intentAt:t,token},()=>({healthy:true}));assert.equal(hash(raw),before);
    raw.definition.taskDefinition.containerDefinitions[0].environment[0].value='bad';let calls=0;
    await assert.rejects(verifyObserved(raw,extra,{updated,source,controlLease:lease(t,s),intentAt:t,token},()=>{calls++;}));assert.equal(calls,0);
  }
});
test('transport is readonly by default; CLI cannot select a target, session, derive function, slot or output for Run',async()=>{
  const c=createHandoffCloud({validator:()=>true,endpoint:'https://invalid.example'});try{await assert.rejects(c.update({}),/WRITE_DISABLED/);assert.deepEqual(c.counts,{sts:0,metadata:0,writes:0});}finally{c.close();}
  for(const key of ['--profile','--endpoint','--session','--derive','--slot','--output'])assert.throws(()=>parseArgs(['--mode','RunReviewed','--manifest','x','--approved-sha','x','--ready-at','x',key,'override']));
  const p=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-recovery-handoff-v1/local.mjs','--check'],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
  const r=JSON.parse(p.stdout);assert.equal(r.privateReads+r.awsCalls+r.sqlConnections+r.slotsConsumed,0);
});
