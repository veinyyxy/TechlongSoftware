// Offline evidence is untrusted input. It can prove content consistency only.
import {verifyCloudResultContent} from '../platform-operations-v6/evidence.mjs';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {assertEvidenceSafeV5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {assertReferenceV6} from '../platform-cloud-v6/contract.mjs';
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {exactKeys,LIMITS,must} from './review.mjs';

export async function verifyBundle(raw){
  const b=structuredClone(raw);exactKeys(b,['schema','plan','runId','run','resultReference','objects','observedAt']);
  must(b.schema==='techlong/platform-operator-bundle/v6'&&Number.isSafeInteger(b.observedAt)&&Array.isArray(b.objects)&&b.objects.length>0&&b.objects.length<=LIMITS.maxObjects,'BUNDLE');
  const cache=new Map();
  for(const item of b.objects){
    exactKeys(item,['reference','object']);const r=item.reference,o=item.object;assertReferenceV6(r,r?.key);
    exactKeys(o,['value','versionId','encryption','contentLength']);assertEvidenceSafeV5(o.value);
    must(o.versionId===r.versionId&&o.encryption==='AES256'&&Number.isSafeInteger(o.contentLength)&&o.contentLength>0&&o.contentLength<=1000000&&
      await sha256Hex(o.value)===r.sha256&&!cache.has(canonicalJson(r)),'BUNDLE_OBJECT');cache.set(canonicalJson(r),o);
  }
  const result=await verifyCloudResultContent({plan:b.plan,runId:b.runId,run:b.run,resultReference:b.resultReference,release:B.platform,
    sourceCommit:b.plan.sourceCommit,frozenSourceCommit:B.publisher.frozenSourceCommit,readObject:async r=>{
      must(cache.has(canonicalJson(r)),'BUNDLE_MISSING_OBJECT');return cache.get(canonicalJson(r));},now:()=>b.observedAt});
  return {schema:'techlong/platform-operator-offline-verification/v6',contentVerified:result.contentVerified,
    claimedOutcome:result.attestation.outcome,proofSha256:result.attestation.proofSha256,
    candidateIndependentAcceptance:result.independentCloudAcceptanceVerified,runMetadataAuthenticated:false,
    independentCloudAcceptanceVerified:false,platformLedgerVerified:false,proofImported:false,executionApproved:false,
    warning:'Offline metadata is not an authenticated GitHub observation or a platform-ledger attestation.'};
}
