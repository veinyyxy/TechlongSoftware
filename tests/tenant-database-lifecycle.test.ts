import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OrderedTenantResourceCleanup } from "../lib/deployments/execution/cleanup.ts";
import { RepositoryTenantExternalOwnershipCoordinator } from "../lib/deployments/execution/external-ownership-coordinator.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { NeonDeploymentExecutionRepository } from "../lib/deployments/execution/neon-repository.ts";
import type {
  DeploymentExecutionContext,
  DeploymentExecutionRepository,
  DeploymentTenantResourceLifecycleStatus,
  TenantApprovedBaseline,
  TenantDatabaseInspection,
  TenantDatabaseLifecyclePort,
  TenantDatabaseMutationReceipt,
  TenantExternalOperationFence,
  TenantProvisionPredecessor,
  TenantResourceCleanupPhase,
  TenantResourceCleanupPhaseRecord,
  TenantResourceCleanupPhaseReceiptMap,
  TenantResourceCleanupRun,
  TenantResourceFence,
  TenantResourceIdentity,
  TenantSecretInspection,
  TenantSecretStorePort,
} from "../lib/deployments/execution/contracts.ts";
import {
  deriveTenantOwnershipMarker,
  deriveTenantResourceIdentity,
  deriveTenantRuntimeSecretName,
  GuardedTenantDatabasePort,
} from "../lib/deployments/execution/tenant-database.ts";

import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";
import { assertSafeDeploymentOutput } from "../lib/deployments/safety.ts";

const signal = () => new AbortController().signal;

const now = Date.UTC(2026, 7, 10);
const evidenceHash = "a".repeat(64);
const baselineDigest = "b".repeat(64);
const manifestDigest = "c".repeat(64);
const baseline: TenantApprovedBaseline = {
  contract: "speedfeast-pg16.14-tenant-baseline-v1",
  archiveS3Uri: "s3://techlong-sandbox-migrations/_migration/tenant-v1.dump",
  archiveSha256: baselineDigest,
  approvedArchiveSha256: baselineDigest,
  manifestS3Uri:
    "s3://techlong-sandbox-migrations/_migration/tenant-v1.manifest.json",
  manifestSha256: manifestDigest,
  sourceDatabase: "speedfeast_empty_template",
};

const environment: DeploymentEnvironment = {
  id: "env_aws_sandbox_ca_central_1",
  key: "aws-sandbox-ca-central-1",
  name: "AWS Sandbox ca-central-1",
  kind: "aws_sandbox",
  driver: "aws_ecs_cell",
  expectedAccountId: "402010193138",
  region: "ca-central-1",
  cellKey: "cell-sandbox-1",
  baseDomain: "sandbox.techlong.cloud",
  applyEnabled: false,
  status: "active",
  policy: {
    budgetLimitCents: 1_000,
    ttlSeconds: 7_200,
    maxCells: 1,
    maxTenants: 1,
    maxTaskCount: 1,
    allowedProfiles: ["standard-v1"],
    allowNatGateway: false,
    allowInterfaceEndpoints: false,
    databaseEngine: "aurora-postgresql-serverless-v2",
    auroraPostgresMinimumVersion: "16.3",
    auroraPostgresEngineVersion: "16.14",
    auroraEngineMode: "provisioned",
    allowLimitlessDatabase: false,
    databaseMode: "tenant_database",
    auroraServerlessMinAcu: 0,
    auroraServerlessMaxAcu: 1,
    auroraSecondsUntilAutoPause: 300,
    allowDedicatedDatabase: false,
    allowMultiAzDatabase: false,
    allowRdsProxy: false,
    allowGlobalDatabase: false,
    logRetentionDays: 1,
  },
};

function context(input: {
  deploymentId?: string;
  selectedEnvironment?: DeploymentEnvironment;
} = {}): DeploymentExecutionContext {
  const selectedEnvironment = input.selectedEnvironment ?? environment;
  const deploymentId = input.deploymentId ?? "dep_one";
  const plan = new AwsEcsCellPlanOnlyDriver({
    mode: "aws_sandbox",
    region: selectedEnvironment.region,
    cellKey: selectedEnvironment.cellKey,
  }).buildPlan({
    appInstanceId: "app_Tenant-One!?",
    workspaceId: "wsp_one",
    productId: "prd_restaurant_order_system",
    planId: "plan_basic",
    subscriptionId: "sub_one",
    tenantKey: "tenant_one",
    deploymentProfileKey: "standard-v1",
  });
  return {
    job: {
      id: `job_${deploymentId}`,
      deploymentId,
      jobType: "apply",
      payload: {},
      attempt: 1,
      maxAttempts: 5,
      leaseExpiresAt: now + 60_000,
      leaseToken: "lease_00000000000000000000000000000001",
    },
    deployment: {
      id: deploymentId,
      appInstanceId: "app_Tenant-One!?",
      environmentId: selectedEnvironment.id,
      status: "database_preparing",
      planHash: evidenceHash,
      configurationHash: evidenceHash,
      artifactRef: `example.invalid/image@sha256:${evidenceHash}`,
      desiredPlan: plan,
      createdAt: now,
    },
    environment: selectedEnvironment,
    binding: null,
    cleanupSchedule: null,
    workspace: { id: "wsp_one", status: "active" },
    subscription: { id: "sub_one", status: "active" },
    appInstance: {
      id: "app_Tenant-One!?",
      workspaceId: "wsp_one",
      productId: "prd_restaurant_order_system",
      subscriptionId: "sub_one",
      templateVersionId: "tplver_restaurant_v2",
      status: "pending",
      slug: "tenant-one",
      tenantKey: "tenant_one",
      configurationSnapshot: {},
    },
    tenantResources: null,
    tenantExternalOperation: null,
    activeCellCount: 1,
    activeTenantCount: 0,
  };
}

function fence(
  identity: TenantResourceIdentity,
  generation = 1,
  ownerDeploymentId = "dep_one",
): TenantResourceFence {
  return {
    schemaVersion: 1,
    identity,
    generation,
    ownerDeploymentId,
    ownershipMarker: deriveTenantOwnershipMarker(identity, generation),
  };
}

function provisionExternalFence(
  resourceFence: TenantResourceFence,
): TenantExternalOperationFence {
  return {
    schemaVersion: 1,
    resourceFence,
    epoch: 1,
    intent: "provision",
    ownerDeploymentId: resourceFence.ownerDeploymentId,
    operationHash: "e".repeat(64),
    marker:
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
      `_g${resourceFence.generation}_e1`,
    state: "active",
  };
}

