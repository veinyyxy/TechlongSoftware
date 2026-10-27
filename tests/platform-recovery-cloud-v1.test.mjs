import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {recoveryFixture} from './fixtures/platform-recovery-v1.mjs';
import {compileRecoveryRequest} from '../ops/platform-recovery-v1/request.mjs';
import {recoveryData,recoveryBasisCompiler} from '../ops/platform-recovery-v1/basis.mjs';
import {makeRecoveryPackage,rebuildRecoveryPackage,recoveryPackageKey,recoveryEnvelopeKey} from '../ops/platform-recovery-v1/package.mjs';
import {createRecoveryWorker} from '../ops/platform-recovery-v1/worker.mjs';
import {runRecoveryCloud} from '../ops/platform-recovery-cloud-v1/runtime.mjs';
import {recoveryRuntime} from '../ops/platform-recovery-cloud-v1/live.mjs';
import {createRecoveryApplication,readRecoveryRetirement} from '../ops/platform-recovery-cloud-v1/application.mjs';
import {recoveryCloudClosure} from '../ops/platform-recovery-cloud-v1/closure.mjs';
import {recoveryCloudWorkflows} from '../ops/platform-recovery-cloud-v1/workflows.mjs';
import {makeRecoveryReleaseDraft} from '../ops/platform-recovery-cloud-v1/release-draft.mjs';
import {loadNeonContractV5} from '../ops/cloud-worker/neon-contract-v5.mjs';
import {INSTALLED_BINDING_V6 as B} from '../lib/deployments/controller-v6/installed-binding.ts';
import {REQUEST_ADMIN_V6 as ADMIN} from '../lib/deployments/reviewed-request-window-v6.ts';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
import {a604CloudWorkflows} from '../ops/platform-a604-cloud-v1/workflows.mjs';
import {LOCAL_PUBLICATION,publicationAt} from '../ops/platform-a604-operator-v1/scope.mjs';

async function fixture(){
  const f=await recoveryFixture(),d=recoveryData(f.basis,f.at),events=[],puts=[];
  const objects=[...f.objects.entries()].map(([key,object])=>({reference:{key,versionId:object.versionId,sha256:null},object:structuredClone(object)}));
  for(const v of objects)v.reference.sha256=await sha256Hex(v.object.value);
  const pkg=await makeRecoveryPackage({basis:f.basis,inputs:f.input,objects}),pkgRef=await f.store(recoveryPackageKey(f.basis.basisSha256),pkg);
  const p=await compileRecoveryRequest(f.basis,f.at),observed=structuredClone(f.observed);
  observed.job={...f.makeAfter(p).jobs.find(j=>j.id===p.jobId),payload:canonicalJson(p.payload)};
  observed.jobs=[...f.state.jobs,structuredClone(observed.job)];observed.requester={id:ADMIN,status:'active',is_platform_admin:1};observed.checkedAt=f.at;
  const dependencies={installation:f.installation,contract:await loadNeonContractV5(),code:{commitSha:f.sourceCommit,closureSha256:f.release.closureSha256},run:f.run('123456797'),
    openDatabase:async()=>({verify:async()=>{},read:async()=>structuredClone(observed)}),evidence:{verify:async()=>{},put:async(name,scope,value)=>{
      events.push('innerManifest');return f.store(`worker-v5/${observed.job.deployment_id}/${scope.jobId}/${scope.manifestSha256}/${name}`,value);}},
    provider:{readCell:async()=>({stackId:d.context.base.compute.stackId,outputs:Object.fromEntries(['ClusterName','VpcId','SubnetIds','TaskSecurityGroupId','HttpsListenerArn','ControlListenerArn'].map(k=>[k,d.context.base.compute.outputs[k]])),
      parentTagExpiresAt:d.context.base.compute.outputs.CellExpiresAt,activeCellCount:1,activeTenantCount:0}),
      inspectBefore:async()=>({namespacesAbsent:true,retiredPredecessor:d.context.predecessor.stackId,cloudWrites:0})}};
  const real=createRecoveryWorker({basis:f.basis,dependencies,authorize:async()=>{},observeRetirement:async()=>({retirement:f.retirement,observedAt:f.at}),now:()=>f.at});
  const env={...f.env,GITHUB_RUN_ID:'123456797',TECHLONG_RECOVERY_PROTOCOL:'recovery-envelope/v1',TECHLONG_INPUT_JOB:f.profile.newJobId,TECHLONG_INPUT_LINEAGE:canonicalJson(pkgRef)};
  const closure={...f.closure,previousPlatformClosureSha256:B.platform.closureSha256};
  const ports={signal:AbortSignal.timeout(20000),read:async ref=>{events.push('read');return structuredClone(f.objects.get(ref.key).value);},
    open:async()=>({review:async args=>{events.push('Review');return real.review(args);},dispose:async()=>{events.push('dispose');}}),
    put:async(key,value)=>{puts.push({key,value});return f.store(key,value);}};
  const options={env,binding:f.binding,closure,ports,rebuild:v=>rebuildRecoveryPackage(v,f.compile),now:()=>f.at};
  return {...f,pkg,pkgRef,env,closure,events,puts,ports,options};
}

