import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {P,PIN_FILES,git,verifyCi,prepareObjects,verifyObjects,makeManifest,validateManifest,publish} from '../ops/platform-identity-review-v6/publication.mjs';
import {identityWorkflowV6} from '../ops/platform-cloud-v6/workflows.mjs';
const now=Date.parse('2026-10-19T16:00:00Z');
const run={id:P.runId,head_sha:P.source,head_branch:'main',event:'push',path:P.ciPath,run_attempt:1,status:'completed',conclusion:'success',
  repository:{id:P.repositoryId,owner:{id:P.ownerId}}};
const jobs={total_count:1,jobs:[{id:P.jobId,run_id:P.runId,run_attempt:1,head_sha:P.source,status:'completed',conclusion:'success',
  steps:Array.from({length:16},()=>({status:'completed',conclusion:'success'}))}]};
function manifest(){const parent='a'.repeat(40);return makeManifest({parent,createdAt:now,ci:verifyCi(run,jobs),
  pins:PIN_FILES.map(file=>({file,sha256:'b'.repeat(64)})),objects:{parent,commit:'c'.repeat(40),tree:'d'.repeat(40),blob:'e'.repeat(40),
    file:P.target,workflowSha256:P.workflowSha256,unsigned:true}});}
function fixture(){
  const m=manifest(),events=[];let occupied=false,fail;
  const step=name=>{events.push(name);if(fail===name)throw Error('Synthetic failure');};
  const io={assertLocal:async()=>step('local'),preflight:async()=>step('preflight'),
    consume:async()=>{assert.equal(occupied,false);occupied=true;step('slot');},push:async()=>step('push'),
    record:async n=>step(n),verifyRemote:async()=>{step('readback');return {};},fastForward:async()=>step('ff')};
  return {m,events,io,fail:n=>{fail=n;},run:()=>publish({manifest:m,approved:m.manifestSha256,io,now:()=>now})};
}
test('exact source, run, attempt, repo and all 16 successful steps are required',()=>{
  assert.equal(verifyCi(run,jobs).realPostgresChecks,12);
  for(const change of [{status:'queued'},{head_sha:'f'.repeat(40)},{run_attempt:2},{conclusion:'failure'},{path:'other'},{repository:{id:1}}])
    assert.throws(()=>verifyCi({...run,...change},jobs));
  for(const change of [{total_count:2},{jobs:[]},{jobs:[{...jobs.jobs[0],steps:jobs.jobs[0].steps.slice(1)}]},
    {jobs:[{...jobs.jobs[0],steps:[...jobs.jobs[0].steps.slice(1),{status:'completed',conclusion:'skipped'}]}]}])
    assert.throws(()=>verifyCi(run,{...jobs,...change}));
});
test('48-hour exact approval binds only one manual file publication and local FF',()=>{
  const m=manifest();assert.equal(m.expiresAt-m.createdAt,48*60*60*1000);validateManifest(m,m.manifestSha256,now);
  assert.equal(m.effects.gitPushAttempts,1);assert.equal(m.effects.localMainFastForwards,1);
  for(const k of ['appKeyReads','appTokens','workflowDispatches','awsOrSqlCalls','iamOrEnvironmentChanges','automaticRetries'])assert.equal(m.effects[k],0);
  assert.throws(()=>validateManifest(m,'0'.repeat(64),now));assert.throws(()=>validateManifest(m,m.manifestSha256,m.expiresAt));
  assert.throws(()=>validateManifest(m,m.manifestSha256,now-1));
  for(const change of [{effects:{...m.effects,workflowDispatches:1}},{parent:'f'.repeat(40)},
    {extraAuthorization:true},{expiresAt:m.expiresAt+1},{permanentSlot:'different'}])
    assert.throws(()=>validateManifest({...m,...change},m.manifestSha256,now));
  assert.equal(validateManifest(m,undefined,m.expiresAt+1000,true),m);
});
test('bad/expired approvals and preflight failures consume no permanent slot',async()=>{
  const f=fixture();await assert.rejects(publish({manifest:f.m,approved:'bad',io:f.io,now:()=>now}));assert.deepEqual(f.events,[]);
  f.fail('preflight');await assert.rejects(f.run());assert.equal(f.events.includes('slot'),false);assert.equal(f.events.includes('push'),false);
});
test('one slot precedes one push; ACK then remote content/registration readback then local FF',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.outcome,'IDENTITY_WORKFLOW_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT');
  assert.deepEqual(f.events,['local','preflight','slot','local','preflight','push','push-command-ack','readback','post-push-readback','ff','local-main-ack']);
  await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='push').length,1);
});
test('unknown push/ACK/verification/FF never retries, compensates or reaches later actions',async()=>{
  for(const phase of ['push','push-command-ack','readback','post-push-readback','ff','local-main-ack']){
    const f=fixture();f.fail(phase);const r=await f.run();assert.match(r.outcome,/PARTIAL_OR_UNKNOWN/);assert.equal(r.retryAllowed,false);
    assert.equal(f.events.filter(v=>v==='push').length,1);if(['push','push-command-ack','readback','post-push-readback'].includes(phase))assert.equal(f.events.includes('ff'),false);
    await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='push').length,1);
  }
});
test('expiry after slot or second fresh read failure stops before push without resetting slot',async()=>{
  const f=fixture();let clock=now;f.io.consume=async()=>{f.events.push('slot');clock=f.m.expiresAt;};
  const r=await publish({manifest:f.m,approved:f.m.manifestSha256,io:f.io,now:()=>clock});assert.match(r.outcome,/PARTIAL/);assert.equal(f.events.includes('push'),false);
  const h=fixture();let count=0;h.io.preflight=async()=>{if(++count===2)throw Error('Drift');};
  assert.match((await h.run()).outcome,/PARTIAL/);assert.equal(h.events.includes('slot'),true);assert.equal(h.events.includes('push'),false);
});
test('actual isolated Git plumbing prepares exactly one unreachable workflow commit without touching main/index/worktree',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'techlong-identity-git-test-')),output=path.join(root,'objects-output');
  const g=(a,o={})=>git(a,{root,...o});await g(['init','--initial-branch=main']);
  await g(['config','user.name','Disposable test']);await g(['config','user.email','test@example.invalid']);
  await mkdir(path.join(root,path.dirname(P.candidate)),{recursive:true});await writeFile(path.join(root,P.candidate),identityWorkflowV6(P.source));
  await g(['add',P.candidate]);await g(['commit','-m','Synthetic base']);const parent=(await g(['rev-parse','HEAD'])).trim();
  // Output lives outside the checkout so it cannot dirty the tested worktree.
  const separate=await mkdtemp(path.join(tmpdir(),'techlong-identity-object-test-'));
  const beforeIndex=await readFile(path.join(root,'.git/index'));
  const o=await prepareObjects({root,output:separate,parent,now});await verifyObjects(o,{root});
  assert.equal((await g(['rev-parse','HEAD'])).trim(),parent);assert.equal((await g(['status','--porcelain'])).trim(),'');
  assert.deepEqual(await readFile(path.join(root,'.git/index')),beforeIndex);
  assert.equal((await g(['branch','--format=%(refname:short)'])).trim(),'main');
  assert.equal((await g(['diff','--name-status',parent,o.commit])).trim(),'A\t'+P.target);
  assert.equal((await g(['show',o.commit+':'+P.target])),identityWorkflowV6(P.source));
  for(const change of [{blob:'0'.repeat(40)},{parent:'f'.repeat(40)},{file:'.github/workflows/other.yml'},{tree:'0'.repeat(40)}])
    await assert.rejects(verifyObjects({...o,...change},{root}));
  await assert.rejects(prepareObjects({root,output:separate,parent,now})); // never replace an occupied preparation index
  assert.equal(output.endsWith('objects-output'),true);
});
test('adapter has one non-force push, fixed GitHub GETs only and no private-key/cloud/SQL/dispatch path',async()=>{
  const code=await readFile(new URL('../ops/platform-identity-review-v6/publication.mjs',import.meta.url),'utf8');
  assert.equal((code.match(/'push','--porcelain'/g)||[]).length,1);assert.match(code,/flag:'wx',flush:true/);
  assert.doesNotMatch(code,/--force|--delete|\.pem|secrets-manager|CloudFormationClient|DATABASE_URL|method:\s*['"](?:POST|PUT|PATCH|DELETE)/);
  const workflow=identityWorkflowV6(P.source);assert.doesNotMatch(workflow,/id-token|workflow_call|\n  push:|\n  schedule:/);
  assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/contents: read/);assert.match(workflow,/environment: techlong-sandbox-deploy/);
});