async function reservedContext(input: {
  status?: DeploymentTenantResourceLifecycleStatus;
  generation?: number;
  deploymentId?: string;
  identityFrom?: DeploymentExecutionContext;
} = {}): Promise<DeploymentExecutionContext> {
  const result = context({ deploymentId: input.deploymentId });
  const identity = await deriveTenantResourceIdentity(input.identityFrom ?? result);
  const resourceFence = fence(
    identity,
    input.generation ?? 1,
    result.deployment.id,
  );
  result.tenantResources = {
    identity,
    generation: resourceFence.generation,
    ownershipMarker: resourceFence.ownershipMarker,
    createdByDeploymentId: "dep_one",
    ownerDeploymentId: result.deployment.id,
    runtimeSecretRef: null,
    lifecycleStatus: input.status ?? "planned",
    baselineDigest: null,
    migrationContract: null,
    evidenceHash: null,
    evidence: {},
    lastError: null,
    createdAt: now,
    updatedAt: now,
    destroyedAt: null,
  };
  result.tenantExternalOperation = provisionExternalFence(resourceFence);
  return result;
}

function inspection(
  resourceFence: TenantResourceFence,
  state: TenantDatabaseInspection["state"],
): TenantDatabaseInspection {
  const exists = state !== "missing";
  const restored = !["missing", "partial", "empty"].includes(state);
  const migrated = state === "saas_migrated" || state === "verified";
  return {
    fence: resourceFence,
    externalFence: provisionExternalFence(resourceFence),
    state,
    databaseExists: exists,
    roleExists: exists,
    databaseOwnershipMarker: exists ? resourceFence.ownershipMarker : null,
    roleOwnershipMarker: exists ? resourceFence.ownershipMarker : null,
    baselineDigest: restored ? baselineDigest : null,
    migrationContract: migrated ? "speedfeast-saas-control-v1" : null,
    evidenceHash,
  };
}

function mutation(
  resourceFence: TenantResourceFence,
  operation: TenantDatabaseMutationReceipt["operation"],
  resultingState: TenantDatabaseMutationReceipt["resultingState"],
): TenantDatabaseMutationReceipt {
  return {
    fence: resourceFence,
    externalFence: provisionExternalFence(resourceFence),
    operation,
    outcome: "applied",
    resultingState,
    evidenceHash,
  };
}

function secretInspection(
  resourceFence: TenantResourceFence,
  state: TenantSecretInspection["state"],
): TenantSecretInspection {
  return {
    fence: resourceFence,
    externalFence: provisionExternalFence(resourceFence),
    state,
    secretRef:
      state === "present"
        ? `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${deriveTenantRuntimeSecretName(resourceFence)}-abcdef`
        : null,
    ownershipMarker: state === "present" ? resourceFence.ownershipMarker : null,
    versionRef: state === "present" ? "version-one" : null,
  };
}

test("keeps names stable across deployments while changing only recreated generations", async () => {
  const first = await deriveTenantResourceIdentity(context({ deploymentId: "dep_one" }));
  const renewal = await deriveTenantResourceIdentity(
    context({ deploymentId: "dep_renewal" }),
  );
  assert.deepEqual(first, renewal);
  for (const value of [first.databaseName, first.roleName]) {
    assert.match(value, /^[a-z][a-z0-9_]{0,62}$/);
  }
  const generationOne = fence(first, 1, "dep_one");
  const generationTwo = fence(first, 2, "dep_reopen");
  assert.equal(deriveTenantRuntimeSecretName(generationOne), `${first.secretName}/g1`);
  assert.equal(deriveTenantRuntimeSecretName(generationTwo), `${first.secretName}/g2`);
  assert.notEqual(
    deriveTenantRuntimeSecretName(generationOne),
    deriveTenantRuntimeSecretName(generationTwo),
  );
  assert.match(first.stableIdentityHash, /^[a-f0-9]{64}$/);
  assert.match(
    first.secretName,
    /^techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime$/,
  );
  const original = fence(first, 1, "dep_one");
  const handedOff = fence(first, 1, "dep_renewal");
  const reopened = fence(first, 2, "dep_reopen");
  assert.equal(original.ownershipMarker, handedOff.ownershipMarker);
  assert.notEqual(original.ownershipMarker, reopened.ownershipMarker);
  assert.match(original.ownershipMarker, /^tl_owner_[a-f0-9]{32}_g1$/);
});