test('cloud Review uses real V5 admission/root and writes outer envelope separately from inner manifest',async()=>{
  const f=await fixture(),r=await runRecoveryCloud(f.options);
  assert.equal(r.outcome,'RECOVERY_REVIEW_PREPARED_NOT_APPROVED');assert.notEqual(r.manifestSha256,r.innerManifestSha256);
  assert.equal(f.events.filter(e=>e==='Review').length,1);assert.equal(f.events.at(-1),'dispose');assert.equal(f.puts.length,2);
  assert.equal(f.puts[0].key,recoveryEnvelopeKey(f.profile.newJobId,r.manifestSha256));
  assert.equal(f.puts[1].value.basisSha256,f.basis.basisSha256);assert.equal(f.puts[1].value.executionReference,null);
  assert(f.events.indexOf('innerManifest')>f.events.indexOf('Review'));
});

for(const fault of ['unpublished','personalActor','rerun','protocol','oldClosure','job','missingPackage'])test('cloud '+fault+' refuses before all ports',async()=>{
  const f=await fixture(),env={...f.env},binding={...f.binding},closure={...f.closure};
  if(fault==='unpublished')binding.state='CANDIDATE';if(fault==='personalActor')env.GITHUB_ACTOR_ID='14145707';
  if(fault==='rerun')env.GITHUB_RUN_ATTEMPT='2';if(fault==='protocol')env.TECHLONG_RECOVERY_PROTOCOL='old';
  if(fault==='oldClosure')closure.previousPlatformClosureSha256='0'.repeat(64);if(fault==='job')env.TECHLONG_INPUT_JOB=f.oldJob.id;
  if(fault==='missingPackage')env.TECHLONG_INPUT_LINEAGE='';
  await assert.rejects(runRecoveryCloud({...f.options,env,binding,closure}));assert.deepEqual(f.events,[]);assert.deepEqual(f.puts,[]);
});

