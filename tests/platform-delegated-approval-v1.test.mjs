import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {D,S,environmentProof,historyProof,seedPlan,grant,validateGrant,validateTarget,slot,auditKey} from '../ops/platform-delegated-approval-v1/policy.mjs';
import {dispatchOnce} from '../ops/platform-delegated-approval-v1/operation.mjs';
import {appFetchGuard,verifyAuditPermission} from '../ops/platform-delegated-approval-v1/io.mjs';
import {parseArgs} from '../ops/platform-delegated-approval-v1/local.mjs';
import {readonlyQuery} from '../ops/platform-delegated-approval-v1/readiness.mjs';
import {validatePlan,effects} from '../lib/deployments/controller-v6/contract.ts';
import {canonicalJson} from '../lib/deployments/execution/hash.ts';
import {EVIDENCE_V5 as E} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
const at=Date.parse('2026-10-27T05:00:00Z'),source='2'.repeat(40),sha='b'.repeat(64);
const environment=()=>environmentProof({name:D.environment,protection_rules:[{id:1,type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:Number(S.ownerId)}}]}],
  can_admins_bypass:false,deployment_branch_policy:{protected_branches:true,custom_branch_policies:false}});
const old=()=>({planSha256:'636676cb2faed296b492797942328486b4089962fa23cf5ceb36ca0cdc3b461e',
  actionSha256:'0e62672ee48026a5ee18939d6a8b3cfb25b2ed44ba18c9d8b02d3fff62ff36a5',riskSha256:'09eab6e5c56119faed3c3f7eb3f952ad99a7a9d6b08f535b6e5e9280f4dc115b',
  sourceCommit:'d098cfefd11c8839d5b00fee0701a71ed74aa73c',mode:'Review',jobId:D.jobId,expiresAt:1793069849699,state:'EXPIRED',runId:null});
async function makeGrant(){return grant({sourceCommit:source,seed:await seedPlan(source,at),issuedAt:at,environment:environment(),history:historyProof([old()]),
  pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i+'.mjs',sha256:'a'.repeat(64)})),
  ci:{runId:'123',jobId:'456',sourceCommit:source,testedSourceCommit:source,attempt:1,status:'completed',conclusion:'success'},
  key:{contentRead:false,length:2200,identity:'synthetic',mtimeMs:1,ctimeMs:1,protectionSha256:'c'.repeat(64)},auth:{contentRead:false,length:100,aclSha256:'d'.repeat(64)}});}
const entry=v=>({...v,riskSha256:v.plan.riskSha256,attempt:null});
async function fixture(fail,existing=true){const g=await makeGrant(),plans=new Map(existing?[[g.seed.planSha256,entry(g.seed)]]:[]),calls=[],records=[];
  const act=n=>{calls.push(n);if(n===fail)throw Error('DELEGATED_APPROVAL_SYNTHETIC');};
  const io={assertSource:async()=>act('source'),verifyCi:async()=>act('ci'),environment:async()=>{act('environment');return g.environment;},
    preflight:async()=>act('preflight'),status:async()=>[old()],loadPlan:async s=>structuredClone(plans.get(s)??null),
    claim:async()=>act('claim'),record:async(n,v)=>{act('record:'+n);records.push({n,v});},
    persistAudit:async(k,v)=>{act('audit');assert.equal(k,auditKey(g.grantSha256,'Review'));assert.equal(v.actor,'local_delegated_operator');assert.equal(v.humanWebClick,false);},
    publishSeed:async v=>{act('publish');plans.set(v.planSha256,entry(v));},begin:async(v,admin)=>{act('begin');assert.equal(admin,D.admin);plans.get(v.planSha256).attempt={state:'SUBMISSION_STARTED'};},
    assertLive:async()=>act('live'),acknowledge:async(s,a)=>{act('ack');plans.get(s).attempt={state:'ACKNOWLEDGED',runId:a.runId};},
    markUnknown:async()=>act('unknown'),dispatch:async(p,before,ack)=>{act('dispatch');await before();const a={runId:'123456789',url:'https://github.com/'+S.repository+'/actions/runs/123456789'};await ack(a);return a;},close:async()=>act('close')};
  return {g,io,calls,records,plans};}
