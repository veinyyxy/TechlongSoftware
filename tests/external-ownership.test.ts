import assert from "node:assert/strict";
import test from "node:test";

import type {
  TenantExternalOperationFence,
  TenantExternalOwnershipPort,
  TenantExternalOwnershipProof,
} from "../lib/deployments/execution/contracts.ts";
import { DisabledTenantExternalOwnershipPort } from "../lib/deployments/execution/external-ownership.ts";

const pendingFence: TenantExternalOperationFence = {
  schemaVersion: 1,
  resourceFence: {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      appInstanceId: "app_tenant_one",
      workspaceId: "wsp_one",
      productId: "prd_restaurant",
      environmentId: "env_sandbox",
      cellKey: "cell-sandbox-1",
      databaseName: "tenant_app_one",
      roleName: "tenant_role_one",
      secretName: "techlong/sandbox/tenant/app_one/runtime",
      stableIdentityHash: "a".repeat(64),
    },
    generation: 1,
    ownerDeploymentId: "dep_one",
    ownershipMarker: `tl_owner_${"a".repeat(32)}_g1`,
  },
  epoch: 1,
  intent: "provision",
  ownerDeploymentId: "dep_one",
  operationHash: "b".repeat(64),
  marker: `tl_epoch_${"a".repeat(24)}_g1_e1`,
  state: "pending_external",
};

test("disabled ownership provider fails closed and preserves an already-aborted reason", async () => {
  const port = new DisabledTenantExternalOwnershipPort();
  await assert.rejects(
    port.installAndObserve({
      pendingFence,
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_EXTERNAL_OWNERSHIP_BOUNDARY_DISABLED",
  );

  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await assert.rejects(
    port.installAndObserve({ pendingFence, signal: controller.signal }),
    /lease lost/,
  );
});
test("an injected ownership provider receives the exact pending fence and signal", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | null = null;
  const proof: TenantExternalOwnershipProof = {
    schemaVersion: 1,
    pendingFence,
    evidenceHash: "c".repeat(64),
    evidence: { provider: "offline-mock", marker: pendingFence.marker },
  };
  const port: TenantExternalOwnershipPort = {
    installAndObserve: async (input) => {
      observedSignal = input.signal;
      assert.deepEqual(input.pendingFence, pendingFence);
      return proof;
    },
  };

  assert.deepEqual(
    await port.installAndObserve({ pendingFence, signal: controller.signal }),
    proof,
  );
  assert.equal(observedSignal, controller.signal);
});
