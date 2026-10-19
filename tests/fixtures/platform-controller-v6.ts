import { CONTROL_SCOPE as S, type ControlPlan, type ReleaseBinding } from '../../lib/deployments/controller-v6/contract.ts';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
export const TEST_NOW = Date.parse('2026-10-19T12:00:00Z');
export const TEST_RELEASE: ReleaseBinding = {state:'PUBLISHED',workflowId:'12345',actorId:S.candidateBotId,
  reusableCommit:'a'.repeat(40),closureSha256:'b'.repeat(64),identityProofSha256:'c'.repeat(64),installationSha256:'d'.repeat(64),riskSha256:'e'.repeat(64)};
export async function controlPlanFixture(): Promise<ControlPlan> {
  const jobId='job_'+'a'.repeat(24);
  return {schema:'techlong/platform-controller-plan/v6',instanceId:S.instanceId,deploymentId:S.deploymentId,
    jobId,mode:'Review',sourceCommit:'f'.repeat(40),releaseSha256:await sha256Hex(TEST_RELEASE),riskSha256:TEST_RELEASE.riskSha256!,
    preparedAt:TEST_NOW-1000,expiresAt:TEST_NOW+600000,predecessor:null,
    inputs:{mode:'Review',job:jobId,installation:JSON.stringify({key:`worker-v5/${S.instanceId}/installation/${TEST_RELEASE.installationSha256}.json`,
      sha256:'1'.repeat(64),versionId:'fixture-version'}),manifest:'',manifestSha:'',execution:'',lineage:''}};
}
