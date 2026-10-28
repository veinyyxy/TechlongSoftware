import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {a604Fixture} from './fixtures/platform-a604-cloud-v1.mjs';
import {cycleCloudClosure} from '../ops/platform-reviewed-cycle-v1/closure.mjs';
import {createReviewedCycle,assertCycle,RISK} from '../ops/platform-reviewed-cycle-v1/cycle.mjs';
import {createCycleComposition,projectHistory,COMPLETE_STATUS_SQL,readCompleteCycleStatus,createCompleteHistoryDispatchIo} from '../ops/platform-reviewed-cycle-v1/composition.mjs';
import {createWholeCycleFlow,LOCAL_LIMITS} from '../ops/platform-reviewed-cycle-v1/whole.mjs';
import {createCycleRuntime} from '../ops/platform-reviewed-cycle-v1/cloud.mjs';
import {runCycleLive} from '../ops/platform-reviewed-cycle-v1/live.mjs';
import {parseArgs} from '../ops/platform-reviewed-cycle-v1/local.mjs';
import {createRecoveryPublisher} from '../ops/platform-recovery-v1/bridge.mjs';
import {createDispatchOperation} from '../ops/platform-delegated-approval-v1/operation.mjs';
import {INSTALLATION} from '../ops/platform-a604-operator-v1/policy.mjs';
import {environmentProof} from '../ops/platform-delegated-approval-v1/policy.mjs';
import {validatePlan} from '../lib/deployments/controller-v6/contract.ts';
import {compilePlatformInitializedClaimV4,compilePlatformInitializedCompleteV4} from '../lib/deployments/execution/express-platform-claim-v4.ts';
import {normalizedState} from '../ops/platform-request-v6/state-contract.mjs';
import {sha256Hex,canonicalJson} from '../lib/deployments/execution/hash.ts';
let closure;
async function fixture(fault){
  closure??=await cycleCloudClosure();const f=await a604Fixture({clientRequestId:'11111111-2222-4333-8444-555555555555',closure});
  let at=f.at,state=normalizedState({...f.projection,jobs:f.observed.jobs});const now=()=>at,job=f.profile.newJobId,
    entries=new Map(),events=[],writes=[],records=[],results=new Map(),admin='usr_3fcad3f83006507cb104eebc';
  const oldRows=state.ledger.plans.map(p=>{const a=state.ledger.attempts.find(a=>a.plan_sha===p.plan_sha);return {jobId:p.job_id,planSha256:p.plan_sha,actionSha256:p.action_sha,
    riskSha256:p.risk_sha,sourceCommit:p.body.sourceCommit,mode:p.mode,expiresAt:p.body.expiresAt,runId:a?.run_id??null,state:a?.state??'EXPIRED',
    proofSha256:a?.proof_sha??null,runStatus:a?.run_status??null,conclusion:a?.conclusion??null};});
  const source={schema:'techlong/reviewed-cycle-source/v1',profile:f.profile,historicalJobIds:state.jobs.filter(j=>j.id!==job).map(j=>j.id),
    historicalPlanCount:oldRows.length,requestEvidence:{schema:'techlong/reviewed-cycle-request-evidence/v1',jobId:job,requestId:f.profile.requestId,
      transactionAt:at,independentObservedAt:at,afterSha256:await sha256Hex(state),sealRawSha256:'1'.repeat(64)}};
  source.historySha256=await sha256Hex(projectHistory(oldRows,source.historicalJobIds));
  const selected=await createReviewedCycle(source,{anchor:f.profile});source.publication={...structuredClone(f.publication),
    schema:'techlong/reviewed-cycle-publication/v1',riskFile:RISK,cycleId:selected.cycleId};
  const c=await createCycleComposition(source,{now,anchor:f.profile}),p=c.publication;
  const installation=await f.readObject(f.installationReference);f.objects.set(INSTALLATION.key,{...installation,versionId:INSTALLATION.versionId});
  const env={...f.env,TECHLONG_INPUT_INSTALLATION:canonicalJson(INSTALLATION)};
  const g=await c.policy.grant({sourceCommit:f.sourceCommit,pins:Array.from({length:20},(_,i)=>({file:'synthetic/'+i,sha256:'a'.repeat(64)})),
    ci:{sourceCommit:f.sourceCommit,testedSourceCommit:f.sourceCommit,attempt:1,status:'completed',conclusion:'success'},
    environment:environmentProof({name:c.definition.environment,protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:14145707}}]}],can_admins_bypass:false}),
    history:c.capability.history(oldRows),key:{length:2000,contentRead:false,protectionSha256:'c'.repeat(64)},auth:{length:100,contentRead:false,aclSha256:'e'.repeat(64)},issuedAt:at});
  const row=v=>({plan_sha:v.planSha256,action_sha:v.actionSha256,risk_sha:v.plan.riskSha256,body:v.plan,job_id:job,mode:v.plan.mode,
    expires_at:new Date(v.plan.expiresAt).toISOString(),created_at:new Date(at).toISOString()});
  const loadPlan=async sha=>structuredClone(entries.get(sha)??null);
  const writeOwner=async q=>{
    const phase=q.text.includes('attest_evidence')?'proof':'publish';writes.push(phase);
    if(fault===phase&&events.includes('dispatch-RunOnce'))throw Error('SYNTHETIC_UNKNOWN_WRITE');
    if(phase==='proof'){entries.get(q.values[0]).attempt.proofSha256=q.values[1];state.ledger.attempts.find(a=>a.plan_sha===q.values[0]).proof_sha=q.values[1];}
    else{const v=await validatePlan(JSON.parse(q.values[3]),p.release,at);entries.set(v.planSha256,{...v,riskSha256:v.plan.riskSha256,attempt:null});state.ledger.plans.push(row(v));}
  };
  const initial=createRecoveryPublisher({basis:f.basis,release:p.release,sourceCommit:f.sourceCommit,frozenSourceCommit:p.frozenSourceCommit,
    activation:p.activation,now,rebuildPackage:c.runtime.rebuild,ports:{guard:()=>c.runtime.guard(),readObject:f.readObject,readRun:async id=>f.rawRun(id),
      readHeldJob:async()=>f.observed,loadPlan,writeOwner}});
  const seed=await initial.publishReview({installationReference:INSTALLATION,recoveryPackageReference:f.pkgRef});assert.equal(seed.planSha256,g.seed.planSha256);writes.length=0;
  const dispatchOp=createDispatchOperation({definition:c.definition,approve:c.policy.approve,target:c.policy.target,history:c.capability.history,
    key:c.capability.auditKey,historyModes:c.definition.modes});
  const dispatch=async(mode,plan)=>{
    events.push('dispatch-'+mode);const id={Review:'123456797',RunOnce:'123456798',Inspect:'123456799'}[mode];
    return dispatchOp({grant:g,approved:g.grantSha256,mode,planSha256:plan.planSha256,now,io:{
      assertSource:async()=>{},verifyCi:async()=>{},environment:async()=>g.environment,preflight:async()=>{},status:async()=>oldRows,loadPlan,
      claim:async()=>events.push('slot-'+mode),record:async(n,v)=>records.push({n:mode+'-'+n,v}),persistAudit:async()=>events.push('audit-'+mode),
      publishSeed:async()=>{throw Error('UNEXPECTED_SEED_REPLAY');},
      begin:async()=>{const e=entries.get(plan.planSha256);e.attempt={state:'DISPATCHING',runId:null,status:null,conclusion:null,proofSha256:null};
        state.ledger.approvals.push({plan_sha:plan.planSha256,admin_id:c.definition.admin,approved_at:new Date(at).toISOString()});
        state.ledger.attempts.push({plan_sha:plan.planSha256,job_id:job,mode,state:'DISPATCHING',run_id:null,run_status:null,conclusion:null,proof_sha:null,observed_at:null});},
      assertLive:async()=>{},dispatch:async(_p,before,onAck)=>{await before();if(fault==='unknown-'+mode)throw Error('SYNTHETIC_UNKNOWN_ACK');
        await onAck({runId:id,url:'https://github.com/veinyyxy/TechlongSoftware/actions/runs/'+id});},
      acknowledge:async(sha,ack)=>{Object.assign(entries.get(sha).attempt,{state:'ACKNOWLEDGED',runId:ack.runId});Object.assign(state.ledger.attempts.find(a=>a.plan_sha===sha),{state:'ACKNOWLEDGED',run_id:ack.runId});},
      markUnknown:async()=>events.push('unknown-'+mode),close:async()=>{}}});
  };
  const publisherIo=()=>({assertSource:async()=>{},verifyCi:async()=>{},verifySourceIdentity:async()=>{},claim:async()=>events.push('publisher-slot'),
    record:async(n,v)=>records.push({n,v}),readRun:async id=>f.rawRun(id),readObject:f.readObject,close:async()=>{},open:async()=>({loadPlan,
      snapshot:async()=>structuredClone(state),writeOwner,close:async()=>{},observe:async sha=>{writes.push('observe');
        Object.assign(entries.get(sha).attempt,{state:'OBSERVED',status:'completed',conclusion:'success'});
        Object.assign(state.ledger.attempts.find(a=>a.plan_sha===sha),{state:'OBSERVED',run_status:'completed',conclusion:'success',observed_at:new Date(at).toISOString()});}})});
  async function wait(ack){
    events.push('human-approval-'+ack.mode);if(fault==='failed-'+ack.mode)return {...f.rawRun(ack.runId),conclusion:'failure'};
    const plan=entries.get(ack.planSha256).plan,runtime=createCycleRuntime({cycle:c.cycle,publication:p,now}),input={...env,GITHUB_RUN_ID:ack.runId,
      ...Object.fromEntries(Object.entries(plan.inputs).map(([k,v])=>['TECHLONG_INPUT_'+k.toUpperCase(),v]))};
    let ports=f.ports;
    if(ack.mode!=='Review'){
      const envelope=(await f.readObject(JSON.parse(plan.inputs.manifest))).value,inner=envelope.innerManifest;let report;
      if(ack.mode==='RunOnce'){
        const token='lease_'+'0'.repeat(32),done=at+1000,claim=await compilePlatformInitializedClaimV4({plan:inner.jobPlan,queuedJob:inner.queue.row,approvedPlanSha256:inner.jobPlan.planSha256,leaseToken:token});
        const proof={materialSha256:inner.jobPlan.materialSha256,jobId:job,leaseToken:token,
          stackId:'arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/22222222-3333-4444-8555-666666666666',
          workloadExpiresAt:inner.workload.workloadExpiresAt,imageUri:inner.jobPlan.material.images.app,configurationHash:inner.jobPlan.material.configurationSha256,
          existingDefaultStoreId:inner.jobPlan.material.existingDefaultStoreId,epoch:inner.jobPlan.externalFence.epoch,operationHash:inner.jobPlan.externalFence.operationHash,
          providerObservationSha256:'1'.repeat(64),providerCheckedAt:done-1,authorityObservationSha256:'2'.repeat(64),authorityCheckedAt:done-1,
          controlObservationSha256:'3'.repeat(64),controlCheckedAt:done-1,initializedVerified:true,effectiveConfigurationVerified:true};
        const complete=await compilePlatformInitializedCompleteV4({plan:inner.jobPlan,queuedJob:inner.queue.row,lease:claim.lease,proof,now:done}),
          completed={...inner.queue.row,status:'succeeded',payload:JSON.parse(claim.statements[3].values[2]),attempts:1,available_at:at+100,completed_at:done,updated_at:done};
        state.jobs=state.jobs.map(j=>j.id===job?completed:j);state.deployment.outputs=JSON.parse(complete.outputs);state.deployment.admissionSnapshot.predecessorJob=completed;
        report={schema:'techlong/cloud-worker-run/v5',manifestSha256:inner.manifestSha256,jobId:job,run:f.run(ack.runId),
          result:{outcome:'NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED',receiptSha256:complete.receiptSha256},journal:{state:'ALL_SLOTS_CONSUMED'},independentInspectRequired:true,retryAllowed:false};
      }else{
        const receipt=state.deployment.outputs.expressInitializedWorkerRunsV2[job],body={schema:'techlong/cloud-worker-independent-inspect/v5',outcome:'SUCCEEDED_INDEPENDENTLY_VERIFIED',
          manifestSha256:inner.manifestSha256,jobId:job,run:f.run(ack.runId),executionRun:f.run('123456798'),journal:{state:'ALL_SLOTS_CONSUMED'},
          receiptSha256:await sha256Hex(receipt),providerObservationSha256:receipt.providerObservationSha256,checkedAt:at,retryAllowed:false,cloudWrites:0,databaseWrites:0,privateControlReads:0};
        if(fault==='receipt-Inspect')body.receiptSha256='9'.repeat(64);
        report={...body,inspectSha256:await sha256Hex(body)};
      }
      const saved=await f.store(`worker-v5/${plan.instanceId}/${job}/${inner.manifestSha256}/run-${ack.runId}-1/${ack.mode==='RunOnce'?'run':'inspect'}.json`,report);
      ports={...f.ports,open:async()=>({runOnce:async()=>({report,saved}),inspect:async()=>({report,saved}),dispose:async()=>{}})};
    }
    results.set(ack.mode,await runtime.run({env:input,closure,ports}));at+=2000;return f.rawRun(ack.runId);
  }
  async function capture(ack){
    const entry=await loadPlan(ack.planSha256),resultRef=results.get(ack.mode).saved,result=(await f.readObject(resultRef)).value,
      refs=[resultRef,ack.mode==='Review'?result.cloudReportReference:JSON.parse(entry.plan.inputs.manifest)];
    if(ack.mode!=='Review')refs.push(result.cloudReportReference);if(ack.mode==='RunOnce')refs.push(result.executionReference);refs.push(f.pkgRef,INSTALLATION);
    const objects=[];for(const reference of refs)objects.push({reference,object:await f.readObject(reference)});
    if(fault==='bytes-'+ack.mode)objects[0].object.value.outcome='FORGED';
    if(fault==='late-'+ack.mode)at+=(ack.mode==='Review'?12:120)*60000;
    const snapshot=structuredClone(state);if(fault==='business-'+ack.mode)snapshot.deployment.admissionSnapshot.subscription.status='paused';
    return {entry,objects,resultReference:resultRef,snapshot};
  }
  const flow=createWholeCycleFlow(c,{now}),outer=await flow.makeReview({grant:g,createdAt:at});
  const continuousIo={record:async(n,v)=>records.push({n,v}),assertSource:async()=>{},verifyCi:async()=>{},assertUnused:async()=>{},claim:async()=>events.push('continuous-slot'),
    dispatchReview:async()=>dispatch('Review',g.seed),waitReview:wait,capture,publisherIo:async()=>publisherIo(),close:async()=>{}};
  const io={record:async(n,v)=>records.push({n,v}),assertSource:async()=>{},verifyCi:async()=>{},assertUnused:async()=>{if(fault==='occupied')throw Error('SLOT_OCCUPIED');},
    claim:async()=>events.push('whole-slot'),continuousIo:async()=>continuousIo,dispatch,wait,capture,publisherIo:async()=>publisherIo(),close:async()=>events.push('close')};
  return {f,source,c,g,outer,flow,io,events,writes,records,advance:ms=>{at+=ms;},admin};
}

