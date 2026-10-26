import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Q,R,hash,trustOnlyRecoveryTemplate,makeRecoveryPublicationReview,validateRecoveryApproval,
  validateRecoveryPreflight,reconcileRecoveryLayout} from '../ops/platform-recovery-publication-v1/plan.mjs';
import {recoveryCloudWorkflows} from '../ops/platform-recovery-cloud-v1/workflows.mjs';
import {recoveryPublicationProfile,parsePublicationArgs} from '../ops/platform-recovery-publication-v1/local.mjs';
import {createAppPublicationIo} from '../ops/platform-publication-v6/local.mjs';
import {publishAppOnceV6,verifyAppChangeSetV6} from '../ops/platform-publication-v6/plan.mjs';
const now=1792977000000;
async function fixture(){
  const baseline=JSON.parse(await readFile(new URL('./fixtures/platform-recovery-publication-v1.json',import.meta.url),'utf8'));
  const parent='a'.repeat(40),objects={reusable:{file:Q.reusable,parent,commit:'b'.repeat(40),tree:'c'.repeat(40),blob:'d'.repeat(40)},
    caller:{file:Q.caller,parent:'b'.repeat(40),commit:'e'.repeat(40),tree:'f'.repeat(40),blob:'1'.repeat(40)}};
  const texts=recoveryCloudWorkflows({...R,reusableCommit:objects.reusable.commit});
  objects.reusable.normalizedLfSha256=hash(texts.reusable);objects.caller.normalizedLfSha256=hash(texts.caller);
  const input={parent,objects,baseline,createdAt:now,previousTargets:[Q.reusable,Q.caller].map(file=>({file,blob:'2'.repeat(40),normalizedLfSha256:'3'.repeat(64)})),
    pins:Array.from({length:15},(_,i)=>({file:'synthetic-'+i,sha256:'4'.repeat(64)})),ci:{runId:'123',jobId:'456',sourceCommit:parent,attempt:1,status:'completed',conclusion:'success'}};
  const m=await makeRecoveryPublicationReview(input),p={source:baseline.source,main:parent,
    foundation:{stackId:R.stackId,status:'UPDATE_COMPLETE',roleArn:null,parameters:[],template:baseline.template,resources:baseline.resources},
    iam:{...baseline.iam,path:'/',maxSessionDuration:3600,tags:[{Key:'synthetic',Value:'unchanged'}]},
    environment:{environmentId:24613410405,requiredReviewerId:14145707,adminBypass:false,mainBranchOnly:true},
    oidc:{use_default:true,use_immutable_subject:true,sub_claim_prefix:'repo:veinyyxy@14145707/TechlongSoftware@1323312747'},
    unfinishedDeploymentRuns:0,oldDeploymentRunIds:['111']};
  return {input,m,p,texts};
}
function post(m,p,state){const v=structuredClone(p);v.main=m.objects.caller.commit;
  if(state==='new'){v.foundation.template=JSON.parse(m.actions.create.TemplateBody);v.iam.trust=v.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument;}return v;}
