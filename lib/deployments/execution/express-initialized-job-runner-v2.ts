import type { DeploymentJobLeaseFence } from './contracts.ts';
import type { prepareExpressInitializedWorkerV2 } from './express-initialized-worker-v2.ts';
import type { createExpressInitializedJobNeonV2 } from './express-initialized-job-neon-v2.ts';
import { compileExpressInitializedClaimV2, assertExpressInitializedStackIdV2, type ExpressInitializedJobPlanV2,
  type ExpressInitializedCompletionProofV2 } from './express-initialized-job-v2.ts';
import { sha256Hex, canonicalJson } from './hash.ts';

type Root = Awaited<ReturnType<typeof prepareExpressInitializedWorkerV2>>;
type Readback = ReturnType<Root['composeInitializedReadback']>;
type Repository = ReturnType<typeof createExpressInitializedJobNeonV2>;
export interface ExpressInitializedWorkloadObservationV2 {
  materialSha256: string; ownerDeploymentId: string; generation: number;
  stackId: string; workloadExpiresAt: number; imageUri: string; configurationHash: string;
  epoch: number; operationHash: string;
  providerObservationSha256: string; providerCheckedAt: number;
  authorityObservationSha256: string; authorityCheckedAt: number;
}
export interface ExpressInitializedWorkloadPortV2 {
  /** The concrete provider is NOT implemented/activated by W2. It must bind a
   * separate fresh review of the exact cloud action, render and live namespace,
   * and call assertLease immediately before any mutation. This interface alone
   * does not attest TLS, AWS identity, DDB epoch, resource count or ownership. */
  executeOnce(input: { plan: ExpressInitializedJobPlanV2; lease: DeploymentJobLeaseFence;
    assertLease: () => Promise<void>; signal: AbortSignal }): Promise<ExpressInitializedWorkloadObservationV2>;
}
function fail(): never { throw Error('EXPRESS_INITIALIZED_RUNNER_REJECTED'); }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }

/** Single-job orchestration, never a poller/global queue. No capabilities for
 * initialization/password, heartbeat, retry, cleanup or old-job mutation.
 * Construction is lazy. A production CLI/provider approval root is still
 * required; injecting a successful port is not live acceptance evidence. */
export function createExpressInitializedSingleJobRunnerV2(input: {
  plan: ExpressInitializedJobPlanV2; repository: Repository; workload: ExpressInitializedWorkloadPortV2;
  readback: Readback; now?: () => number;
}) {
  const plan = freeze(structuredClone(input.plan)), now = input.now ?? Date.now;
  let started = false;
  return Object.freeze({ runtimeEnabled: false as const, initializationPostAllowed: false as const,
    async runOnce(request: { approvedPlanSha256: string; signal: AbortSignal }) {
      let stage = 'validate', claimStarted = false, providerStarted = false;
      if (started) fail();
      started = true;
      const leaseToken = 'lease_' + crypto.randomUUID().replaceAll('-', '');
      // Bad approval makes no DB call. This object allows only one invocation;
      // durable duplicate prevention additionally lives in the PostgreSQL slot.
      const compiled = await compileExpressInitializedClaimV2({ plan, approvedPlanSha256: request.approvedPlanSha256, leaseToken });
      request.signal.throwIfAborted();
      if (now() < plan.preparedAt || now() >= plan.claimBy) fail();
      try {
        stage = 'claim'; claimStarted = true;
        const claimed = await input.repository.claim({ plan, approvedPlanSha256: request.approvedPlanSha256, leaseToken }, request.signal);
        if (canonicalJson(claimed.lease) !== canonicalJson(compiled.lease) || !Number.isSafeInteger(claimed.leaseExpiresAt) ||
            claimed.leaseExpiresAt > plan.deadline) fail();
        const remaining = Math.min(claimed.leaseExpiresAt, plan.deadline) - now();
        if (remaining <= 0) fail();
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.min(remaining, 2 ** 31 - 1))]);
        const lease = freeze(structuredClone(claimed.lease));
        const assertLease = async () => { signal.throwIfAborted(); await input.repository.assertLease(plan, lease, signal); signal.throwIfAborted(); };
        stage = 'provider'; await assertLease(); providerStarted = true;
        const observation = await input.workload.executeOnce({ plan, lease, assertLease, signal });
        const m = plan.material, f = plan.externalFence, checked = now();
        assertExpressInitializedStackIdV2(plan, observation.stackId);
        if (observation.materialSha256 !== plan.materialSha256 || observation.ownerDeploymentId !== m.scope.ownerDeploymentId ||
            observation.generation !== m.binding.resourceGeneration || observation.imageUri !== m.images.app ||
            observation.configurationHash !== m.configurationSha256 || observation.epoch !== f.epoch ||
            observation.operationHash !== f.operationHash || observation.workloadExpiresAt <= checked) fail();
        for (const [at, hash] of [[observation.providerCheckedAt, observation.providerObservationSha256],
          [observation.authorityCheckedAt, observation.authorityObservationSha256]] as const) {
          if (!Number.isSafeInteger(at) || at < plan.preparedAt || at > checked || checked - at > 30000 || !/^[a-f0-9]{64}$/.test(hash)) fail();
        }
        stage = 'initialized_get_readback'; await assertLease();
        const control = await input.readback.readConfiguration({ externalFence: f, signal });
        if (!control.ready || control.desiredConfigurationHash !== m.configurationSha256 || control.imageRevision !== m.images.app.split('@')[1]) fail();
        const controlCheckedAt = now();
        const proof: ExpressInitializedCompletionProofV2 = { materialSha256: plan.materialSha256,
          stackId: observation.stackId, workloadExpiresAt: observation.workloadExpiresAt, imageUri: observation.imageUri,
          configurationHash: observation.configurationHash, epoch: observation.epoch, operationHash: observation.operationHash,
          providerObservationSha256: observation.providerObservationSha256, providerCheckedAt: observation.providerCheckedAt,
          authorityObservationSha256: observation.authorityObservationSha256, authorityCheckedAt: observation.authorityCheckedAt,
          jobId: plan.jobId, leaseToken: lease.leaseToken,
          existingDefaultStoreId: m.existingDefaultStoreId, controlCheckedAt,
          controlObservationSha256: await sha256Hex({ protocol: 'W1-exact-initialized-readback/v2', result: control,
            existingDefaultStoreId: m.existingDefaultStoreId, externalFence: f, checkedAt: controlCheckedAt }),
          initializedVerified: true, effectiveConfigurationVerified: true };
        stage = 'atomic_complete_and_independent_readback';
        signal.throwIfAborted();
        const result = await input.repository.complete({ plan, lease, proof, now: now() }, signal);
        return { ...result, jobId: plan.jobId, providerExecutions: 1, initializationPosts: 0, automaticRetries: 0 };
      } catch {
        // Do not leak HTTP/DB errors or credential-bearing provider messages.
        // Claim/commit ambiguity intentionally leaves state for read-only inspect.
        return { outcome: 'INSPECT_REQUIRED_NO_RETRY' as const, stage, jobId: plan.jobId,
          claimStarted, providerStarted, retryAllowed: false, initializationPosts: 0 };
      }
    },
  });
}
