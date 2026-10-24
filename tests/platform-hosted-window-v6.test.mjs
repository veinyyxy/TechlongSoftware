import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {K,H,P,hash,canonical,lease,policy,windowLease,windowTemplate,normalizeSuccess,checkIdentities,assertExtra,
  makeReview,validate,readyReview,updateInput,runOnce} from '../ops/platform-hosted-window-v6/contract.mjs';
import {template} from '../ops/platform-hosted-deploy-v6/contract.mjs';
import {assertOperatorOnlyDiff} from '../ops/platform-hosted-window-v6/compatibility.mjs';
import {prepareHostedControl} from '../ops/platform-hosting-v1/control-runtime.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';

const at=Date.parse('2026-10-24T00:00:00Z'),source='a'.repeat(40);
function fixture(){
  const ids=Object.fromEntries(['AlbSecurityGroup','Cluster','DnsRecord','HttpsListener','LoadBalancer','LogGroup','Service','TargetGroup',
    'TaskDefinition','TaskIngress','TaskSecurityGroup'].map(n=>[n,n==='TaskDefinition'?K.originalDefinition:'fixture-'+n]));
  const baseline={stackId:K.stackId,ids,oldLease:lease(at-7200000),hostingExpiresAt:K.originalHostingExpiresAt,
    templateSha256:hash(canonical(template(K.originalNonce))),tags:[],stackPolicy:null,healthy:true,imageDigest:H.imageDigest};
  return makeReview({sourceCommit:source,pins:Array.from({length:15},(_,i)=>({file:'fixture-'+i,sha256:'b'.repeat(64)})),
    ci:{sourceCommit:source,attempt:1,status:'completed',conclusion:'success'},baseline,
    publication:{sourceCommit:source,runtimeSourceCommit:source,jobId:K.jobId,manifestSha256:'c'.repeat(64),rawSha256:'d'.repeat(64)},
    parents:[{rawSha256:K.inventorySha256},{rawSha256:K.extraSha256}],nonce:'e'.repeat(32),createdAt:at,
    compatibility:{executionSourceCommit:source,imageSourceCommit:H.imageSource,protectedRuntimeCodeUnchanged:true,cloudClosureSha256:B.platform.closureSha256}});
}
function reviewed(m,now=at){return {outcome:'FOLLOWUP_REVIEW_INDEPENDENTLY_VERIFIED_NOT_DISPATCHED',jobId:K.jobId,
  runtimeSourceCommit:m.sourceCommit,controlCounts:{plans:1,approvals:0,attempts:0},heldJobUnchanged:true,executionApproved:false,
  checkedAt:now,planExpiresAt:now+7200000,planSha256:'f'.repeat(64)};}
function runner(){
  const m=fixture(),events=[],records={};let time=at,used=false,fail=null,states=['UPDATE_IN_PROGRESS','UPDATE_COMPLETE'];
  const step=n=>{events.push(n);if(fail===n)throw Error('PROVIDER_PRIVATE_DETAILS');};
  const io={assertSource:async()=>step('source'),reviewReady:async()=>{step('review');return reviewed(m,time);},
    snapshot:async()=>{step('snapshot');return {baseline:m.baseline,checkedAt:time};},
    claim:async()=>{assert.equal(used,false);used=true;step('claim');},record:async(n,v)=>{step('record-'+n);records[n]=v;},
    enableWrite:async()=>step('enable'),update:async r=>{step('update');assert.deepEqual(r,updateInput(m,time));return {StackId:K.stackId};},
    stack:async()=>{step('stack');return {StackId:K.stackId,StackStatus:states.shift()??'UPDATE_COMPLETE'};},
    wait:async()=>{step('wait');time+=10000;},observe:async(l,ids)=>{step('observe');assert.equal(ids,m.baseline.ids);return {source:l.sourceCommit};}};
  return {m,io,events,records,fail:n=>{fail=n;},time:n=>{time=n;},states:s=>{states=s;},
    run:()=>runOnce({manifest:m,approved:m.manifestSha256,io,now:()=>time})};
}

