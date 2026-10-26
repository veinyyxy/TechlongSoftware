import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {M,hash,recoveryBindingCandidate,renderRecoveryBinding,validateBindingLive,makeRecoveryBindingReview,verifyRecoveryBindingApproval} from '../ops/platform-recovery-binding-v1/plan.mjs';
import {parseBindingArgs,createRecoveryBindingIo,bindingPins} from '../ops/platform-recovery-binding-v1/local.mjs';
import {trustOnlyRecoveryTemplate,R} from '../ops/platform-recovery-publication-v1/plan.mjs';
import {recoveryCloudWorkflows} from '../ops/platform-recovery-cloud-v1/workflows.mjs';
import {recoveryCloudClosure} from '../ops/platform-recovery-cloud-v1/closure.mjs';
import {assertRecoveryPublication,bindRecoveryPublication,RECOVERY_CONTROL_BINDING} from '../ops/platform-recovery-control-v1/binding.mjs';
import {createBoundRecoveryController} from '../ops/platform-recovery-control-v1/controller.mjs';
import {publishBindingOnceV6} from '../ops/platform-binding-v6/plan.mjs';
const now=1793020000000;
async function fixture(){
  const b=JSON.parse(await readFile(new URL('./fixtures/platform-recovery-publication-v1.json',import.meta.url),'utf8')),
    before=(await readFile(new URL('./fixtures/platform-recovery-binding-v1.source.txt',import.meta.url),'utf8')).replaceAll('\r\n','\n'),parent='a'.repeat(40),
    template=trustOnlyRecoveryTemplate(b.template,M.reusableCommit).template;
  const baseline={source:b.source,main:'f76d8264e7805a1a9c3eedb0fbd40cd1b0ad0a92',
    foundation:{stackId:R.stackId,status:'UPDATE_COMPLETE',roleArn:null,parameters:[],template,resources:b.resources},
    iam:{...b.iam,trust:template.Resources.WorkerRole.Properties.AssumeRolePolicyDocument,path:'/',tags:[],maxSessionDuration:3600},
    environment:{environmentId:24613410405,adminBypass:false,requiredReviewerId:14145707,mainBranchOnly:true},
    oidc:{use_default:true,use_immutable_subject:true,sub_claim_prefix:'repo:veinyyxy@14145707/TechlongSoftware@1323312747'},unfinishedDeploymentRuns:0,oldDeploymentRunIds:['123']};
  const text=await renderRecoveryBinding(before,parent),input={parent,object:{file:M.target,parent,commit:'b'.repeat(40),tree:'c'.repeat(40),blob:'d'.repeat(40),sha256:hash(text)},
    pins:Array.from({length:15},(_,i)=>({file:'synthetic-'+i,sha256:'e'.repeat(64)})),ci:{runId:'123',jobId:'456',sourceCommit:parent,attempt:1,status:'completed',conclusion:'success'},baseline,createdAt:now};
  const m=await makeRecoveryBindingReview(input);return {m,input,text,before};
}
function state(m,published=false){const layout=structuredClone(m.baseline);layout.main=published?m.object.commit:m.parent;
  const t=recoveryCloudWorkflows({...m.binding.release,sourceCommit:M.runtimeSource});
  return {layout,bindingSha256:published?m.object.sha256:M.beforeSha256,workflows:[
    {id:'390829324',path:'.github/workflows/cloud-worker-platform-job-v6.yml',sha256:hash(t.reusable)},
    {id:'390829326',path:'.github/workflows/cloud-worker-platform-v6.yml',sha256:hash(t.caller)}]};}
async function runner(){const {m}=await fixture(),events=[];let used=false,clock=now,fail;
  const step=s=>{events.push(s);if(s===fail)throw Error('Synthetic unknown');};
  const io={assertLocal:async()=>step('local'),preflight:async()=>{step('preflight');return state(m);},claim:async()=>{assert.equal(used,false);used=true;step('slot');},
    push:async()=>step('push'),record:async n=>step(n),verifyRemote:async()=>{step('readback');return {};},fastForward:async()=>step('ff')};
  const profile={verifyApproval:verifyRecoveryBindingApproval,validatePreflight:validateBindingLive};
  return {m,events,io,profile,fail:s=>{fail=s;},tick:t=>{clock=t;},run:()=>publishBindingOnceV6({manifest:m,approved:m.manifestSha256,io,profile,now:()=>clock})};}
