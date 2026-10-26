// Non-executable release planning. No publication, credentials or clients.
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
import {CLOUD_V6 as C,S} from '../platform-cloud-v6/contract.mjs';
import {must} from '../platform-recovery-v1/basis-core.mjs';
export async function makeRecoveryReleaseDraft({sourceCommit,ci,closure,registration,createdAt}){
  must(/^[a-f0-9]{40}$/.test(sourceCommit)&&ci?.sourceCommit===sourceCommit&&ci.attempt===1&&ci.status==='completed'&&ci.conclusion==='success'&&
    /^[1-9][0-9]{0,15}$/.test(ci.runId)&&Number.isSafeInteger(createdAt),'RELEASE_DRAFT_SOURCE');
  must(closure.schema==='techlong/recovery-cloud-closure/v1'&&closure.pinCount===closure.pins.length&&closure.pinCount>81&&
    closure.previousPlatformClosureSha256==='828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a'&&
    /^[a-f0-9]{64}$/.test(closure.closureSha256)&&registration?.newJobId==='job_9b57b43a6b88f37202b29170'&&
    registration.outcome==='RECOVERY_HELD_REQUEST_COMMITTED_AND_INDEPENDENTLY_VERIFIED'&&/^[a-f0-9]{64}$/.test(registration.rawSha256),'RELEASE_DRAFT_BASE');
  const body={schema:'techlong/recovery-cloud-release-draft/v1',state:'CANDIDATE',sourceCommit,ci,createdAt,closure,registration,
    protocol:'recovery-envelope/v1',frozenSourceCommit:sourceCommit,reusableCommit:null,recoveryActivation:null,
    proposal:{repository:S.repository,callerWorkflow:S.workflowFile,reusableWorkflow:C.reusableWorkflow,
      roleArn:C.roleArn,roleId:C.roleId,permissionExpansionProposed:false,newResourcesProposed:false,
      humanEnvironment:C.environment,existingSevenInputsPreserved:true},
    missingBeforeExecutableReview:['fresh_limited_trust_and_permission_metadata','fixed_package_single_upload_review',
      'exact_reusable_publication_commit','caller_and_role_trust_binding','controller_release_risk_activation_and_bounded_followup'],
    approvalShaForExecution:null,cloudWritesAuthorized:0,workflowPublicationsAuthorized:0,iamChangesAuthorized:0,
    privateReadsAuthorized:0,sqlConnectionsAuthorized:0,dispatchesAuthorized:0,executionAuthorized:false};
  return {...body,draftSha256:await sha256Hex(body)};
}
