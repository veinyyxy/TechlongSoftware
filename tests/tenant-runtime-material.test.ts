import assert from "node:assert/strict";
import test from "node:test";
import type { TenantExternalOperationFence, TenantResourceFence, TenantSecretStorePort } from "../lib/deployments/execution/contracts.ts";
import { deriveTenantRuntimeSecretName } from "../lib/deployments/execution/tenant-database.ts";
import { tenantRuntimeSecretExactJsonKeys, type TenantRuntimeSecretOwnershipEvidence } from "../lib/deployments/execution/tenant-aws-one-shot-adapters.ts";
import { NodeTenantRuntimeSecretMaterialGenerator, type TenantPaymentCredentialSource } from "../lib/deployments/execution/tenant-runtime-material.ts";

const endpoint = "cell.cluster-123456789012.ca-central-1.rds.amazonaws.com";
const config = { databaseEndpoint: endpoint, databasePort: 5432, expectedRegion: "ca-central-1" };
const stripeSecretKey = `sk_test_${"a".repeat(24)}`;
const stripeWebhookSecret = `whsec_${"b".repeat(24)}`;

function binding(token = "one", hash = "8") {
  const fence: TenantResourceFence = {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1, appInstanceId: `app_${token}`, workspaceId: `wsp_${token}`,
      productId: "prd_restaurant_order_system", environmentId: "env_aws_sandbox_ca_central_1",
      cellKey: "cell-sandbox-1", databaseName: `tenant_${token}_db`, roleName: `tenant_${token}_role`,
      secretName: `techlong/sandbox/tenant/tenant_${token}_123/runtime`, stableIdentityHash: hash.repeat(64),
    },
    generation: 1, ownerDeploymentId: `dep_${token}`, ownershipMarker: `tl_owner_${hash.repeat(32)}_g1`,
  };
  const externalFence: TenantExternalOperationFence = {
    schemaVersion: 1, resourceFence: fence, epoch: 3, intent: "provision", state: "active",
    ownerDeploymentId: fence.ownerDeploymentId, operationHash: "9".repeat(64), marker: `tl_epoch_${hash.repeat(24)}_g1_e3`,
  };
  return { fence, externalFence, signal: new AbortController().signal, idempotencyKey: "material:test" };
}

function evidence(input: ReturnType<typeof binding>): TenantRuntimeSecretOwnershipEvidence {
  return {
    resourceGeneration: input.fence.generation, ownershipMarker: input.fence.ownershipMarker,
    externalEpoch: input.externalFence.epoch, externalMarker: input.externalFence.marker,
    externalOperationHash: input.externalFence.operationHash,
  };
}

function payments(overrides: Partial<TenantPaymentCredentialSource> = {}): TenantPaymentCredentialSource {
  return { async lease() { return { read: () => ({ stripeSecretKey, stripeWebhookSecret }), dispose() {} }; }, ...overrides };
}

function store(generator: NodeTenantRuntimeSecretMaterialGenerator, changeOwnership = false) {
  const raw: TenantSecretStorePort = {
    async inspectRuntimeSecret() { throw new Error("not needed"); },
    async destroyRuntimeSecret() { throw new Error("not needed"); },
    async ensureRuntimeSecret(input) {
      return await generator.generate({
        secretName: deriveTenantRuntimeSecretName(input.fence),
        ownership: { ...evidence(input), ...(changeOwnership ? { externalEpoch: 4 } : {}) },
        signal: input.signal,
      }) as never;
    },
  };
  return generator.bindSecretStore(raw);
}

test("material produces exact five keys, bound database identity and independent 256-bit secrets", async () => {
  let disposed = 0;
  const generator = new NodeTenantRuntimeSecretMaterialGenerator(config, payments({
    async lease() { return { read: () => ({ stripeSecretKey, stripeWebhookSecret }), dispose() { disposed += 1; } }; },
  }));
  const bound = store(generator);
  const first = await bound.ensureRuntimeSecret(binding()) as unknown as Record<string, string>;
  const second = await bound.ensureRuntimeSecret(binding()) as unknown as Record<string, string>;
  assert.deepEqual(Object.keys(first).sort(), [...tenantRuntimeSecretExactJsonKeys].sort());
  const url = new URL(first.database_url);
  assert.equal(url.hostname, endpoint);
  assert.equal(url.port, "5432");
  assert.equal(url.username, "tenant_one_role");
  assert.equal(url.pathname, "/tenant_one_db");
  assert.equal(url.search, "?sslmode=verify-full");
  const keys = [url.password, first.hmac_secret_key, first.jwt_secret_key];
  assert.equal(new Set(keys).size, 3);
  for (const key of keys) assert.equal(Buffer.from(key, "base64url").length, 32);
  assert.notEqual(first.database_url, second.database_url);
  assert.notEqual(first.hmac_secret_key, second.hmac_secret_key);
  assert.notEqual(first.jwt_secret_key, second.jwt_secret_key);
  assert.equal(first.stripe_secret_key, stripeSecretKey);
  assert.equal(disposed, 2);
  assert.equal(JSON.stringify(generator), "{}");
});

