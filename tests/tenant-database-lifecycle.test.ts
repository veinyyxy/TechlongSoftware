import assert from "node:assert/strict";
import test from "node:test";
import { OrderedTenantResourceCleanup } from "../lib/deployments/execution/cleanup.ts";
import type {
  DeploymentExecutionContext,
  DeploymentTenantResourceLifecycleStatus,
  TenantApprovedBaseline,
  TenantDatabaseInspection,
  TenantDatabaseLifecyclePort,
  TenantDatabaseMutationReceipt,
  TenantResourceCleanupFencePort,
  TenantResourceFence,
  TenantResourceIdentity,
  TenantSecretInspection,
  TenantSecretStorePort,
} from "../lib/deployments/execution/contracts.ts";
import {
  deriveTenantOwnershipMarker,
  deriveTenantResourceIdentity,
  GuardedTenantDatabasePort,
} from "../lib/deployments/execution/tenant-database.ts";
import { AwsEcsCellPlanOnlyDriver } from "../lib/deployments/drivers/aws-ecs-cell.ts";
import type { DeploymentEnvironment } from "../lib/deployments/environment.ts";

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
    state,
    secretRef:
      state === "present"
        ? `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${resourceFence.identity.secretName}-abcdef`
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
    prepareEmptyDatabase: async ({ fence: next, runtimeSecretRef }) => {
      events.push("prepare");
      assert.match(runtimeSecretRef, /^arn:aws:secretsmanager:/);
      databaseState = "empty";
      return mutation(next, "prepare_empty_database", "empty");
    },
    restoreApprovedBaseline: async ({ fence: next, baseline: selected }) => {
      events.push("baseline");
      assert.equal(selected.approvedArchiveSha256, baselineDigest);
      databaseState = "baseline_restored";
      return mutation(next, "restore_approved_baseline", "baseline_restored");
    },
    migrateSaas: async ({ fence: next, command, migrationContract }) => {
      events.push("saas");
      assert.equal(command, "/usr/local/bin/node db/apply_saas_control.js");
      assert.equal(migrationContract, "speedfeast-saas-control-v1");
      databaseState = "saas_migrated";
      return mutation(next, "migrate_saas", "saas_migrated");
    },
    verify: async ({ fence: next }) => {
      events.push("verify");
      databaseState = "verified";
      return mutation(next, "verify", "verified");
    },
    destroy: async ({ fence: next }) => ({
      fence: next,
      outcome: "deleted",
      databaseDeleted: true,
      roleDeleted: true,
      evidenceHash,
    }),
  };
  const secrets: TenantSecretStorePort = {
    inspectRuntimeSecret: async ({ fence: next }) => {
      events.push(`secret-inspect:${secretState}:g${next.generation}`);
      return secretInspection(next, secretState);
    },
    ensureRuntimeSecret: async ({ fence: next }) => {
      events.push("secret-create");
      secretState = "present";
      const observed = secretInspection(next, "present");
      return {
        fence: next,
        outcome: "created",
        secretRef: observed.secretRef!,
        ownershipMarker: next.ownershipMarker,
        versionRef: observed.versionRef!,
      };
    },
    destroyRuntimeSecret: async ({ fence: next }) => ({
      fence: next,
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
    idempotencyKey: "dep_one:database",
  });
  assert.equal(prepared.lifecycleState, "empty");
  assert.equal(prepared.resourceGeneration, 1);
  assert.equal(prepared.resourceOwnerDeploymentId, "dep_one");
  assert.equal(JSON.stringify(prepared).includes("password"), false);

  const migrated = await guarded.migrateTenantDatabase({
    context: claimed,
    idempotencyKey: "dep_one:migration:v1",
  });
  assert.equal(migrated.lifecycleState, "verified");
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
      idempotencyKey: "dep_one:database",
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "TENANT_RESOURCE_GENERATION_UNCLAIMED",
  );
  assert.equal(calls, 0);
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
      idempotencyKey: "dep_one:database",
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
    idempotencyKey: "dep_one:database",
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
      idempotencyKey: "dep_one:database",
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
      idempotencyKey: "dep_one:database",
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
      idempotencyKey: "dep_one:database",
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
      idempotencyKey: "dep_one:migration:v1",
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_BASELINE_NOT_APPROVED",
  );
  assert.equal(adapterCalls, 0);
});

function cleanupFences(
  expected: TenantResourceFence,
  events: string[],
  input: { begin?: boolean; loseAt?: string } = {},
): TenantResourceCleanupFencePort {
  return {
    beginTenantResourceCleanup: async ({ fence: requested }) => {
      events.push("begin");
      assert.deepEqual(requested, expected);
      return input.begin === false ? null : expected;
    },
    assertTenantResourceCleanupFence: async ({ fence: requested, phase }) => {
      events.push(`assert:${phase}`);
      assert.deepEqual(requested, expected);
      return input.loseAt !== phase;
    },
    completeTenantResourceCleanup: async ({ fence: requested, receipt }) => {
      events.push("complete");
      assert.deepEqual(requested, expected);
      assert.deepEqual(receipt.fence, expected);
      return true;
    },
  };
}