test('one reviewed fresh-cycle composition reuses real compilers and two three-write publishers through independent Inspect',async()=>{
  const f=await fixture(),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
  assert.equal(r.outcome,'WHOLE_CYCLE_INDEPENDENTLY_VERIFIED',JSON.stringify(r));
  assert.deepEqual(f.writes,['observe','proof','publish','observe','proof','publish']);
  assert.deepEqual(Object.keys(r.runIds),['Review','RunOnce','Inspect']);assert.equal(new Set(Object.values(r.runIds)).size,3);
  for(const mode of ['Review','RunOnce','Inspect']){assert.equal(f.events.filter(e=>e==='dispatch-'+mode).length,1);assert(f.events.includes('human-approval-'+mode));}
  assert.equal(r.finalLedgerProofImported,false);assert.equal(r.wholeProductAccepted,false);assert.equal(f.outer.policy.approveGithubEnvironment,false);
  assert.equal(f.outer.limits.configurationReadsMax,8);assert.equal(f.outer.limits.sqlQueriesMax,635);
  assert.notEqual(f.c.slots.Review,'F:/ChatGPT_workshop/techlong-a604-delegation-v1-Review.intent.json');
  await assert.rejects(f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io}),/MEMORY_ONCE/);
});
for(const fault of ['occupied','unknown-RunOnce','unknown-Inspect','failed-RunOnce','failed-Inspect','bytes-RunOnce','bytes-Inspect','business-RunOnce','business-Inspect','receipt-Inspect','late-Review','late-RunOnce','proof','publish']){
  test(fault+' stops the exact chain and never repeats a dispatch/write',async()=>{
    const f=await fixture(fault),r=await f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io});
    assert.equal(r.outcome,'WHOLE_CYCLE_STOPPED_REQUIRES_READBACK',JSON.stringify(r));assert.equal(r.retryAllowed,false);
    for(const mode of ['Review','RunOnce','Inspect'])assert(f.events.filter(e=>e==='dispatch-'+mode).length<=1);
    if(['bytes-RunOnce','business-RunOnce','failed-RunOnce','unknown-RunOnce','proof','publish'].includes(fault))assert(!f.events.includes('dispatch-Inspect'));
    if(fault==='late-Review')assert(!f.events.includes('dispatch-RunOnce'));
  });
}
test('whole approval cannot be replaced by the Review-only grant/continuous SHA, recomputed enlarged budget or stale manifest',async()=>{
  const f=await fixture();for(const sha of [f.g.grantSha256,f.outer.continuous.manifestSha256])await assert.rejects(f.flow.run({manifest:f.outer,approved:sha,io:f.io}),/APPROVAL/);
  const changed=structuredClone(f.outer);changed.limits.appDispatchesMax=4;delete changed.manifestSha256;changed.manifestSha256=await sha256Hex(changed);
  await assert.rejects(f.flow.run({manifest:changed,approved:changed.manifestSha256,io:f.io}),/APPROVAL/);assert.deepEqual(f.events,[]);
  f.advance(7200001);await assert.rejects(f.flow.run({manifest:f.outer,approved:f.outer.manifestSha256,io:f.io}));
});
test('source-only capability fixes history, anchors, request evidence and stable slots; JSON cannot mint a capability',async()=>{
  const f=await fixture();assert.throws(()=>assertCycle(JSON.parse(JSON.stringify(f.c.cycle))),/SOURCE_CAPABILITY/);
  const again=await createReviewedCycle(f.source,{anchor:f.f.profile});assert.deepEqual(again.slots,f.c.cycle.slots);
  const changedFacts=structuredClone(f.source);changedFacts.profile.observedBy++;const changed=await createReviewedCycle(changedFacts,{anchor:f.f.profile});
  assert.notEqual(changed.cycleId,again.cycleId);assert.deepEqual(changed.slots,again.slots);
  for(const change of [s=>{s.profile.newJobId='job_a60423b885fef3e4326213f7';},s=>{s.profile.receiptSha256='0'.repeat(64);},s=>{s.requestEvidence.jobId='job_'+'f'.repeat(24);}]){
    const s=structuredClone(f.source);change(s);await assert.rejects(createReviewedCycle(s,{anchor:f.f.profile}));}
  assert.throws(()=>f.c.capability.history([]),/HISTORY_DRIFT/);assert.equal(LOCAL_LIMITS.appDispatchesMax,3);
});
test('new cloud composition rejects a different job, actor, rerun or old closure before private ports',async()=>{
  const f=await fixture();let ports=0;
  for(const change of [e=>{e.TECHLONG_INPUT_JOB='job_'+'f'.repeat(24);},e=>{e.GITHUB_ACTOR_ID='14145707';},e=>{e.GITHUB_RUN_ATTEMPT='2';}]){
    const env=structuredClone(f.f.env);change(env);await assert.rejects(createCycleRuntime({cycle:f.c.cycle,publication:f.c.publication,now:f.f.now}).run({env,closure,
      ports:{read:async()=>{ports++;},open:async()=>{ports++;}}}));}
  await assert.rejects(createCycleRuntime({cycle:f.c.cycle,publication:f.c.publication,now:f.f.now}).input(f.f.env,{...closure,schema:'old'}));assert.equal(ports,0);
});
test('default entry and cloud transport close before credentials; no job/profile/source/continue overrides',async()=>{
  let calls=0;const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('NO_NETWORK');};
  try{await assert.rejects(runCycleLive({},{}),/SOURCE_NOT_CONFIGURED/);}finally{globalThis.fetch=old;}assert.equal(calls,0);
  for(const flag of ['--job','--profile','--source','--resume','--run-id'])assert.throws(()=>parseArgs(['--mode','RunReviewed','--manifest','x','--approved-sha','a'.repeat(64),flag,'override']));
  const r=spawnSync(process.execPath,['--experimental-strip-types','ops/platform-reviewed-cycle-v1/local.mjs','--check'],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).executionAuthorized,false);
  assert.equal(closure.previousA604ClosureSha256,'f4e76cfb90ef04cb4229c6f720f08603130335d84c35cb638817f7209e0d1269');
});

