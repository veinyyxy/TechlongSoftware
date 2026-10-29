// Local composition of existing single-dispatch/publisher adapters. Never in a
// cloud closure; no credentials or connection are discovered on construction.
import {createHash} from 'node:crypto';
import {createReviewedCycle,assertPublication,assertScope,RISK,must,same} from './cycle.mjs';
import {createCycleRuntime} from './cloud.mjs';
import {D as LEGACY} from '../platform-a604-operator-v1/scope.mjs';
import {CONTINUOUS,createContinuousReviewFlow} from '../platform-a604-operator-v1/continuous.mjs';
import {createA604Policy} from '../platform-a604-operator-v1/policy.mjs';
import {createA604PublisherOperations,createA604InspectPublisherOperations} from '../platform-a604-operator-v1/publisher.mjs';
import {createIo} from '../platform-delegated-approval-v1/io.mjs';
import {createLiveIo,readLaunchSnapshot} from '../platform-recovery-launch-v1/io.mjs';
import {readTransferState} from '../platform-request-v6/transfer-state.mjs';
import {RECOVERY_EXTRA_LEDGER_SQL} from '../platform-recovery-v1/request-state.mjs';
import {normalizedState} from '../platform-request-v6/state-contract.mjs';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {buyerCompatibilityData,rebuildBuyerBundle,createBuyerPublisher} from './buyer-compatibility.mjs';
import {reviewTiming} from '../platform-delegated-publisher-v1/successor.mjs';
import {inspectTiming} from '../platform-a604-operator-v1/inspect-successor.mjs';
import {assertReferenceV6,exactRunV6,CLOUD_V6} from '../platform-cloud-v6/contract.mjs';
import {releaseReady,validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {prepareInitializedPlatformRequest,INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {REQUEST_ADMIN_V6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {evidenceKeyV5} from '../cloud-worker/cloud-evidence-v5.mjs';

// The caller supplies a genuine code capability, never a protocol switch from
// CLI/env/JSON. All actual writes remain in the existing three-write publisher.
async function buyerComposition(cycle,compat,bundle,now){
  const data=buyerCompatibilityData(compat,now()),rebuilt=await rebuildBuyerBundle(compat,bundle),
    beforeState=freeze(rebuilt.baseline),p=cycle.source.publication,job=cycle.profile.newJobId,
    end=Math.min(data.basis.expiresAt,cycle.profile.factsAt+cycle.profile.validMs),packageSha=await sha256Hex(bundle);
  must(job===data.source.request.jobId&&cycle.profile.requestId===data.source.request.requestId&&
    cycle.profile.clientRequestId===data.source.request.clientRequestId&&cycle.profile.stateSha256===await sha256Hex(beforeState)&&
    same([...cycle.source.historicalJobIds].sort(),beforeState.jobs.map(j=>j.id).sort()),'BUYER_SOURCE_BASELINE');
  const assertNative=async(value,profile,at)=>{
    buyerCompatibilityData(compat,at);
    must(same(value,p)&&same(profile,cycle.profile)&&p.schema==='techlong/buyer-context-publication/v1'&&
      p.protocol==='platform-v6/buyer-context'&&p.riskFile===RISK&&p.state==='PUBLISHED'&&p.cycleId===cycle.cycleId&&releaseReady(p.release)&&
      p.sourceCommit===data.source.code.commitSha&&p.release.closureSha256===data.source.code.closureSha256&&
      p.release.installationSha256===CLOUD_V6.installationSha256&&/^[a-f0-9]{40}$/.test(p.frozenSourceCommit??'')&&
      p.basisSha256===data.basis.basisSha256&&p.profileSha256===await sha256Hex(cycle.profile)&&
      p.buyerContextSha256===await sha256Hex(data.source)&&p.packageReference.sha256===packageSha,'BUYER_PUBLICATION');
    assertReferenceV6(p.packageReference,`worker-v5/${S.appInstanceId}/lineage/buyer-context-v1-${packageSha}.json`);
    const a=p.factsApproval;
    must(a?.state==='APPROVED'&&/^[a-f0-9]{64}$/.test(a.manifestSha256??'')&&a.profileSha256===p.profileSha256&&
      a.factsAt===profile.factsAt&&a.databaseCheckedAt===profile.databaseCheckedAt&&a.observedBy===profile.observedBy&&
      a.expiresAt===end&&a.originalBasisExtended===false&&Number.isSafeInteger(at)&&at>=profile.observedBy&&at<end,'BUYER_FACTS_APPROVAL');
    must(p.activation?.schema==='techlong/buyer-context-activation/v1'&&p.activation.state==='PUBLISHED'&&
      p.activation.protocol===p.protocol&&p.activation.sourceCommit===p.sourceCommit&&p.activation.frozenSourceCommit===p.frozenSourceCommit&&
      p.activation.releaseSha256===await sha256Hex(p.release),'BUYER_ACTIVATION');return p;
  };
  await assertNative(p,cycle.profile,now());
  const scope=(plan,value)=>must(same(value,p)&&plan.jobId===job&&plan.sourceCommit===p.sourceCommit&&
    plan.riskSha256===p.release.riskSha256&&plan.inputs.lineage==='','BUYER_PLAN_SCOPE');
  const guard=()=>assertNative(p,cycle.profile,now());
  const runtime={guard,innerManifest:value=>{must(value?.schema==='techlong/cloud-worker-review/v5','BUYER_NATIVE_MANIFEST');return value;},
    rebuild:async value=>{await guard();must(await sha256Hex(value)===packageSha,'BUYER_BUNDLE_SHA');return (await rebuildBuyerBundle(compat,value)).basis;},
    publisher:options=>createBuyerPublisher({compat,publication:p,ports:options.ports,now}),runtimeEnabled:false};
  const verifyRequestReadback=async(basis,input,at)=>{
    await guard();must(basis.basisSha256===data.basis.basisSha256,'BUYER_HISTORICAL_BASIS');
    const s=normalizedState(input),e=cycle.requestEvidence,j=s.jobs.find(j=>j.id===job),
      before=normalizedState({...s,jobs:s.jobs.filter(j=>j.id!==job)});
    must(same(before,beforeState)&&at===e.transactionAt&&await sha256Hex(s)===e.afterSha256&&
      j?.status==='pending'&&j.attempts===0&&j.max_attempts===1&&j.available_at===Number.MAX_SAFE_INTEGER&&
      ['lease_owner','lease_token','lease_expires_at','completed_at'].every(k=>j[k]===null)&&
      Number.isSafeInteger(j.created_at)&&Number.isSafeInteger(j.updated_at)&&j.created_at>=at&&j.updated_at>=j.created_at&&
      j.updated_at<=e.independentObservedAt,'BUYER_REAL_SINGLE_INSERT');
    // Reconstruct at the recorded request instant, not a fabricated later time.
    const request=await prepareInitializedPlatformRequest({deployment:before.deployment,jobs:before.jobs,gateEnabled:true,
      body:{clientRequestId:data.source.request.clientRequestId,deploymentId:S.deploymentId,intent:'restore_initialized_workload'},
      adminUserId:REQUEST_ADMIN_V6,now:at});
    must(request.program?.jobId===job&&request.requestId===cycle.profile.requestId&&
      same(j.payload,request.program.payload)&&j.dedupe_key===request.program.values[2]&&j.deployment_id===S.deploymentId&&j.job_type==='reconcile','BUYER_REQUEST_COMPILER');
  };
  return {runtime,beforeState,basisExpiresAt:end,lineageInput:'',assertPublication:assertNative,assertScope:scope,verifyRequestReadback,
    innerManifest:runtime.innerManifest,
    proposeReview:args=>proposeBuyerSuccessor({...args,runtime,publication:p,now,scope,mode:'Review'}),
    proposeInspect:args=>proposeBuyerSuccessor({...args,runtime,publication:p,now,scope,mode:'RunOnce'})};
}
async function proposeBuyerSuccessor({runtime,publication:p,scope,binding,basis,entry,run,resultReference,readObject,now,mode}){
  await runtime.guard();must(same(binding,p),'BUYER_PROPOSAL_BINDING');scope(entry.plan,p);
  const valid=await validatePlan(entry.plan,p.release,entry.plan.preparedAt),a=entry.attempt;
  must(entry.planSha256===valid.planSha256&&entry.actionSha256===valid.actionSha256&&entry.riskSha256===entry.plan.riskSha256&&
    entry.plan.mode===mode&&a?.proofSha256===null&&['ACKNOWLEDGED','OBSERVED'].includes(a.state)&&
    (a.state==='ACKNOWLEDGED'?a.status==null&&a.conclusion==null:a.status==='completed'&&a.conclusion==='success'),'BUYER_PROPOSAL_ACK');
  exactRunV6(run,{runId:a.runId,sourceCommit:p.sourceCommit,workflowId:p.release.workflowId,reusableCommit:p.release.reusableCommit});
  const allowed=new Set([resultReference,p.packageReference,JSON.parse(entry.plan.inputs.installation)].map(canonicalJson)),cache=new Map();
  const read=async ref=>{assertReferenceV6(ref,ref.key);const k=canonicalJson(ref);must(allowed.has(k),'BUYER_PROPOSAL_ALLOWLIST');
    if(!cache.has(k)){must(cache.size<(mode==='Review'?4:6),'BUYER_PROPOSAL_OBJECT_BUDGET');cache.set(k,await readObject(ref));}return structuredClone(cache.get(k));};
  const result=(await read(resultReference)).value,manifestReference=mode==='Review'?result.cloudReportReference:JSON.parse(entry.plan.inputs.manifest);
  assertReferenceV6(manifestReference,`worker-v5/${S.appInstanceId}/${entry.plan.jobId}/${result.manifestSha256}/manifest.json`);
  allowed.add(canonicalJson(manifestReference));const manifest=(await read(manifestReference)).value;
  const timing=()=>mode==='Review'?reviewTiming(manifest,basis.expiresAt,now()):inspectTiming(manifest,basis.expiresAt,now());timing();
  let report=null;
  if(mode==='RunOnce'){
    assertReferenceV6(result.cloudReportReference,evidenceKeyV5('run.json',{jobId:entry.plan.jobId,manifestSha256:manifest.manifestSha256,
      run:{repository:run.repository.full_name,runId:a.runId,runAttempt:1,commitSha:p.sourceCommit}}));
    assertReferenceV6(result.executionReference,`worker-v5/${S.appInstanceId}/${entry.plan.jobId}/${manifest.manifestSha256}/execution-reference-${a.runId}-v1.json`);
    allowed.add(canonicalJson(result.cloudReportReference));allowed.add(canonicalJson(result.executionReference));report=(await read(result.cloudReportReference)).value;
  }
  const virtual={...structuredClone(entry),attempt:{...structuredClone(a),state:'OBSERVED',status:'completed',conclusion:'success'}},queries=[];
  const pub=runtime.publisher({ports:{guard:async()=>{await runtime.guard();timing();},readObject:read,
    loadPlan:async sha=>{must(sha===valid.planSha256,'BUYER_EXACT_PLAN');return virtual;},
    readRun:async id=>{must(id===a.runId,'BUYER_EXACT_RUN');return run;},writeOwner:async q=>{
      if(queries.length===0){must(q.text==='SELECT deployment_control_v6.attest_evidence($1,$2)'&&q.values[0]===valid.planSha256&&/^[a-f0-9]{64}$/.test(q.values[1]),'BUYER_MEMORY_PROOF');virtual.attempt.proofSha256=q.values[1];}
      else must(queries.length===1&&q.text==='SELECT deployment_control_v6.publish_plan($1,$2,$3,$4::jsonb)','BUYER_MEMORY_PLAN');
      queries.push(structuredClone(q));}}});
  const attestation=await pub.attestResult(valid.planSha256,resultReference),successor=await pub.publishSuccessor(valid.planSha256,resultReference);
  must(queries.length===2&&same(successor.plan,JSON.parse(queries[1].values[3]))&&successor.plan.predecessor.runId===a.runId&&
    successor.plan.expiresAt<=timing().expiresAt,'BUYER_PROPOSAL_SUCCESSOR');
  return {outcome:'BUYER_SUCCESSOR_PROPOSED_NOT_PUBLISHED',sourceCommit:p.sourceCommit,reviewPlanSha256:valid.planSha256,runId:a.runId,
    resultReference,manifestReference,attestation,successor,timing:timing(),proposedOwnerQueries:queries,
    verifiedManifest:manifest,verifiedRunReport:report,physicalOwnerWrites:0,executionApproved:false};
}
export function projectHistory(rows,jobIds){
  return rows.filter(r=>jobIds.includes(r.jobId)).map(r=>{
    // The installed RPC calls this field status; archived rows use runStatus.
    // An explicit conflicting/null value must not be silently replaced.
    must(!Object.hasOwn(r,'runStatus')||!Object.hasOwn(r,'status')||r.runStatus===r.status,'HISTORY_STATUS_CONFLICT');
    const runStatus=(Object.hasOwn(r,'runStatus')?r.runStatus:r.status)??null;
    must(runStatus===null||typeof runStatus==='string','HISTORY_RUN_STATUS');
    return Object.fromEntries(['jobId','planSha256','actionSha256','riskSha256','sourceCommit','mode','expiresAt',
      'runId','state','proofSha256','runStatus','conclusion'].map(k=>[k,k==='runStatus'?runStatus:r[k]??null]));
  }).sort((a,b)=>a.planSha256.localeCompare(b.planSha256));
}
// The installed display RPC is intentionally capped at 12. Read exactly the
// SOURCE-selected job set on the existing verified owner reader instead.
// 54 is an overflow sentinel: the 53-row contract is never truncated/relaxed.
export const COMPLETE_STATUS_SQL=`SELECT count(*)::integer AS plan_count,
  coalesce(jsonb_agg(v ORDER BY plan_sha),'[]'::jsonb) AS value FROM (
    SELECT p.plan_sha,jsonb_build_object('planSha256',p.plan_sha,'actionSha256',p.action_sha,'riskSha256',p.risk_sha,
      'jobId',p.job_id,'mode',p.mode,'sourceCommit',p.body->>'sourceCommit','expiresAt',p.body->'expiresAt',
      'state',coalesce(a.state,CASE WHEN EXISTS(SELECT FROM deployment_control_v6.dispatch_attempts used
        WHERE used.job_id=p.job_id AND used.mode=p.mode) THEN 'SLOT_OCCUPIED'
        WHEN pg_catalog.clock_timestamp()>=p.expires_at THEN 'EXPIRED' ELSE 'AWAITING_APPROVAL' END),
      'runId',a.run_id,'status',a.run_status,'conclusion',a.conclusion,
      'proofSha256',a.proof_sha) AS v FROM deployment_control_v6.plans p
      LEFT JOIN deployment_control_v6.dispatch_attempts a USING(plan_sha)
      WHERE p.job_id=ANY($1::text[]) ORDER BY p.plan_sha LIMIT 54
  ) safe_rows`;
const statusJobIds=ids=>{
  must(Array.isArray(ids)&&ids.length>0&&ids.length<=20&&new Set(ids).size===ids.length&&ids.every(id=>/^job_[a-f0-9]{24}$/.test(id)),'STATUS_JOB_SCOPE');
  return Object.freeze([...ids]);
};
export async function readCompleteCycleStatus(client,jobIds){
  const ids=statusJobIds(jobIds),rows=(await client.query(COMPLETE_STATUS_SQL,[ids])).rows,r=rows?.[0];
  must(rows?.length===1&&Array.isArray(r?.value)&&Number.isSafeInteger(r.plan_count)&&r.plan_count===r.value.length&&r.plan_count<=53,'COMPLETE_STATUS_ROWS');
  must(r.value.every(p=>ids.includes(p.jobId)&&/^[a-f0-9]{64}$/.test(p.planSha256))&&
    new Set(r.value.map(p=>p.planSha256)).size===r.plan_count,'COMPLETE_STATUS_SCOPE');return r.value;
}
// Only this composition overrides status. The original adapter still owns all
// role/catalog/TLS/source checks, guarded read-only queries, budgets and close.
export function createCompleteHistoryDispatchIo(options,jobIds,makeIo=createIo){
  const ids=statusJobIds(jobIds),original=options.capability;let reader,closed=false;
  const io=makeIo({...options,capability:{...original,verifyPreflight:async input=>{
    await original.verifyPreflight(input);reader=input.client;
  }}});
  return {...io,preflight:async()=>{must(!closed,'STATUS_READER_CLOSED');reader=undefined;await io.preflight();must(reader,'STATUS_VERIFIED_READER_REQUIRED');},
    status:async()=>{must(!closed&&reader,'STATUS_VERIFIED_READER_REQUIRED');return readCompleteCycleStatus(reader,ids);},
    close:async()=>{closed=true;reader=undefined;await io.close();}};
}
export async function createCycleComposition(source,{now=Date.now,anchor,buyer,buyerBundle}={}){
  const cycle=await createReviewedCycle(source,{anchor}),p=cycle.source.publication;source=cycle.source;
  const adapter=buyer?await buyerComposition(cycle,buyer,buyerBundle,now):null;
  if(!adapter)await assertPublication(cycle,p,now());
  const slots=freeze(Object.fromEntries(Object.entries(cycle.slots).map(([k,v])=>[k,'F:/ChatGPT_workshop/'+v])));
  const definition=freeze({...LEGACY,schema:'techlong/reviewed-cycle-delegation/v1',jobId:cycle.profile.newJobId,riskFile:RISK,
    basisExpiresAt:adapter?.basisExpiresAt??cycle.profile.factsAt+cycle.profile.validMs,slotPrefix:null});
  const slot=mode=>{must(definition.modes.includes(mode),'MODE');return slots[mode];};
  const auditKey=(sha,mode)=>{must(/^[a-f0-9]{64}$/.test(sha)&&definition.modes.includes(mode),'AUDIT_SCOPE');
    return `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/${definition.jobId}/reviewed-cycle-v1/${cycle.cycleId}/${sha}/${mode}.json`;};
  const history=rows=>{
    must(Array.isArray(rows)&&rows.length<=53&&rows.every(r=>[...source.historicalJobIds,definition.jobId].includes(r.jobId)),'HISTORY_SCOPE');
    const values=projectHistory(rows,source.historicalJobIds);
    must(values.length===source.historicalPlanCount&&new Set(values.map(r=>r.planSha256)).size===values.length&&
      createHash('sha256').update(canonicalJson(values)).digest('hex')===source.historySha256,'HISTORY_DRIFT');return values;
  };
  const runtime=adapter?.runtime??createCycleRuntime({cycle,publication:p,now}),capability={jobId:definition.jobId,definition,slot,auditKey,history,runtime,
    continuous:freeze({...CONTINUOUS,schema:'techlong/reviewed-cycle-continuous/v1',slot:slots.continuous,riskFile:RISK}),
    publishSlot:slots.publish,inspectSlot:slots.inspectPublish,riskFile:RISK,
    publisherSchema:'techlong/reviewed-cycle-publisher/v1',inspectSchema:'techlong/reviewed-cycle-inspect-publisher/v1',
    assertPublication:adapter?.assertPublication??((p,profile,at)=>{must(same(profile,cycle.profile),'SOURCE_PROFILE');return assertPublication(cycle,p,at);}),
    assertScope:adapter?.assertScope??((plan,p)=>assertScope(cycle,plan,p)),
    ...(adapter?Object.fromEntries(['beforeState','basisExpiresAt','lineageInput','verifyRequestReadback','innerManifest','proposeReview','proposeInspect'].map(k=>[k,adapter[k]])):{})};
  const policy=createA604Policy({publication:p,profile:cycle.profile,baselineSha256:cycle.requestEvidence.afterSha256,capability}),
    publisher=createA604PublisherOperations({publication:p,profile:cycle.profile,requestEvidence:cycle.requestEvidence,now,capability}),
    inspectPublisher=createA604InspectPublisherOperations({publication:p,profile:cycle.profile,requestEvidence:cycle.requestEvidence,now,capability});
  // Keep the original role/catalog/admission/protection reader; supply the
  // complete reviewed history, not another hardcoded generation's subset.
  capability.readState=async(client,options)=>{
    const state=await readTransferState(client,{...options,candidateJobId:definition.jobId,ledgerJobIds:source.historicalJobIds.slice(0,2)});
    must(state.jobs.every(j=>[...source.historicalJobIds,definition.jobId].includes(j.id)),'UNREVIEWED_JOB_HISTORY');
    const rows=(await client.query(RECOVERY_EXTRA_LEDGER_SQL,[[...source.historicalJobIds,definition.jobId]])).rows;
    must(rows.length===1&&['plans','approvals','attempts'].every(k=>Array.isArray(rows[0][k])&&rows[0][k].length<=53),'COMPLETE_LEDGER');
    state.ledger=rows[0];return normalizedState(state);
  };
  capability.dispatchIo=options=>createCompleteHistoryDispatchIo({...options,capability:{definition,auditKey,verifyPreflight:async({client,contract})=>{
    if(options.mode==='Inspect')return;
    const state=await readLaunchSnapshot(client,{contract,readState:capability.readState}),ids=new Set(state.ledger.plans.filter(r=>r.job_id===definition.jobId).map(r=>r.plan_sha));
    const base=normalizedState({...state,ledger:{plans:state.ledger.plans.filter(r=>!ids.has(r.plan_sha)),
      approvals:state.ledger.approvals.filter(r=>!ids.has(r.plan_sha)),attempts:state.ledger.attempts.filter(r=>r.job_id!==definition.jobId)}});
    must(await sha256Hex(base)===options.grant.baselineSha256,'FULL_HELD_BASELINE_DRIFT');
  }}},[...source.historicalJobIds,definition.jobId]);
  capability.publisherIo=options=>createLiveIo({...options,readState:capability.readState});
  const continuous=createContinuousReviewFlow({policy,publisher,runtime,profile:cycle.profile,requestEvidence:cycle.requestEvidence,now,capability});
  return Object.freeze({cycle,slots,publication:p,definition,capability:Object.freeze(capability),policy,publisher,inspectPublisher,runtime,continuous});
}
