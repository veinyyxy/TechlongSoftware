// Verify cloud content in memory; never import a proof into a live ledger.
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {createRecoveryPublisher} from '../platform-recovery-v1/bridge.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {assertRecoveryBinding,assertRecoveryPlanScope} from './binding.mjs';
import {must,same} from '../platform-recovery-v1/basis-core.mjs';
export async function verifyRecoveryContent({binding,basis,plan,runId,run,resultReference,readObject,
  deriveInspectPlan=false,now=Date.now,rebuildPackage}){
  await assertRecoveryBinding(binding);assertRecoveryPlanScope(plan,binding);
  must(['RunOnce','Inspect'].includes(plan.mode)&&(!deriveInspectPlan||plan.mode==='RunOnce')&&basis.basisSha256===binding.basisSha256,'CONTENT_SCOPE');
  const expected=await validatePlan(plan,binding.release,plan.preparedAt),entry={...expected,riskSha256:plan.riskSha256,
    attempt:{state:'OBSERVED',runId,status:'completed',conclusion:'success',proofSha256:null}};
  let captures=0,derivedInspectPlan=null;
  const publisher=createRecoveryPublisher({basis,release:binding.release,sourceCommit:binding.sourceCommit,
    frozenSourceCommit:binding.frozenSourceCommit,activation:binding.activation,now,...(rebuildPackage?{rebuildPackage}:{}),ports:{
      guard:()=>assertRecoveryBinding(binding),readObject,
      loadPlan:async sha=>{must(sha===expected.planSha256,'CONTENT_EXACT_PLAN');return structuredClone(entry);},
      readRun:async id=>{must(id===runId,'CONTENT_EXACT_RUN');return structuredClone(run);},
      writeOwner:async q=>{captures++;if(captures===1){must(q.text===ownerQueryV6('proof',{planSha256:expected.planSha256,proofSha256:'a'.repeat(64)}).text&&q.values[0]===expected.planSha256,'CONTENT_MEMORY_PROOF');
        entry.attempt.proofSha256=q.values[1];}
      else{must(deriveInspectPlan&&captures===2&&q.text===ownerQueryV6('plan',expected).text,'CONTENT_MEMORY_SUCCESSOR');
        derivedInspectPlan={planSha256:q.values[0],actionSha256:q.values[1],plan:JSON.parse(q.values[3])};}}}});
  const attestation=await publisher.attestResult(expected.planSha256,resultReference);
  if(deriveInspectPlan){const v=await publisher.publishSuccessor(expected.planSha256,resultReference);
    must(same(v.plan,derivedInspectPlan.plan)&&v.plan.mode==='Inspect'&&v.plan.predecessor.runId===runId,'CONTENT_INSPECT_BINDING');}
  must(captures===(deriveInspectPlan?2:1),'CONTENT_CAPTURE_COUNT');
  return {attestation,derivedInspectPlan,contentVerified:true,independentCloudAcceptanceVerified:plan.mode==='Inspect'&&
    attestation.outcome==='SUCCEEDED_INDEPENDENTLY_VERIFIED',platformLedgerVerified:false,physicalOwnerWrites:0,proofImported:false,executionApproved:false};
}
