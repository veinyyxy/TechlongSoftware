import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {load} from 'js-yaml';
import {readFile} from 'node:fs/promises';
import {CLOUD_V6 as C,S,CLOUD_RELEASE_V6,validateCloudRunV6,validateOidcClaimsV6,externalInputsV6} from '../ops/platform-cloud-v6/contract.mjs';
import {runPlatformCloudV6,platformRuntimeV6} from '../ops/platform-cloud-v6/runtime.mjs';
import {identityProofV6,verifyIdentityProofV6} from '../ops/platform-cloud-v6/identity.mjs';
import {cloudWorkflowsV6,identityWorkflowV6} from '../ops/platform-cloud-v6/workflows.mjs';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';

test('real candidate CLI computes new closure, retains old 76-file closure and has no live authority by default',()=>{
  const invoke=args=>spawnSync(process.execPath,['--experimental-strip-types','ops/platform-cloud-v6/run.mjs',...args],{encoding:'utf8',timeout:30000,windowsHide:true});
  const r=invoke(['--check']);assert.equal(r.status,0);const p=JSON.parse(r.stdout);
  assert.equal(p.release,'UNPUBLISHED');assert.equal(p.legacyClosureSha256,C.legacyClosureSha256);assert.ok(p.closureFiles>76);
  assert.equal(p.awsCalls+p.privateReads+p.sqlConnections,0);assert.notEqual(invoke([]).status,0);
});
test('unpublished, personal actor, rerun, wrong source or inherited credentials stop before every injected port',async()=>{
  const f=await platformFixtureV6();let reads=0;
  const patches=[{GITHUB_ACTOR_ID:S.ownerId},{GITHUB_TRIGGERING_ACTOR:'veinyyxy'},{GITHUB_RUN_ATTEMPT:'2'},
    {GITHUB_WORKFLOW_REF:'other'},{TECHLONG_FROZEN_SOURCE_COMMIT:'b'.repeat(40)},{AWS_PROFILE:'inherited'},{NODE_OPTIONS:'--inspect'},{AWS_ENDPOINT_URL_S3:'https://bad.invalid'}];
  for(const patch of patches)await assert.rejects(runPlatformCloudV6({env:{...f.env,...patch},binding:f.binding,closure:f.closure,ports:{read:()=>{reads++;}}}));
  await assert.rejects(runPlatformCloudV6({env:f.env,binding:CLOUD_RELEASE_V6,closure:f.closure,ports:{read:()=>{reads++;}}}));assert.equal(reads,0);
  await assert.rejects(platformRuntimeV6({},f.closure),/UNPUBLISHED/);
});
test('strict external seven fields reject completed job, foreign execution and reference paths',async()=>{
  const f=await platformFixtureV6();externalInputsV6(f.basePlan.inputs);
  for(const input of [{...f.basePlan.inputs,installationSha:C.installationSha256},{...f.basePlan.inputs,job:S.completedJob},
    {...f.basePlan.inputs,lineage:JSON.stringify({key:'worker-v5/'+S.instanceId+'/not-lineage/x',sha256:'a'.repeat(64),versionId:'v'})}])assert.throws(()=>externalInputsV6(input));
});
test('real mode bridge performs one Review or RunOnce then immutable descriptor/result writes; failure never repeats mode',async()=>{
  const f=await platformFixtureV6(),events=[];let disposed=0;
  const ports={signal:AbortSignal.timeout(10000),read:async ref=>{events.push('read');return f.objects.get(ref.key).value;},
    open:async()=>({review:async()=>{events.push('Review');return {manifest:f.manifest,saved:f.manifestReference};},
      runOnce:async()=>{events.push('RunOnce');return {report:{result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'}},saved:{key:'fixture-run',versionId:'v',sha256:'a'.repeat(64)}};},
      dispose:()=>{disposed++;}}),
    writeExecution:async(k,v)=>{events.push('descriptor');return f.store(k,v);},
    writeResult:async(k,v)=>{events.push('result');assert.equal(v.run.commitSha,f.sourceCommit);return f.store(k,v);}};
  const review=await runPlatformCloudV6({env:f.env,binding:f.binding,closure:f.closure,ports});assert.equal(review.outcome,'REVIEW_PREPARED_NOT_APPROVED');
  const env={...f.env,TECHLONG_INPUT_MODE:'RunOnce',TECHLONG_INPUT_MANIFEST:JSON.stringify(f.manifestReference),TECHLONG_INPUT_MANIFESTSHA:f.manifest.manifestSha256};
  await runPlatformCloudV6({env,binding:f.binding,closure:f.closure,ports});assert.equal(events.filter(x=>x==='RunOnce').length,1);
  assert.ok(events.lastIndexOf('descriptor')<events.lastIndexOf('result'));assert.equal(disposed,2);
  const before=events.filter(x=>x==='RunOnce').length;
  await assert.rejects(runPlatformCloudV6({env,binding:f.binding,closure:f.closure,ports:{...ports,writeExecution:async()=>{throw Error('unknown Put');}}}));
  assert.equal(events.filter(x=>x==='RunOnce').length,before+1);assert.equal(disposed,3);
});
test('Inspect bridge binds a separate exact execution descriptor and never falls through into deployment',async()=>{
  const f=await platformFixtureV6(),run=f.run('123456788'),ref=await f.store(`worker-v5/${S.instanceId}/${f.observed.job.id}/${f.manifest.manifestSha256}/execution-reference-${run.runId}-v1.json`,
    {executionRun:run,executionReportReference:{key:'fixture',versionId:'v',sha256:'a'.repeat(64)}});
  const env={...f.env,TECHLONG_INPUT_MODE:'Inspect',TECHLONG_INPUT_MANIFEST:JSON.stringify(f.manifestReference),TECHLONG_INPUT_MANIFESTSHA:f.manifest.manifestSha256,TECHLONG_INPUT_EXECUTION:JSON.stringify(ref)};
  let calls=0;
  const ports={read:async r=>f.objects.get(r.key).value,open:async()=>({inspect:async e=>{calls++;assert.equal(e.executionRun.runId,run.runId);
    return {report:{outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED'},saved:{key:'fixture',versionId:'v',sha256:'b'.repeat(64)}};},dispose(){}}),writeResult:async(k,v)=>f.store(k,v)};
  await runPlatformCloudV6({env,binding:f.binding,closure:f.closure,ports});assert.equal(calls,1);
  await assert.rejects(runPlatformCloudV6({env:{...env,GITHUB_RUN_ID:run.runId},binding:f.binding,closure:f.closure,ports}));assert.equal(calls,1);
});
test('OIDC claims preflight requires immutable repo subject, actual pinned reusable and App actor, not old personal identity',async()=>{
  const f=await platformFixtureV6(),c={iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',sub:C.oidcSubject,
    repository:S.repository,repository_id:S.repositoryId,repository_owner_id:S.ownerId,actor_id:S.candidateBotId,actor:C.actorLogin,
    ref:'refs/heads/main',sha:f.env.GITHUB_SHA,event_name:'workflow_dispatch',run_id:f.env.GITHUB_RUN_ID,run_attempt:'1',environment:C.environment,
    workflow_ref:`${S.repository}/.github/workflows/${S.workflowFile}@refs/heads/main`,workflow_sha:f.sourceCommit,runner_environment:'github-hosted',
    job_workflow_ref:`${S.repository}/.github/workflows/${C.reusableWorkflow}@${f.binding.reusableCommit}`,
    job_workflow_sha:f.binding.reusableCommit,exp:Math.floor(f.at/1000)+300,nbf:Math.floor(f.at/1000)-60};
  validateCloudRunV6(f.env,f.binding,f.closure);validateOidcClaimsV6(c,f.env,f.binding,f.at);
  for(const patch of [{actor_id:S.ownerId},{aud:'other'},{sub:'repo:veinyyxy/TechlongSoftware:environment:'+C.environment},
    {job_workflow_sha:'0'.repeat(40)},{run_attempt:'2'},{sha:'0'.repeat(40)},{exp:1}])assert.throws(()=>validateOidcClaimsV6({...c,...patch},f.env,f.binding,f.at));
});
test('unpublished workflow renderers preserve seven external inputs, human gate and shared concurrency; no self-reference hash',async()=>{
  const f=await platformFixtureV6(),w=cloudWorkflowsV6({...f.binding}),caller=load(w.caller),job=load(w.reusable),identity=load(identityWorkflowV6(f.frozenSourceCommit));
  assert.equal(caller.jobs.reviewed.uses,`${S.repository}/.github/workflows/${C.reusableWorkflow}@${f.release.reusableCommit}`);
  assert.equal(Object.keys(caller.on.workflow_dispatch.inputs).length,7);assert.equal(caller.concurrency.group,'single-techlong-sandbox-cloud-worker-v5');
  assert.equal(job.jobs.single.environment,C.environment);assert.equal(job.on.workflow_call.inputs.releaseReusableCommit.required,true);
  assert.equal(w.reusable.includes(f.release.reusableCommit),false);assert.equal(job.jobs.single.steps[0].with.ref,f.frozenSourceCommit);
  assert.deepEqual(identity.permissions,{contents:'read'});assert.equal(identity.jobs.identity.environment,C.environment);
  assert.doesNotMatch(JSON.stringify(identity),/id-token|secrets\.|AssumeRole|AWS_ACCESS_KEY|secrets: inherit/);
  const original=await readFile(new URL('../.github/workflows/cloud-worker-execute.yml',import.meta.url),'utf8');assert.match(original,/actor_id == '14145707'/);
});
test('identity proof is nonce/source/sender bound and must match independent exact GitHub run metadata',async()=>{
  const f=await platformFixtureV6(),env={...f.env,GITHUB_WORKFLOW_REF:`${S.repository}/.github/workflows/${C.identityWorkflow}@refs/heads/main`,
    TECHLONG_IDENTITY_SOURCE:f.sourceCommit,TECHLONG_IDENTITY_FROZEN_SOURCE:f.frozenSourceCommit,TECHLONG_IDENTITY_NONCE:'1'.repeat(64)};
  const p=await identityProofV6(env,S.candidateBotId),expected={nonce:env.TECHLONG_IDENTITY_NONCE,sourceCommit:f.sourceCommit,
    frozenSourceCommit:f.frozenSourceCommit,workflowId:'12345',runId:env.GITHUB_RUN_ID};
  const raw=f.rawRun(env.GITHUB_RUN_ID,C.identityWorkflow);assert.equal((await verifyIdentityProofV6(p,raw,expected)).canDeploy,false);
  await assert.rejects(identityProofV6(env,S.ownerId));await assert.rejects(identityProofV6({...env,ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture'},S.candidateBotId));
  await assert.rejects(verifyIdentityProofV6(p,{...raw,run_attempt:2},expected));await assert.rejects(verifyIdentityProofV6(p,raw,{...expected,nonce:'2'.repeat(64)}));
});