test('one template literal changes execution source; image provenance and all other infrastructure remain identical',()=>{
  const old=template(K.originalNonce),next=windowTemplate(source),c=next.Resources.TaskDefinition.Properties.ContainerDefinitions[0];
  assert.equal(next.Metadata.ImageSource,H.imageSource);assert.equal(c.Image,old.Resources.TaskDefinition.Properties.ContainerDefinitions[0].Image);
  const e=c.Environment.find(e=>e.Name==='TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT');assert.equal(e.Value,source);
  e.Value=H.imageSource;assert.deepEqual(next,old);assert.throws(()=>windowTemplate('main'));
});

test('exact UpdateStack keeps hosting tag, has no IAM/role/capabilities and temporary policy permits only two logical resources',()=>{
  const m=fixture(),r=updateInput(m,at+60000),l=JSON.parse(r.Parameters[1].ParameterValue);
  assert.equal(r.StackName,K.stackId);assert.equal(r.DisableRollback,true);assert.equal(r.ClientRequestToken,'platform-window-'+m.nonce);
  assert.deepEqual(r.Parameters[0],{ParameterKey:'HostingExpiresAt',UsePreviousValue:true});
  assert.deepEqual(l,windowLease(at+60000,source));assert.equal(l.expiresAt-l.issuedAt,1800000);
  assert.deepEqual(Object.keys(r).sort(),['ClientRequestToken','DisableRollback','Parameters','StackName','StackPolicyDuringUpdateBody','TemplateBody']);
  assert.deepEqual(JSON.parse(r.StackPolicyDuringUpdateBody),policy());
  assert.deepEqual(policy().Statement.map(s=>s.Resource),['LogicalResourceId/TaskDefinition','LogicalResourceId/Service']);
  assert.doesNotMatch(canonical(policy()),/Update:Delete/);
});

test('48h approval binds CI, exact baseline, same-source plan and runtime compatibility; altered or expired reviews stop',()=>{
  const m=fixture();assert.equal(m.expiresAt-at,48*3600000);assert.equal(m.expiresAt-m.latestStartAt,K.runMs);
  assert.equal(validate(m,m.manifestSha256,at),m);assert.equal(m.scope.updateStackAttemptsMax,1);assert.equal(m.scope.workflowDispatches,0);
  for(const change of [x=>{x.sourceCommit=H.imageSource;},x=>{x.baseline.imageDigest='changed';},
    x=>{x.publication.runtimeSourceCommit=H.imageSource;},x=>{x.scope.newIam=1;},x=>{x.extra=true;}]){
    const bad=structuredClone(m);change(bad);assert.throws(()=>validate(bad,m.manifestSha256,at));}
  assert.throws(()=>validate(m,'wrong',at));assert.throws(()=>validate(m,m.manifestSha256,m.latestStartAt));
});

test('source witness allows operator-only changes but cannot bless runtime, cloud pins, arbitrary workflows or package changes',()=>{
  assert.doesNotThrow(()=>assertOperatorOnlyDiff(['README.md','docs/review.md','tests/window.test.mjs',
    'ops/platform-hosted-window-v6/local.mjs','.github/workflows/platform-cloud-candidate.yml'],[]));
  for(const f of ['app/page.tsx','lib/deployments/controller-v6/github.ts','ops/platform-hosting-v1/start.mjs',
    'ops/platform-cloud-v6/closure.mjs','ops/cloud-worker/cloud-runtime-v5.mjs','package.json','Dockerfile',
    '.github/workflows/unknown.yml','ops/platform-review-v6/protected.mjs'])
    assert.throws(()=>assertOperatorOnlyDiff([f],['ops/platform-review-v6/protected.mjs']));
});

