// Render only. No workflow file publication, Git command or IAM mutation.
import {cloudWorkflowsV6} from '../platform-cloud-v6/workflows.mjs';
export function recoveryCloudWorkflows(binding){
  const old=cloudWorkflowsV6(binding);
  return {...old,protocol:'recovery-envelope/v1',published:false,
    reusable:old.reusable.replace('ops/platform-cloud-v6/run.mjs','ops/platform-recovery-cloud-v1/run.mjs')
      .replace('          TECHLONG_PLATFORM_RELEASE_STATE: PUBLISHED',
        '          TECHLONG_RECOVERY_PROTOCOL: recovery-envelope/v1\n          TECHLONG_PLATFORM_RELEASE_STATE: PUBLISHED'),
    requiresSeparatePublicationApproval:true,requiresSeparateTrustApproval:true};
}
