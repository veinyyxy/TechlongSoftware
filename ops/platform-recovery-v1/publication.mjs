// Non-executable publication materials. No client, private read or PUT here.
import {sha256Hex,canonicalJson} from '../../lib/deployments/execution/hash.ts';
import {INSTALLED_BINDING_V6 as B} from '../../lib/deployments/controller-v6/installed-binding.ts';
import {EVIDENCE_V5} from '../cloud-worker/cloud-evidence-v5.mjs';
import {makeRecoveryPackage,rebuildRecoveryPackage,recoveryPackageKey} from './bridge.mjs';
import {recoveryData,must} from './basis.mjs';
export async function prepareRecoveryPublication({basis,inputs,objects,sourceCommit,pins,ci,requestOperatorSha256,createdAt},rebuild=rebuildRecoveryPackage){
  recoveryData(basis,createdAt);must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci.sourceCommit===sourceCommit&&ci.conclusion==='success'&&
    /^[a-f0-9]{64}$/.test(requestOperatorSha256)&&Array.isArray(pins)&&pins.length>=20,'PUBLICATION_INPUT');
  const pkg=await makeRecoveryPackage({basis,inputs,objects}),rebuilt=await rebuild(pkg);must(rebuilt.basisSha256===basis.basisSha256,'PUBLICATION_PACKAGE');
  const bytes=Buffer.byteLength(canonicalJson(pkg)),packageSha256=await sha256Hex(pkg);must(bytes<=1000000,'PUBLICATION_PACKAGE_SIZE');
  const body={schema:'techlong/recovery-publication-draft/v1',sourceCommit,ci,pins,createdAt,expiresAt:basis.expiresAt,
    requestOperatorSha256,basisSha256:basis.basisSha256,
    proposedPackage:{bucket:EVIDENCE_V5.bucket,key:recoveryPackageKey(basis.basisSha256),sha256:packageSha256,bytes,
      versionId:null,published:false,conditionalCreateOnly:true,containsHistoricalBusinessMetadata:true},
    currentInstalledRelease:B.platform,proposedReleaseState:'CANDIDATE',recoveryActivation:null,
    requiredBeforeActivation:['exact_new_cloud_closure_and_reusable_pin_review','controller_release_and_risk_binding_review',
      'source_and_IAM_trust_metadata_readback','new_envelope_runtime_and_followup_live_binding','package_single_conditional_PUT_approval'],
    proposedActionsAreNotApproved:true,awsWritesAuthorized:0,githubWorkflowPublicationsAuthorized:0,iamChangesAuthorized:0,
    sqlWritesAuthorized:0,dispatchesAuthorized:0,executionAuthorized:false};
  return {package:pkg,draft:{...body,draftSha256:await sha256Hex(body)}};
}
