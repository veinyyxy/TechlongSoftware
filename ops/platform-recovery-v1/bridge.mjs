// Publication/evidence bridge for a separately reviewed future cloud release.
// Same V6 control-plan schema/owner SQL; distinct recovery envelope/result.
// No credentials, dispatch or SQL connection exists in this module.
import {validatePlan,releaseReady,commit} from '../../lib/deployments/controller-v6/contract.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {exactRunV6,assertReferenceV6,resultKeyV6} from '../platform-cloud-v6/contract.mjs';
import {ownerQueryV6} from '../platform-cloud-v6/publisher.mjs';
import {assertEvidenceSafeV5,evidenceKeyV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertCloudManifestV5,assertInstallationV5} from '../cloud-worker/cloud-worker-root-v5.mjs';
import {loadNeonContractV5} from '../cloud-worker/neon-contract-v5.mjs';
import {admitPlatformJobV4} from '../aws-sandbox/scripts/express-platform-worker-v4.mjs';
import {assertRunWindowV3} from '../aws-sandbox/scripts/express-initialized-workload-v3.mjs';
import {prepareRecoveryBasis,recoveryData,must,same} from './basis.mjs';
import {recoveryEnvelope} from './worker.mjs';
const prefix=`worker-v5/${S.appInstanceId}/`,digest=v=>/^[a-f0-9]{64}$/.test(v);
export const recoveryPackageKey=sha=>{must(digest(sha),'PACKAGE_SHA');return prefix+'lineage/recovery-v1-'+sha+'.json';};
export const recoveryEnvelopeKey=(job,sha)=>evidenceKeyV5('manifest.json',{jobId:job,manifestSha256:sha});
export async function makeRecoveryPackage({basis,inputs,objects}){
  must(Array.isArray(objects)&&objects.length<=8,'PACKAGE_OBJECTS');
  const body={schema:'techlong/retired-recovery-package/v1',basis,
    inputs:Object.fromEntries(['capsule','state','retirement','execution','createdAt'].map(k=>[k,k==='createdAt'?basis.createdAt:inputs[k]])),objects};
  assertEvidenceSafeV5(body);return body;
}
export async function rebuildRecoveryPackage(value,compile=prepareRecoveryBasis){
  must(value?.schema==='techlong/retired-recovery-package/v1'&&Array.isArray(value.objects)&&value.objects.length<=8,'PACKAGE_SCHEMA');
  const cache=new Map();for(const v of value.objects){
    assertReferenceV6(v.reference,v.reference.key);must(!cache.has(canonicalJson(v.reference)),'PACKAGE_DUPLICATE');cache.set(canonicalJson(v.reference),v.object);
  }
  const basis=await compile({...value.inputs,readObject:async ref=>{const v=cache.get(canonicalJson(ref));must(v,'PACKAGE_MISSING_OBJECT');return structuredClone(v);}});
  must(same(basis,value.basis),'PACKAGE_BASIS');return basis;
}
export async function recoveryCloudResult({plan,run,release,frozenSourceCommit,envelope,cloudReportReference,executionReference=null}){
  const mode=plan.mode,review=envelope.review,inner=review.innerManifest;
  must(['Review','RunOnce','Inspect'].includes(mode)&&plan.jobId===inner.jobPlan.jobId,'RESULT_MODE');
  const outcome=mode==='Review'?'RECOVERY_REVIEW_PREPARED_NOT_APPROVED':envelope.report.outcome??envelope.report.result?.outcome;
  const value={schema:'techlong/recovery-cloud-result/v1',mode,jobId:plan.jobId,run,frozenSourceCommit,closureSha256:release.closureSha256,
    installationSha256:release.installationSha256,requestSha256:await sha256Hex(plan.inputs),manifestSha256:review.recoveryReviewSha256,
    innerManifestSha256:inner.manifestSha256,basisSha256:review.basis.basisSha256,outcome,cloudReportReference,executionReference,retryAllowed:false};
  assertEvidenceSafeV5(value);return value;
}
export function createRecoveryPublisher({basis,release,sourceCommit,frozenSourceCommit,activation,ports,now=Date.now,rebuildPackage=rebuildRecoveryPackage}){
  const cache=new Map();
  const gate=async()=>{must(releaseReady(release)&&commit(sourceCommit)&&commit(frozenSourceCommit),'BRIDGE_UNPUBLISHED');
    // Code-bound future publication record, never derived from an input package.
    // The old generic PUBLISHED binding alone is not recovery-protocol approval.
    must(activation?.schema==='techlong/recovery-bridge-activation/v1'&&activation.state==='PUBLISHED'&&
      activation.protocol==='recovery-envelope/v1'&&activation.sourceCommit===sourceCommit&&
      activation.frozenSourceCommit===frozenSourceCommit&&activation.releaseSha256===await sha256Hex(release),'BRIDGE_ACTIVATION_REQUIRED');
    recoveryData(basis,now());await ports.guard(activation);};
  const read=async ref=>{
    assertReferenceV6(ref,ref.key);must(ref.key.startsWith(prefix),'BRIDGE_OBJECT_SCOPE');const key=canonicalJson(ref);
    if(!cache.has(key)){
      must(cache.size<16,'BRIDGE_OBJECT_BUDGET');const o=await ports.readObject(ref);
      must(o?.versionId===ref.versionId&&o.encryption==='AES256'&&o.contentLength>0&&o.contentLength<=1000000&&await sha256Hex(o.value)===ref.sha256,'BRIDGE_OBJECT_METADATA');
      assertEvidenceSafeV5(o.value);cache.set(key,structuredClone(o.value));
    }return structuredClone(cache.get(key));
  };
  const packageFor=async inputs=>{
    const ref=JSON.parse(inputs.lineage);assertReferenceV6(ref,recoveryPackageKey(basis.basisSha256));
    const rebuilt=await rebuildPackage(await read(ref));must(same(rebuilt,basis),'BRIDGE_PACKAGE_BINDING');recoveryData(rebuilt,now());return rebuilt;
  };
  const installationFor=async inputs=>{
    const contract=await loadNeonContractV5(),installation=await assertInstallationV5(await read(JSON.parse(inputs.installation)),release.installationSha256,contract);
    return {contract,installation};
  };
  const publish=async p=>{await gate();const valid=await validatePlan(p,release,now());await gate();await ports.writeOwner(ownerQueryV6('plan',valid));return {...valid,executionApproved:false};};
  async function verified(planSha,ref){
    await gate();must(digest(planSha),'BRIDGE_PLAN_SHA');const entry=await ports.loadPlan(planSha),v=await validatePlan(entry.plan,release,entry.plan.preparedAt),p=entry.plan;
    must(v.planSha256===planSha&&entry.actionSha256===v.actionSha256&&p.sourceCommit===sourceCommit&&p.jobId===recoveryData(basis,now()).target.newJobId&&
      entry.attempt?.state==='OBSERVED'&&entry.attempt.status==='completed'&&entry.attempt.conclusion==='success','BRIDGE_ACTUAL_LEDGER');
    const run=exactRunV6(await ports.readRun(entry.attempt.runId),{runId:entry.attempt.runId,sourceCommit,workflowId:release.workflowId,reusableCommit:release.reusableCommit});
    await packageFor(p.inputs);const result=await read(ref);
    must(result.schema==='techlong/recovery-cloud-result/v1'&&result.mode===p.mode&&result.jobId===p.jobId&&same(result.run,run)&&
      result.frozenSourceCommit===frozenSourceCommit&&result.closureSha256===release.closureSha256&&result.installationSha256===release.installationSha256&&
      result.requestSha256===await sha256Hex(p.inputs)&&result.basisSha256===basis.basisSha256&&result.retryAllowed===false,'BRIDGE_RESULT_BINDING');
    assertReferenceV6(ref,resultKeyV6(p.jobId,result.manifestSha256,run.runId));
    const manifestRef=p.mode==='Review'?result.cloudReportReference:JSON.parse(p.inputs.manifest);
    assertReferenceV6(manifestRef,recoveryEnvelopeKey(p.jobId,result.manifestSha256));
    const envelope=await read(manifestRef);
    must(same(envelope,await recoveryEnvelope(basis,envelope.innerManifest,envelope.createdAt))&&
      envelope.recoveryReviewSha256===result.manifestSha256&&result.innerManifestSha256===envelope.innerManifest.manifestSha256&&
      envelope.innerManifest.code.commitSha===sourceCommit&&envelope.innerManifest.code.closureSha256===release.closureSha256&&
      envelope.innerManifest.installationSha256===release.installationSha256,'BRIDGE_ENVELOPE');
    const inner=envelope.innerManifest;
    await assertCloudManifestV5(inner,{...await installationFor(p.inputs),context:recoveryData(basis,now()).context,
      code:{commitSha:sourceCommit,closureSha256:release.closureSha256}});
    if(p.mode==='Review')must(result.outcome==='RECOVERY_REVIEW_PREPARED_NOT_APPROVED'&&result.executionReference===null,'BRIDGE_REVIEW_OUTCOME');
    else{
      must(p.inputs.manifestSha===envelope.recoveryReviewSha256,'BRIDGE_MANIFEST_INPUT');
      assertReferenceV6(result.cloudReportReference,evidenceKeyV5(p.mode==='RunOnce'?'run.json':'inspect.json',{jobId:p.jobId,manifestSha256:inner.manifestSha256,run}));
      const report=await read(result.cloudReportReference);
      must(same(report.run,run)&&report.jobId===p.jobId&&report.manifestSha256===inner.manifestSha256&&report.retryAllowed===false&&
        (report.outcome??report.result?.outcome)===result.outcome,'BRIDGE_REPORT');
      if(p.mode==='RunOnce'){
        must(report.schema==='techlong/cloud-worker-run/v5'&&result.outcome==='NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED','BRIDGE_RUN_SUCCESS_REQUIRED');
        assertReferenceV6(result.executionReference,`${prefix}${p.jobId}/${envelope.recoveryReviewSha256}/execution-reference-${run.runId}-v1.json`);
        const descriptor=await read(result.executionReference);
        must(same(descriptor,{executionRun:run,executionReportReference:result.cloudReportReference,
          recoveryReviewSha256:envelope.recoveryReviewSha256,recoveryBasisSha256:basis.basisSha256}),'BRIDGE_EXECUTION_DESCRIPTOR');
      }else{
        const {inspectSha256,...body}=report;
        must(report.schema==='techlong/cloud-worker-independent-inspect/v5'&&report.outcome==='SUCCEEDED_INDEPENDENTLY_VERIFIED'&&
          report.executionRun?.runId===p.predecessor.runId&&report.executionRun.runId!==run.runId&&report.executionRun.commitSha===sourceCommit&&
          report.journal?.state==='ALL_SLOTS_CONSUMED'&&digest(report.receiptSha256)&&digest(report.providerObservationSha256)&&
          await sha256Hex(body)===inspectSha256&&report.cloudWrites===0&&report.databaseWrites===0&&report.privateControlReads===0&&
          Number.isSafeInteger(report.checkedAt)&&report.checkedAt<=now()+30000&&report.checkedAt<inner.workload.workloadExpiresAt&&result.executionReference===null,'BRIDGE_INDEPENDENT_INSPECT');
      }
    }
    const body={schema:'techlong/recovery-cloud-attestation/v1',planSha256:planSha,mode:p.mode,jobId:p.jobId,run,
      resultReference:ref,manifestReference:manifestRef,reportReference:result.cloudReportReference,basisSha256:basis.basisSha256,
      recoveryReviewSha256:envelope.recoveryReviewSha256,outcome:result.outcome};
    return {entry,result,envelope,attestation:{...body,proofSha256:await sha256Hex(body)}};
  }
  return {
    async publishReview({installationReference,recoveryPackageReference}){
      await gate();const d=recoveryData(basis,now()),at=now(),inputs={mode:'Review',job:d.target.newJobId,installation:canonicalJson(installationReference),
        manifest:'',manifestSha:'',execution:'',lineage:canonicalJson(recoveryPackageReference)};
      await packageFor(inputs);await installationFor(inputs);await admitPlatformJobV4({root:d.context.root,predecessor:d.context.predecessor,
        observed:await ports.readHeldJob(d.target.newJobId),now:now()});
      return publish({schema:'techlong/platform-controller-plan/v6',instanceId:S.appInstanceId,deploymentId:S.deploymentId,jobId:d.target.newJobId,mode:'Review',
        sourceCommit,releaseSha256:await sha256Hex(release),riskSha256:release.riskSha256,preparedAt:at,expiresAt:Math.min(at+7200000,basis.expiresAt),inputs,predecessor:null});
    },
    async attestResult(sha,ref){const v=await verified(sha,ref);must(v.entry.attempt.proofSha256===null,'BRIDGE_ATTESTATION_OCCUPIED');
      await gate();await ports.writeOwner(ownerQueryV6('proof',v.attestation));return v.attestation;},
    async publishSuccessor(sha,ref){
      const v=await verified(sha,ref);must(v.entry.attempt.proofSha256===v.attestation.proofSha256&&v.entry.plan.mode!=='Inspect','BRIDGE_PREDECESSOR_ATTESTATION');
      const p=structuredClone(v.entry.plan),at=now();p.mode=p.mode==='Review'?'RunOnce':'Inspect';p.inputs.mode=p.mode;p.preparedAt=at;
      p.expiresAt=Math.min(at+7200000,basis.expiresAt,v.envelope.innerManifest.workload.workloadExpiresAt);
      p.predecessor={planSha256:sha,runId:v.entry.attempt.runId,proofSha256:v.attestation.proofSha256};
      p.inputs.manifest=canonicalJson(v.attestation.manifestReference);p.inputs.manifestSha=v.envelope.recoveryReviewSha256;
      if(p.mode==='RunOnce'){
        assertRunWindowV3(v.envelope.innerManifest,at);p.expiresAt=Math.min(p.expiresAt,v.envelope.innerManifest.jobPlan.claimBy-480000,
          v.envelope.innerManifest.workload.workloadExpiresAt-90*60000);
      }else{must(p.expiresAt-at>10*60000,'BRIDGE_INSPECT_WINDOW');p.inputs.execution=canonicalJson(v.result.executionReference);}
      must(p.expiresAt>at+60000,'BRIDGE_SUCCESSOR_WINDOW');return publish(p);
    },
  };
}
