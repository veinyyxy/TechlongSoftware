// Pure proposal builder: no credential discovery, connection, SQL writer or CLI.
// Reuse the frozen content verifier; a proposal is never a persisted observation.
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {assertRecoveryBinding,assertRecoveryPlanScope} from '../platform-recovery-control-v1/binding.mjs';
import {createRecoveryPublisher} from '../platform-recovery-v1/bridge.mjs';
import {exactRunV6,assertReferenceV6,resultKeyV6} from '../platform-cloud-v6/contract.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertRunWindowV3} from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
const must=(v,c)=>{if(!v)throw Error('DELEGATED_PUBLISHER_'+c);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
export const RUNONCE_RESERVE_MS=8*60000;
export function reviewTiming(inner,basisExpiresAt,at){
  must(Number.isSafeInteger(at)&&Number.isSafeInteger(basisExpiresAt)&&at<basisExpiresAt,'BASIS_EXPIRED');
  must(inner?.jobPlan?.claimBy===inner?.jobPlan?.preparedAt+15*60000,'CLAIM_WINDOW');
  assertRunWindowV3(inner,at);
  const expiresAt=Math.min(at+7200000,basisExpiresAt,inner.jobPlan.claimBy-RUNONCE_RESERVE_MS,
    inner.workload.workloadExpiresAt-90*60000);
  must(expiresAt>at+60000,'INSUFFICIENT_HANDOFF_RESERVE');
  return {checkedAt:at,claimBy:inner.jobPlan.claimBy,workloadExpiresAt:inner.workload.workloadExpiresAt,expiresAt};
}
export async function proposeReviewSuccessor({binding,basis,entry,run,resultReference,readObject,now=Date.now,rebuildPackage}){
  await assertRecoveryBinding(binding);assertRecoveryPlanScope(entry?.plan,binding);
  must(basis.basisSha256===binding.basisSha256&&typeof readObject==='function','BINDING');
  const valid=await validatePlan(entry.plan,binding.release,entry.plan.preparedAt),attempt=entry.attempt;
  must(entry.planSha256===valid.planSha256&&entry.actionSha256===valid.actionSha256&&entry.riskSha256===entry.plan.riskSha256&&
    entry.plan.mode==='Review'&&attempt?.proofSha256===null&&['ACKNOWLEDGED','OBSERVED'].includes(attempt.state),'EXACT_REVIEW');
  must(attempt.state==='ACKNOWLEDGED'?(attempt.status==null&&attempt.conclusion==null):
    attempt.status==='completed'&&attempt.conclusion==='success','ACTUAL_ATTEMPT');
  exactRunV6(run,{runId:attempt.runId,sourceCommit:binding.sourceCommit,workflowId:binding.release.workflowId,reusableCommit:binding.release.reusableCommit});
  const allowed=new Set([resultReference,JSON.parse(entry.plan.inputs.installation),JSON.parse(entry.plan.inputs.lineage)].map(canonicalJson));
  const cache=new Map();let objectReads=0;
  const read=async ref=>{
    assertReferenceV6(ref,ref.key);const key=canonicalJson(ref);must(allowed.has(key),'OBJECT_ALLOWLIST');
    if(!cache.has(key)){
      must(++objectReads<=4,'OBJECT_BUDGET');const object=await readObject(ref);
      must(object?.versionId===ref.versionId&&object.encryption==='AES256'&&object.contentLength>0&&object.contentLength<=1000000&&
        await sha256Hex(object.value)===ref.sha256,'OBJECT_METADATA_OR_SHA');
      assertEvidenceSafeV5(object.value);cache.set(key,structuredClone(object));
    }
    return structuredClone(cache.get(key));
  };
  const result=(await read(resultReference)).value;
  assertReferenceV6(resultReference,resultKeyV6(entry.plan.jobId,result.manifestSha256,attempt.runId));
  const manifestReference=result.cloudReportReference;
  assertReferenceV6(manifestReference,`worker-v5/${entry.plan.instanceId}/${entry.plan.jobId}/${result.manifestSha256}/manifest.json`);
  allowed.add(canonicalJson(manifestReference));const envelope=(await read(manifestReference)).value;
  // Reject expired real evidence before compiling even an in-memory proof.
  reviewTiming(envelope.innerManifest,basis.expiresAt,now());
  const virtual={...structuredClone(entry),attempt:{...structuredClone(attempt),state:'OBSERVED',status:'completed',conclusion:'success'}};
  const queries=[];let proposedPlan;
  const publisher=createRecoveryPublisher({basis,release:binding.release,sourceCommit:binding.sourceCommit,
    frozenSourceCommit:binding.frozenSourceCommit,activation:binding.activation,now,...(rebuildPackage?{rebuildPackage}:{}),ports:{
      guard:async()=>{await assertRecoveryBinding(binding);reviewTiming(envelope.innerManifest,basis.expiresAt,now());},readObject:read,
      loadPlan:async sha=>{must(sha===valid.planSha256,'EXACT_PLAN');return structuredClone(virtual);},
      readRun:async id=>{must(id===attempt.runId,'EXACT_RUN');return structuredClone(run);},
      writeOwner:async q=>{
        // Capture only. There is deliberately no supplied/live write capability.
        if(queries.length===0){
          must(q.text===ownerQueryV6('proof',{planSha256:valid.planSha256,proofSha256:'a'.repeat(64)}).text&&
            q.values[0]===valid.planSha256&&/^[a-f0-9]{64}$/.test(q.values[1]),'MEMORY_PROOF');
          virtual.attempt.proofSha256=q.values[1];
        }else{
          must(queries.length===1&&q.text===ownerQueryV6('plan',valid).text,'MEMORY_SUCCESSOR');
          proposedPlan=await validatePlan(JSON.parse(q.values[3]),binding.release,now());
          must(proposedPlan.plan.mode==='RunOnce'&&proposedPlan.plan.jobId===entry.plan.jobId&&
            proposedPlan.plan.predecessor.planSha256===valid.planSha256&&proposedPlan.plan.predecessor.runId===attempt.runId&&
            proposedPlan.plan.predecessor.proofSha256===virtual.attempt.proofSha256&&
            proposedPlan.plan.expiresAt<=reviewTiming(envelope.innerManifest,basis.expiresAt,now()).expiresAt,'SUCCESSOR_SCOPE');
        }
        queries.push(structuredClone(q));
      }}});
  const attestation=await publisher.attestResult(valid.planSha256,resultReference);
  const successor=await publisher.publishSuccessor(valid.planSha256,resultReference);
  const timing=reviewTiming(envelope.innerManifest,basis.expiresAt,now());
  must(queries.length===2&&same(successor.plan,proposedPlan.plan),'PROPOSAL_COUNT');
  const proposal={outcome:'REVIEW_SUCCESSOR_PROPOSED_NOT_PUBLISHED',sourceCommit:binding.sourceCommit,
    reviewPlanSha256:valid.planSha256,runId:attempt.runId,resultReference,manifestReference,attestation,successor,
    proposedObservation:{text:'SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',values:[valid.planSha256,attempt.runId,'completed','success']},
    proposedOwnerQueries:queries,timing,objectReads,proposedWriteCount:3,physicalOwnerWrites:0,webLeaseRequired:false,
    actualLedgerChanged:false,actualObservationVerified:false,proofImported:false,successorPublished:false,executionApproved:false};
  assertEvidenceSafeV5(proposal);return proposal;
}