test("unbound and mismatched generation requests cannot acquire credentials", async () => {
  let leases = 0;
  const generator = new NodeTenantRuntimeSecretMaterialGenerator(config, payments({
    async lease() { leases += 1; throw new Error("must not lease"); },
  }));
  const input = binding();
  await assert.rejects(generator.generate({ secretName: deriveTenantRuntimeSecretName(input.fence), ownership: evidence(input), signal: input.signal }), { code: "TENANT_MATERIAL_BINDING_MISSING" });
  await assert.rejects(store(generator, true).ensureRuntimeSecret(input), { code: "TENANT_MATERIAL_BINDING_MISMATCH" });
  assert.equal(leases, 0);
});

test("concurrent tenant scopes stay independent through asynchronous credential loading", async () => {
  const leasedNames: string[] = [];
  const generator = new NodeTenantRuntimeSecretMaterialGenerator(config, payments({
    async lease({ fence }) {
      leasedNames.push(fence.identity.databaseName);
      await new Promise<void>((resolve) => setTimeout(resolve, fence.identity.databaseName.includes("one") ? 10 : 1));
      return { read: () => ({ stripeSecretKey, stripeWebhookSecret }), dispose() {} };
    },
  }));
  const bound = store(generator);
  const results = await Promise.all([bound.ensureRuntimeSecret(binding()), bound.ensureRuntimeSecret(binding("two", "7"))]);
  assert.deepEqual(results.map((result) => new URL((result as unknown as Record<string, string>).database_url).pathname), ["/tenant_one_db", "/tenant_two_db"]);
  assert.deepEqual(leasedNames, ["tenant_one_db", "tenant_two_db"]);
  const input = binding();
  await assert.rejects(generator.generate({ secretName: deriveTenantRuntimeSecretName(input.fence), ownership: evidence(input), signal: input.signal }), { code: "TENANT_MATERIAL_BINDING_MISSING" });
});

test("cleanup, pending, foreign owner and aborted bindings fail before generation", async () => {
  let leases = 0;
  const generator = new NodeTenantRuntimeSecretMaterialGenerator(config, payments({
    async lease() { leases += 1; throw new Error("must not lease"); },
  }));
  for (const change of [
    { intent: "cleanup" as const }, { state: "pending_external" as const }, { ownerDeploymentId: "dep_other" },
  ]) {
    const input = binding();
    Object.assign(input.externalFence, change);
    assert.throws(() => store(generator).ensureRuntimeSecret(input), { code: "TENANT_MATERIAL_BINDING_INVALID" });
  }
  const input = binding();
  input.signal = AbortSignal.abort();
  assert.throws(() => store(generator).ensureRuntimeSecret(input), { name: "AbortError" });
  assert.equal(leases, 0);
});

test("invalid or throwing payment reads are disposed and errors contain no raw secrets", async () => {
  for (const mode of ["live", "extra", "throw", "abort", "dispose"] as const) {
    let disposed = 0;
    const controller = new AbortController();
    const generator = new NodeTenantRuntimeSecretMaterialGenerator(config, payments({
      async lease() {
        return {
          read() {
            if (mode === "throw") throw new Error(stripeSecretKey);
            if (mode === "abort") controller.abort();
            return { stripeSecretKey: mode === "live" ? `sk_live_${"a".repeat(24)}` : stripeSecretKey, stripeWebhookSecret, ...(mode === "extra" ? { password: "secret" } : {}) };
          },
          dispose() { disposed += 1; if (mode === "dispose") throw new Error(stripeWebhookSecret); },
        };
      },
    }));
    await assert.rejects(store(generator).ensureRuntimeSecret({ ...binding(), signal: controller.signal }), (error: unknown) => {
      assert.equal(String(error).includes(stripeSecretKey), false);
      assert.equal(String(error).includes(stripeWebhookSecret), false);
      return true;
    });
    assert.equal(disposed, 1);
  }
});

test("material endpoint cannot switch to localhost, URL overrides or another region", () => {
  for (const databaseEndpoint of ["localhost", "127.0.0.1", `https://${endpoint}`, `${endpoint}/path`, `${endpoint}?sslmode=disable`, "cell.cluster-123456789012.us-east-1.rds.amazonaws.com"]) {
    assert.throws(() => new NodeTenantRuntimeSecretMaterialGenerator({ ...config, databaseEndpoint }, payments()), { code: "TENANT_MATERIAL_CONFIG_INVALID" });
  }
  assert.throws(() => new NodeTenantRuntimeSecretMaterialGenerator({ ...config, databasePort: 5433 }, payments()), { code: "TENANT_MATERIAL_CONFIG_INVALID" });
});

test("credential source failures are sanitized and its mutable input cannot retarget the database", async () => {
  const failed = new NodeTenantRuntimeSecretMaterialGenerator(config, payments({
    async lease() { throw new Error(stripeSecretKey); },
  }));
  await assert.rejects(store(failed).ensureRuntimeSecret(binding()), (error: unknown) => {
    assert.equal((error as { code: string }).code, "TENANT_PAYMENT_SOURCE_FAILED");
    assert.equal(String(error).includes(stripeSecretKey), false);
    return true;
  });
  const mutable = new NodeTenantRuntimeSecretMaterialGenerator(config, payments({
    async lease(input) {
      input.fence.identity.databaseName = "tenant_other_db";
      input.fence.identity.roleName = "tenant_other_role";
      return { read: () => ({ stripeSecretKey, stripeWebhookSecret }), dispose() {} };
    },
  }));
  const result = await store(mutable).ensureRuntimeSecret(binding()) as unknown as Record<string, string>;
  assert.equal(new URL(result.database_url).pathname, "/tenant_one_db");
});
