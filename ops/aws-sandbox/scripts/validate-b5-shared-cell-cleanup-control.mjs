import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const paths = {
  authorityOperator: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-cleanup-authority-operator.ts",
  ),
  deletion: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-cleanup-deletion.ts",
  ),
  authorityTest: path.join(
    repositoryRoot,
    "tests/shared-cell-cleanup-authority-operator.test.ts",
  ),
  deletionTest: path.join(
    repositoryRoot,
    "tests/shared-cell-cleanup-deletion.test.ts",
  ),
  runtime: path.join(
    repositoryRoot,
    "lib/deployments/execution/runtime-composition.ts",
  ),
  janitor: path.join(repositoryRoot, "ops/aws-sandbox/lambda/cell-janitor.cjs"),
  bootstrap: path.join(
    repositoryRoot,
    "ops/aws-sandbox/cloudformation/s3-b5-cell-bootstrap.template.json",
  ),
  wrapper: path.join(
    scriptDirectory,
    "s3-b5-shared-cell-cleanup-control.ps1",
  ),
};

const [
  authorityOperator,
  deletion,
  authorityTest,
  deletionTest,
  runtime,
  janitor,
  bootstrapSource,
  wrapper,
] = await Promise.all(Object.values(paths).map((value) => readFile(value, "utf8")));
const bootstrap = JSON.parse(bootstrapSource);

function assertIncludesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} is missing ${value}`);
  }
}

assert.match(wrapper, /\[ValidateSet\('LocalValidate'\)\]/);
assert.match(wrapper, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(wrapper, /validate-b5-shared-cell-cleanup-control\.mjs/);
assert.match(wrapper, /LOCAL_ONLY_DORMANT_PLAN_ONLY_JANITOR_NOT_CLEANUP_READY/);
assert.match(wrapper, /No cloud API was called; this wrapper exposes no online mode\./);
assert.doesNotMatch(wrapper, /\baws(?:\.exe)?\b/i);
assert.doesNotMatch(
  wrapper,
  /CreateChangeSet|ExecuteChangeSet|DeleteStack|PutItem|UpdateSchedule|CreateSchedule/,
);

assertIncludesAll(
  authorityOperator,
  [
    'from "./shared-cell-cleanup-authority.ts"',
    "advanceSharedCellCleanupAuthority",
    "compileSharedCellCleanupAuthorityCandidateItem",
    "const maximumEvidenceAgeMs = 30_000",
    "const verifiedStackEvidence = new WeakSet<object>()",
    "const verifiedZeroTenantEvidence = new WeakSet<object>()",
    "const grantBoundCasPorts = new WeakSet<object>()",
    "export abstract class SharedCellCleanupStackEvidencePort",
    "export abstract class SharedCellZeroTenantEvidencePort",
    "export abstract class GrantBoundSharedCellCleanupAuthorityCasPort",
    "export interface StrongReadSharedCellCleanupAuthorityPort",
    "export async function inspectSharedCellCleanupAuthorityCandidate",
    "export async function executeReviewedSharedCellCleanupAuthorityAdvance",
    "export async function recoverReviewedSharedCellCleanupAuthorityAdvance",
    "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
    'fromState: "provision_verified"',
    'toState: "cleanup_authorized"',
    "deletionPerformed: false as const",
  ],
  "cleanup-authority operator",
);
for (const zeroCount of [
  "activeTenantCount",
  "activeCapacityReservationCount",
  "nonterminalDeploymentCount",
  "liveTenantResourceCount",
  "nonterminalTenantCleanupScheduleCount",
]) {
  assert.match(
    authorityOperator,
    new RegExp(`value\\.${zeroCount} !== 0`),
    `cleanup-authority operator does not require zero ${zeroCount}`,
  );
}
assert.match(
  authorityOperator,
  /input\.now - oldest > maximumEvidenceAgeMs/,
);
assert.match(authorityOperator, /cellExpiry > input\.now/);
assert.match(authorityOperator, /oldest < cellExpiry/);
assert.match(
  authorityOperator,
  /candidate\.candidateItemSha256 !== approvedCandidateItemSha256/,
);
assert.match(
  authorityOperator,
  /writer\.grant\.expectedPredecessorItemSha256 !==[\s\S]*?candidate\.predecessor\.itemSha256/,
);
assert.match(
  authorityOperator,
  /const readback = await authority\.observe\([\s\S]*?validateSharedCellCleanupAuthorityItem/,
);
const authorityRecovery = authorityOperator.slice(
  authorityOperator.indexOf(
    "export async function recoverReviewedSharedCellCleanupAuthorityAdvance",
  ),
);
assert.doesNotMatch(
  authorityRecovery,
  /readVerifiedCleanupStackEvidence|readVerifiedZeroTenantEvidence|compareAndSet|assertSharedCellCleanupAuthorityActive/,
);
assert.doesNotMatch(authorityOperator, /@aws-sdk\//);
assert.doesNotMatch(authorityOperator, /DeleteStackCommand|deleteStack\s*\(/);

assertIncludesAll(
  deletion,
  [
    'SHARED_CELL_CLEANUP_DELETION_ACCOUNT_ID = "402010193138"',
    'SHARED_CELL_CLEANUP_DELETION_REGION = "ca-central-1"',
    '"techlong-sandbox-cell-sandbox-1" as const',
    "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole",
    '"TechlongSandboxCellJanitorExecutionRole" as const',
    "export interface SharedCellCleanupDeletionEvidenceReadPort",
    "readStrongZeroTenantOwnershipSnapshot",
    "export interface StrongSharedCellCleanupAuthorityReadPort",
    "export interface SharedCellCleanupDeleteStackPort",
    "export async function inspectSharedCellCleanupDeletion",
    "export async function executeReviewedSharedCellCleanupDeletion",
    "export async function recoverReviewedSharedCellCleanupDeletion",
    'action: "delete_shared_cell_stack"',
    "const verifiedCycles = new WeakSet<object>()",
    "clientRequestToken: `cell-delete-${deletionPlanSha256}`",
    "zeroTenantSourceSnapshotSha256",
    'DeletionMode: "STANDARD"',
    'stack.stackStatus === "DELETE_FAILED"',
    'stack.stackStatus === "ROLLBACK_FAILED"',
  ],
  "cleanup deletion contract",
);
assert.match(
  deletion,
  /assumed-role\\\/TechlongSandboxCellJanitorExecutionRole/,
);
assert.doesNotMatch(deletion, /TechlongSandboxProvisionerRole/);
assert.doesNotMatch(deletion, /TechlongSandboxCellOperatorRole/);
assert.doesNotMatch(deletion, /@aws-sdk\//);
assert.doesNotMatch(deletion, /compareAndSet|PutCommand|UpdateCommand/);
for (const emptySource of [
  "activeTenantIds",
  "activeCapacityReservationIds",
  "nonterminalDeploymentIds",
  "liveTenantResourceIds",
  "nonterminalTenantCleanupScheduleIds",
]) {
  assert.ok(
    deletion.includes(`sourceRecord.${emptySource}`),
    `cleanup deletion does not include ${emptySource} in the verified source lists`,
  );
}
assert.match(
  deletion,
  /sourceLists\.some\(\(value\) => !Array\.isArray\(value\) \|\| value\.length !== 0\)/,
);
assert.match(deletion, /sha256Hex\(source\)[\s\S]*?sourceSnapshotSha256/);
assert.match(
  deletion,
  /const first = await readPresentEvidence[\s\S]*?const second = await readPresentEvidence/,
);
assert.match(
  deletion,
  /const firstNames = await collectStackNames[\s\S]*?const finalNames = await collectStackNames/,
);
assert.match(
  deletion,
  /const authorityBefore = await readStrongAuthority[\s\S]*?const authorityAfter = await readStrongAuthority/,
);
assert.match(
  deletion,
  /const zeroTenantBefore = await readZeroTenantOwnership[\s\S]*?const zeroTenantAfter = await readZeroTenantOwnership/,
);
assert.match(
  deletion,
  /Number\(record\(raw\)\.observedAt\) < cellExpiry/,
);
const destructiveBoundary = deletion.slice(
  deletion.indexOf("async function immediateRecheck"),
  deletion.indexOf("async function defaultWait"),
);
assert.match(
  destructiveBoundary,
  /const zeroTenantBefore = await readZeroTenantOwnership[\s\S]*?const zeroTenantAfter = await readZeroTenantOwnership/,
);
assert.match(
  deletion,
  /await immediateRecheck\([\s\S]*?await deleter\.deleteStack\(/,
);
assert.match(
  deletion,
  /RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN/,
);
assert.match(
  deletion,
  /responseLost = true[\s\S]*?confirmAuthoritativeMissing/,
);
const deletionRecovery = deletion.slice(
  deletion.indexOf("export async function recoverReviewedSharedCellCleanupDeletion"),
);
assert.doesNotMatch(deletionRecovery, /\.deleteStack\s*\(/);

assert.equal(
  bootstrap.Metadata.SafetyBoundary.CoordinatorMode,
  "PLAN_ONLY",
);
assert.equal(bootstrap.Metadata.SafetyBoundary.CellDeletionAllowed, false);
assert.equal(bootstrap.Metadata.SafetyBoundary.AuthorityReadOnly, true);
assert.equal(
  bootstrap.Resources.CellGlobalJanitorSchedule.Properties.State,
  "DISABLED",
);
assert.equal(
  JSON.parse(
    bootstrap.Resources.CellGlobalJanitorSchedule.Properties.Target.Input,
  ).action,
  "inspect_cell_cleanup_plan",
);
assert.match(janitor, /const PLAN_ACTION = "inspect_cell_cleanup_plan"/);
assert.match(janitor, /const PLAN_ONLY_MODE = "PLAN_ONLY"/);
assert.doesNotMatch(janitor, /DeleteStackCommand|PutCommand|UpdateCommand/);

assertIncludesAll(
  runtime,
  [
    'mode: "offline_only" as const',
    "applyRuntimeReady: false as const",
    "cleanupRuntimeReady: false as const",
    '"shared_cell_provision_authority_predecessor_missing"',
    '"shared_cell_cleanup_authority_writer_missing"',
  ],
  "default runtime composition",
);
assert.doesNotMatch(
  runtime,
  /shared-cell-cleanup-authority-operator|shared-cell-cleanup-deletion/,
);

assertIncludesAll(
  authorityTest,
  [
    "inspectSharedCellCleanupAuthorityCandidate",
    "executeReviewedSharedCellCleanupAuthorityAdvance",
    "recoverReviewedSharedCellCleanupAuthorityAdvance",
  ],
  "cleanup-authority operator tests",
);
assertIncludesAll(
  deletionTest,
  [
    "inspectSharedCellCleanupDeletion",
    "executeReviewedSharedCellCleanupDeletion",
    "recoverReviewedSharedCellCleanupDeletion",
  ],
  "cleanup deletion tests",
);

const tests = spawnSync(
  process.execPath,
  [
    "--experimental-loader",
    "./tests/cloudflare-loader.mjs",
    "--test",
    "tests/shared-cell-cleanup-authority-operator.test.ts",
    "tests/shared-cell-cleanup-deletion.test.ts",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  },
);
assert.equal(
  tests.status,
  0,
  `J5g-b targeted tests failed.\n${tests.stdout}\n${tests.stderr}`,
);

console.log(
  "B5-J5g-b Shared Cell cleanup authority/deletion contracts validated locally (dormant production ports, existing CAS reuse, PLAN_ONLY Janitor unchanged, no AWS wiring).",
);
