// HOSTED-only successor to the local bridge. No credentials, connections or dispatch.
// Do not turn a hosted lease into a synthetic local lease to reuse a local gate.
import {validatePlan,releaseReady,commit,CONTROL_SCOPE} from '../../lib/deployments/controller-v6/contract.ts';
import {hostedRuntimeLeaseV6} from '../../lib/deployments/controller-v6/configuration.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {createTrustedPublisherV6,ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {exactRunV6,resultKeyV6} from '../platform-cloud-v6/contract.mjs';
import {assertScope,must,same} from '../platform-operations-v6/contract.mjs';
import {assertReadiness,assertHandoffBudget,reserveRunOncePlan,HANDOFF_LIMITS} from '../platform-operations-v6/handoff.mjs';

export async function assertHostedHandoffLease(lease,release,scope,now){
  must(hostedRuntimeLeaseV6(JSON.stringify(lease),release,now)&&lease.sourceCommit===scope.sourceCommit&&
    lease.releaseSha256===await sha256Hex(release),'HOSTED_HANDOFF_LEASE');
  return lease;
}
export function createHostedHandoff({scope:rawScope,release:rawRelease,frozenSourceCommit,lease:rawLease,ports,now=Date.now}){
  const scope=assertScope(rawScope),release=structuredClone(rawRelease),lease=structuredClone(rawLease);
  must(releaseReady(release)&&commit(frozenSourceCommit),'HOSTED_HANDOFF_BINDING');let entered=false;
  return Object.freeze({async once({planSha256,resultReference,manifestReference,manifestSha256,runId}){
    must(!entered,'MEMORY_ONCE');entered=true;let phase='PRE_APPROVAL',observations=0,ownerSubmissions=0,claimAttempted=false,claimed=false;
    try{
      const approved=async()=>{await ports.assertApproved();await ports.assertSource();await assertHostedHandoffLease(lease,release,scope,now());};
      await approved();assertReadiness(await ports.readiness(),scope,now());await approved();
      phase='SLOT_CLAIM_SUBMISSION';claimAttempted=true;await ports.claim();claimed=true;phase='FULL_RECONSTRUCTION';
      const entry=await ports.loadPlan(planSha256),v=await validatePlan(entry.plan,release,entry.plan.preparedAt);
      must(v.planSha256===planSha256&&entry.plan.sourceCommit===scope.sourceCommit&&entry.plan.jobId===scope.jobId&&entry.plan.mode==='Review'&&
        entry.actionSha256===v.actionSha256&&entry.riskSha256===release.riskSha256&&['ACKNOWLEDGED','OBSERVED'].includes(entry.attempt?.state)&&
        entry.attempt.runId===runId&&entry.attempt.proofSha256===null,'EXACT_REVIEW_LEDGER');
      const run=await ports.readRun(runId);exactRunV6(run,{runId,sourceCommit:scope.sourceCommit,workflowId:release.workflowId,reusableCommit:release.reusableCommit});
      must(resultReference.key===resultKeyV6(scope.jobId,manifestSha256,runId),'EXACT_RESULT');
      const allowed=[resultReference,manifestReference,JSON.parse(entry.plan.inputs.installation),
        ...(entry.plan.inputs.lineage?[JSON.parse(entry.plan.inputs.lineage)]:[])],cache=new Map();
      const readObject=async r=>{must(allowed.some(v=>same(v,r)),'OBJECT_ALLOWLIST');const key=canonicalJson(r);
        if(!cache.has(key))cache.set(key,await ports.readObject(r));return cache.get(key);};
      // Reconstruction only: this virtual observation never reaches the ledger.
      // The real observation and attestation below use freshly loaded actual state.
      const virtualEntry={...structuredClone(entry),attempt:{...entry.attempt,state:'OBSERVED',status:'completed',conclusion:'success'}};
      let capturedProof=null;
      const verifier=createTrustedPublisherV6({release,sourceCommit:scope.sourceCommit,frozenSourceCommit,now,ports:{readObject,
        loadPlan:async sha=>{must(sha===planSha256,'EXACT_PLAN');return virtualEntry;},readRun:async()=>run,
        writeOwner:async q=>{must(!capturedProof&&q.text===ownerQueryV6('proof',{planSha256,proofSha256:'a'.repeat(64)}).text&&
          q.values.length===2&&q.values[0]===planSha256,'VIRTUAL_PROOF_ONLY');capturedProof=q;}}});
      const attestation=await verifier.attestResult(planSha256,resultReference);
      must(attestation.mode==='Review'&&attestation.jobId===scope.jobId&&same(attestation.manifestReference,manifestReference),'REVIEW_BINDING');
      const manifest=cache.get(canonicalJson(manifestReference))?.value;
      const guard=async()=>{await approved();assertHandoffBudget(manifest,lease,now());};
      await guard();phase='OBSERVATION_SUBMISSION';observations++;
      await ports.observeRun(planSha256,{runId,status:'completed',conclusion:'success',url:`https://github.com/${CONTROL_SCOPE.repository}/actions/runs/${runId}`});
      let shortened=null;
      const publisher=createTrustedPublisherV6({release,sourceCommit:scope.sourceCommit,frozenSourceCommit,now,
        ports:{readObject,loadPlan:ports.loadPlan,readRun:async()=>run,
          async writeOwner(q){
            await guard();must(ownerSubmissions<2,'WRITE_BUDGET');
            if(q.text===capturedProof.text){
              must(ownerSubmissions===0&&same(q,capturedProof),'EXACT_PROOF_QUERY');await ports.record('proposed-attestation',attestation);
              await guard();phase='PROOF_SUBMISSION';ownerSubmissions++;await ports.writeOwner(q);
            }else{
              must(ownerSubmissions===1&&!shortened&&q.text===ownerQueryV6('plan',{planSha256:'',actionSha256:'',plan:{riskSha256:''}}).text,'EXACT_SUCCESSOR_QUERY');
              const unreserved=await validatePlan(JSON.parse(q.values[3]),release,now());
              must(unreserved.planSha256===q.values[0]&&unreserved.actionSha256===q.values[1]&&unreserved.plan.jobId===scope.jobId&&
                unreserved.plan.predecessor?.planSha256===planSha256&&unreserved.plan.predecessor.runId===runId&&
                unreserved.plan.predecessor.proofSha256===attestation.proofSha256,'SUCCESSOR_BINDING');
              shortened=await reserveRunOncePlan(unreserved,manifest,lease,release,now());
              await ports.record('proposed-runonce-plan',shortened);await guard();phase='RESERVED_PLAN_SUBMISSION';ownerSubmissions++;
              await ports.writeOwner(ownerQueryV6('plan',shortened));
            }
          }}});
      const actual=await publisher.attestResult(planSha256,resultReference);must(same(actual,attestation),'ATTESTATION_DRIFT');
      await publisher.publishSuccessor(planSha256,resultReference);must(shortened,'RESERVED_PLAN');phase='INDEPENDENT_READBACK';
      const loaded=await ports.loadPlan(shortened.planSha256);
      must(same(loaded.plan,shortened.plan)&&loaded.planSha256===shortened.planSha256&&loaded.actionSha256===shortened.actionSha256&&
        loaded.riskSha256===release.riskSha256&&loaded.attempt===null,'READBACK');
      const prior=await ports.loadPlan(planSha256);must(prior.attempt?.proofSha256===attestation.proofSha256,'PROOF_READBACK');await guard();
      const result={outcome:'RESERVED_RUNONCE_PLAN_READY_REQUIRES_EXACT_HUMAN_APPROVAL',jobId:scope.jobId,sourceCommit:scope.sourceCommit,
        planSha256:shortened.planSha256,actionSha256:shortened.actionSha256,riskSha256:release.riskSha256,expiresAt:shortened.plan.expiresAt,
        cloudClaimBy:manifest.jobPlan.claimBy,reservedMs:HANDOFF_LIMITS.reserveMs,observations,ownerSubmissions,workflowDispatches:0,
        humanRunOnceApprovalRequired:true,humanEnvironmentApprovalRequired:true,executionApproved:false,retryAllowed:false};
      await ports.record('result',result);return result;
    }catch{
      const result={outcome:'HANDOFF_STOPPED_REQUIRES_READBACK_NO_RETRY',phase,slotClaimAttempted:claimAttempted,slotClaimed:claimed,
        observations,ownerSubmissions,workflowDispatches:0,retryAllowed:false};
      if(claimAttempted)await ports.record('result',result);return result;
    }finally{await ports.dispose();}
  }});
}