test("fences cleanup before every external step and completes the same generation", async () => {
  const identity = await deriveTenantResourceIdentity(context());
  const resourceFence = fence(identity);
  const events: string[] = [];
  let retry = false;
  const cleanup = new OrderedTenantResourceCleanup({
    workload: {
      destroy: async ({ fence: next }) => {
        events.push("workload");
        return {
          fence: next,
          outcome: retry ? "already_missing" : "deleted",
          ownershipMarker: next.ownershipMarker,
        };
      },
    },
    database: {
      destroy: async ({ fence: next }: { fence: TenantResourceFence }) => {
        events.push("database");
        return {
          fence: next,
          outcome: retry ? "already_missing" : "deleted",
          databaseDeleted: !retry,
          roleDeleted: !retry,
          evidenceHash,
        };
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {
      destroyRuntimeSecret: async ({ fence: next }: { fence: TenantResourceFence }) => {
        events.push("secret");
        return {
          fence: next,
          outcome: retry ? "already_missing" : "deleted",
          ownershipMarker: next.ownershipMarker,
        };
      },
    } as unknown as TenantSecretStorePort,
    fences: cleanupFences(resourceFence, events),
    now: () => now,
  });
  const call = () =>
    cleanup.destroy({
      fence: resourceFence,
      jobId: "job_cleanup",
      workerId: "worker_one",
      idempotencyKey: "dep_one:cleanup:g1",
    });
  const first = await call();
  retry = true;
  const second = await call();
  assert.deepEqual(first.order, ["workload", "database", "secret"]);
  assert.equal(second.secretOutcome, "already_missing");
  const once = [
    "begin",
    "assert:before_workload",
    "workload",
    "assert:before_database",
    "database",
    "assert:before_secret",
    "secret",
    "assert:before_complete",
    "complete",
  ];
  assert.deepEqual(events, [...once, ...once]);
});

test("a stale cleanup fence makes zero external calls", async () => {
  const identity = await deriveTenantResourceIdentity(context());
  const staleFence = fence(identity, 1, "dep_old");
  let externalCalls = 0;
  const cleanup = new OrderedTenantResourceCleanup({
    workload: {
      destroy: async () => {
        externalCalls += 1;
        throw new Error("must not run");
      },
    },
    database: {} as TenantDatabaseLifecyclePort,
    secrets: {} as TenantSecretStorePort,
    fences: cleanupFences(staleFence, [], { begin: false }),
  });
  await assert.rejects(
    cleanup.destroy({
      fence: staleFence,
      jobId: "job_old_cleanup",
      workerId: "worker_one",
      idempotencyKey: "dep_old:cleanup:g1",
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_CLEANUP_FENCE_REJECTED",
  );
  assert.equal(externalCalls, 0);
});

test("losing the fence after workload stops database and secret deletion", async () => {
  const identity = await deriveTenantResourceIdentity(context());
  const resourceFence = fence(identity);
  let workloadCalls = 0;
  let databaseCalls = 0;
  let secretCalls = 0;
  const cleanup = new OrderedTenantResourceCleanup({
    workload: {
      destroy: async ({ fence: next }) => {
        workloadCalls += 1;
        return {
          fence: next,
          outcome: "deleted",
          ownershipMarker: next.ownershipMarker,
        };
      },
    },
    database: {
      destroy: async () => {
        databaseCalls += 1;
        throw new Error("must not run");
      },
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {
      destroyRuntimeSecret: async () => {
        secretCalls += 1;
        throw new Error("must not run");
      },
    } as unknown as TenantSecretStorePort,
    fences: cleanupFences(resourceFence, [], { loseAt: "before_database" }),
  });
  await assert.rejects(
    cleanup.destroy({
      fence: resourceFence,
      jobId: "job_cleanup",
      workerId: "worker_one",
      idempotencyKey: "dep_one:cleanup:g1",
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_CLEANUP_FENCE_LOST",
  );
  assert.equal(workloadCalls, 1);
  assert.equal(databaseCalls, 0);
  assert.equal(secretCalls, 0);
});

test("never deletes a secret or completes after partial database cleanup", async () => {
  const identity = await deriveTenantResourceIdentity(context());
  const resourceFence = fence(identity);
  let secretCalls = 0;
  let completeCalls = 0;
  const fencePort = cleanupFences(resourceFence, []);
  const cleanup = new OrderedTenantResourceCleanup({
    workload: {
      destroy: async ({ fence: next }) => ({
        fence: next,
        outcome: "deleted",
        ownershipMarker: next.ownershipMarker,
      }),
    },
    database: {
      destroy: async ({ fence: next }: { fence: TenantResourceFence }) => ({
        fence: next,
        outcome: "deleted",
        databaseDeleted: true,
        roleDeleted: false,
        evidenceHash,
      }),
    } as unknown as TenantDatabaseLifecyclePort,
    secrets: {
      destroyRuntimeSecret: async () => {
        secretCalls += 1;
        throw new Error("must not run");
      },
    } as unknown as TenantSecretStorePort,
    fences: {
      ...fencePort,
      completeTenantResourceCleanup: async () => {
        completeCalls += 1;
        return true;
      },
    },
  });
  await assert.rejects(
    cleanup.destroy({
      fence: resourceFence,
      jobId: "job_cleanup",
      workerId: "worker_one",
      idempotencyKey: "dep_one:cleanup:g1",
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "TENANT_DATABASE_CLEANUP_PARTIAL",
  );
  assert.equal(secretCalls, 0);
  assert.equal(completeCalls, 0);
});