test("prepares, restores, migrates and verifies with one exact generation fence", async () => {
  const events: string[] = [];
  let databaseState: TenantDatabaseInspection["state"] = "missing";
  let secretState: TenantSecretInspection["state"] = "missing";
  const lifecycle: TenantDatabaseLifecyclePort = {
    inspect: async ({ fence: next }) => {
      events.push(`inspect:${databaseState}:g${next.generation}`);
      return inspection(next, databaseState);
    },
    prepareEmptyDatabase: async ({ fence: next, externalFence, runtimeSecretRef }) => {
      events.push("prepare");
      assert.match(runtimeSecretRef, /^arn:aws:secretsmanager:/);
      databaseState = "empty";
      return { ...mutation(next, "prepare_empty_database", "empty"), externalFence };
    },
    restoreApprovedBaseline: async ({ fence: next, externalFence, baseline: selected }) => {
      events.push("baseline");
      assert.equal(selected.approvedArchiveSha256, baselineDigest);
      databaseState = "baseline_restored";
      return {
        ...mutation(next, "restore_approved_baseline", "baseline_restored"),
        externalFence,
      };
    },
    migrateSaas: async ({ fence: next, externalFence, command, migrationContract }) => {
      events.push("saas");
      assert.equal(
        command,
        "/usr/local/bin/node db/tenant_lifecycle.js migrate_saas",
      );
      assert.equal(migrationContract, "speedfeast-saas-control-v1");
      databaseState = "saas_migrated";
      return { ...mutation(next, "migrate_saas", "saas_migrated"), externalFence };
    },
    verify: async ({ fence: next, externalFence }) => {
      events.push("verify");
      databaseState = "verified";
      return { ...mutation(next, "verify", "verified"), externalFence };
    },
    destroy: async ({ fence: next, externalFence }) => ({
      fence: next,
      externalFence,
      outcome: "deleted",
      databaseDeleted: true,
      roleDeleted: true,
      evidenceHash,
    }),
  };
  const secrets: TenantSecretStorePort = {
    inspectRuntimeSecret: async ({ fence: next, externalFence }) => {
      events.push(`secret-inspect:${secretState}:g${next.generation}`);
      return { ...secretInspection(next, secretState), externalFence };
    },
    ensureRuntimeSecret: async ({ fence: next, externalFence }) => {
      events.push("secret-create");
      secretState = "present";
      const observed = secretInspection(next, "present");
      return {
        fence: next,
        externalFence,
        outcome: "created",
        secretRef: observed.secretRef!,
        ownershipMarker: next.ownershipMarker,
        versionRef: observed.versionRef!,
      };
    },
    destroyRuntimeSecret: async ({ fence: next, externalFence }) => ({
      fence: next,
      externalFence,
      outcome: "deleted",
      ownershipMarker: next.ownershipMarker,
    }),
  };
  const guarded = new GuardedTenantDatabasePort({
    lifecycle,
    secrets,
    approvedBaseline: baseline,
  });
  const claimed = await reservedContext();
  const prepared = await guarded.ensureTenantDatabase({
    context: claimed,
    externalFence: claimed.tenantExternalOperation!,
    idempotencyKey: "dep_one:database",
    signal: signal(),
  });
  assert.equal(prepared.lifecycleState, "empty");
  assert.equal(prepared.resourceGeneration, 1);
  assert.equal(prepared.resourceOwnerDeploymentId, "dep_one");
  assert.equal(prepared.externalEpoch, claimed.tenantExternalOperation!.epoch);
  assert.equal(prepared.externalMarker, claimed.tenantExternalOperation!.marker);
  assert.equal(
    prepared.externalOperationHash,
    claimed.tenantExternalOperation!.operationHash,
  );
  assertSafeDeploymentOutput(prepared);
  assert.equal(JSON.stringify(prepared).includes("password"), false);

  const migrated = await guarded.migrateTenantDatabase({
    context: claimed,
    externalFence: claimed.tenantExternalOperation!,
    idempotencyKey: "dep_one:migration:v1",
    signal: signal(),
  });
  assert.equal(migrated.lifecycleState, "verified");
  assertSafeDeploymentOutput(migrated);
  assert.match(String(migrated.ownershipMarker), /^tl_owner_[a-f0-9]{32}_g1$/);
  assert.deepEqual(events, [
    "inspect:missing:g1",
    "secret-inspect:missing:g1",
    "secret-create",
    "prepare",
    "inspect:empty:g1",
    "secret-inspect:present:g1",
    "inspect:empty:g1",
    "baseline",
    "inspect:baseline_restored:g1",
    "saas",
    "inspect:saas_migrated:g1",
    "verify",
    "inspect:verified:g1",
  ]);
});

test("makes zero adapter calls until the stable resource generation is claimed", async () => {
  let calls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: {
      inspect: async () => {
        calls += 1;
        throw new Error("must not inspect");
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {} as TenantSecretStorePort,
    approvedBaseline: baseline,
  });
  await assert.rejects(
    guarded.ensureTenantDatabase({
      context: context(),
      externalFence: undefined!,
      idempotencyKey: "dep_one:database",
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_RESOURCE_GENERATION_UNCLAIMED",
  );
  assert.equal(calls, 0);
});

test("makes zero adapter calls without an exact active provision epoch", async () => {
  let calls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: new Proxy({} as TenantDatabaseLifecyclePort, {
      get: () => () => {
        calls += 1;
        throw new Error("must not call lifecycle");
      },
    }),
    secrets: new Proxy({} as TenantSecretStorePort, {
      get: () => () => {
        calls += 1;
        throw new Error("must not call secrets");
      },
    }),
    approvedBaseline: baseline,
  });
  const claimed = await reservedContext();
  const expected = claimed.tenantExternalOperation!;
  claimed.tenantExternalOperation = null;
  await assert.rejects(
    guarded.ensureTenantDatabase({
      context: claimed,
      externalFence: expected,
      idempotencyKey: "dep_one:database",
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_EXTERNAL_OWNERSHIP_UNPROVEN",
  );
  assert.equal(calls, 0);
});

test("an already-aborted tenant database operation makes zero adapter calls", async () => {
  let externalCalls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: new Proxy({} as TenantDatabaseLifecyclePort, {
      get: () => () => {
        externalCalls += 1;
        throw new Error("must not call lifecycle");
      },
    }),
    secrets: new Proxy({} as TenantSecretStorePort, {
      get: () => () => {
        externalCalls += 1;
        throw new Error("must not call secrets");
      },
    }),
    approvedBaseline: baseline,
  });
  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await assert.rejects(
    guarded.ensureTenantDatabase({
      context: context(),
      externalFence: undefined!,
      idempotencyKey: "dep_one:database",
      signal: controller.signal,
    }),
    /lease lost/,
  );
  assert.equal(externalCalls, 0);
});

