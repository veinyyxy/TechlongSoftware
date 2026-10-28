import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {Q,F,FACTS,REFERENCE,OPERATOR_BEFORE,hash,sourceTemplate,texts,bindingText,trustTemplate,makeReview,validateApproval,reconcile} from '../ops/platform-reviewed-cycle-v1/publication.mjs';
import {profile,main,parseArgs} from '../ops/platform-reviewed-cycle-v1/publication-local.mjs';
import {createReviewedCycle,bindWorkflowSource,assertPublication} from '../ops/platform-reviewed-cycle-v1/cycle.mjs';
import {createAppPublicationIo} from '../ops/platform-publication-v6/local.mjs';
import {publishAppOnceV6} from '../ops/platform-publication-v6/plan.mjs';
import {cycleCloudClosure} from '../ops/platform-reviewed-cycle-v1/closure.mjs';
import {SELECTED_CYCLE as CLOUD_DEFAULT} from '../ops/platform-reviewed-cycle-v1/selection.mjs';
import {sha256Hex} from '../lib/deployments/execution/hash.ts';
const at=1793205000000;
async function fixture(){
  const b=JSON.parse(await readFile(new URL('./fixtures/platform-recovery-publication-v1.json',import.meta.url),'utf8'));
  b.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:job_workflow_ref']=
    'veinyyxy/TechlongSoftware/'+Q.reusable+'@'+Q.oldReusable;b.iam.trust=structuredClone(b.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument);
  const parent='a'.repeat(40),objects={reusable:{file:Q.reusable,parent,commit:'b'.repeat(40),tree:'c'.repeat(40),blob:'d'.repeat(40)},
    caller:{file:Q.caller,parent:'b'.repeat(40),commit:'e'.repeat(40),tree:'f'.repeat(40),blob:'1'.repeat(40),operatorBinding:{file:Q.bindingFile,blob:'2'.repeat(40)}}},w=texts(objects.reusable.commit);
  objects.reusable.normalizedLfSha256=hash(w.reusable);objects.caller.normalizedLfSha256=hash(w.caller);
  objects.caller.operatorBinding.normalizedLfSha256=hash(bindingText(OPERATOR_BEFORE,objects.reusable.commit));
  const baseline={source:b.source,main:parent,foundation:{stackId:F.stackId,status:'UPDATE_COMPLETE',roleArn:null,parameters:[],template:b.template,resources:b.resources},
    iam:{...b.iam,path:'/',maxSessionDuration:3600,tags:[{Key:'synthetic',Value:'stable'}]},environment:{environmentId:24613410405,requiredReviewerId:14145707,adminBypass:false,mainBranchOnly:true},
    oidc:{use_default:true,use_immutable_subject:true,sub_claim_prefix:'repo:veinyyxy@14145707/TechlongSoftware@1323312747'},unfinishedDeploymentRuns:0,oldDeploymentRunIds:['111']};
  const input={parent,objects,operatorScopeSource:OPERATOR_BEFORE,baseline,observedAt:at-1000,createdAt:at,
    previousTargets:[Q.reusable,Q.caller,Q.bindingFile].map(file=>({file,blob:'3'.repeat(40),normalizedLfSha256:file===Q.bindingFile?Q.bindingBeforeSha256:'4'.repeat(64)})),
    pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i,sha256:'5'.repeat(64)})),ci:{sourceCommit:parent,testedSourceCommit:parent,runId:'123',jobId:'456',attempt:1,status:'completed',conclusion:'success'}};
  return {input,m:await makeReview(input),baseline,w};
}
const post=(m,b,state)=>{const p=structuredClone(b);p.main=m.objects.caller.commit;if(state==='new'){
  p.foundation.template=JSON.parse(m.actions.create.TemplateBody);p.iam.trust=p.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument;}return p;};
