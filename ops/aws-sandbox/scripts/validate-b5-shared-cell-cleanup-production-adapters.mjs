import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..", "..");
const read = (relative) =>
  readFile(path.join(repositoryRoot, relative), "utf8");

const [
  stackCollector,
  zeroTenantCollector,
  neonSource,
  deletionAdapter,
  deletionZeroTenant,
  grantAdapter,
  runtime,
  janitor,
  childTemplateSource,
  wrapper,
] = await Promise.all([
  read("lib/deployments/execution/aws-sdk-shared-cell-cleanup-stack-evidence.ts"),
  read("lib/deployments/execution/shared-cell-zero-tenant-evidence.ts"),
  read("lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts"),
  read("lib/deployments/execution/aws-sdk-shared-cell-cleanup-deletion.ts"),
  read("lib/deployments/execution/shared-cell-cleanup-deletion-zero-tenant.ts"),
  read("lib/deployments/execution/aws-sdk-shared-cell-cleanup-authority-grant.ts"),
  read("lib/deployments/execution/runtime-composition.ts"),
  read("ops/aws-sandbox/lambda/cell-janitor.cjs"),
  read("ops/aws-sandbox/cloudformation/s3-b5-cell-bootstrap.template.json"),
  read("ops/aws-sandbox/scripts/s3-b5-shared-cell-cleanup-production-adapters.ps1"),
]);

function includesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} is missing ${value}`);
  }
}

includesAll(
  stackCollector,
  [
    "AwsSdkSharedCellCleanupStackEvidenceAdapter",
    "createAwsSdkSharedCellCleanupStackEvidenceAdapterFromModules",
    "createAwsSdkSharedCellCleanupStackEvidenceAdapter",
    "TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator",
    "techlong-sandbox-cell-operator",
    "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev",
    "TechlongSandboxCellCloudFormationExecutionRole",
    "ignoreConfiguredEndpointUrls: true",
    'TemplateStage: "Original"',
    "listStackResources",
    "markVerified",
    "maximumEvidenceAgeMs = 30_000",
  ],
  "cleanup Stack collector",
);
assert.doesNotMatch(stackCollector, /DeleteStackCommand|PutCommand|UpdateCommand/);

includesAll(
  zeroTenantCollector,
  [
    'isolationLevel: "Serializable"',
    "readonly readOnly: true",
    "readonly deferrable: true",
    "readSerializableReadOnlySnapshot",
    "neon_serializable_zero_tenant_snapshot_source_not_wired",
    "SHARED_CELL_ZERO_TENANT_NOT_ZERO",
    "markVerified",
  ],
  "zero-tenant evidence collector",
);

includesAll(
  neonSource,
  [
    "transaction_timestamp()",
    'isolationLevel: "Serializable"',
    "readOnly: true",
    "deferrable: true",
    "deployment_environment_capacity_reservations",
    "deployment_tenant_resources",
    "deployment_cleanup_schedules",
    "instance.status IN ('pending', 'active')",
    "deployment.status NOT IN ('rolled_back', 'canceled')",
    "resource.lifecycle_status <> 'destroyed'",
    "schedule.status NOT IN ('succeeded', 'canceled')",
  ],
  "Neon ownership source",
);
assert.doesNotMatch(
  neonSource,
  /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i,
);

includesAll(
  deletionAdapter,
  [
    "SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES",
    'TemplateStage: "Original"',
    'proof: "NAME_BOUND_VALIDATION_ERROR"',
    "AwsSdkSharedCellCleanupDeleteStackAdapter",
    'DeletionMode: "STANDARD"',
    "DeleteStackCommand",
    "createAwsSdkSharedCellCleanupDeletionRuntimeFromModules",
    "ignoreConfiguredEndpointUrls: true",
  ],
  "AWS cleanup deletion adapter",
);
assert.ok(!deletionAdapter.match(/SHARED_CELL_CLEANUP_ACTIVE_STACK_STATUSES[\s\S]{0,1000}"DELETE_COMPLETE"/));
assert.doesNotMatch(deletionAdapter, /RetainResources\s*:/);

includesAll(
  deletionZeroTenant,
  [
    "SerializableSharedCellCleanupDeletionZeroTenantAdapter",
    "sourceSnapshotSha256",
    "activeTenantCount",
    "activeCapacityReservationCount",
    "nonterminalDeploymentCount",
    "liveTenantResourceCount",
    "nonterminalTenantCleanupScheduleCount",
  ],
  "deletion zero-tenant projection",
);

includesAll(
  grantAdapter,
  [
    "extends GrantBoundSharedCellCleanupAuthorityCasPort",
    "expectedPredecessorItemSha256",
    "approvedCandidateItemSha256",
    "SHARED_CELL_CLEANUP_GRANT_EXPIRED",
    "SharedCellCleanupAuthorityStrongReadView",
  ],
  "grant-bound cleanup authority adapter",
);

includesAll(
  runtime,
  [
    'mode: "offline_only" as const',
    "applyRuntimeReady: false as const",
    "cleanupRuntimeReady: false as const",
    '"shared_cell_cleanup_authority_writer_missing"',
  ],
  "default runtime",
);
assert.doesNotMatch(
  runtime,
  /aws-sdk-shared-cell-cleanup|neon-shared-cell-zero-tenant/,
);
includesAll(
  janitor,
  [
    'const PLAN_ACTION = "inspect_cell_cleanup_plan"',
    'const DELETE_INTENT_ACTION = "delete_shared_cell_stack"',
    'const PLAN_ONLY_MODE = "PLAN_ONLY"',
  ],
  "reviewed Janitor target",
);
assert.match(
  janitor,
  /exactKeys\(event, \["action", "cellId", "schemaVersion", "stackName"\]\)/,
);
assert.doesNotMatch(janitor, /DeleteStackCommand|PutCommand|UpdateCommand/);
const child = JSON.parse(childTemplateSource);
assert.equal(child.Metadata.SafetyBoundary.CoordinatorMode, "PLAN_ONLY");
assert.equal(child.Metadata.SafetyBoundary.CellDeletionAllowed, false);
assert.equal(
  child.Resources.CellGlobalJanitorSchedule.Properties.State,
  "DISABLED",
);

assert.match(wrapper, /\[ValidateSet\('LocalValidate'\)\]/);
assert.doesNotMatch(
  wrapper,
  /\baws(?:\.exe)?\b|DeleteStack|PutItem|CreateChangeSet|ExecuteChangeSet/i,
);

const tests = spawnSync(
  process.execPath,
  [
    "--experimental-loader",
    "./tests/cloudflare-loader.mjs",
    "--test",
    "tests/aws-sdk-shared-cell-cleanup-authority-grant.test.ts",
    "tests/aws-sdk-shared-cell-cleanup-deletion.test.ts",
    "tests/neon-shared-cell-zero-tenant-source.test.ts",
    "tests/shared-cell-cleanup-deletion-zero-tenant.test.ts",
    "tests/shared-cell-cleanup-evidence-adapters.test.ts",
  ],
  { cwd: repositoryRoot, encoding: "utf8" },
);
assert.equal(
  tests.status,
  0,
  `J5g-c production adapter tests failed.\n${tests.stdout}\n${tests.stderr}`,
);

console.log(
  "B5-J5g-c production cleanup adapters validated locally (real SDK/Neon shapes, default-off, delete-intent-compatible PLAN_ONLY target, no provider call).",
);
