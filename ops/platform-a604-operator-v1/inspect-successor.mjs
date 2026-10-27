// Capture-only proof/Inspect proposal. No live write/dispatch or acceptance.
import {validatePlan} from '../../lib/deployments/controller-v6/contract.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {createRecoveryPublisher} from '../platform-recovery-v1/bridge.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {exactRunV6,assertReferenceV6,resultKeyV6} from '../platform-cloud-v6/contract.mjs';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertA604Publication,assertA604PlanScope} from '../platform-a604-cloud-v1/contract.mjs';
import {A604_PROFILE} from '../platform-a604-cloud-v1/profile.mjs';
import {createA604Runtime} from '../platform-a604-cloud-v1/runtime.mjs';
import {freeze} from '../platform-recovery-v1/basis-core.mjs';
import {must,same,digest} from './policy.mjs';
export function inspectTiming(inner,basisExpiresAt,at){
  must(Number.isSafeInteger(at)&&Number.isSafeInteger(basisExpiresAt)&&Number.isSafeInteger(inner?.workload?.workloadExpiresAt)&&
    inner?.jobPlan?.claimBy===inner?.jobPlan?.preparedAt+900000,'INSPECT_TIMING');
  const expiresAt=Math.min(at+7200000,basisExpiresAt,inner.workload.workloadExpiresAt);
  must(expiresAt>at+12*60000,'INSPECT_HANDOFF_RESERVE');
  return {checkedAt:at,claimBy:inner.jobPlan.claimBy,workloadExpiresAt:inner.workload.workloadExpiresAt,expiresAt};
}
export function createInspectProposer({publication:raw,profile:rawProfile=A604_PROFILE,now=Date.now}){
  const publication=freeze(structuredClone(raw)),profile=freeze(structuredClone(rawProfile)),runtime=createA604Runtime({publication,profile,now});
  return async function({binding,basis,entry,run,resultReference,readObject}){
    const guard=async()=>{must(same(binding,publication),'SOURCE_PUBLICATION');await assertA604Publication(binding,profile,now());};
    await guard();assertA604PlanScope(entry.plan,binding);must(basis.basisSha256===binding.basisSha256,'BASIS');
    const valid=await validatePlan(entry.plan,binding.release,entry.plan.preparedAt),a=entry.attempt;
    must(entry.planSha256===valid.planSha256&&entry.actionSha256===valid.actionSha256&&entry.riskSha256===entry.plan.riskSha256&&
      entry.plan.mode==='RunOnce'&&a?.proofSha256===null&&['ACKNOWLEDGED','OBSERVED'].includes(a.state),'EXACT_RUN');
    must(a.state==='ACKNOWLEDGED'?a.status==null&&a.conclusion==null:a.status==='completed'&&a.conclusion==='success','ACTUAL_RUN_ATTEMPT');
    exactRunV6(run,{runId:a.runId,sourceCommit:binding.sourceCommit,workflowId:binding.release.workflowId,reusableCommit:binding.release.reusableCommit});
    const manifestReference=JSON.parse(entry.plan.inputs.manifest),allowed=new Set([resultReference,manifestReference,binding.packageReference,JSON.parse(entry.plan.inputs.installation)].map(canonicalJson)),cache=new Map();
    const read=async ref=>{assertReferenceV6(ref,ref.key);const key=canonicalJson(ref);must(allowed.has(key),'INSPECT_OBJECT_ALLOWLIST');
      if(!cache.has(key)){must(cache.size<6,'INSPECT_OBJECT_BUDGET');const o=await readObject(ref);
        must(o?.versionId===ref.versionId&&o.encryption==='AES256'&&o.contentLength>0&&o.contentLength<=1000000&&await sha256Hex(o.value)===ref.sha256,'INSPECT_OBJECT_METADATA');
        assertEvidenceSafeV5(o.value);cache.set(key,structuredClone(o));}return structuredClone(cache.get(key));};
    const result=(await read(resultReference)).value;assertReferenceV6(resultReference,resultKeyV6(entry.plan.jobId,entry.plan.inputs.manifestSha,a.runId));
    const envelope=(await read(manifestReference)).value;inspectTiming(envelope.innerManifest,basis.expiresAt,now());
    const prefix=`worker-v5/${entry.plan.instanceId}/${entry.plan.jobId}/`,inner=envelope.innerManifest;
    assertReferenceV6(result.cloudReportReference,`${prefix}${inner.manifestSha256}/run-${a.runId}-1/run.json`);
    assertReferenceV6(result.executionReference,`${prefix}${entry.plan.inputs.manifestSha}/execution-reference-${a.runId}-v1.json`);
    allowed.add(canonicalJson(result.cloudReportReference));allowed.add(canonicalJson(result.executionReference));
    const report=(await read(result.cloudReportReference)).value;
    must(report.schema==='techlong/cloud-worker-run/v5'&&report.result?.outcome==='NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED'&&
      digest(report.result.receiptSha256)&&report.independentInspectRequired===true&&report.journal?.state==='ALL_SLOTS_CONSUMED','RUN_COMPLETION_REQUIRED');
    const virtual={...structuredClone(entry),attempt:{...structuredClone(a),state:'OBSERVED',status:'completed',conclusion:'success'}},queries=[];
    const publisher=createRecoveryPublisher({basis,release:binding.release,sourceCommit:binding.sourceCommit,frozenSourceCommit:binding.frozenSourceCommit,
      activation:binding.activation,now,rebuildPackage:runtime.rebuild,ports:{guard:async()=>{await guard();inspectTiming(inner,basis.expiresAt,now());},readObject:read,
        loadPlan:async sha=>{must(sha===valid.planSha256,'EXACT_RUN_PLAN');return structuredClone(virtual);},
        readRun:async id=>{must(id===a.runId,'EXACT_RUN_ID');return structuredClone(run);},writeOwner:async q=>{
          if(queries.length===0){must(q.text===ownerQueryV6('proof',{planSha256:valid.planSha256,proofSha256:'a'.repeat(64)}).text&&q.values[0]===valid.planSha256,'MEMORY_PROOF');virtual.attempt.proofSha256=q.values[1];}
          else must(queries.length===1&&q.text===ownerQueryV6('plan',valid).text,'MEMORY_INSPECT');queries.push(structuredClone(q));}}});
    const attestation=await publisher.attestResult(valid.planSha256,resultReference),successor=await publisher.publishSuccessor(valid.planSha256,resultReference);
    must(queries.length===2&&successor.plan.mode==='Inspect'&&successor.plan.predecessor.runId===a.runId&&successor.plan.inputs.execution===canonicalJson(result.executionReference)&&
      same(successor.plan,JSON.parse(queries[1].values[3])),'INSPECT_SUCCESSOR');
    return {outcome:'INSPECT_SUCCESSOR_PROPOSED_NOT_PUBLISHED',sourceCommit:binding.sourceCommit,reviewPlanSha256:valid.planSha256,runId:a.runId,
      resultReference,manifestReference,attestation,successor,proposedOwnerQueries:queries,timing:inspectTiming(inner,basis.expiresAt,now()),
      verifiedEnvelope:envelope,verifiedRunReport:report,objectReads:cache.size,proposedWriteCount:3,physicalOwnerWrites:0,
      webLeaseRequired:false,independentCloudAcceptanceVerified:false,executionApproved:false};
  };
}
