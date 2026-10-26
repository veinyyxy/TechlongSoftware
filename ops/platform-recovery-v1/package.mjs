// Public recovery wire format; reconstruct all original evidence before use.
import {canonicalJson,sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
import {assertReferenceV6} from '../platform-cloud-v6/contract.mjs';
import {assertEvidenceSafeV5,evidenceKeyV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {prepareRecoveryCloudBasis,must,same} from './basis-core.mjs';
const prefix=`worker-v5/${S.appInstanceId}/`,digest=v=>/^[a-f0-9]{64}$/.test(v);
export const recoveryPackageKey=sha=>{must(digest(sha),'PACKAGE_SHA');return prefix+'lineage/recovery-v1-'+sha+'.json';};
export const recoveryEnvelopeKey=(job,sha)=>evidenceKeyV5('manifest.json',{jobId:job,manifestSha256:sha});
export async function makeRecoveryPackage({basis,inputs,objects}){
  must(Array.isArray(objects)&&objects.length<=8,'PACKAGE_OBJECTS');
  const body={schema:'techlong/retired-recovery-package/v1',basis,
    inputs:Object.fromEntries(['capsule','state','retirement','execution','createdAt'].map(k=>[k,k==='createdAt'?basis.createdAt:inputs[k]])),objects};
  assertEvidenceSafeV5(body);return body;
}
export async function rebuildRecoveryPackage(value,compile=prepareRecoveryCloudBasis){
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