test("rejects a cross-environment reservation before an external inspection", async () => {
  const otherEnvironment: DeploymentEnvironment = {
    ...environment,
    id: "env_other",
    cellKey: "cell-other-1",
  };
  const otherContext = context({ selectedEnvironment: otherEnvironment });
  const mismatched = await reservedContext({ identityFrom: context() });
  otherContext.tenantResources = mismatched.tenantResources;
  let calls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: {
      inspect: async () => {
        calls += 1;
        throw new Error("must not inspect");
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {} as TenantSecretStorePort,
    approvedBaseline: baseline,
  });
  await assert.rejects(
    guarded.ensureTenantDatabase({
      context: otherContext,
      externalFence: mismatched.tenantExternalOperation!,
      idempotencyKey: "dep_one:database",
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_OWNERSHIP_MISMATCH",
  );
  assert.equal(calls, 0);
});

test("reopening resumes after its current-generation Secret was created before a crash", async () => {
  const reopened = await reservedContext({ status: "reopening", generation: 2 });
  let databaseState: TenantDatabaseInspection["state"] = "missing";
  let prepareCalls = 0;
  let secretCreateCalls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: {
      inspect: async ({ fence: next }: { fence: TenantResourceFence }) =>
        inspection(next, databaseState),
      prepareEmptyDatabase: async ({
        fence: next,
      }: {
        fence: TenantResourceFence;
      }) => {
        prepareCalls += 1;
        databaseState = "empty";
        return mutation(next, "prepare_empty_database", "empty");
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {
      inspectRuntimeSecret: async ({
        fence: next,
      }: {
        fence: TenantResourceFence;
      }) =>
        secretInspection(next, "present"),
      ensureRuntimeSecret: async () => {
        secretCreateCalls += 1;
        throw new Error("must not create");
      },
    } as unknown as TenantSecretStorePort,
    approvedBaseline: baseline,
  });
  const output = await guarded.ensureTenantDatabase({
    context: reopened,
    externalFence: reopened.tenantExternalOperation!,
    idempotencyKey: "dep_one:database",
    signal: signal(),
  });
  assert.equal(output.lifecycleState, "empty");
  assert.equal(prepareCalls, 1);
  assert.equal(secretCreateCalls, 0);
});

test("reopening rejects a Secret that still carries the destroyed generation", async () => {
  const reopened = await reservedContext({ status: "reopening", generation: 2 });
  const staleFence = {
    ...fence(reopened.tenantResources!.identity, 1),
    ownerDeploymentId: reopened.deployment.id,
  };
  let writeCalls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: {
      inspect: async ({ fence: next }: { fence: TenantResourceFence }) =>
        inspection(next, "missing"),
      prepareEmptyDatabase: async () => {
        writeCalls += 1;
        throw new Error("must not prepare");
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {
      inspectRuntimeSecret: async () => secretInspection(staleFence, "present"),
      ensureRuntimeSecret: async () => {
        writeCalls += 1;
        throw new Error("must not create");
      },
    } as unknown as TenantSecretStorePort,
    approvedBaseline: baseline,
  });
  await assert.rejects(
    guarded.ensureTenantDatabase({
      context: reopened,
      externalFence: reopened.tenantExternalOperation!,
      idempotencyKey: "dep_one:database",
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_RESOURCE_FENCE_MISMATCH",
  );
  assert.equal(writeCalls, 0);
});

test("rejects a tenant Secret reference from another AWS account or region", async () => {
  const claimed = await reservedContext();
  const currentFence = fence(claimed.tenantResources!.identity);
  let writeCalls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: {
      inspect: async () => inspection(currentFence, "missing"),
      prepareEmptyDatabase: async () => {
        writeCalls += 1;
        throw new Error("must not prepare");
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {
      inspectRuntimeSecret: async () => ({
        ...secretInspection(currentFence, "present"),
        secretRef:
          `arn:aws:secretsmanager:us-east-1:999999999999:secret:` +
          `${currentFence.identity.secretName}-abcdef`,
      }),
      ensureRuntimeSecret: async () => {
        writeCalls += 1;
        throw new Error("must not create");
      },
    } as unknown as TenantSecretStorePort,
    approvedBaseline: baseline,
  });
  await assert.rejects(
    guarded.ensureTenantDatabase({
      context: claimed,
      externalFence: claimed.tenantExternalOperation!,
      idempotencyKey: "dep_one:database",
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_SECRET_REFERENCE_INVALID",
  );
  assert.equal(writeCalls, 0);
});

test("fails closed on partial database state before inspecting secrets", async () => {
  const claimed = await reservedContext();
  let secretCalls = 0;
  const lifecycle = {
    inspect: async ({ fence: next }: { fence: TenantResourceFence }) => ({
      ...inspection(next, "partial"),
      databaseExists: true,
      roleExists: false,
      roleOwnershipMarker: null,
    }),
  } as unknown as TenantDatabaseLifecyclePort;
  const secrets = {
    inspectRuntimeSecret: async () => {
      secretCalls += 1;
      throw new Error("must not inspect after partial database evidence");
    },
  } as unknown as TenantSecretStorePort;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle,
    secrets,
    approvedBaseline: baseline,
  });
  await assert.rejects(
    guarded.ensureTenantDatabase({
      context: claimed,
      externalFence: claimed.tenantExternalOperation!,
      idempotencyKey: "dep_one:database",
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_DATABASE_PARTIAL_STATE",
  );
  assert.equal(secretCalls, 0);
});

test("blocks restore before adapters when no baseline is independently approved", async () => {
  const claimed = await reservedContext();
  let adapterCalls = 0;
  const guarded = new GuardedTenantDatabasePort({
    lifecycle: {
      inspect: async () => {
        adapterCalls += 1;
        throw new Error("baseline gate must run first");
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {} as TenantSecretStorePort,
    approvedBaseline: null,
  });
  await assert.rejects(
    guarded.migrateTenantDatabase({
      context: claimed,
      externalFence: claimed.tenantExternalOperation!,
      idempotencyKey: "dep_one:migration:v1",
      signal: signal(),
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_BASELINE_NOT_APPROVED",
  );
  assert.equal(adapterCalls, 0);
});

function cleanupLease(resourceFence: TenantResourceFence, jobId: string) {
  return {
    jobId,
    deploymentId: resourceFence.ownerDeploymentId,
    workerId: "worker_one",
    attempt: 1,
    leaseToken: "lease_00000000000000000000000000000002",
  };
}

function provisionPredecessor(
  resourceFence: TenantResourceFence,
): TenantProvisionPredecessor {
  return {
    schemaVersion: 1,
    generation: resourceFence.generation,
    epoch: 1,
    intent: "provision",
    ownerDeploymentId: resourceFence.ownerDeploymentId,
    operationHash: "e".repeat(64),
    marker:
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
      `_g${resourceFence.generation}_e1`,
  };
}

function cleanupExternalFence(
  resourceFence: TenantResourceFence,
): TenantExternalOperationFence {
  return {
    schemaVersion: 1,
    resourceFence,
    epoch: 2,
    intent: "cleanup",
    ownerDeploymentId: resourceFence.ownerDeploymentId,
    operationHash: "f".repeat(64),
    marker:
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
      `_g${resourceFence.generation}_e2`,
    state: "active",
    provisionPredecessor: provisionPredecessor(resourceFence),
  };
}

function phaseOperationId(phase: TenantResourceCleanupPhase): string {
  const token = phase === "workload" ? "1" : phase === "database" ? "2" : "3";
  return `tl_cleanup_${token.repeat(32)}`;
}

function recoverableCleanupRepository(input: {
  externalFence: TenantExternalOperationFence;
  events: string[];
  active?: boolean;
  rejectCompletePhase?: TenantResourceCleanupPhase;
}) {
  const run: TenantResourceCleanupRun = {
    id: "cleanup_run_one",
    externalFence: input.externalFence,
    provisionPredecessor: input.externalFence.provisionPredecessor!,
    ownerDeploymentId: input.externalFence.ownerDeploymentId,
    status: "running",
    nextPhase: "workload",
    phases: {},
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  let finalized = 0;
  const order: TenantResourceCleanupPhase[] = ["workload", "database", "secret"];
  const repository = {
    assertTenantExternalOperation: async ({
      externalFence,
    }: {
      externalFence: TenantExternalOperationFence;
    }) => {
      input.events.push("assert-external");
      return (
        input.active !== false &&
        JSON.stringify(externalFence.provisionPredecessor) ===
          JSON.stringify(run.provisionPredecessor)
      );
    },
    beginOrResumeTenantResourceCleanup: async ({
      provisionPredecessor: predecessorInput,
    }: {
      provisionPredecessor: TenantProvisionPredecessor;
    }) => {
      input.events.push("begin-or-resume");
      assert.deepEqual(predecessorInput, run.provisionPredecessor);
      return run;
    },
    beginTenantResourceCleanupPhase: async ({
      phase,
      provisionPredecessor: predecessorInput,
    }: {
      phase: TenantResourceCleanupPhase;
      provisionPredecessor: TenantProvisionPredecessor;
    }) => {
      input.events.push(`begin:${phase}`);
      assert.deepEqual(predecessorInput, run.provisionPredecessor);
      const existing = run.phases[phase] as
        | TenantResourceCleanupPhaseRecord<typeof phase>
        | undefined;
      if (existing?.status === "succeeded") {
        return {
          outcome: "already_succeeded" as const,
          operationId: existing.operationId,
          receipt: existing.receipt,
          run,
        };
      }
      const record: TenantResourceCleanupPhaseRecord<typeof phase> =
        existing ?? {
          phase,
          status: "running",
          operationId: phaseOperationId(phase),
          receipt: null,
          receiptHash: null,
          attempts: 0,
          startedAt: now,
          updatedAt: now,
          completedAt: null,
        };
      record.attempts += 1;
      Object.assign(run.phases, { [phase]: record });
      return {
        outcome: "execute" as const,
        operationId: record.operationId,
        receipt: null,
        run,
      };
    },
    completeTenantResourceCleanupPhase: async <P extends TenantResourceCleanupPhase>({
      phase,
      operationId,
      receipt,
      provisionPredecessor: predecessorInput,
    }: {
      phase: P;
      operationId: string;
      receipt: TenantResourceCleanupPhaseReceiptMap[P];
      provisionPredecessor: TenantProvisionPredecessor;
    }) => {
      input.events.push(`complete:${phase}`);
      assert.deepEqual(predecessorInput, run.provisionPredecessor);
      if (input.rejectCompletePhase === phase) return null;
      const record = run.phases[phase] as TenantResourceCleanupPhaseRecord<P>;
      assert.equal(record.operationId, operationId);
      record.status = "succeeded";
      record.receipt = receipt;
      record.receiptHash = "e".repeat(64);
      record.completedAt = now;
      const index = order.indexOf(phase);
      run.nextPhase = index === order.length - 1 ? "finalize" : order[index + 1];
      return run;
    },
    finalizeTenantResourceCleanup: async ({
      provisionPredecessor: predecessorInput,
    }: {
      provisionPredecessor: TenantProvisionPredecessor;
    }) => {
      input.events.push("finalize");
      assert.deepEqual(predecessorInput, run.provisionPredecessor);
      if (order.some((phase) => run.phases[phase]?.status !== "succeeded")) {
        return false;
      }
      finalized += 1;
      run.status = "completed";
      run.nextPhase = null;
      run.completedAt ??= now;
      return true;
    },
  } as unknown as DeploymentExecutionRepository;
  return { repository, run, finalized: () => finalized };
}

function cleanupCall(
  resourceFence: TenantResourceFence,
  externalFence: TenantExternalOperationFence,
  signal: AbortSignal = new AbortController().signal,
) {
  return {
    fence: resourceFence,
    externalFence,
    lease: cleanupLease(resourceFence, "job_cleanup"),
    idempotencyKey: "dep_one:cleanup:g1",
    scheduleId: "clean_one",
    appInstanceId: resourceFence.identity.appInstanceId,
    reason: "ttl_cleanup" as const,
    signal,
  };
}

function cleanupAdapters(input: {
  events: string[];
  externalFence: TenantExternalOperationFence;
  failDatabaseOnce?: boolean;
  abortAfterWorkload?: AbortController;
  partialDatabase?: boolean;
}) {
  let databaseFailurePending = input.failDatabaseOnce === true;
  const operationIds: Record<string, string[]> = {};
  const track = (phase: string, operationId: string) => {
    input.events.push(`adapter:${phase}`);
    (operationIds[phase] ??= []).push(operationId);
  };
  return {
    operationIds,
    workload: {
      destroy: async ({
        fence: next,
        externalFence,
        provisionPredecessor: phasePredecessor,
        idempotencyKey,
        signal,
      }: {
        fence: TenantResourceFence;
        externalFence: TenantExternalOperationFence;
        provisionPredecessor: TenantProvisionPredecessor;
        idempotencyKey: string;
        signal: AbortSignal;
      }) => {
        assert.equal(signal.aborted, false);
        assert.deepEqual(
          phasePredecessor,
          input.externalFence.provisionPredecessor,
        );
        track("workload", idempotencyKey);
        input.abortAfterWorkload?.abort();
        return {
          fence: next,
          externalFence,
          outcome: "deleted" as const,
          ownershipMarker: next.ownershipMarker,
        };
      },
    },
    database: {
      destroy: async ({
        fence: next,
        externalFence,
        provisionPredecessor: phasePredecessor,
        idempotencyKey,
      }: {
        fence: TenantResourceFence;
        externalFence: TenantExternalOperationFence;
        provisionPredecessor: TenantProvisionPredecessor;
        idempotencyKey: string;
      }) => {
        assert.deepEqual(
          phasePredecessor,
          input.externalFence.provisionPredecessor,
        );
        track("database", idempotencyKey);
        if (databaseFailurePending) {
          databaseFailurePending = false;
          throw Object.assign(new Error("database task crashed"), { retryable: true });
        }
        return {
          fence: next,
          externalFence,
          outcome: "deleted" as const,
          databaseDeleted: true,
          roleDeleted: !input.partialDatabase,
          evidenceHash,
        };
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {
      destroyRuntimeSecret: async ({
        fence: next,
        externalFence,
        provisionPredecessor: phasePredecessor,
        idempotencyKey,
      }: {
        fence: TenantResourceFence;
        externalFence: TenantExternalOperationFence;
        provisionPredecessor: TenantProvisionPredecessor;
        idempotencyKey: string;
      }) => {
        assert.deepEqual(
          phasePredecessor,
          input.externalFence.provisionPredecessor,
        );
        track("secret", idempotencyKey);
        return {
          fence: next,
          externalFence,
          outcome: "deleted" as const,
          ownershipMarker: next.ownershipMarker,
        };
      },
    } as unknown as TenantSecretStorePort,
  };
}

test("persists each cleanup phase before advancing and finalizes once", async () => {
  const resourceFence = fence(await deriveTenantResourceIdentity(context()));
  const externalFence = cleanupExternalFence(resourceFence);
  const events: string[] = [];
  const state = recoverableCleanupRepository({ externalFence, events });
  const adapters = cleanupAdapters({ events, externalFence });
  const cleanup = new OrderedTenantResourceCleanup({
    ...adapters,
    repository: state.repository,
    now: () => now,
  });
  const receipt = await cleanup.destroy(cleanupCall(resourceFence, externalFence));
  assert.deepEqual(receipt.order, ["workload", "database", "secret"]);
  assert.deepEqual(events, [
    "assert-external",
    "begin-or-resume",
    "begin:workload",
    "adapter:workload",
    "complete:workload",
    "begin:database",
    "adapter:database",
    "complete:database",
    "begin:secret",
    "adapter:secret",
    "complete:secret",
    "finalize",
  ]);
  assert.equal(state.run.status, "completed");
  assert.equal(state.finalized(), 1);
});

test("crash recovery skips a durably completed phase and reuses operation ids", async () => {
  const resourceFence = fence(await deriveTenantResourceIdentity(context()));
  const externalFence = cleanupExternalFence(resourceFence);
  const events: string[] = [];
  const state = recoverableCleanupRepository({ externalFence, events });
  const adapters = cleanupAdapters({
    events,
    externalFence,
    failDatabaseOnce: true,
  });
  const cleanup = new OrderedTenantResourceCleanup({
    ...adapters,
    repository: state.repository,
    now: () => now,
  });
  await assert.rejects(
    cleanup.destroy(cleanupCall(resourceFence, externalFence)),
    /database task crashed/,
  );
  assert.equal(state.run.phases.workload?.status, "succeeded");
  assert.equal(state.run.phases.database?.status, "running");
  await cleanup.destroy(cleanupCall(resourceFence, externalFence));
  assert.equal(adapters.operationIds.workload.length, 1);
  assert.equal(adapters.operationIds.database.length, 2);
  assert.equal(
    adapters.operationIds.database[0],
    adapters.operationIds.database[1],
  );
  assert.equal(adapters.operationIds.secret.length, 1);
});

test("losing the lease after an external result leaves a resumable running phase", async () => {
  const resourceFence = fence(await deriveTenantResourceIdentity(context()));
  const externalFence = cleanupExternalFence(resourceFence);
  const events: string[] = [];
  const state = recoverableCleanupRepository({ externalFence, events });
  const controller = new AbortController();
  const firstAdapters = cleanupAdapters({
    events,
    externalFence,
    abortAfterWorkload: controller,
  });
  const first = new OrderedTenantResourceCleanup({
    ...firstAdapters,
    repository: state.repository,
  });
  await assert.rejects(
    first.destroy(cleanupCall(resourceFence, externalFence, controller.signal)),
    (error: unknown) =>
      (error as { code?: string }).code === "DEPLOYMENT_LEASE_LOST",
  );
  assert.equal(state.run.phases.workload?.status, "running");
  const retryAdapters = cleanupAdapters({ events, externalFence });
  const retry = new OrderedTenantResourceCleanup({
    ...retryAdapters,
    repository: state.repository,
  });
  await retry.destroy(cleanupCall(resourceFence, externalFence));
  assert.equal(
    firstAdapters.operationIds.workload[0],
    retryAdapters.operationIds.workload[0],
  );
});

test("an inactive cleanup epoch makes zero external calls", async () => {
  const resourceFence = fence(await deriveTenantResourceIdentity(context()));
  const externalFence = cleanupExternalFence(resourceFence);
  const events: string[] = [];
  const state = recoverableCleanupRepository({
    externalFence,
    events,
    active: false,
  });
  const adapters = cleanupAdapters({ events, externalFence });
  const cleanup = new OrderedTenantResourceCleanup({
    ...adapters,
    repository: state.repository,
  });
  await assert.rejects(
    cleanup.destroy(cleanupCall(resourceFence, externalFence)),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_CLEANUP_EXTERNAL_EPOCH_INACTIVE",
  );
  assert.deepEqual(adapters.operationIds, {});
});

test("missing, cross-generation, non-provision, and drifting predecessors make zero calls", async () => {
  const resourceFence = fence(await deriveTenantResourceIdentity(context()));
  const valid = cleanupExternalFence(resourceFence);
  const withoutPredecessor = Object.fromEntries(
    Object.entries(valid).filter(([key]) => key !== "provisionPredecessor"),
  ) as unknown as TenantExternalOperationFence;
  const invalidFences: TenantExternalOperationFence[] = [
    withoutPredecessor,
    {
      ...valid,
      provisionPredecessor: {
        ...valid.provisionPredecessor!,
        generation: resourceFence.generation + 1,
      },
    },
    {
      ...valid,
      provisionPredecessor: {
        ...valid.provisionPredecessor!,
        intent: "cleanup",
      } as unknown as TenantProvisionPredecessor,
    },
    {
      ...valid,
      provisionPredecessor: {
        ...valid.provisionPredecessor!,
        operationHash: "0".repeat(64),
      },
    },
  ];

  for (const externalFence of invalidFences) {
    const events: string[] = [];
    const state = recoverableCleanupRepository({ externalFence: valid, events });
    const adapters = cleanupAdapters({ events, externalFence: valid });
    const cleanup = new OrderedTenantResourceCleanup({
      ...adapters,
      repository: state.repository,
    });
    await assert.rejects(
      cleanup.destroy(cleanupCall(resourceFence, externalFence)),
      (error: unknown) =>
        [
          "TENANT_CLEANUP_PROVISION_PREDECESSOR_INVALID",
          "TENANT_CLEANUP_EXTERNAL_EPOCH_INACTIVE",
        ].includes(String((error as { code?: string }).code)),
    );
    assert.equal(events.some((event) => event.startsWith("adapter:")), false);
    assert.deepEqual(adapters.operationIds, {});
  }
});

test("partial database cleanup cannot persist or reach Secret deletion", async () => {
  const resourceFence = fence(await deriveTenantResourceIdentity(context()));
  const externalFence = cleanupExternalFence(resourceFence);
  const events: string[] = [];
  const state = recoverableCleanupRepository({ externalFence, events });
  const adapters = cleanupAdapters({
    events,
    externalFence,
    partialDatabase: true,
  });
  const cleanup = new OrderedTenantResourceCleanup({
    ...adapters,
    repository: state.repository,
  });
  await assert.rejects(
    cleanup.destroy(cleanupCall(resourceFence, externalFence)),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_DATABASE_CLEANUP_PARTIAL",
  );
  assert.equal(state.run.phases.database?.status, "running");
  assert.equal(adapters.operationIds.secret, undefined);
  assert.equal(state.finalized(), 0);
});

function pendingExternalFence(
  resourceFence: TenantResourceFence,
  intent: "provision" | "cleanup",
  epoch: number,
): TenantExternalOperationFence {
  return {
    schemaVersion: 1,
    resourceFence,
    epoch,
    intent,
    ownerDeploymentId: resourceFence.ownerDeploymentId,
    operationHash: "9".repeat(64),
    marker:
      `tl_epoch_${resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
      `_g${resourceFence.generation}_e${epoch}`,
    state: "pending_external",
  };
}

test("external ownership coordinator activates only provider-observed proof", async () => {
  const selectedContext = context();
  const resourceFence = fence(
    await deriveTenantResourceIdentity(selectedContext),
  );
  const events: string[] = [];
  let prepared: TenantExternalOperationFence | null = null;
  const repository = {
    prepareTenantExternalOperation: async (input: {
      operationHash: string;
      intent: "provision" | "cleanup";
    }) => {
      events.push("prepare");
      prepared = {
        ...pendingExternalFence(resourceFence, input.intent, 1),
        operationHash: input.operationHash,
      };
      return { outcome: "created" as const, fence: prepared };
    },
    activateTenantExternalOperation: async ({ proof }: {
      proof: {
        pendingFence: TenantExternalOperationFence;
        evidenceHash: string;
        provisionPredecessor: TenantProvisionPredecessor | null;
      };
    }) => {
      events.push("activate");
      assert.deepEqual(proof.pendingFence, prepared);
      assert.equal(
        proof.evidenceHash,
        await sha256Hex({
          registryMarker: proof.pendingFence.marker,
          provisionPredecessor: null,
        }),
      );
      return { ...proof.pendingFence, state: "active" as const };
    },
    assertTenantExternalOperation: async () => {
      throw new Error("a pending claim must use provider proof");
    },
  } as unknown as DeploymentExecutionRepository;
  const coordinator = new RepositoryTenantExternalOwnershipCoordinator(
    repository,
    {
      installAndObserve: async ({ pendingFence, signal }) => {
        events.push("provider-observe");
        assert.equal(signal.aborted, false);
        assert.deepEqual(pendingFence, prepared);
        const evidence = {
          registryMarker: pendingFence.marker,
          provisionPredecessor: null,
        };
        return {
          schemaVersion: 1 as const,
          pendingFence,
          provisionPredecessor: null,
          evidenceHash: await sha256Hex(evidence),
          evidence,
        };
      },
    },
    () => now,
  );
  const result = await coordinator.prepareAndActivate({
    intent: "provision",
    context: selectedContext,
    resourceFence,
    lease: cleanupLease(resourceFence, selectedContext.job.id),
    signal: new AbortController().signal,
  });
  assert.equal(result.state, "active");
  assert.deepEqual(events, ["prepare", "provider-observe", "activate"]);
});

test("external ownership coordinator reuses an exact active epoch without provider calls", async () => {
  const selectedContext = context();
  const resourceFence = fence(
    await deriveTenantResourceIdentity(selectedContext),
  );
  let active!: TenantExternalOperationFence;
  let providerCalls = 0;
  let assertCalls = 0;
  const coordinator = new RepositoryTenantExternalOwnershipCoordinator(
    {
      prepareTenantExternalOperation: async ({ operationHash }: {
        operationHash: string;
      }) => {
        active = {
          ...pendingExternalFence(resourceFence, "cleanup", 2),
          operationHash,
          state: "active" as const,
          provisionPredecessor: provisionPredecessor(resourceFence),
        };
        return { outcome: "reused" as const, fence: active };
      },
      assertTenantExternalOperation: async ({ externalFence }: {
        externalFence: TenantExternalOperationFence;
      }) => {
        assertCalls += 1;
        return externalFence === active;
      },
    } as unknown as DeploymentExecutionRepository,
    {
      installAndObserve: async () => {
        providerCalls += 1;
        throw new Error("active epoch must not be reinstalled");
      },
    },
    () => now,
  );
  const result = await coordinator.prepareAndActivate({
    intent: "cleanup",
    cleanupReason: "ttl_cleanup",
    context: selectedContext,
    resourceFence,
    lease: cleanupLease(resourceFence, selectedContext.job.id),
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, active);
  assert.equal(assertCalls, 1);
  assert.equal(providerCalls, 0);
});

test("cleanup reason changes reuse the same immutable cleanup epoch", async () => {
  const selectedContext = context();
  const resourceFence = fence(
    await deriveTenantResourceIdentity(selectedContext),
  );
  let current: TenantExternalOperationFence | null = null;
  const preparedHashes: string[] = [];
  let providerCalls = 0;
  const repository = {
    prepareTenantExternalOperation: async ({ operationHash }: {
      operationHash: string;
    }) => {
      preparedHashes.push(operationHash);
      if (current?.operationHash === operationHash) {
        return { outcome: "reused" as const, fence: current };
      }
      current = {
        ...pendingExternalFence(resourceFence, "cleanup", 2),
        operationHash,
      };
      return { outcome: "created" as const, fence: current };
    },
    activateTenantExternalOperation: async ({ proof }: {
      proof: {
        pendingFence: TenantExternalOperationFence;
        provisionPredecessor: TenantProvisionPredecessor | null;
      };
    }) => {
      current = {
        ...proof.pendingFence,
        state: "active" as const,
        provisionPredecessor: proof.provisionPredecessor ?? undefined,
      };
      return current;
    },
    assertTenantExternalOperation: async () => true,
  } as unknown as DeploymentExecutionRepository;
  const coordinator = new RepositoryTenantExternalOwnershipCoordinator(
    repository,
    {
      installAndObserve: async ({ pendingFence }) => {
        providerCalls += 1;
        const predecessor = provisionPredecessor(resourceFence);
        const evidence = {
          registryMarker: pendingFence.marker,
          provisionPredecessor: predecessor,
        };
        return {
          schemaVersion: 1 as const,
          pendingFence,
          provisionPredecessor: predecessor,
          evidenceHash: await sha256Hex(evidence),
          evidence,
        };
      },
    },
    () => now,
  );
  const shared = {
    intent: "cleanup" as const,
    context: selectedContext,
    resourceFence,
    lease: cleanupLease(resourceFence, selectedContext.job.id),
    signal: new AbortController().signal,
  };

  const rollback = await coordinator.prepareAndActivate({
    ...shared,
    cleanupReason: "rollback",
  });
  const ttl = await coordinator.prepareAndActivate({
    ...shared,
    cleanupReason: "ttl_cleanup",
  });

  assert.equal(rollback.operationHash, ttl.operationHash);
  assert.equal(rollback.epoch, ttl.epoch);
  assert.deepEqual(preparedHashes, [rollback.operationHash, rollback.operationHash]);
  assert.equal(providerCalls, 1);
});

test("Neon ownership SQL fences lifecycle and job intent before epoch mutation", async () => {
  const source = await readFile(
    new URL("../lib/deployments/execution/neon-repository.ts", import.meta.url),
    "utf8",
  );
  const prepare = source.slice(
    source.indexOf("async prepareTenantExternalOperation"),
    source.indexOf("async activateTenantExternalOperation"),
  );
  const activate = source.slice(
    source.indexOf("async activateTenantExternalOperation"),
    source.indexOf("async assertTenantExternalOperation"),
  );
  const assertion = source.slice(
    source.indexOf("async assertTenantExternalOperation"),
    source.indexOf("async beginTenantResourceCleanup"),
  );
  const resumableCleanup = source.slice(
    source.indexOf("async beginOrResumeTenantResourceCleanup"),
    source.length,
  );

  for (const operation of [prepare, activate]) {
    assert.match(operation, /lifecycle_status NOT IN \('destroying', 'destroyed'\)/);
    assert.match(operation, /job\.job_type IN \('apply', 'reconcile'\)/);
    assert.match(operation, /job\.job_type IN \('cleanup', 'rollback'\)/);
    assert.match(operation, /active_cleanup_conflict/);
  }
  assert.match(assertion, /lifecycle_status NOT IN \('destroying', 'destroyed'\)/);
  assert.match(assertion, /job\.job_type IN \('apply', 'reconcile'\)/);
  assert.match(assertion, /job\.job_type IN \('cleanup', 'rollback'\)/);
  assert.equal(
    (resumableCleanup.match(/job\.job_type IN \('cleanup', 'rollback'\)/g) ?? [])
      .length,
    4,
  );
  assert.match(
    resumableCleanup,
    /phase\.phase <> selected\.phase[\s\S]*?UNION ALL[\s\S]*?SELECT selected\.run_id/,
  );
  assert.match(
    resumableCleanup,
    /phase\.phase <> completed\.phase[\s\S]*?UNION ALL[\s\S]*?SELECT completed\.run_id/,
  );
  assert.equal(
    (
      resumableCleanup.match(
        /operation\.evidence::jsonb -> 'provisionPredecessor'/g,
      ) ?? []
    ).length,
    4,
  );
});

test("a reclaimed active cleanup fence reloads its predecessor from persisted authority evidence", async () => {
  const selectedContext = context();
  const resourceFence = fence(
    await deriveTenantResourceIdentity(selectedContext),
  );
  const expected = cleanupExternalFence(resourceFence);
  const persistedEvidence = {
    provisionPredecessor: expected.provisionPredecessor,
  };
  const repository = new NeonDeploymentExecutionRepository(
    "postgresql://offline:offline@offline.invalid/never_contacted?sslmode=require",
  );
  (
    repository as unknown as {
      sql: { query: () => Promise<{ rows: Record<string, unknown>[] }> };
    }
  ).sql = {
    query: async () => ({
      rows: [
        {
          external_epoch: expected.epoch,
          external_intent: expected.intent,
          external_owner_deployment_id: expected.ownerDeploymentId,
          external_operation_hash: expected.operationHash,
          external_marker: expected.marker,
          external_state: expected.state,
          external_evidence_hash: await sha256Hex(persistedEvidence),
          external_evidence: persistedEvidence,
          claim_outcome: "reused",
          lease_owned: true,
          pending_conflict: false,
          active_cleanup_conflict: false,
        },
      ],
    }),
  };

  const claim = await repository.prepareTenantExternalOperation({
    lease: cleanupLease(resourceFence, selectedContext.job.id),
    resourceFence,
    intent: "cleanup",
    operationHash: expected.operationHash,
    now,
  });
  assert.equal(claim.outcome, "reused");
  assert.deepEqual(
    claim.fence.provisionPredecessor,
    expected.provisionPredecessor,
  );
});

test("cleanup resume rejects a succeeded phase with a corrupted receipt hash", async () => {
  const selectedContext = context();
  const resourceFence = fence(
    await deriveTenantResourceIdentity(selectedContext),
  );
  const externalFence = cleanupExternalFence(resourceFence);
  const repository = new NeonDeploymentExecutionRepository(
    "postgresql://offline:offline@offline.invalid/never_contacted?sslmode=require",
  );
  (
    repository as unknown as {
      sql: { query: () => Promise<{ rows: Record<string, unknown>[] }> };
    }
  ).sql = {
    query: async () => ({
      rows: [
        {
          cleanup_run_id: "tlcr_offline_hash_test",
          cleanup_run_owner_deployment_id: resourceFence.ownerDeploymentId,
          cleanup_run_status: "running",
          cleanup_run_next_phase: "database",
          cleanup_run_created_at: now,
          cleanup_run_updated_at: now,
          cleanup_run_completed_at: null,
          cleanup_run_phases: {
            workload: {
              status: "succeeded",
              operationId: `tl_cleanup_${"a".repeat(32)}`,
              receipt: {
                outcome: "deleted",
                ownershipMarker: resourceFence.ownershipMarker,
              },
              receiptHash: "0".repeat(64),
              attempts: 1,
              startedAt: now,
              updatedAt: now,
              completedAt: now,
            },
          },
        },
      ],
    }),
  };

  await assert.rejects(
    repository.beginOrResumeTenantResourceCleanup({
      lease: cleanupLease(resourceFence, selectedContext.job.id),
      externalFence,
      provisionPredecessor: externalFence.provisionPredecessor!,
      now,
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_RESOURCE_CLEANUP_RECEIPT_INVALID",
  );
});

test("an aborted ownership handoff makes zero repository and provider calls", async () => {
  const selectedContext = context();
  const resourceFence = fence(
    await deriveTenantResourceIdentity(selectedContext),
  );
  let calls = 0;
  const coordinator = new RepositoryTenantExternalOwnershipCoordinator(
    {
      prepareTenantExternalOperation: async () => {
        calls += 1;
        throw new Error("must not run");
      },
    } as unknown as DeploymentExecutionRepository,
    {
      installAndObserve: async () => {
        calls += 1;
        throw new Error("must not run");
      },
    },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    coordinator.prepareAndActivate({
      intent: "provision",
      context: selectedContext,
      resourceFence,
      lease: cleanupLease(resourceFence, selectedContext.job.id),
      signal: controller.signal,
    }),
    (error: unknown) => (error as { name?: string }).name === "AbortError",
  );
  assert.equal(calls, 0);
});