test('RunOnce and independent Inspect preserve inner report paths and four-field outer descriptor, once each',async()=>{
  const f=await fixture(),reviewResult=await runRecoveryCloud(f.options),review=f.puts[0].value,manifest=await f.store(f.puts[0].key,review);
  const base={...f.env,TECHLONG_INPUT_MANIFEST:canonicalJson(manifest),TECHLONG_INPUT_MANIFESTSHA:reviewResult.manifestSha256};
  let runCalls=0,inspectCalls=0,disposed=0;
  const runEnv={...base,TECHLONG_INPUT_MODE:'RunOnce',GITHUB_RUN_ID:'123456798'};
  const reportRef=await f.store(`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/${f.profile.newJobId}/${review.innerManifest.manifestSha256}/run-123456798-1/run.json`,{synthetic:true});
  const runPorts={...f.ports,open:async()=>({runOnce:async args=>{runCalls++;assert.equal(args.approvedRecoveryReviewSha256,reviewResult.manifestSha256);
    return {report:{result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'}},saved:reportRef};},dispose:()=>{disposed++;}})};
  await runRecoveryCloud({...f.options,env:runEnv,ports:runPorts});
  const descriptor=f.puts.find(v=>v.key.endsWith('execution-reference-123456798-v1.json'));
  const execution=await f.store(descriptor.key,descriptor.value),inspectEnv={...base,TECHLONG_INPUT_MODE:'Inspect',GITHUB_RUN_ID:'123456799',TECHLONG_INPUT_EXECUTION:canonicalJson(execution)};
  const inspectReportRef=await f.store(reportRef.key.replace('run-123456798-1/run.json','run-123456799-1/inspect.json'),{synthetic:true});
  const inspectPorts={...f.ports,open:async()=>({inspect:async args=>{inspectCalls++;assert.equal(args.executionRun.runId,'123456798');
    assert.deepEqual(args.executionReportReference,reportRef);return {report:{outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED'},saved:inspectReportRef};},dispose:()=>{disposed++;}})};
  const accepted=await runRecoveryCloud({...f.options,env:inspectEnv,ports:inspectPorts});
  assert.equal(accepted.outcome,'SUCCEEDED_INDEPENDENTLY_VERIFIED');assert.equal(runCalls,1);assert.equal(inspectCalls,1);assert.equal(disposed,2);
  const before=f.events.length;await assert.rejects(runRecoveryCloud({...f.options,env:{...inspectEnv,GITHUB_RUN_ID:'123456798'},ports:inspectPorts}));
  assert(f.events.length>before);assert.equal(inspectCalls,1);
  descriptor.value.recoveryBasisSha256='0'.repeat(64);const bad=await f.store(descriptor.key,descriptor.value);
  await assert.rejects(runRecoveryCloud({...f.options,env:{...inspectEnv,TECHLONG_INPUT_EXECUTION:canonicalJson(bad)},ports:inspectPorts}));assert.equal(inspectCalls,1);
});

test('unknown outer PUT acknowledgement never repeats Review or falls through into RunOnce',async()=>{
  const f=await fixture();await assert.rejects(runRecoveryCloud({...f.options,ports:{...f.ports,put:async()=>{throw Error('synthetic unknown PUT');}}}));
  assert.equal(f.events.filter(e=>e==='Review').length,1);assert.equal(f.events.at(-1),'dispose');
});

test('old package mutation and wrong outer SHA are stopped before opening application',async()=>{
  const f=await fixture();const pkg=structuredClone(f.pkg);pkg.basis.disposition.independentAcceptance=true;
  const bad=await f.store(f.pkgRef.key,pkg);await assert.rejects(runRecoveryCloud({...f.options,env:{...f.env,TECHLONG_INPUT_LINEAGE:canonicalJson(bad)}}));
  assert(!f.events.includes('Review'));
  const g=await fixture();await runRecoveryCloud(g.options);const ref=await g.store(g.puts[0].key,g.puts[0].value);
  await assert.rejects(runRecoveryCloud({...g.options,env:{...g.env,TECHLONG_INPUT_MODE:'RunOnce',
    TECHLONG_INPUT_MANIFEST:canonicalJson(ref),TECHLONG_INPUT_MANIFESTSHA:'0'.repeat(64)}}));
  assert.equal(g.events.filter(e=>e==='Review').length,1);
});

test('retirement read compares exact live UUID, all seven resources and timestamp semantics, with no missing fallback',async()=>{
  const f=await fixture(),calls=[];
  const responses={DescribeStacksCommand:{Stacks:[{StackId:f.profile.stackId,StackStatus:'DELETE_COMPLETE',DeletionTime:new Date(f.retirement.deletionTime)}]},
    ListStackResourcesCommand:{StackResourceSummaries:structuredClone(f.retirement.resources)}};
  const send=async cmd=>{calls.push(cmd);assert.equal(cmd.input.StackName,f.profile.stackId);return responses[cmd.constructor.name];};
  const r=await readRecoveryRetirement({basis:f.basis,send,signal:AbortSignal.timeout(1000),now:()=>f.at});
  assert.deepEqual(r.retirement,f.retirement);assert.equal(calls.length,2);
  responses.ListStackResourcesCommand.NextToken='more';await assert.rejects(readRecoveryRetirement({basis:f.basis,send,now:()=>f.at}));
  delete responses.ListStackResourcesCommand.NextToken;responses.ListStackResourcesCommand.StackResourceSummaries[0].PhysicalResourceId='different';
  await assert.rejects(readRecoveryRetirement({basis:f.basis,send,now:()=>f.at}));
});

test('concrete application construction/disposal has zero credential or secret reads; default live entry rejects locally',async()=>{
  const f=await fixture();let credentialReads=0;const app=await createRecoveryApplication({basis:f.basis,installation:f.installation,run:f.run('123456797'),
    code:{commitSha:f.sourceCommit,closureSha256:f.release.closureSha256},mode:'Review',approvedRecoveryReviewSha256:null,
    credentials:async()=>{credentialReads++;throw Error('must stay lazy');}});
  app.dispose();assert.equal(credentialReads,0);await assert.rejects(recoveryRuntime({},f.closure));
});

test('retirement projection accepts SDK Dates versus archived microsecond ISO only when every fact matches',async()=>{
  const f=await fixture(),retirement={...f.retirement,deletionTime:f.retirement.deletionTime.replace('Z','000+00:00'),
    resources:f.retirement.resources.map((r,n)=>({...r,LastUpdatedTimestamp:new Date(f.at-30000+n).toISOString().replace('Z','000+00:00'),
      DriftInformation:{StackResourceDriftStatus:'NOT_CHECKED'}}))};
  const basis=await recoveryBasisCompiler({...f.profile,retirementSha256:await sha256Hex(retirement)})({...f.input,retirement});
  const responses={DescribeStacksCommand:{Stacks:[{StackId:retirement.stackId,StackStatus:retirement.status,DeletionTime:new Date(retirement.deletionTime)}]},
    ListStackResourcesCommand:{StackResourceSummaries:retirement.resources.map(r=>({...r,LastUpdatedTimestamp:new Date(r.LastUpdatedTimestamp)}))}};
  const value=await readRecoveryRetirement({basis,send:async cmd=>responses[cmd.constructor.name],now:()=>f.at});assert.deepEqual(value.retirement,retirement);
});

test('release draft binds successful source and registered held job but cannot approve publication or deployment',async()=>{
  const f=await fixture(),closure=await recoveryCloudClosure(),input={sourceCommit:f.sourceCommit,createdAt:f.at,closure,
    ci:{sourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success',runId:'123456789'},
    registration:{newJobId:f.profile.newJobId,outcome:'RECOVERY_HELD_REQUEST_COMMITTED_AND_INDEPENDENTLY_VERIFIED',rawSha256:'1'.repeat(64)}};
  const v=await makeRecoveryReleaseDraft(input);assert.equal(v.state,'CANDIDATE');assert.equal(v.approvalShaForExecution,null);
  assert.equal(v.reusableCommit,null);assert.equal(v.recoveryActivation,null);assert.equal(v.executionAuthorized,false);
  await assert.rejects(makeRecoveryReleaseDraft({...input,ci:{...input.ci,conclusion:'failure'}}));
});

test('new closure has no local capabilities and retains all 81 deployed files unchanged; CLI is closed by default',async()=>{
  const c=await recoveryCloudClosure();assert.equal(c.previousPlatformClosureSha256,B.platform.closureSha256);assert(c.pinCount>81);
  for(const file of ['ops/platform-recovery-v1/basis.mjs','ops/platform-recovery-v1/bridge.mjs','ops/platform-request-v6/transfer-state.mjs','ops/platform-publisher-v6/io.mjs'])
    assert(!c.pins.some(p=>p.file===file));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-recovery-cloud-v1/run.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0);const v=JSON.parse(r.stdout);assert.equal(v.state,'CANDIDATE_NOT_PUBLISHED');assert.equal(v.awsCalls+v.privateReads+v.sqlConnections,0);
});

test('workflow renderer preserves archived publication; live files match the current reviewed SOURCE binding',async()=>{
  const f=await fixture(),w=recoveryCloudWorkflows(f.binding),caller=load(w.caller),job=load(w.reusable);
  assert.equal(Object.keys(caller.on.workflow_dispatch.inputs).length,7);assert.equal(caller.concurrency.group,'single-techlong-sandbox-cloud-worker-v5');
  assert.equal(job.jobs.single.environment,'techlong-sandbox-deploy');assert.equal(w.published,false);
  assert.equal(w.reusable.includes(f.binding.reusableCommit),false);assert(w.reusable.includes('ops/platform-recovery-cloud-v1/run.mjs'));
  assert(w.reusable.includes('TECHLONG_RECOVERY_PROTOCOL: recovery-envelope/v1'));
  const published=JSON.parse(await readFile(new URL('../ops/aws-sandbox/reviews/platform-recovery-publication-v1.executed.json',import.meta.url),'utf8'));
  assert.equal(published.outcome,'RECOVERY_WORKFLOWS_AND_TRUST_INDEPENDENTLY_VERIFIED_NO_DISPATCH');
  assert.equal(published.release.sourceCommit,'0494b2be7b0f559ac991533137dfb1b0388ac7a9');
  assert.equal(published.release.closureSha256,'30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374');
  assert.equal(published.release.reusableCommit,'4c09548ab9852a4f3e948f0686f8c81251cda73b');
  assert.equal(published.role.reusableTrustPin,published.release.reusableCommit);
  const historical=recoveryCloudWorkflows(published.release);
  // An immutable old publication remains an archive, not the expected bytes
  // of a subsequently approved deployment. Never rewrite its recorded hashes.
  for(const [file,text] of [['cloud-worker-platform-job-v6.yml',historical.reusable],['cloud-worker-platform-v6.yml',historical.caller]])
    assert.equal(await sha256Hex(text),published.workflows.find(w=>w.path==='.github/workflows/'+file).normalizedLfSha256);
  let active=historical;
  assert(['UNPUBLISHED','PUBLISHED'].includes(LOCAL_PUBLICATION.state));
  if(LOCAL_PUBLICATION.state==='PUBLISHED'){
    const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:20000,windowsHide:true});assert.equal(head.status,0);assert.match(head.stdout.trim(),/^[a-f0-9]{40}$/);
    // Validate the approved descriptor at its real recorded observation time;
    // CI tests publication provenance, not a new grant or a renewed validity.
    const current=await publicationAt(head.stdout.trim(),LOCAL_PUBLICATION.template.factsApproval.observedBy);
    active=a604CloudWorkflows({...current.release,sourceCommit:current.frozenSourceCommit},{publication:current});
    assert.equal(load(active.caller).jobs.reviewed.uses,'veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-platform-job-v6.yml@'+LOCAL_PUBLICATION.reusableCommit);
  }
  assert.equal(Object.keys(load(active.caller).on.workflow_dispatch.inputs).length,7);
  assert.equal(load(active.reusable).jobs.single.environment,'techlong-sandbox-deploy');
  for(const [file,text] of [['cloud-worker-platform-job-v6.yml',active.reusable],['cloud-worker-platform-v6.yml',active.caller]]){
    const current=(await readFile(new URL('../.github/workflows/'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n');
    assert.equal(current,text);
  }
  assert.equal(published.state.controllerActivated,false);assert.equal(published.state.workflowDispatched,false);
});
