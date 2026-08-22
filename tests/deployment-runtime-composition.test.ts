import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultDisabledWorkerRuntime,
  DEFAULT_DISABLED_RUNTIME_BLOCKERS,
} from "../lib/deployments/execution/runtime-composition.ts";
import type {
  DeploymentExecutionRepository,
} from "../lib/deployments/execution/contracts.ts";
import type { DeploymentJobType } from "../lib/deployments/state-machine.ts";
import { runDeploymentWorkerOnce } from "../lib/deployments/execution/worker.ts";

test("default Worker composition is immutable and exposes no live capability", () => {
  const runtime = createDefaultDisabledWorkerRuntime();

  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.blockers), true);
  assert.equal(runtime.mode, "offline_only");
  assert.equal(runtime.applyRuntimeReady, false);
  assert.equal(runtime.cleanupRuntimeReady, false);
  assert.deepEqual(runtime.blockers, DEFAULT_DISABLED_RUNTIME_BLOCKERS);
  assert.equal(
    runtime.blockers.includes(
      "tenant_lifecycle_task_definition_live_readback_missing",
    ),
    true,
  );
  assert.equal("tenantExternalOperationCoordinator" in runtime, false);
  assert.equal("tenantResourceCleanup" in runtime, false);
});

test("default Worker composition returns disabled before claiming any job", async () => {
  let claimCalls = 0;
  const repository = {
    async claimNext(input: { jobTypes: DeploymentJobType[] }) {
      claimCalls += 1;
      assert.deepEqual(input.jobTypes, []);
      return null;
    },
  } as unknown as DeploymentExecutionRepository;
  const runtime = createDefaultDisabledWorkerRuntime();

  const result = await runDeploymentWorkerOnce({
    workerId: "worker:offline-test",
    config: {
      workerEnabled: true,
      applyEnabled: true,
      environmentKey: "aws-sandbox-ca-central-1",
      expectedAccountId: "402010193138",
      expectedRegion: "ca-central-1",
      workerRoleArn:
        "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole",
      confirmation: "I_ACKNOWLEDGE_AWS_SANDBOX_COST_AND_TTL",
      leaseDurationMs: 120_000,
      pollIntervalMs: 10_000,
    },
    dependencies: {
      repository,
      awsFactory: async () => {
        throw new Error("AWS factory must not be constructed offline.");
      },
      cleanupScheduler: {} as never,
      ...runtime,
    },
  });

  assert.deepEqual(result, {
    status: "disabled",
    failures: [
      "No apply/reconcile or complete fenced cleanup runtime is enabled.",
    ],
  });
  assert.equal(claimCalls, 0);
});
