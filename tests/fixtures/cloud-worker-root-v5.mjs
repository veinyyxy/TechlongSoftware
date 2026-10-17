import { readFile } from 'node:fs/promises';
import { prepareCloudContextV5 } from '../../ops/cloud-worker/cloud-context-v5.mjs';
import { INITIALIZED_PLATFORM_SCOPE as S, INITIALIZED_REVIEW_HOLD_AT } from '../../lib/deployments/initialized-platform-request-v1.ts';
import { admitPlatformJobV4 } from '../../ops/aws-sandbox/scripts/express-platform-worker-v4.mjs';
import { canonicalJson, sha256Hex } from '../../lib/deployments/execution/hash.ts';
export async function cloudRootFixtureV5(now = Date.now()) {
  const capsule = JSON.parse(await readFile(new URL('../../ops/cloud-worker/material/public-capsule-v5.json', import.meta.url), 'utf8'));
  const context = await prepareCloudContextV5(capsule), f = JSON.parse(await readFile(new URL('./express-platform-v4.json', import.meta.url), 'utf8'));
  const snapshot = f.snapshot; snapshot.subscription.current_period_end = now + 86400000;
  snapshot.deployment.outputs = canonicalJson({ fixtureOnly: true, expressInitializedWorkerRunsV2: { [context.predecessor.jobId]: capsule.lineage.receipt } });
  const requestId = 'c'.repeat(64), jobId = 'job_' + (await sha256Hex({ purpose: 'express-initialized-job/v2',
    deploymentId: S.deploymentId, materialSha256: S.materialSha256, requestId })).slice(0, 24);
  const queued = { id: jobId, deployment_id: S.deploymentId, job_type: 'reconcile', dedupe_key: 'express-initialized-v2:' + requestId,
    status: 'pending', attempts: 0, max_attempts: 1, available_at: INITIALIZED_REVIEW_HOLD_AT, created_at: now - 2000, updated_at: now - 2000,
    completed_at: null, lease_owner: null, lease_token: null, lease_expires_at: null,
    payload: canonicalJson({ kind: 'express_initialized_request_v4', requestId, requestedByUserId: 'usr_fixture_admin', requestedAt: now - 3000,
      scope: S, reviewRequired: true, cloudExecutionAuthorized: false }) };
  const prior = { id: context.predecessor.jobId, deployment_id: S.deploymentId, job_type: 'reconcile', status: 'succeeded', attempts: 1,
    lease_owner: null, lease_token: null, lease_expires_at: null, completed_at: now - 3600000, created_at: now - 7200000,
    payload: canonicalJson({ kind: 'express_initialized_workload_v2', planSha256: capsule.lineage.receipt.jobPlanSha256, materialSha256: S.materialSha256 }) };
  const observed = { snapshot, job: queued, jobs: [snapshot.predecessorJob, prior, structuredClone(queued)],
    requester: { id: 'usr_fixture_admin', status: 'active', is_platform_admin: 1 }, checkedAt: now };
  const admission = await admitPlatformJobV4({ root: context.root, observed, predecessor: context.predecessor, now });
  const token = 'lease_' + 'a'.repeat(32), lease = { jobId, deploymentId: S.deploymentId, workerId: 'express-initialized-single-job-v2', attempt: 1, leaseToken: token };
  const stackId = context.predecessor.stackId.replace('aa962890-c9e4-11f1-988b-06ffcd51c63d', '11111111-2222-4333-8444-555555555555');
  const proof = { materialSha256: S.materialSha256, jobId, leaseToken: token, stackId, workloadExpiresAt: now + 7200000,
    imageUri: S.artifactRef, configurationHash: S.configurationHash, existingDefaultStoreId: S.existingDefaultStoreId,
    epoch: S.epoch, operationHash: S.operationHash, providerObservationSha256: '1'.repeat(64), providerCheckedAt: now,
    authorityObservationSha256: '2'.repeat(64), authorityCheckedAt: now, controlObservationSha256: '3'.repeat(64), controlCheckedAt: now,
    initializedVerified: true, effectiveConfigurationVerified: true };
  return { context, capsule, observed, admission, lease, proof, now };
}