async function runner(){const {m,p}=await fixture(),events=[];let taken=false,fail,clock=now,n=0,saved;
  const step=s=>{events.push(s);if(s===fail)throw Error('Synthetic unknown');};
  const io={assertLocal:async()=>step('local'),preflight:async()=>{step('preflight');return structuredClone(p);},
    consume:async v=>{assert.equal(taken,false);taken=true;saved=v;step('slot');},record:async name=>step(name),
    push:async()=>step('push'),verifyWorkflows:async()=>{step('workflows');return [];},layout:async()=>{step('layout');return post(m,p,++n<3?'old':'new');},
    create:async()=>{step('create');return {id:'synthetic-cs',stackId:R.stackId};},waitChangeSet:async()=>step('strict-cs'),
    execute:async()=>step('execute'),waitFoundation:async()=>step('wait'),fastForward:async()=>step('ff')};
  return {m,p,io,events,slot:()=>saved,fail:s=>{fail=s;},at:t=>{clock=t;},run:()=>publishAppOnceV6({manifest:m,approved:m.manifestSha256,io,now:()=>clock,profile:recoveryPublicationProfile(m)})};
}
test('real saved template changes only the existing job_workflow_ref; actor and all permissions remain byte-equivalent',async()=>{
  const {m}=await fixture(),change=trustOnlyRecoveryTemplate(m.baseline.template,m.objects.reusable.commit);
  assert.equal(change.changes.length,1);const back=structuredClone(change.template);
  back.Resources.WorkerRole.Properties.AssumeRolePolicyDocument=m.baseline.iam.trust;assert.deepEqual(back,m.baseline.template);
  assert.equal(m.effects.existingWorkflowUpdates,2);assert.equal(m.effects.newWorkflowFiles,0);
  for(const k of ['iamPermissionExpansion','newIamResources','environmentWrites','secretValueReads','appKeyReads','dispatches','sqlConnections','packageUploads','controllerActivations','workloadCreates','automaticWriteRetries'])assert.equal(m.effects[k],0);
  assert.equal(m.actions.execute.DisableRollback,true);assert.notEqual(m.permanentSlot,'F:/ChatGPT_workshop/techlong-w6i-app-publication.intent.json');
});
test('review expires at original oldest observation +24h, not at regenerated preparation time',async()=>{
  const {m,input}=await fixture();assert.equal(m.expiresAt,m.baseline.observedAt+Q.validMs);
  const refreshed=await makeRecoveryPublicationReview({...input,createdAt:now+3600000});assert.equal(refreshed.expiresAt,m.expiresAt);
  assert.equal(refreshed.permanentSlot,m.permanentSlot);await assert.rejects(makeRecoveryPublicationReview({...input,createdAt:m.expiresAt}));
});
test('wrong SHA, future, expiry and action/risk/limits tampering fail; expired Inspect grants no writes',async()=>{
  const {m}=await fixture();for(const [sha,t] of [['bad',now],[m.manifestSha256,now-1],[m.manifestSha256,m.expiresAt]])await assert.rejects(validateRecoveryApproval(m,sha,t));
  for(const patch of [{effects:{...m.effects,dispatches:1}},{expiresAt:m.expiresAt+1},{permanentSlot:'other'},
    {requiredExecutionChecks:{...m.requiredExecutionChecks,unfinishedDeploymentRuns:1}},{profile:'unsafe'}])await assert.rejects(validateRecoveryApproval({...m,...patch},m.manifestSha256,now));
  await validateRecoveryApproval(m,undefined,m.expiresAt+100,true);
});
test('unobserved aggregate/runtime preconditions are explicit requirements, not invented observed facts',async()=>{
  const {m,p}=await fixture();assert.equal(m.prestate,undefined);assert.equal(m.baseline.foundation,undefined);
  assert.equal(m.requiredExecutionChecks.notPreviouslyObserved,true);validateRecoveryPreflight(p,m);
  for(const change of [v=>{v.foundation.status='UPDATE_IN_PROGRESS';},v=>{v.foundation.roleArn='other';},v=>{v.foundation.parameters=[{}];},
    v=>{v.iam.roleId='other';},v=>{v.iam.inline[0].document.Statement.pop();},v=>{v.iam.boundary.defaultVersion='v2';},
    v=>{v.environment.adminBypass=true;},v=>{v.oidc.use_immutable_subject=false;},v=>{v.unfinishedDeploymentRuns=1;},
    v=>{v.foundation.resources.pop();},v=>{v.main=m.objects.caller.commit;}]){
    const q=structuredClone(p);change(q);assert.throws(()=>validateRecoveryPreflight(q,m));
  }
});
test('template, previous workflow hashes and proof reference drift reject before approval',async()=>{
  const {input}=await fixture();for(const change of [v=>{v.baseline.template.Resources.WorkerRole.Properties.MaxSessionDuration=7200;},
    v=>{v.baseline.proofs[0].rawSha256='0'.repeat(64);},v=>{v.objects.caller.normalizedLfSha256='0'.repeat(64);},
    v=>{v.previousTargets.reverse();},v=>{v.objects.caller.parent=v.parent;}]){
    const x=structuredClone(input);change(x);await assert.rejects(makeRecoveryPublicationReview(x));
  }
});
test('reusable frozen source/97 closure/manual seven inputs survive renderer; caller pins exact R without self-cycle',async()=>{
  const {m,texts}=await fixture();assert.match(texts.reusable,/ops\/platform-recovery-cloud-v1\/run.mjs/);assert.match(texts.reusable,/TECHLONG_RECOVERY_PROTOCOL: recovery-envelope\/v1/);
  assert.ok(texts.reusable.includes(R.sourceCommit));assert.ok(texts.reusable.includes(R.closureSha256));assert.ok(texts.caller.includes('@'+m.objects.reusable.commit));
  assert.equal(texts.reusable.includes(m.objects.reusable.commit),false);assert.match(texts.reusable,/environment: techlong-sandbox-deploy/);
  assert.doesNotMatch(texts.caller,/\n  (push|schedule|pull_request):/);assert.match(texts.caller,/workflow_dispatch:/);
});
test('shared executor captures fresh facts before permanent slot; all four mutations remain ordered and single',async()=>{
  const f=await runner(),r=await f.run();assert.match(r.outcome,/REQUIRES_INDEPENDENT_INSPECT/);assert.equal(f.slot().preflightSha256,hash(f.p));
  for(const [a,b] of [['execution-preflight','slot'],['slot','push'],['push','create'],['create','strict-cs'],['strict-cs','execute'],['execute','ff']])assert.ok(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());for(const s of ['push','create','execute','ff'])assert.equal(f.events.filter(x=>x===s).length,1);
});
test('wrong approval or unproven preflight never records or consumes a slot',async()=>{
  const f=await runner();await assert.rejects(publishAppOnceV6({manifest:f.m,approved:'wrong',io:f.io,profile:recoveryPublicationProfile(f.m),now:()=>now}));assert.deepEqual(f.events,[]);
  f.io.preflight=async()=>({...f.p,unfinishedDeploymentRuns:1});await assert.rejects(f.run());assert.equal(f.events.includes('slot'),false);assert.equal(f.events.includes('execution-preflight'),false);
});
test('every post-slot ambiguous stage retains the slot and stops with no write replay',async()=>{
  for(const stage of ['push','push-ack','workflows','published-workflows','layout','create','create-ack','strict-cs','execute','execute-ack','wait','post-layout','final-workflows','ff','local-main-ack']){
    const f=await runner();f.fail(stage);const r=await f.run();assert.match(r.outcome,/PARTIAL/);assert.equal(r.retryAllowed,false);assert.ok(f.slot());
    await assert.rejects(f.run());for(const s of ['push','create','execute','ff'])assert.ok(f.events.filter(x=>x===s).length<=1);
  }
});
test('expiry after slot or during final writer read stops before real submission',async()=>{
  const f=await runner();f.io.push=async(m,guard)=>{f.at(m.expiresAt);await guard();f.events.push('submit');};
  assert.match((await f.run()).outcome,/PARTIAL/);assert.equal(f.events.includes('submit'),false);
});
test('full captured layout reconciles only main/trust, rejects tags, boundary, environment or inventory drift',async()=>{
  const {m,p}=await fixture();for(const state of ['old','new'])assert.equal(reconcileRecoveryLayout(post(m,p,state),m,state,p).remainingLayoutUnchanged,true);
  for(const fn of [v=>{v.iam.tags=[];},v=>{v.iam.boundary.defaultVersion='v2';},v=>{v.oldDeploymentRunIds.push('112');},
    v=>{v.foundation.resources[0].physicalId='replacement';},v=>{v.environment.adminBypass=true;}]){
    const v=post(m,p,'new');fn(v);assert.throws(()=>reconcileRecoveryLayout(v,m,'new',p));
  }
});
test('existing strict Change Set verifier rejects policy edits, multiple changes, dynamic evaluation and wrong stack',async()=>{
  const {m}=await fixture(),id='arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+m.actions.create.ChangeSetName+'/12345678-abcd-1234-abcd-123456789012';
  const d={ChangeSetId:id,ChangeSetName:m.actions.create.ChangeSetName,Description:m.actions.create.Description,Capabilities:['CAPABILITY_NAMED_IAM'],
    StackId:R.stackId,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[{ResourceChange:{Action:'Modify',LogicalResourceId:'WorkerRole',
      PhysicalResourceId:Q.roleName,ResourceType:'AWS::IAM::Role',Replacement:'False',Scope:['Properties'],Details:[{
        Target:{Attribute:'Properties',Name:'AssumeRolePolicyDocument',RequiresRecreation:'Never'},ChangeSource:'DirectModification',Evaluation:'Static'}]}}]};
  const t=JSON.parse(m.actions.create.TemplateBody);assert.equal(verifyAppChangeSetV6(d,m,id,t).changedLogicalId,'WorkerRole');
  for(const fn of [x=>{x.Changes[0].ResourceChange.Details[0].Target.Name='Policies';},x=>{x.Changes.push(x.Changes[0]);},
    x=>{x.Changes[0].ResourceChange.Details[0].Evaluation='Dynamic';},x=>{x.StackId='other';},x=>{x.RoleARN='other';}]){
    const x=structuredClone(d);fn(x);assert.throws(()=>verifyAppChangeSetV6(x,m,id,t));
  }
});
test('actual adapter read-only capability rejects every writer before credentials, network or local slot',async()=>{
  const {m}=await fixture(),io=await createAppPublicationIo('unused',{profile:recoveryPublicationProfile(m,{readOnly:true})});
  try{for(const fn of [()=>io.consume({}),()=>io.push(m),()=>io.create(m),()=>io.execute(m,{}),()=>io.fastForward(m)])await assert.rejects(Promise.resolve().then(fn),/READ_ONLY_CAPABILITY/);
    assert.deepEqual(io.counts(),{push:0,create:0,execute:0,fastForward:0,awsMetadata:0,githubGets:0});
  }finally{io.dispose();}
});
test('CLI has no profile, endpoint, retry, refresh or dispatch override; saved preparation cannot call live preflight',async()=>{
  assert.equal(parsePublicationArgs(['--mode','PrepareSaved','--output','x','--ci-run','123'])['--mode'],'PrepareSaved');
  for(const args of [['--mode','Prepare'],['--mode','Publish','--output','x','--manifest','x'],
    ['--mode','PrepareSaved','--output','x','--ci-run','123','--profile','unsafe']])assert.throws(()=>parsePublicationArgs(args));
  const text=await readFile(new URL('../ops/platform-recovery-publication-v1/local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(text,/io\.preflight\(|\.env\.local|GetSecretValue|\.pem|signAppJwt|UpdateAssumeRolePolicy/);
  assert.match(text,/preflightSha256/);assert.match(text,/await absent\(Q.inspectSlot\)/);
});