test('existing hosted runtime supports explicit execution binding distinct from image producer without private reads',async()=>{
  const l=windowLease(at,source),env={NODE_ENV:'production',HOST:'0.0.0.0',PORT:'3000',
    TECHLONG_PLATFORM_INGRESS:'alb-https-v1',TECHLONG_PLATFORM_PUBLIC_ORIGIN:'https://'+P.domain,
    TECHLONG_PLATFORM_CONTROLLER_ENABLED:'true',TECHLONG_PLATFORM_CONTROL_LOCAL:'false',TECHLONG_PLATFORM_CONTROL_HOSTED:'true',
    TECHLONG_PLATFORM_CONTROLLER_LEASE:canonical(l),TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT:source};
  let reads=0;for(const n of ['TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL','TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY'])
    Object.defineProperty(env,n,{enumerable:true,get(){reads++;throw Error('NO_PRIVATE_READ');}});
  const capability=await prepareHostedControl(env,{now:()=>at});assert.equal(capability.lease.sourceCommit,source);assert.equal(reads,0);capability.close();
  env.TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT=H.imageSource;
  await assert.rejects(prepareHostedControl(env,{now:()=>at}));assert.equal(reads,0);
});

test('status compatibility normalizes only successful states on a clone, never hides a failure or changes raw receipt',()=>{
  const v={stack:{Stacks:[{StackId:K.stackId,StackStatus:'UPDATE_COMPLETE'}]},
    resources:{StackResourceSummaries:Array.from({length:11},()=>({ResourceStatus:'UPDATE_COMPLETE'}))}};
  const c=normalizeSuccess(v,'UPDATE_COMPLETE');assert.equal(c.stack.Stacks[0].StackStatus,'CREATE_COMPLETE');
  assert.equal(v.stack.Stacks[0].StackStatus,'UPDATE_COMPLETE');
  for(const s of ['UPDATE_FAILED','UPDATE_IN_PROGRESS','UPDATE_ROLLBACK_COMPLETE']){
    const bad=structuredClone(v);bad.stack.Stacks[0].StackStatus=s;assert.throws(()=>normalizeSuccess(bad,s));}
  v.resources.StackResourceSummaries[0].ResourceStatus='UPDATE_FAILED';assert.throws(()=>normalizeSuccess(v,'UPDATE_COMPLETE'));
});

test('ten resource identities cannot move; only same-family increasing task definition revision may replace',()=>{
  const m=fixture(),rows=Object.entries(m.baseline.ids).map(([LogicalResourceId,PhysicalResourceId])=>({LogicalResourceId,PhysicalResourceId}));
  assert.doesNotThrow(()=>checkIdentities(rows,m.baseline.ids,false));
  const td=rows.find(r=>r.LogicalResourceId==='TaskDefinition');td.PhysicalResourceId=K.originalDefinition.replace(/:3$/,':4');
  assert.doesNotThrow(()=>checkIdentities(rows,m.baseline.ids,true));
  rows[0].PhysicalResourceId='changed';assert.throws(()=>checkIdentities(rows,m.baseline.ids,true));rows[0].PhysicalResourceId=m.baseline.ids.AlbSecurityGroup;
  for(const id of [K.originalDefinition,K.originalDefinition.replace(/:3$/,':2'),K.originalDefinition.replace(P.family,'wrong')]){
    td.PhysicalResourceId=id;assert.throws(()=>checkIdentities(rows,m.baseline.ids,true));}
});

test('pending changesets, extra active definitions or permanent stack policy block the baseline',()=>{
  const m=fixture(),e={stackId:K.stackId,stackPolicy:null,changeSets:[],definitions:{ACTIVE:[K.originalDefinition],INACTIVE:[...H.retiredTaskDefinitions],DELETE_IN_PROGRESS:[]}};
  assert.doesNotThrow(()=>assertExtra(e,m.baseline.ids));
  for(const change of [x=>{x.stackPolicy=policy();},x=>{x.changeSets=[{}];},x=>{x.definitions.ACTIVE.push('foreign');},x=>{x.definitions.INACTIVE.push('foreign');}]){
    const bad=structuredClone(e);change(bad);assert.throws(()=>assertExtra(bad,m.baseline.ids));}
});