async function runner(){const f=await fixture(),events=[];let taken=false,fail,claim,n=0;
  const step=s=>{events.push(s);if(s===fail)throw Error('Synthetic unknown');},io={assertLocal:async()=>step('local'),preflight:async()=>{step('preflight');return f.baseline;},
    record:async s=>step(s),consume:async v=>{assert.equal(taken,false);taken=true;claim=v;step('slot');},push:async()=>step('push'),verifyWorkflows:async()=>{step('workflows');return [];},
    layout:async()=>post(f.m,f.baseline,++n<3?'old':'new'),create:async()=>{step('create');return {id:'synthetic',stackId:F.stackId};},
    waitChangeSet:async()=>step('strict-cs'),execute:async()=>step('execute'),waitFoundation:async()=>step('wait'),fastForward:async()=>step('ff')};
  return {...f,events,claim:()=>claim,setFail:s=>{fail=s;},run:()=>publishAppOnceV6({manifest:f.m,approved:f.m.manifestSha256,io,now:()=>at,profile:profile(f.m)})};}
test('SOURCE binds actual immutable package/facts/history and only four workflow self references are derived',async()=>{
  const s=sourceTemplate(),bound=await bindWorkflowSource(s,'a'.repeat(40),'b'.repeat(40)),c=await createReviewedCycle(bound);
  await assertPublication(c,bound.publication,at);assert.equal(s.historicalPlanCount,14);assert.equal(s.historicalJobIds.length,11);
  assert.equal(s.publication.packageReference.versionId,'PCD4J0_Ydp1lpa1BzFeKhDbNIEiUK1HC');assert.deepEqual(s.publication.factsApproval,FACTS);
  assert.equal(s.publication.sourceCommit,null);assert.equal(s.publication.release.reusableCommit,null);assert.equal(s.publication.activation.releaseSha256,null);
  assert.equal(s.publication.frozenSourceCommit,F.sourceCommit);assert.equal(CLOUD_DEFAULT,null);
});
test('reusable has no self hash, preserves original human gate/App inputs and executes only frozen code with SOURCE literal',async()=>{
  const {m,w}=await fixture(),r=m.objects.reusable.commit;assert(!w.reusable.includes(r));assert(w.caller.includes('@'+r));
  assert.equal(Object.keys(load(w.caller).on.workflow_dispatch.inputs).length,7);assert.equal(load(w.reusable).jobs.single.environment,'techlong-sandbox-deploy');
  assert(w.reusable.includes(F.sourceCommit));assert(w.reusable.includes(F.closureSha256));assert(w.reusable.includes(REFERENCE.versionId));assert(w.reusable.includes('runCycleLive'));
  assert(!w.reusable.includes('fromLoginCredentials'));assert(!w.reusable.includes('F:/'));assert(!w.reusable.includes('E:/'));
  assert.equal(texts('c'.repeat(40)).reusable,w.reusable);
});
test('local binding remains outside the cloud closure and installs only the exact SOURCE/reusable pair',async()=>{
  const text=bindingText(OPERATOR_BEFORE,'b'.repeat(40));assert(text.includes('reusableCommit'));assert(text.includes(REFERENCE.versionId));
  assert.equal(text.replace(/^export const SELECTED_CYCLE=Object\.freeze\(.+\);$/m,'export const SELECTED_CYCLE=null;'),OPERATOR_BEFORE);
  assert.throws(()=>bindingText(text,'c'.repeat(40)),/BINDING_SOURCE/);
  const c=await cycleCloudClosure();assert.equal(c.pinCount,110);assert.equal(c.closureSha256,F.closureSha256);
  assert(!c.pins.some(p=>p.file.endsWith('/operator-source.mjs')));assert(c.pins.some(p=>p.file.endsWith('/selection.mjs')));
});
test('exact current template changes only one trust pin; policies, actor, boundary and physical resources are preserved',async()=>{
  const {m,baseline}=await fixture(),change=trustTemplate(baseline.foundation.template,m.objects.reusable.commit),restored=structuredClone(change.template);
  const claim='token.actions.githubusercontent.com:job_workflow_ref';restored.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[claim]=
    baseline.foundation.template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals[claim];assert.deepEqual(restored,baseline.foundation.template);
  assert.equal(change.changes.length,1);assert.equal(change.changes[0].claim,'job_workflow_ref');assert.equal(m.effects.iamPermissionExpansion,0);
  assert.notEqual(Q.slot,'F:/ChatGPT_workshop/techlong-a604-publication-v1.intent.json');
});
test('five-hour preparation does not restamp facts; 24h approval retains twenty-minute start reserve',async()=>{
  const {m,input}=await fixture();assert.equal(m.expiresAt,input.observedAt+24*3600000);assert.equal(m.source.publication.factsApproval.expiresAt,FACTS.expiresAt);
  await makeReview({...input,createdAt:input.observedAt+5*3600000-1});
  await assert.rejects(makeReview({...input,createdAt:input.observedAt+5*3600000}));
  await assert.rejects(validateApproval(m,m.manifestSha256,m.expiresAt-1200000,false,true));
});
test('tampered object/facts/trust/actions/budget cannot pass even if a new digest is calculated',async()=>{
  const {m}=await fixture();for(const mutate of [v=>{v.actions.push.force=true;},v=>{v.effects.newIamResources=1;},v=>{v.source.publication.packageReference.versionId='other';},
    v=>{v.source.publication.factsApproval.expiresAt++;},v=>{v.objects.caller.operatorBinding.file='other';},v=>{v.permanentSlot='other';}]){
    const v=structuredClone(m);mutate(v);const {manifestSha256:unused,...body}=v;void unused;v.manifestSha256=await sha256Hex(body);await assert.rejects(validateApproval(v,v.manifestSha256,at));}
});
test('shared three-writer publisher preserves ordering and independent inspection remains required',async()=>{
  const f=await runner(),r=await f.run();assert.equal(r.outcome,'APP_WORKFLOWS_AND_TRUST_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  for(const [a,b] of [['slot','push'],['push','create'],['create','strict-cs'],['strict-cs','execute'],['execute','wait'],['wait','ff']])assert(f.events.indexOf(a)<f.events.indexOf(b));
  assert(f.claim().preflightSha256);assert.equal(r.workflowDispatched,false);await assert.rejects(f.run());
});
for(const stage of ['push','create','strict-cs','execute','wait','ff'])test('unknown '+stage+' stops without automatic retries or dispatch',async()=>{
  const f=await runner();f.setFail(stage);const r=await f.run();assert.equal(r.outcome,'APP_PUBLICATION_PARTIAL_OR_UNKNOWN_INSPECT_ONLY_NO_RETRY');
  assert.equal(r.retryAllowed,false);assert.equal(r.workflowDispatched,false);for(const name of ['push','create','execute'])assert(f.events.filter(s=>s===name).length<=1);
});
test('non-trust layout drift cannot be normalized into a successful reconciliation',async()=>{
  const {m,baseline}=await fixture(),p=post(m,baseline,'new');assert.equal(reconcile(p,m,'new',baseline).remainingLayoutUnchanged,true);
  p.iam.roleId='other';assert.throws(()=>reconcile(p,m,'new',baseline));
});
test('read-only shared SDK cannot reach any writer; entry has no arbitrary source/target/permission overrides',async()=>{
  const {m}=await fixture(),io=await createAppPublicationIo('unused',{profile:profile(m,{readOnly:true})});
  try{for(const op of [()=>io.consume({}),()=>io.push(m,async()=>{}),()=>io.create(m,async()=>{}),()=>io.execute(m,{},async()=>{}),()=>io.fastForward(m,async()=>{})])
    await assert.rejects(Promise.resolve().then(op),/READ_ONLY_CAPABILITY/);assert.equal(io.counts().push,0);assert.equal(io.counts().awsMetadata,0);assert.equal(io.counts().githubGets,0);
  }finally{io.dispose();}
  const r=await main(['--check']);assert.equal(r.awsCalls+r.privateContentReads+r.externalWrites+r.dispatches,0);
  for(const args of [[],['--mode','ApproveEnvironment'],['--mode','CaptureReadiness','--ci-run','123','--output','F:/ChatGPT_workshop/techlong-reviewed-cycle-publication-x','--profile','other']])assert.throws(()=>parseArgs(args));
});
