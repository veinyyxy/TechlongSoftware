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
export async function createCycleComposition(source,{now=Date.now,anchor}={}){
  const cycle=await createReviewedCycle(source,{anchor}),p=cycle.source.publication;source=cycle.source;await assertPublication(cycle,p,now());
  const slots=freeze(Object.fromEntries(Object.entries(cycle.slots).map(([k,v])=>[k,'F:/ChatGPT_workshop/'+v])));
  const definition=freeze({...LEGACY,schema:'techlong/reviewed-cycle-delegation/v1',jobId:cycle.profile.newJobId,riskFile:RISK,
    basisExpiresAt:cycle.profile.factsAt+cycle.profile.validMs,slotPrefix:null});
  const slot=mode=>{must(definition.modes.includes(mode),'MODE');return slots[mode];};
  const auditKey=(sha,mode)=>{must(/^[a-f0-9]{64}$/.test(sha)&&definition.modes.includes(mode),'AUDIT_SCOPE');
    return `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/${definition.jobId}/reviewed-cycle-v1/${cycle.cycleId}/${sha}/${mode}.json`;};
  const history=rows=>{
    must(Array.isArray(rows)&&rows.length<=53&&rows.every(r=>[...source.historicalJobIds,definition.jobId].includes(r.jobId)),'HISTORY_SCOPE');
    const values=projectHistory(rows,source.historicalJobIds);
    must(values.length===source.historicalPlanCount&&new Set(values.map(r=>r.planSha256)).size===values.length&&
      createHash('sha256').update(canonicalJson(values)).digest('hex')===source.historySha256,'HISTORY_DRIFT');return values;
  };
  const runtime=createCycleRuntime({cycle,publication:p,now}),capability={jobId:definition.jobId,definition,slot,auditKey,history,runtime,
    continuous:freeze({...CONTINUOUS,schema:'techlong/reviewed-cycle-continuous/v1',slot:slots.continuous,riskFile:RISK}),
    publishSlot:slots.publish,inspectSlot:slots.inspectPublish,riskFile:RISK,
    publisherSchema:'techlong/reviewed-cycle-publisher/v1',inspectSchema:'techlong/reviewed-cycle-inspect-publisher/v1',
    assertPublication:(p,profile,at)=>{must(same(profile,cycle.profile),'SOURCE_PROFILE');return assertPublication(cycle,p,at);},
    assertScope:(plan,p)=>assertScope(cycle,plan,p)};
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