const run=f=>dispatchOnce({grant:f.g,approved:f.g.grantSha256,mode:'Review',planSha256:f.g.seed.planSha256,io:f.io,now:()=>at});
test('one delegation covers exact sandbox modes but retains human GitHub gate and resource caps',async()=>{
  const g=await makeGrant();await validateGrant(g,g.grantSha256,at);
  assert.equal(g.policy.githubEnvironmentApproval,'human-owner-required');assert.equal(g.policy.approveGithubEnvironment,false);
  assert.equal(g.policy.oldHostedLeaseRequired,false);assert.equal(g.policy.createStackMax,1);assert.equal(g.policy.resourcesMax,7);
  assert.equal(g.limits.cloudReviewEvidencePutsMax,3);assert.equal(g.delegatedActor.humanWebClick,false);assert.equal(g.delegatedActor.delegatorAdminId,D.admin);
  for(const mode of D.modes)assert.equal(effects(mode).humanEnvironmentApprovalRequired,true);
  assert.notEqual(slot('Review'),slot('RunOnce'));assert.throws(()=>slot('Delete'));assert(g.expiresAt<=D.basisExpiresAt);
});
for(const fault of ['sha','expired','review-window','source','github-policy','budget','actor','seed','history'])test('invalid '+fault+' delegation cannot acquire I/O',async()=>{
  const f=await fixture(),g=structuredClone(f.g);let approved=g.grantSha256,clock=at;
  if(fault==='sha')approved='0'.repeat(64);if(fault==='expired')clock=g.expiresAt;if(fault==='review-window')clock=g.reviewLatestStartAt;
  if(fault==='source')g.sourceCommit='0'.repeat(40);if(fault==='github-policy')g.policy.approveGithubEnvironment=true;
  if(fault==='budget')g.policy.resourcesMax=8;if(fault==='actor')g.delegatedActor.humanWebClick=true;
  if(fault==='seed')g.seed.plan.inputs.job='other';if(fault==='history')g.history[0].runId='123';
  await assert.rejects(dispatchOnce({grant:g,approved,mode:'Review',planSha256:g.seed.planSha256,io:f.io,now:()=>clock}));assert.deepEqual(f.calls,[]);
});
test('missing human reviewer or unknown historical approval never becomes an auto-approval',()=>{
  assert.throws(()=>environmentProof({name:D.environment,protection_rules:[]}));
  assert.throws(()=>environmentProof({name:D.environment,protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:1}}]}]}));
  assert.throws(()=>historyProof([{...old(),state:'ACKNOWLEDGED',runId:'123'}]));assert.throws(()=>historyProof([]));
  assert.deepEqual(historyProof([{...old(),state:'AWAITING_APPROVAL'}]),historyProof([old()]));
});
test('delegated review: audit before ledger, no Web login, durable API ACK and user GitHub approval required',async()=>{
  const f=await fixture(),r=await run(f);assert.equal(r.outcome,'DELEGATED_DISPATCH_ACKNOWLEDGED_REQUIRES_USER_GITHUB_APPROVAL');
  assert(f.calls.indexOf('claim')<f.calls.indexOf('audit'));assert(f.calls.indexOf('audit')<f.calls.indexOf('begin'));
  assert(f.calls.indexOf('begin')<f.calls.indexOf('dispatch'));assert(f.calls.indexOf('record:dispatch-api-ack')<f.calls.indexOf('ack'));
  assert.equal(r.githubEnvironmentApprovedByAgent,false);assert.equal(r.githubEnvironmentApprovalRequired,true);assert.equal(f.calls.at(-1),'close');
});
test('absent seed is published once only after durable delegation audit, with exact independent readback',async()=>{
  const f=await fixture(null,false),r=await run(f);assert(r.outcome.includes('ACKNOWLEDGED'));assert.equal(f.calls.filter(n=>n==='publish').length,1);
  assert(f.calls.indexOf('audit')<f.calls.indexOf('publish'));assert(f.calls.indexOf('publish')<f.calls.indexOf('begin'));
});
for(const fail of ['ci','environment','preflight','claim','audit','publish','begin','dispatch','live','record:dispatch-api-ack','ack'])test('failure '+fail+' never retries or approves GitHub',async()=>{
  const f=await fixture(fail,fail!=='publish'),r=await run(f);assert(r.outcome.includes('STOPPED'));
  assert.equal(r.retryAllowed,false);assert(f.calls.filter(n=>n==='dispatch').length<=1);
  if(['ci','environment','preflight','claim','audit','publish','begin'].includes(fail))assert(!f.calls.includes('dispatch'));
  assert.equal(f.calls.at(-1),'close');
});
test('known API ACK survives token-revoke failure or database ACK failure, not rewritten UNKNOWN',async()=>{
  for(const failure of ['revoke','ack']){const f=await fixture(failure==='ack'?'ack':null),dispatch=f.io.dispatch;
    f.io.dispatch=async(...args)=>{await dispatch(...args);throw Error('DELEGATED_APPROVAL_REVOKE');};const r=await run(f);
    assert(r.knownAck?.runId==='123456789');assert(!f.calls.includes('unknown'));}
});
test('changed environment or occupied plan attempt stops before local slot and audit',async()=>{
  const f=await fixture();f.io.environment=async()=>({...f.g.environment,canAdminsBypass:true});await run(f);assert(!f.calls.includes('claim'));assert(!f.calls.includes('audit'));
  const g=await fixture();g.plans.get(g.g.seed.planSha256).attempt={state:'SUBMISSION_STARTED'};await run(g);assert(!g.calls.includes('claim'));
});
test('unknown old Review status stops before any audit, seed publication or new approval',async()=>{
  const f=await fixture(null,false);f.io.status=async()=>[{...old(),state:'UNKNOWN',runId:null}];
  const r=await run(f);assert(r.outcome.includes('STOPPED'));assert(!f.calls.includes('claim'));assert(!f.calls.includes('publish'));assert(!f.calls.includes('audit'));
});
test('preparation query gate never permits a mutation RPC, DDL, owner write or role switch',()=>{
  readonlyQuery('SELECT deployment_control_v6.status() AS value');readonlyQuery('SET LOCAL search_path=pg_catalog');
  for(const q of ['SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)','SELECT deployment_control_v6.publish_plan($1,$2,$3,$4)',
    'UPDATE public.deployment_jobs SET status=1','ALTER ROLE example LOGIN','SET ROLE neondb_owner','BEGIN'])assert.throws(()=>readonlyQuery(q));
});
test('RunOnce and Inspect require the same delegated seed, source and trusted attested predecessor',async()=>{
  const g=await makeGrant(),plans=new Map(),seed=entry(g.seed);seed.attempt={state:'OBSERVED',status:'completed',conclusion:'success',runId:'123',proofSha256:sha};plans.set(seed.planSha256,seed);
  const ref={key:`worker-v5/${S.instanceId}/${D.jobId}/${'a'.repeat(64)}/manifest.json`,versionId:'fixed-version',sha256:'c'.repeat(64)};
  const p={...structuredClone(g.seed.plan),mode:'RunOnce',preparedAt:at,expiresAt:at+7200000,
    predecessor:{planSha256:seed.planSha256,runId:'123',proofSha256:sha}};
  p.inputs.mode='RunOnce';p.inputs.manifest=canonicalJson(ref);p.inputs.manifestSha='a'.repeat(64);
  const rv=await validatePlan(p,g.binding.release,at),r=entry(rv);await validateTarget(g,r,async s=>plans.get(s),at);
  r.attempt={state:'OBSERVED',status:'completed',conclusion:'success',runId:'124',proofSha256:'d'.repeat(64)};plans.set(r.planSha256,r);
  const ip=structuredClone(p);ip.mode='Inspect';ip.inputs.mode='Inspect';ip.inputs.execution=canonicalJson({key:`worker-v5/${S.instanceId}/${D.jobId}/${'a'.repeat(64)}/execution-reference-124-v1.json`,versionId:'fixed',sha256:'e'.repeat(64)});
  ip.predecessor={planSha256:r.planSha256,runId:'124',proofSha256:'d'.repeat(64)};const iv=entry(await validatePlan(ip,g.binding.release,at));
  await validateTarget(g,iv,async s=>plans.get(s),at);seed.attempt.state='UNKNOWN';await assert.rejects(validateTarget(g,iv,async s=>plans.get(s),at));
  seed.attempt.state='OBSERVED';r.attempt.proofSha256='0'.repeat(64);await assert.rejects(validateTarget(g,iv,async s=>plans.get(s),at));
});
test('transport rejects GitHub environment approval, bypass, settings and arbitrary repository writes',async()=>{
  const g=await makeGrant(),counts={appHttp:0,tokens:0,dispatches:0,revokes:0};let calls=0;
  const send=appFetchGuard({guard:async()=>{},counts,fetcher:async()=>{calls++;return {};}});
  for(const endpoint of [`/repos/${S.repository}/actions/runs/123/pending_deployments`,`/repos/${S.repository}/environments/${D.environment}`,
    '/repos/other/repo/actions/workflows/build.yml/dispatches'])await assert.rejects(send('https://api.github.com'+endpoint,{method:'POST',redirect:'manual'}));
  assert.equal(calls,0);assert.equal(g.policy.approveGithubEnvironment,false);
});
test('last-moment GitHub gate drift prevents the actual dispatch HTTP call',async()=>{
  const counts={appHttp:0,tokens:0,dispatches:0,revokes:0};let posts=0;
  const send=appFetchGuard({guard:async()=>{},counts,beforeDispatch:async()=>{throw Error('GATE_CHANGED');},fetcher:async()=>{posts++;return {};}});
  await assert.rejects(send(`https://api.github.com/repos/${S.repository}/actions/workflows/${S.workflowFile}/dispatches`,{method:'POST',redirect:'manual'}));assert.equal(posts,0);
});
test('audit permission requires the exact action, object, complete decision and no missing context',async()=>{
  const g=await makeGrant(),r={IsTruncated:false,EvaluationResults:[{EvalActionName:'s3:PutObject',EvalResourceName:`arn:aws:s3:::${E.bucket}/${auditKey(g.grantSha256,'Review')}`,
    EvalDecision:'allowed',MissingContextValues:[]}]};verifyAuditPermission(r,g.grantSha256,'Review');
  for(const field of ['EvalActionName','EvalResourceName','EvalDecision','MissingContextValues']){const n=structuredClone(r);n.EvaluationResults[0][field]=field==='MissingContextValues'?['unknown']:'wrong';
    assert.throws(()=>verifyAuditPermission(n,g.grantSha256,'Review'));}
  assert.throws(()=>verifyAuditPermission({...r,IsTruncated:true},g.grantSha256,'Review'));
});
test('CLI has no target, admin, endpoint, environment-approve or key-path override; check is capability-free',()=>{
  for(const flag of ['--admin','--approve-environment','--profile','--endpoint','--key-path'])assert.throws(()=>parseArgs([
    '--mode','DispatchReviewed','--grant','x','--approved-sha','a','--action','Review','--plan-sha','b'.repeat(64),flag,'x']));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-delegated-approval-v1/local.mjs','--check'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout);assert.equal(v.webLoginRequired,false);assert.equal(v.githubEnvironmentApproval,'user-required');
  assert.equal(v.privateReads+v.awsCalls+v.sqlConnections+v.dispatches,0);
});