const historyJobs=['job_'+'1'.repeat(24),'job_'+'2'.repeat(24)];
const statusRows=(count=14)=>Array.from({length:count},(_,i)=>({jobId:historyJobs[0],planSha256:(i+1).toString(16).padStart(64,'0'),
  actionSha256:'a'.repeat(64),riskSha256:'b'.repeat(64),sourceCommit:'c'.repeat(40),mode:'Review',expiresAt:1,
  state:i===0?'OBSERVED':'SLOT_OCCUPIED',runId:i===0?'123456797':null,status:i===0?'completed':null,
  conclusion:i===0?'success':null,proofSha256:i===0?'d'.repeat(64):null}));
test('runtime status maps to the archived runStatus without losing a real value or masking conflicts',()=>{
  const rows=statusRows(),expected=rows.map(({status,...r})=>({...r,runStatus:status}));
  assert.deepEqual(projectHistory(rows,historyJobs),projectHistory(expected,historyJobs));
  assert.equal(projectHistory(rows,historyJobs)[0].runStatus,'completed');
  for(const runStatus of [null,'queued',undefined])assert.throws(()=>projectHistory([{...rows[0],runStatus}],historyJobs),/HISTORY_STATUS_CONFLICT/);
  assert.throws(()=>projectHistory([{...expected[0],runStatus:{forged:true}}],historyJobs),/HISTORY_RUN_STATUS/);
});
test('complete status is one fixed scoped SELECT, retaining fourteen rows and the original status semantics',async()=>{
  const value=statusRows(),calls=[],client={query:async(text,values)=>{calls.push({text,values});return {rows:[{plan_count:14,value}]};}};
  assert.deepEqual(await readCompleteCycleStatus(client,historyJobs),value);assert.equal(calls.length,1);
  assert.equal(calls[0].text,COMPLETE_STATUS_SQL);assert.deepEqual(calls[0].values,[historyJobs]);
  assert.match(COMPLETE_STATUS_SQL,/WHERE p\.job_id=ANY\(\$1::text\[\]\)/);assert.match(COMPLETE_STATUS_SQL,/LIMIT 54/);
  assert(!/LIMIT 12|\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|REVOKE)\b/.test(COMPLETE_STATUS_SQL));
  const installed=(await readFile(new URL('../ops/platform-controller-v6/install.sql',import.meta.url),'utf8')).split('CREATE FUNCTION deployment_control_v6.status()')[1].split('$$;')[0],
    object=s=>s.slice(s.indexOf('jsonb_build_object('),s.indexOf(' AS v FROM')).replaceAll('pg_catalog.','').replace(/\s+/g,' ');
  assert.equal(object(COMPLETE_STATUS_SQL),object(installed));
});
for(const fault of ['overflow','missing','duplicate','foreign','multiple','string-count'])test('complete status rejects '+fault+' without RPC fallback or another query',async()=>{
  const value=statusRows(fault==='overflow'?54:14);let plan_count=value.length;
  if(fault==='missing')value.pop();if(fault==='duplicate')value[1]={...value[0]};
  if(fault==='foreign')value[0].jobId='job_'+'f'.repeat(24);if(fault==='string-count')plan_count=String(plan_count);
  const rows=[{plan_count,value}];if(fault==='multiple')rows.push(rows[0]);let calls=0;
  await assert.rejects(readCompleteCycleStatus({query:async()=>{calls++;return {rows};}},historyJobs),/COMPLETE_STATUS/);assert.equal(calls,1);
});
test('complete reader keeps the existing 53 row ceiling and rejects invalid SOURCE job sets before querying',async()=>{
  const value=statusRows(53);assert.equal((await readCompleteCycleStatus({query:async()=>({rows:[{plan_count:53,value}]})},historyJobs)).length,53);
  let calls=0;for(const ids of [[],['arbitrary'],[historyJobs[0],historyJobs[0]],Array.from({length:21},(_,i)=>'job_'+i.toString(16).padStart(24,'0'))])
    await assert.rejects(readCompleteCycleStatus({query:async()=>{calls++;}},ids),/STATUS_JOB_SCOPE/);
  assert.equal(calls,0);
});
test('SOURCE dispatch wrapper uses only the verified existing reader, never opens another connection and closes access',async()=>{
  const rows=statusRows(),events=[],ids=[...historyJobs],queries=[],client={query:async(text,values)=>{queries.push({text,values});return {rows:[{plan_count:rows.length,value:rows}]};}};
  const io=createCompleteHistoryDispatchIo({capability:{verifyPreflight:async({client:c})=>{assert.equal(c,client);events.push('full-preflight');}}},ids,
    options=>({preflight:async()=>{events.push('original-tls-role-catalog');await options.capability.verifyPreflight({client});},
      status:async()=>{throw Error('TRUNCATED_RPC_MUST_NOT_RUN');},close:async()=>events.push('original-close')}));
  ids[0]='job_'+'e'.repeat(24);await assert.rejects(io.status(),/VERIFIED_READER_REQUIRED/);assert.equal(queries.length,0);
  await io.preflight();assert.deepEqual(events,['original-tls-role-catalog','full-preflight']);
  assert.deepEqual(await io.status(),rows);assert.equal(queries.length,1);assert.deepEqual(queries[0].values,[historyJobs]);
  await io.close();await assert.rejects(io.status(),/VERIFIED_READER_REQUIRED/);assert.equal(queries.length,1);
});
test('failed full preflight never exposes a status reader',async()=>{
  let reads=0;const io=createCompleteHistoryDispatchIo({capability:{verifyPreflight:async()=>{throw Error('SYNTHETIC_BASELINE_DRIFT');}}},historyJobs,
    options=>({preflight:async()=>options.capability.verifyPreflight({client:{query:async()=>{reads++;}}}),close:async()=>{}}));
  await assert.rejects(io.preflight(),/BASELINE_DRIFT/);await assert.rejects(io.status(),/VERIFIED_READER_REQUIRED/);assert.equal(reads,0);await io.close();
});
test('complete fourteen-plan history is mandatory; missing older rows or changing actual status cannot pass the frozen digest',async()=>{
  const f=await fixture(),source=structuredClone(f.source),rows=statusRows().map(r=>({...r,jobId:source.historicalJobIds[0]}));
  source.historicalPlanCount=14;source.historySha256=await sha256Hex(projectHistory(rows,source.historicalJobIds));
  const selected=await createReviewedCycle(source,{anchor:f.f.profile});source.publication.cycleId=selected.cycleId;
  const c=await createCycleComposition(source,{anchor:f.f.profile,now:f.f.now});assert.equal(c.capability.history(rows).length,14);
  assert.throws(()=>c.capability.history(rows.slice(2)),/HISTORY_DRIFT/);
  assert.throws(()=>c.capability.history(rows.map((r,i)=>i===0?{...r,status:null}:r)),/HISTORY_DRIFT/);
  assert.throws(()=>c.capability.history(rows.map((r,i)=>i===0?{...r,proofSha256:null}:r)),/HISTORY_DRIFT/);
});
