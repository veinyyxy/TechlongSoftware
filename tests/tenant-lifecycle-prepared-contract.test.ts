import test from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { compilePreparedLifecycleAuthorityEnvironment, preparedLifecycleCommands, preparedLifecycleEntrypoint } from "../lib/deployments/execution/tenant-lifecycle-prepared-contract.ts";
import { approvedTenantDatabaseOneShotCommands, tenantDatabaseOneShotOperations } from "../lib/deployments/execution/ecs-one-shot-task.ts";
import type { TenantResourceFence } from "../lib/deployments/execution/contracts.ts";

async function fence(): Promise<TenantResourceFence> {
  const ownership = { appInstanceId: "test-instance", workspaceId: "test-workspace", productId: "test-product", environmentId: "test-environment", cellKey: "cell-sandbox-1" };
  const hash = await sha256Hex(ownership);
  return { schemaVersion: 1, generation: 1, ownerDeploymentId: "test-deployment",
    ownershipMarker: `tl_owner_${hash.slice(0, 32)}_g1`, identity: { schemaVersion: 1, ...ownership,
      databaseName: "tenant_abc123_db", roleName: "tenant_abc123_role",
      secretName: `techlong/sandbox/tenant/testinstance_${hash.slice(0, 10)}/runtime`, stableIdentityHash: hash } };
}
test("prepared protocol binds full non-secret ownership identity without changing legacy vectors", async () => {
  const f = await fence(), env = await compilePreparedLifecycleAuthorityEnvironment(f);
  assert.equal(env.TENANT_EXTERNAL_AUTHORITY_KEY, `tenant:${f.identity.stableIdentityHash}`);
  assert.equal(env.TENANT_OWNER_DEPLOYMENT_ID, f.ownerDeploymentId);
  assert.deepEqual(JSON.parse(env.TENANT_RESOURCE_IDENTITY_JSON), f.identity);
  assert.deepEqual(preparedLifecycleEntrypoint, ["/usr/local/bin/node", "db/tenant_lifecycle_prepared.js"]);
  for (const op of tenantDatabaseOneShotOperations) {
    assert.deepEqual(preparedLifecycleCommands[op], [op]);
    assert.deepEqual(approvedTenantDatabaseOneShotCommands[op], ["/usr/local/bin/node", "db/tenant_lifecycle.js", op]);
  }
  assert.equal(Object.isFrozen(env), true);
  assert.equal("runtimeEnabled" in env, false);
});
test("prepared identity rejects forged preimage and logical Secret alias", async () => {
  const f = await fence();
  for (const patch of [{ appInstanceId: "other" }, { secretName: "techlong/sandbox/tenant/other/runtime" }, { workspaceId: "other" }]) {
    await assert.rejects(() => compilePreparedLifecycleAuthorityEnvironment({ ...f, identity: { ...f.identity, ...patch } }));
  }
});
