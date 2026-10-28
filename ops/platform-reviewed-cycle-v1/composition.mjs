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
  return rows.filter(r=>jobIds.includes(r.jobId)).map(r=>Object.fromEntries(['jobId','planSha256','actionSha256','riskSha256','sourceCommit','mode','expiresAt',
    'runId','state','proofSha256','runStatus','conclusion'].map(k=>[k,r[k]??null]))).sort((a,b)=>a.planSha256.localeCompare(b.planSha256));
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
  capability.dispatchIo=options=>createIo({...options,capability:{definition,auditKey,verifyPreflight:async({client,contract})=>{
    if(options.mode==='Inspect')return;
    const state=await readLaunchSnapshot(client,{contract,readState:capability.readState}),ids=new Set(state.ledger.plans.filter(r=>r.job_id===definition.jobId).map(r=>r.plan_sha));
    const base=normalizedState({...state,ledger:{plans:state.ledger.plans.filter(r=>!ids.has(r.plan_sha)),
      approvals:state.ledger.approvals.filter(r=>!ids.has(r.plan_sha)),attempts:state.ledger.attempts.filter(r=>r.job_id!==definition.jobId)}});
    must(await sha256Hex(base)===options.grant.baselineSha256,'FULL_HELD_BASELINE_DRIFT');
  }}});
  capability.publisherIo=options=>createLiveIo({...options,readState:capability.readState});
  const continuous=createContinuousReviewFlow({policy,publisher,runtime,profile:cycle.profile,requestEvidence:cycle.requestEvidence,now,capability});
  return Object.freeze({cycle,slots,publication:p,definition,capability:Object.freeze(capability),policy,publisher,inspectPublisher,runtime,continuous});
}