test('requires independently read exact un-dispatched Review with forty minutes left; observed run is not enough',()=>{
  const m=fixture(),r=reviewed(m);assert.equal(readyReview(r,m,at),r);
  for(const change of [x=>{x.controlCounts.approvals=1;},x=>{x.controlCounts.attempts=1;},x=>{x.runtimeSourceCommit=H.imageSource;},
    x=>{x.checkedAt=at+1;},x=>{x.checkedAt=at-80*60000;},x=>{x.planExpiresAt=at+39*60000;},x=>{x.heldJobUnchanged=false;}]){
    const bad=structuredClone(r);change(bad);assert.throws(()=>readyReview(bad,m,at));}
});

test('slot precedes one update, lease derives at actual intent; metadata success is not control acceptance or dispatch',async()=>{
  const f=runner();f.time(at+3600000);const r=await f.run();assert.equal(r.outcome,'HOSTED_WINDOW_METADATA_VERIFIED_ACCEPTANCE_PENDING');
  assert.equal(r.controlLease.issuedAt,at+3600000);assert.equal(r.controlLease.sourceCommit,source);
  assert.equal(r.controlAcceptancePassed,false);assert.equal(r.workflowDispatched,false);assert.equal(r.automaticStopOrCleanup,false);
  assert.ok(f.events.indexOf('claim')<f.events.indexOf('update'));assert.equal(f.events.filter(n=>n==='update').length,1);
  await assert.rejects(f.run());assert.equal(f.events.filter(n=>n==='update').length,1);
});

test('partial or unknown writes stop without automatic retry, rollback, cleanup or provider detail exposure',async()=>{
  for(const point of ['record-update-intent','enable','update','record-update-ack','stack','observe']){
    const f=runner();f.fail(point);const r=await f.run();assert.equal(r.outcome,'HOSTED_WINDOW_REQUIRES_INSPECT_NO_RETRY');
    assert.equal(r.retryAllowed,false);assert.doesNotMatch(canonical(r),/PROVIDER_PRIVATE_DETAILS/);
    assert.ok(f.events.filter(n=>n==='update').length<=1);}
  const ack=runner();ack.io.update=async()=>({StackId:'wrong'});assert.equal((await ack.run()).phase,'UPDATE_SUBMISSION');
});

test('pre-slot baseline/Review drift writes nothing; stale post-slot facts permanently stop before update',async()=>{
  const f=runner();f.io.snapshot=async()=>({baseline:{},checkedAt:at});await assert.rejects(f.run());assert.equal(f.events.includes('claim'),false);
  const stale=runner();stale.io.snapshot=async()=>({baseline:stale.m.baseline,checkedAt:at-120000});
  assert.equal((await stale.run()).outcome,'HOSTED_WINDOW_REQUIRES_INSPECT_NO_RETRY');assert.equal(stale.events.includes('update'),false);
});

test('AWS failed update is not repaired; initial eventual consistency is bounded and backwards progress is rejected',async()=>{
  for(const states of [['UPDATE_FAILED'],['CREATE_COMPLETE','UPDATE_IN_PROGRESS','CREATE_COMPLETE']]){
    const f=runner();f.states(states);assert.equal((await f.run()).outcome,'HOSTED_WINDOW_REQUIRES_INSPECT_NO_RETRY');
    assert.equal(f.events.filter(n=>n==='update').length,1);assert.equal(f.events.includes('observe'),false);}
  const f=runner();f.states(['CREATE_COMPLETE','UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS','UPDATE_COMPLETE']);
  assert.equal((await f.run()).outcome,'HOSTED_WINDOW_METADATA_VERIFIED_ACCEPTANCE_PENDING');
});

test('concrete cloud entry has single bounded UpdateStack and no secret, SQL, dispatch, ECS-write or deletion capability',async()=>{
  const code=await readFile(new URL('../ops/platform-hosted-window-v6/cloud.mjs',import.meta.url),'utf8');
  assert.equal((code.match(/new UpdateStackCommand/g)??[]).length,1);assert.match(code,/maxAttempts:1/);assert.match(code,/counts\.writes\+\+/);
  assert.match(code,/requestSha256:hash\(canonical\(request\)\)/);
  assert.doesNotMatch(code,/GetSecretValueCommand|DeleteStackCommand|SetStackPolicyCommand|UpdateServiceCommand|workflow_dispatch|from ['"]pg['"]/);
});
