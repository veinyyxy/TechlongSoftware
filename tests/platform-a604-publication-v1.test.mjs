import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Q,F,FACTS,REFERENCE,hash,publicationTemplate,texts,bindingText,trustTemplate,makeReview,validateApproval,validatePreflight,reconcile} from '../ops/platform-a604-publication-v1/plan.mjs';
import {profile,parseArgs,main} from '../ops/platform-a604-publication-v1/local.mjs';
import {createAppPublicationIo} from '../ops/platform-publication-v6/local.mjs';
import {publishAppOnceV6,verifyAppChangeSetV6} from '../ops/platform-publication-v6/plan.mjs';
import {A604_PROFILE} from '../ops/platform-a604-cloud-v1/profile.mjs';
import {bindA604WorkflowPublication,assertA604Publication} from '../ops/platform-a604-cloud-v1/contract.mjs';
import {load} from 'js-yaml';
import {SNAPSHOT_MAX_AGE_MS,assertSnapshotTime,createReadinessPolicy} from '../ops/platform-a604-publication-v1/readiness.mjs';
const at=1793130000000,defaultLine="export const LOCAL_PUBLICATION=freeze({state:'UNPUBLISHED',template:A604_PUBLICATION,reusableCommit:null});";
async function originalScope(){const text=(await readFile(new URL('../ops/platform-a604-operator-v1/scope.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const restored=text.replace(/^export const LOCAL_PUBLICATION=freeze\(.+\);$/m,defaultLine).replace('A604_JOB,A604_PROFILE}', 'A604_JOB,A604_PROFILE,A604_PUBLICATION}');
  assert.equal(hash(restored),Q.bindingBeforeSha256);return restored;}
async function fixture(){const b=JSON.parse(await readFile(new URL('./fixtures/platform-recovery-publication-v1.json',import.meta.url),'utf8'));
  b.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref']='veinyyxy/TechlongSoftware/'+Q.reusable+'@'+Q.oldReusable;
  b.iam.trust=structuredClone(b.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument);
  const parent='a'.repeat(40),operatorScopeSource=await originalScope(),objects={reusable:{file:Q.reusable,parent,commit:'b'.repeat(40),tree:'c'.repeat(40),blob:'d'.repeat(40)},
    caller:{file:Q.caller,parent:'b'.repeat(40),commit:'e'.repeat(40),tree:'f'.repeat(40),blob:'1'.repeat(40),operatorBinding:{file:Q.bindingFile,blob:'2'.repeat(40)}}},
    w=texts(objects.reusable.commit);objects.reusable.normalizedLfSha256=hash(w.reusable);objects.caller.normalizedLfSha256=hash(w.caller);
  objects.caller.operatorBinding.normalizedLfSha256=hash(bindingText(operatorScopeSource,objects.reusable.commit));
  const baseline={source:b.source,main:parent,foundation:{stackId:F.stackId,status:'UPDATE_COMPLETE',roleArn:null,parameters:[],template:b.template,resources:b.resources},
    iam:{...b.iam,path:'/',maxSessionDuration:3600,tags:[{Key:'synthetic',Value:'stable'}]},environment:{environmentId:24613410405,requiredReviewerId:14145707,adminBypass:false,mainBranchOnly:true},
    oidc:{use_default:true,use_immutable_subject:true,sub_claim_prefix:'repo:veinyyxy@14145707/TechlongSoftware@1323312747'},unfinishedDeploymentRuns:0,oldDeploymentRunIds:['111']};
  const input={parent,objects,operatorScopeSource,baseline,observedAt:at-1000,createdAt:at,
    previousTargets:[Q.reusable,Q.caller,Q.bindingFile].map(file=>({file,blob:'3'.repeat(40),normalizedLfSha256:file===Q.bindingFile?Q.bindingBeforeSha256:'4'.repeat(64)})),
    pins:Array.from({length:20},(_,n)=>({file:'synthetic-'+n,sha256:'5'.repeat(64)})),ci:{sourceCommit:parent,testedSourceCommit:parent,runId:'123',jobId:'456',attempt:1,status:'completed',conclusion:'success'}};
  return {input,m:await makeReview(input),baseline,w};}
const post=(m,b,state)=>{const p=structuredClone(b);p.main=m.objects.caller.commit;if(state==='new'){
  p.foundation.template=JSON.parse(m.actions.create.TemplateBody);p.iam.trust=p.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument;}return p;};
async function runner(){const f=await fixture(),events=[];let taken=false,failed,clock=at,n=0,claim;
  const step=s=>{events.push(s);if(s===failed)throw Error('Synthetic unknown');};
  const io={assertLocal:async()=>step('local'),preflight:async()=>{step('preflight');return structuredClone(f.baseline);},record:async n=>step(n),
    consume:async v=>{assert.equal(taken,false);taken=true;claim=v;step('slot');},push:async()=>step('push'),verifyWorkflows:async()=>{step('workflows');return [];},
    layout:async()=>{step('layout');return post(f.m,f.baseline,++n<3?'old':'new');},create:async()=>{step('create');return {id:'synthetic',stackId:F.stackId};},
    waitChangeSet:async()=>step('strict-cs'),execute:async()=>step('execute'),waitFoundation:async()=>step('wait'),fastForward:async()=>step('ff')};
  return {...f,events,io,claim:()=>claim,fail:v=>{failed=v;},time:v=>{clock=v;},run:()=>publishAppOnceV6({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>clock,profile:profile(f.m)})};}

test('published descriptor fixes the independently read package version and exact approved fact window, no new facts',async()=>{
  const t=publicationTemplate(),p=await bindA604WorkflowPublication(t,'a'.repeat(40),'b'.repeat(40));await assertA604Publication(p,A604_PROFILE,at);
  assert.deepEqual(p.packageReference,REFERENCE);assert.deepEqual(p.factsApproval,FACTS);assert.equal(p.frozenSourceCommit,F.sourceCommit);
  assert.equal(t.sourceCommit,null);assert.equal(t.release.reusableCommit,null);assert.equal(t.activation.sourceCommit,null);assert.equal(t.activation.releaseSha256,null);
});
test('real template changes only one job_workflow_ref, not actor, boundary, policy or resources',async()=>{
  const {m,baseline}=await fixture(),change=trustTemplate(baseline.foundation.template,m.objects.reusable.commit),back=structuredClone(change.template);
  back.Resources.WorkerRole.Properties.AssumeRolePolicyDocument=baseline.iam.trust;assert.deepEqual(back,baseline.foundation.template);assert.equal(change.changes.length,1);
  assert.equal(m.effects.existingWorkflowUpdates,2);assert.equal(m.effects.localOperatorSourceBindingUpdates,1);assert.equal(m.effects.iamPermissionExpansion,0);
  for(const k of ['newIamResources','environmentWrites','secretValueReads','pemReads','dispatches','sqlConnections','packageUploads','hostingRenewals','workloadCreates','automaticWriteRetries'])assert.equal(m.effects[k],0);
});
test('candidate reusable has no self-pin; manual caller pins actual R, human environment and original7 inputs remain',async()=>{
  const {m,w}=await fixture();assert(!w.reusable.includes(m.objects.reusable.commit));assert(w.caller.includes('@'+m.objects.reusable.commit));
  assert.equal(Object.keys(load(w.caller).on.workflow_dispatch.inputs).length,7);assert.equal(load(w.reusable).jobs.single.environment,'techlong-sandbox-deploy');
  assert(w.reusable.includes(F.sourceCommit));assert(w.reusable.includes(F.closureSha256));assert(w.reusable.includes(REFERENCE.versionId));
  assert.doesNotMatch(w.caller,/\n  (push|schedule|pull_request):/);assert.match(w.caller,/github\.run_attempt == 1/);
});
test('operator SOURCE binding changes only fixed declaration and removes unused import; cannot be supplied through JSON/env',async()=>{
  const source=await originalScope(),rendered=bindingText(source,'b'.repeat(40));assert(rendered.includes('"state":"PUBLISHED"'));assert(rendered.includes(REFERENCE.versionId));
  const restored=rendered.replace(/^export const LOCAL_PUBLICATION=freeze\(.+\);$/m,defaultLine).replace('A604_JOB,A604_PROFILE}', 'A604_JOB,A604_PROFILE,A604_PUBLICATION}');
  assert.equal(restored,source);assert.throws(()=>bindingText(source+'\n','b'.repeat(40)));assert.throws(()=>bindingText(source,'bad'));
});
test('approval max24h from actual observation, bounded by fixed facts, retains20min execution reserve',async()=>{
  const {m,input}=await fixture();assert.equal(m.expiresAt,input.observedAt+24*3600000);
  const later=await makeReview({...input,createdAt:at+3600000});assert.equal(later.expiresAt,m.expiresAt);
  for(const [sha,time] of [['bad',at],[m.manifestSha256,at-1],[m.manifestSha256,m.expiresAt-1200000]])await assert.rejects(validateApproval(m,sha,time,false,true));
  await validateApproval(m,m.manifestSha256,m.expiresAt-1200000); // already-started guards use the real expiry, not another start reserve.
  await validateApproval(m,undefined,m.expiresAt+100,true);
});
test('snapshot preparation permits up to5h without restamping, rejects future or expired observations, keeps24h approval unchanged',async()=>{
  assert.equal(SNAPSHOT_MAX_AGE_MS,5*3600000);assert.doesNotThrow(()=>assertSnapshotTime(at,at+2*3600000));
  assert.doesNotThrow(()=>assertSnapshotTime(at,at+SNAPSHOT_MAX_AGE_MS-1));assert.throws(()=>assertSnapshotTime(at,at+SNAPSHOT_MAX_AGE_MS));assert.throws(()=>assertSnapshotTime(at,at-1));
  const {input}=await fixture(),m=await makeReview({...input,createdAt:input.observedAt+5*3600000-1});
  assert.equal(m.observedAt,input.observedAt);assert.equal(m.expiresAt,input.observedAt+24*3600000);assert.equal(m.publication.factsApproval.expiresAt,FACTS.expiresAt);
  await assert.rejects(makeReview({...input,createdAt:input.observedAt+5*3600000}));
});
test('time-policy-only source advance preserves all captured non-main facts, records origin, rejects protected changes and altered snapshots',()=>{
  const old='a'.repeat(40),head='b'.repeat(40),baseline={main:old,source:{arn:'synthetic'},permission:'unchanged'},prior={sourceCommit:old,observedAt:at,file:'synthetic.json',rawSha256:'c'.repeat(64),baselineSha256:hash(baseline)},
    policy=createReadinessPolicy(prior),saved={sourceCommit:old,baseline,observedAt:at},options={head,rawSha256:prior.rawSha256,ancestor:true,changedFiles:['ops/platform-a604-publication-v1/local.mjs'],now:at+4*3600000};
  const prepared=policy.reviewReadiness(saved,options);assert.equal(saved.baseline.main,old);assert.equal(prepared.baseline.main,head);assert.equal(prepared.baseline.permission,'unchanged');
  assert.equal(prepared.readinessOrigin.capturedMain,old);policy.assertOrigin(prepared.readinessOrigin,prepared.baseline,head,at);
  for(const patch of [{ancestor:false},{rawSha256:'d'.repeat(64)},{changedFiles:['.github/workflows/cloud-worker-platform-v6.yml']},{changedFiles:['ops/platform-a604-operator-v1/scope.mjs']}])
    assert.throws(()=>policy.reviewReadiness(saved,{...options,...patch}));
  assert.throws(()=>policy.reviewReadiness({...saved,baseline:{...baseline,permission:'changed'}},options));
  assert.equal(policy.reviewReadiness(saved,{...options,head:old}).readinessOrigin,null);
});
test('all supplied manifest actions, content, source-binding/hash, versions, risks and limits are reconstructed',async()=>{
  const {m}=await fixture();for(const fn of [v=>{v.publication.packageReference.versionId='other';},v=>{v.publication.factsApproval.expiresAt++;},
    v=>{v.objects.caller.operatorBinding.normalizedLfSha256='0'.repeat(64);},v=>{v.actions.execute.DisableRollback=false;},v=>{v.permanentSlot='other';},
    v=>{v.effects.dispatches=1;},v=>{v.limits.awsMetadata++;},v=>{v.operatorScopeSource+='\n';},v=>{v.expiresAt++;}]){
    const v=structuredClone(m);fn(v);await assert.rejects(validateApproval(v,m.manifestSha256,at));}
});
test('preflight requires all captured layout including repo/environment/OIDC/tags/IDs and exact existing permission documents',async()=>{
  const {m,baseline}=await fixture();validatePreflight(baseline,m);
  for(const fn of [v=>{v.foundation.status='UPDATE_IN_PROGRESS';},v=>{v.iam.inline[0].document.Statement.pop();},v=>{v.iam.boundary.defaultVersion='v2';},
    v=>{v.environment.adminBypass=true;},v=>{v.oidc.use_immutable_subject=false;},v=>{v.unfinishedDeploymentRuns=1;},v=>{v.iam.tags=[];}]){
    const v=structuredClone(baseline);fn(v);assert.throws(()=>validatePreflight(v,m));}
});
test('layout reconciliation allows only exact remote main plus the exact new trust template',async()=>{
  const {m,baseline}=await fixture();for(const state of ['old','new'])assert.equal(reconcile(post(m,baseline,state),m,state,baseline).remainingLayoutUnchanged,true);
  const v=post(m,baseline,'new');v.oldDeploymentRunIds.push('112');assert.throws(()=>reconcile(v,m,'new',baseline));
});
test('reuse original ordered publisher with preflight before permanent claim, single push/create/execute/fast-forward',async()=>{
  const f=await runner(),r=await f.run();assert.match(r.outcome,/REQUIRES_INDEPENDENT_INSPECT/);assert.equal(f.claim().preflightSha256,hash(f.baseline));
  for(const [a,b] of [['execution-preflight','slot'],['slot','push'],['push','create'],['strict-cs','execute'],['execute','ff']])assert(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());for(const s of ['push','create','execute','ff'])assert.equal(f.events.filter(x=>x===s).length,1);
});
test('unknown post-slot mutations or ACKs stop without replay or compensation',async()=>{
  for(const stage of ['push','push-ack','workflows','create','create-ack','strict-cs','execute','execute-ack','wait','post-layout','ff','local-main-ack']){
    const f=await runner();f.fail(stage);assert.match((await f.run()).outcome,/PARTIAL/);assert(f.claim());await assert.rejects(f.run());
    for(const s of ['push','create','execute','ff'])assert(f.events.filter(x=>x===s).length<=1);}
});
test('strict real Change Set verifier rejects any policy edit or extra/dynamic change',async()=>{
  const {m}=await fixture(),id='arn:aws:cloudformation:ca-central-1:402010193138:changeSet/'+m.actions.create.ChangeSetName+'/12345678-abcd-1234-abcd-123456789012';
  const d={ChangeSetId:id,ChangeSetName:m.actions.create.ChangeSetName,Description:m.actions.create.Description,Capabilities:['CAPABILITY_NAMED_IAM'],
    StackId:F.stackId,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes:[{ResourceChange:{Action:'Modify',LogicalResourceId:'WorkerRole',PhysicalResourceId:Q.roleName,
      ResourceType:'AWS::IAM::Role',Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:'AssumeRolePolicyDocument',RequiresRecreation:'Never'},ChangeSource:'DirectModification',Evaluation:'Static'}]}}]};
  const t=JSON.parse(m.actions.create.TemplateBody);assert.equal(verifyAppChangeSetV6(d,m,id,t).changedLogicalId,'WorkerRole');
  for(const fn of [v=>{v.Changes[0].ResourceChange.Details[0].Target.Name='Policies';},v=>{v.Changes.push(v.Changes[0]);},v=>{v.Changes[0].ResourceChange.Details[0].Evaluation='Dynamic';}]){
    const v=structuredClone(d);fn(v);assert.throws(()=>verifyAppChangeSetV6(v,m,id,t));}
});
test('new read-only SDK profile rejects every writer before credentials or metadata, capture budgets include CI allowance',async()=>{
  const {m}=await fixture(),p=profile(m,{readOnly:true,capture:true}),io=await createAppPublicationIo('unused',{profile:p});
  assert.equal(p.awsMetadataMax,13);assert.equal(p.githubGetsMax,17);
  try{for(const fn of [()=>io.consume({}),()=>io.push(m),()=>io.create(m),()=>io.execute(m,{}),()=>io.fastForward(m)])await assert.rejects(Promise.resolve().then(fn),/READ_ONLY_CAPABILITY/);
    assert.deepEqual(io.counts(),{push:0,create:0,execute:0,fastForward:0,awsMetadata:0,githubGets:0});}finally{io.dispose();}
});
test('actual existing-target callback hashes decoded workflow TEXT, not a Buffer JSON object; checks both exact GitHub IDs',async()=>{
  const parent='a'.repeat(40),targets=[Q.reusable,Q.caller].map(file=>({file,blob:'b'.repeat(40),normalizedLfSha256:hash('existing '+file+'\n')})),calls=[];
  const p=profile({parent,previousTargets:targets},{readOnly:true});let bad;
  const get=async path=>{calls.push(path);const target=targets.find(o=>path==='contents/'+o.file+'?ref='+parent);
    if(target)return {type:'file',sha:target.blob,encoding:'base64',content:Buffer.from('existing '+target.file+'\n'+(bad==='content'?'changed':'')).toString('base64')};
    const file=targets.find(o=>path==='actions/workflows/'+o.file.split('/').at(-1)).file;
    return {path:file,state:'active',id:bad==='id'?1:Number(file===Q.caller?'390829326':'390829324')};};
  await p.verifyExistingTargets(get,parent);assert.equal(calls.length,4);
  for(const fault of ['content','id']){bad=fault;await assert.rejects(p.verifyExistingTargets(get,parent),/EXISTING_WORKFLOW/);}
  assert.notEqual(hash(Buffer.from('existing '+Q.reusable+'\n')),targets[0].normalizedLfSha256);
});
test('CLI cannot dispatch, read secret/config or override profile/target/binding; default check is zero I/O',async()=>{
  const r=await main(['--check']);assert.equal(r.awsCalls+r.privateReads+r.externalWrites,0);
  for(const args of [[],['--mode','PublishReviewed'],['--mode','Dispatch'],['--mode','CaptureReadiness','--output','x','--ci-run','123','--profile','unsafe']])assert.throws(()=>parseArgs(args));
  const source=await readFile(new URL('../ops/platform-a604-publication-v1/local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/GetSecretValueCommand|\.env\.local|signAppJwt|\/dispatches|UpdateAssumeRolePolicy/);assert.match(source,/profile:profile\(.*readOnly:true/);
});