test('exact descriptor pins verified release/package/risk, without its own future publication SHA',async()=>{
  const {m}=await fixture(),b=m.binding;await assertRecoveryPublication(b);
  assert.equal(b.sourceCommit,null);assert.equal(b.activation.sourceCommit,null);assert.equal(b.controllerCodeCommit,m.parent);
  assert.equal(b.release.reusableCommit,M.reusableCommit);assert.equal(b.release.closureSha256,M.closureSha256);
  assert.deepEqual(b.packageReference,M.packageReference);assert.equal(b.release.riskSha256,M.runtimeRiskSha256);
  const effective=await bindRecoveryPublication(b,m.object.commit);assert.equal(effective.sourceCommit,m.object.commit);assert.equal(b.sourceCommit,null);
});
test('renderer replaces only one descriptor literal in the exact old source; arbitrary before text rejected',async()=>{
  const {text,before,m}=await fixture();assert.equal(hash(before),M.beforeSha256);
  assert.equal(hash(Buffer.from(before,'utf8')),hash(before));assert.equal(hash({a:1}),hash('{"a":1}'));
  const marker='export const RECOVERY_CONTROL_BINDING=Object.freeze(',end=');\nfunction commonReady';
  const beforeRest=before.slice(0,before.indexOf(marker))+before.slice(before.indexOf(end));
  const afterRest=text.slice(0,text.indexOf(marker))+text.slice(text.indexOf(end));assert.equal(afterRest,beforeRest);
  assert(text.includes(M.packageReference.versionId));assert(!text.includes(m.object.commit));
  await assert.rejects(renderRecoveryBinding(before+'\n',m.parent));
});
test('one-file binding review has no AWS write, runtime provision, private, package-value, database or dispatch authority',async()=>{
  const {m}=await fixture();for(const k of ['awsWrites','sqlConnections','packageValueReads','secretValueReads','pemReads','appTokens','workflowDispatches','leaseWrites','serverStarts','deployments','automaticWriteRetries'])assert.equal(m.effects[k],0);
  assert.equal(m.effects.changedBindingFiles,1);assert.equal(m.requiredPreflight.freshCurrentStateNotYetObserved,true);
  assert.notEqual(m.permanentSlot,'F:/ChatGPT_workshop/techlong-w6j-binding-publication.intent.json');
});
test('wrong/future/expired approval and scope/risk/pointer/slot tampering fail; no basis deadline extension',async()=>{
  const {m,input}=await fixture();assert.equal(m.expiresAt,Math.min(now+24*3600000,M.basisExpiresAt));
  for(const [a,t] of [['bad',now],[m.manifestSha256,now-1],[m.manifestSha256,m.expiresAt-300000]])await assert.rejects(verifyRecoveryBindingApproval(m,a,t));
  for(const fn of [v=>{v.binding.packageReference.versionId='other';},v=>{v.effects.leaseWrites=1;},v=>{v.actions.force=true;},
    v=>{v.permanentSlot='other';},v=>{v.binding.release.riskSha256='0'.repeat(64);},v=>{v.extra=true;}]){const v=structuredClone(m);fn(v);await assert.rejects(verifyRecoveryBindingApproval(v,m.manifestSha256,now));}
  await verifyRecoveryBindingApproval(m,undefined,M.basisExpiresAt+1,true);await assert.rejects(makeRecoveryBindingReview({...input,createdAt:M.basisExpiresAt}));
});
test('fresh layout matches only a normalized main change; trust/policy/tag/approval/workflow/source drift blocks',async()=>{
  const {m}=await fixture();validateBindingLive(state(m),m);validateBindingLive(state(m,true),m,{published:true});
  for(const fn of [v=>{v.layout.iam.roleId='other';},v=>{v.layout.iam.tags=[{Key:'other',Value:'drift'}];},v=>{v.layout.source.UserId='other';},
    v=>{v.layout.iam.boundary.defaultVersion='v2';},v=>{v.layout.oldDeploymentRunIds.push('124');},v=>{v.layout.environment.adminBypass=true;},
    v=>{v.bindingSha256='0'.repeat(64);},v=>{v.workflows[1].id='1';},v=>{v.workflows[0].sha256='0'.repeat(64);}]){const p=state(m);fn(p);assert.throws(()=>validateBindingLive(p,m));}
});
test('shared V6 flow records fresh prestate before permanent slot, then one push/readback/localFF',async()=>{
  const f=await runner();assert.match((await f.run()).outcome,/REQUIRES_INDEPENDENT_INSPECT/);
  for(const [a,b] of [['execution-preflight','slot'],['slot','push'],['push','readback'],['readback','ff']])assert.ok(f.events.indexOf(a)<f.events.indexOf(b));
  await assert.rejects(f.run());assert.equal(f.events.filter(x=>x==='push').length,1);
});
test('wrong approval and drift stop before slot; all post-slot failures preserve intent without replay',async()=>{
  const f=await runner();await assert.rejects(publishBindingOnceV6({manifest:f.m,approved:'wrong',io:f.io,profile:f.profile,now:()=>now}));assert.deepEqual(f.events,[]);
  const p=await runner();p.io.preflight=async()=>({...state(p.m),bindingSha256:'bad'});await assert.rejects(p.run());assert.equal(p.events.includes('slot'),false);
  for(const s of ['push','push-ack','readback','published-binding','ff','local-main-ack']){const v=await runner();v.fail(s);assert.match((await v.run()).outcome,/PARTIAL/);await assert.rejects(v.run());assert.ok(v.events.filter(x=>x==='push').length<=1);}
});
test('post-slot expiry rejects before submission and cannot open another attempt',async()=>{
  const f=await runner(),claim=f.io.claim;f.io.claim=async v=>{await claim(v);f.tick(f.m.expiresAt);};assert.match((await f.run()).outcome,/PARTIAL/);assert.equal(f.events.includes('push'),false);
});
test('published descriptor without a runtime lease stays closed before database, private key or network factory',async()=>{
  const b=await recoveryBindingCandidate('a'.repeat(40));let privateAccess=0;
  const c=createBoundRecoveryController({binding:b,read:()=>undefined,fetch,ledgerFactory:()=>{privateAccess++;throw Error('no DB');},githubFactory:()=>{privateAccess++;throw Error('no GitHub');}});
  assert.equal(c.enabled(),false);assert.equal(privateAccess,0);assert.equal(RECOVERY_CONTROL_BINDING.sourceCommit,null);
});
test('independent read-only adapter rejects claim/push/FF before any GitHub/AWS credential use',async()=>{
  const {m}=await fixture(),h=await createRecoveryBindingIo(m,'unused',{readOnly:true});
  try{for(const fn of [()=>h.io.claim({}),()=>h.io.push(m),()=>h.io.fastForward(m)])await assert.rejects(Promise.resolve().then(fn),/READ_ONLY_CAPABILITY/);
    assert.equal(h.counts().publication.githubGets,0);assert.equal(h.counts().metadata.awsMetadata,0);assert.equal(h.counts().metadata.githubGets,0);
  }finally{h.io.dispose();}
});
test('CLI has no target/profile/package/source/lease/dispatch override, and PrepareSaved cannot request live metadata',async()=>{
  for(const args of [[],['--mode','Activate','--output','x'],['--mode','Publish'],['--mode','PrepareSaved','--output','x','--ci-run','123','--profile','other']])assert.throws(()=>parseBindingArgs(args));
  const text=await readFile(new URL('../ops/platform-recovery-binding-v1/local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(text,/GetObjectCommand|GetSecretValueCommand|\.env\.local|readKey\s*\(|readAuthV6\s*\(|signAppJwt|new pg\.|\/dispatches/);
  assert.match(text,/readOnly:true/);assert.match(text,/INSPECT_SOURCE_PINS/);
});
test('new local binding publisher is outside the unchanged 97-file cloud closure',async()=>{
  const c=await recoveryCloudClosure();assert.equal(c.pinCount,97);assert.equal(c.closureSha256,M.closureSha256);assert(!c.pins.some(p=>p.file.startsWith('ops/platform-recovery-binding-v1/')));
});
test('fixed publisher dependency lists plus audited control closure avoid template-string pseudo imports',async()=>{
  const p=await bindingPins(),files=p.map(v=>v.file);assert.equal(new Set(files).size,p.length);
  for(const file of ['ops/platform-recovery-binding-v1/local.mjs','ops/platform-recovery-binding-v1/plan.mjs','ops/platform-binding-v6/local.mjs',
    'ops/platform-publication-v6/local.mjs','ops/platform-local-v6/local.mjs','lib/deployments/controller-v6/contract.ts',M.target])assert(files.includes(file));
  assert(!files.includes('ops/platform-binding-v6/contract.ts'));assert(p.every(v=>/^[a-f0-9]{64}$/.test(v.sha256)));
});
