import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const paths = {
  core: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-author-compensation.ts",
  ),
  test: path.join(
    repositoryRoot,
    "tests/shared-cell-author-compensation.test.ts",
  ),
  adapter: path.join(
    repositoryRoot,
    "lib/deployments/execution/aws-sdk-shared-cell-author-compensation.ts",
  ),
  adapterTest: path.join(
    repositoryRoot,
    "tests/aws-sdk-shared-cell-author-compensation.test.ts",
  ),
  operationStore: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-author-compensation-operation-store.ts",
  ),
  persistenceTest: path.join(
    repositoryRoot,
    "tests/shared-cell-author-compensation-persistence.test.ts",
  ),
  neonOperationStore: path.join(
    repositoryRoot,
    "lib/deployments/execution/neon-shared-cell-author-compensation-operation-store.ts",
  ),
  neonOperationStoreTest: path.join(
    repositoryRoot,
    "tests/neon-shared-cell-author-compensation-operation-store.test.ts",
  ),
  controller: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-author-compensation-controller.ts",
  ),
  controllerTest: path.join(
    repositoryRoot,
    "tests/shared-cell-author-compensation-controller.test.ts",
  ),
  persistenceMigration: path.join(
    repositoryRoot,
    "db/postgres-migrations/0009_shared_cell_author_compensation_persistence.sql",
  ),
  postgresSchema: path.join(repositoryRoot, "db/postgres-schema.sql"),
  postgresSchemaTypes: path.join(repositoryRoot, "db/postgres-schema.ts"),
  sealedMigrationCatalog: path.join(
    repositoryRoot,
    "lib/deployments/execution/neon-shared-cell-migration-readiness.ts",
  ),
  wrapper: path.join(
    scriptDirectory,
    "s3-b5-shared-cell-author-compensation.ps1",
  ),
  runtime: path.join(
    repositoryRoot,
    "lib/deployments/execution/runtime-composition.ts",
  ),
};

const [
  core,
  testSource,
  adapter,
  adapterTestSource,
  operationStore,
  persistenceTestSource,
  neonOperationStore,
  neonOperationStoreTestSource,
  controller,
  controllerTestSource,
  persistenceMigration,
  postgresSchema,
  postgresSchemaTypes,
  sealedMigrationCatalog,
  wrapper,
  runtime,
] = await Promise.all(Object.values(paths).map((value) => readFile(value, "utf8")));

function assertIncludesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} is missing ${value}`);
  }
}

function methodSource(source, start, end) {
  const startIndex = source.indexOf(`async ${start}`);
  const endIndex = source.indexOf(`async ${end}`, startIndex + 1);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

assert.match(wrapper, /\[ValidateSet\('LocalValidate'\)\]/);
assert.match(wrapper, /\[string\]\$Mode = 'LocalValidate'/);
assert.match(wrapper, /validate-b5-shared-cell-author-compensation\.mjs/);
assert.match(wrapper, /LOCAL_ONLY_REVIEW_IN_PROGRESS_COMPENSATION_NOT_CLOUD_WIRED/);
assert.match(wrapper, /No cloud API was called; this wrapper exposes no online mode\./);
assert.doesNotMatch(wrapper, /\baws(?:\.exe)?\b/i);
assert.doesNotMatch(
  wrapper,
  /CreateChangeSet|ExecuteChangeSet|DeleteChangeSet|DeleteStack|PutItem/,
);

assertIncludesAll(
  core,
  [
    '"402010193138"',
    '"ca-central-1"',
    '"techlong-sandbox-cell-sandbox-1"',
    "SharedCellAuthorCompensationReadPort",
    "StrongSharedCellAuthorAuthorityReadPort",
    "SharedCellAuthorCompensationMutationPort",
    "SharedCellAuthorDeleteChangeSetMutationPort",
    "SharedCellAuthorDeleteStackMutationPort",
    "compileSharedCellAuthorCompensationPlan",
    "inspectSharedCellAuthorCompensation",
    "executeReviewedSharedCellAuthorDeleteChangeSet",
    "executeReviewedSharedCellAuthorDeleteStack",
    "inspectSharedCellAuthorDeleteChangeSet",
    "inspectSharedCellAuthorDeleteStack",
    "recoverReviewedSharedCellAuthorDeleteChangeSet",
    "recoverReviewedSharedCellAuthorDeleteStack",
    "executeReviewedSharedCellAuthorCompensation",
    "recoverSharedCellAuthorCompensation",
    '"REVIEW_IN_PROGRESS"',
    '"DELETE_IN_PROGRESS"',
    '"REVIEW_CHANGE_SET_MISSING"',
    "compensationGrant",
    "deleteChangeSetMinimumRemainingMs",
    "deleteStackMinimumRemainingMs",
    "assertMutationCaller",
    "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN",
    "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN",
    "safeToAuthorRevoke",
    "safeToRevokePhaseGrant",
    'DeletionMode: "STANDARD"',
    "deleteChangeSet",
    "deleteStack",
    "getChangeSetTemplate",
    "operationSha256",
    "phasePlanSha256",
  ],
  "author compensation core",
);
assert.match(core, /DescribeStacks[\s\S]*GetTemplate\(Original\)[\s\S]*ListStackResources/);
assert.match(core, /DescribeChangeSet\(exact ARN\)/);
assert.match(core, /b5-author-comp-\$\{operationSha256\.slice\(0, 32\)\}/);
assert.match(core, /CREATE_COMPLETE/);
assert.match(core, /AVAILABLE/);
assert.match(core, /authority[\s\S]*ABSENT/i);
assert.match(core, /stack\.roleArn\s*!==\s*candidate\.changeSet\.roleArn/);
assert.match(core, /\(item\s*===\s*null\)\s*!==\s*\(revision\s*===\s*0\)/);
assert.doesNotMatch(core, /from\s+["']@aws-sdk|node:child_process/);
assert.doesNotMatch(core, /ExecuteChangeSet|CreateChangeSet|PutItem|compareAndSet/);

assertIncludesAll(
  adapter,
  [
    "AwsSdkSharedCellAuthorCompensationEvidenceAdapter",
    "AwsSdkSharedCellAuthorDeleteChangeSetAdapter",
    "AwsSdkSharedCellAuthorDeleteStackAdapter",
    "createAwsSdkSharedCellAuthorCompensationRuntimeFromModules",
    "createAwsSdkSharedCellAuthorCompensationRuntime",
    'profile = "techlong-sandbox-cell-operator"',
    'mfaDeviceArn =',
    '"arn:aws:iam::402010193138:mfa/techlong-sandbox-dev"',
    "IncludePropertyValues: true",
    "TemplateStage: \"Original\"",
    'value.name === "ChangeSetNotFoundException"',
    "ARN_BOUND_CHANGE_SET_NOT_FOUND",
    "maxAttempts: 1",
    "ignoreConfiguredEndpointUrls: true",
  ],
  "author compensation AWS adapter",
);
assert.doesNotMatch(adapter, /process\.env|node:child_process/);

assertIncludesAll(
  operationStore,
  [
    "SharedCellAuthorCompensationOperationStore",
    "claimExactOperation",
    "appendReviewedWindow",
    "beginSubmission",
    "recordLockedAndAdvance",
    "controllerContractSha256",
    "delete_change_set_recover_only",
    "delete_stack_recover_only",
    "delete_change_set_revoke_required",
    "delete_stack_revoke_required",
    "missing_proven_locked",
  ],
  "author compensation durable operation contract",
);

assertIncludesAll(
  neonOperationStore,
  [
    "NeonSharedCellAuthorCompensationOperationStore",
    "createNeonSharedCellAuthorCompensationOperationStore",
    "clock_timestamp()",
    "claimExactOperation",
    "appendReviewedWindow",
    "beginSubmission",
    "recordLockedAndAdvance",
    "shared_cell_author_compensation_operations",
    "shared_cell_author_compensation_review_windows",
    "shared_cell_author_compensation_phase_attempts",
    "shared_cell_author_compensation_events",
  ],
  "Neon author compensation operation store",
);
assert.doesNotMatch(neonOperationStore, /Date\.now\(|deployment_jobs|deployment_steps/);
const createOperationSource = methodSource(
  neonOperationStore,
  "createOrLoadOperation",
  "appendReviewedWindow",
);
assert.match(
  createOperationSource,
  /SELECT inserted\.\*, true AS was_created[\s\S]*?NOT EXISTS \(SELECT 1 FROM inserted\)/,
);
assert.match(
  createOperationSource,
  /FROM selected operation_row[\s\S]*?LEFT JOIN shared_cell_author_compensation_review_windows review_window[\s\S]*?LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt/,
);
const appendWindowSource = methodSource(
  neonOperationStore,
  "appendReviewedWindow",
  "claimExactOperation",
);
assert.match(
  appendWindowSource,
  /current_window\.expires_at - db_clock\.now_ms <= \$12/,
);
assert.match(appendWindowSource, /FOR UPDATE OF operation/);
assert.match(
  appendWindowSource,
  /FROM updated operation_row[\s\S]*?JOIN window_insert review_window/,
);
assert.match(
  methodSource(neonOperationStore, "beginSubmission", "completePhase"),
  /FROM updated operation_row[\s\S]*?JOIN attempt_insert phase_attempt/,
);
assert.match(
  methodSource(neonOperationStore, "completePhase", "recordLockedAndAdvance"),
  /FROM updated operation_row[\s\S]*?JOIN attempt_complete phase_attempt/,
);
const lockedAdvanceSource = methodSource(
  neonOperationStore,
  "recordLockedAndAdvance",
  "heartbeat",
);
assert.match(
  lockedAdvanceSource,
  /completion_receipt::jsonb #>> '\{observedState\}'/,
);
assert.match(lockedAdvanceSource, /SET state = eligible\.next_state/);

assertIncludesAll(
  controller,
  [
    "SHARED_CELL_AUTHOR_COMPENSATION_CONTROLLER_DEFAULT_ENABLED",
    "false as const",
    "compileSharedCellAuthorCompensationControllerContract",
    "inspectAndReviewSharedCellAuthorCompensationPhase",
    "executeClaimedSharedCellAuthorCompensationPhase",
    "recoverClaimedSharedCellAuthorCompensationPhase",
    "controllerContractSha256",
    "beginSubmission",
    "safeToRevokePhaseGrant",
    "AuthorCompensationDeleteChangeSetGrant",
    "AuthorCompensationDeleteStackGrant",
  ],
  "durable author compensation controller",
);
assert.doesNotMatch(
  controller,
  /\bexecuteReviewedSharedCellAuthorCompensation\b/,
  "the controller must not import or call the legacy combined executor",
);
assert.match(
  controller,
  /async deleteChangeSet\(value\)\s*\{[\s\S]*?await beginSubmission\([\s\S]*?\);\s*return delegate\.deleteChangeSet\(value\);/,
  "DeleteChangeSet must cross the durable write-ahead CAS before delegation",
);
assert.match(
  controller,
  /async deleteStack\(value\)\s*\{[\s\S]*?await beginSubmission\([\s\S]*?\);\s*return delegate\.deleteStack\(value\);/,
  "DeleteStack must cross the durable write-ahead CAS before delegation",
);
const recoverControllerSource = controller.slice(
  controller.indexOf("interface RecoverInput"),
);
assert.ok(recoverControllerSource.length > 0, "the recover-only controller entrypoint is missing");
assert.doesNotMatch(recoverControllerSource, /\bmutations\s*:/);
assert.doesNotMatch(recoverControllerSource, /\.beginSubmission\(/);
assert.doesNotMatch(
  recoverControllerSource,
  /\bexecuteReviewedSharedCellAuthorDelete(?:ChangeSet|Stack)\(/,
);
assertIncludesAll(
  recoverControllerSource,
  [
    "recoverReviewedSharedCellAuthorDeleteChangeSet",
    "recoverReviewedSharedCellAuthorDeleteStack",
  ],
  "mutation-free author compensation recovery",
);

const persistenceTables = [
  "shared_cell_author_compensation_operations",
  "shared_cell_author_compensation_review_windows",
  "shared_cell_author_compensation_phase_attempts",
  "shared_cell_author_compensation_events",
];
for (const table of persistenceTables) {
  assert.match(persistenceMigration, new RegExp(`CREATE TABLE ${table}\\s*\\(`));
  assert.ok(postgresSchema.includes(table), `PostgreSQL desired schema is missing ${table}`);
  assert.ok(postgresSchemaTypes.includes(table), `PostgreSQL schema types are missing ${table}`);
}
assertIncludesAll(
  postgresSchemaTypes,
  [
    "shared_cell_author_compensation_operations_last_error_code_check",
    "shared_cell_author_compensation_operations_last_error_sha256_check",
    "shared_cell_author_compensation_phase_attempts_completion_receipt_sha256_check",
  ],
  "Drizzle author compensation constraints",
);
assert.equal(
  (persistenceMigration.match(/CREATE TABLE shared_cell_author_compensation_/g) ?? [])
    .length,
  4,
  "0009 must create exactly four independent compensation tables",
);
assertIncludesAll(
  persistenceMigration,
  [
    "J5g-j2 offline persistence foundation",
    "separate from the sealed J5g-e2 0001-0008 receipt",
    "shared_cell_author_compensation_windows_append_only",
    "shared_cell_author_compensation_events_append_only",
  ],
  "0009 author compensation persistence migration",
);
assert.doesNotMatch(
  persistenceMigration,
  /\bdeployment_jobs\b|\bdeployment_steps\b|SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG/,
);
assert.match(
  persistenceMigration,
  /NEW\.state IN \('delete_change_set_prepared', 'delete_stack_prepared'\)/,
);
assert.match(
  persistenceMigration,
  /NEW\.current_window_number = OLD\.current_window_number \+ 1/,
);
assert.match(
  persistenceMigration,
  /prior_window\.expires_at[\s\S]*?clock_timestamp\(\)[\s\S]*?WHEN 'DELETE_CHANGE_SET' THEN 600000[\s\S]*?WHEN 'DELETE_STACK' THEN 300000/,
);
assert.match(
  persistenceMigration,
  /OLD\.state = 'delete_change_set_revoke_required' AND NEW\.state = 'missing_proven_locked'/,
);

const sealedCatalogEntries = [
  ["0001_local_auth.sql", "c9bc42440c3fb8e71fd6ff8a46d82f19766dd3214c365ae26b34ea0bd56c6d1a"],
  ["0002_app_instance_deployment_planning.sql", "f7add4988ce35cb04bf5edc6855e7bf615899e6ddd4ea122a2eed025128d69ad"],
  ["0003_deployment_execution_foundation.sql", "ba1ba68ec2d4a3c85124b1ccdfd3f19188bca84b9f4a9013e70c7727231dd6bd"],
  ["0004_aws_sandbox_worker.sql", "523e35a9b326367747aba794b6acf3f8790108fef32f3b0a41e77503b6eb242d"],
  ["0005_tenant_resource_lifecycle.sql", "bd36678d6e6f0030c0254475b6a21be89a1adebea8883b99f2ce2014e9f60e05"],
  ["0006_deployment_lease_fencing.sql", "b6b48b8d0c298d354909a335cc91205632a6fa28097c0e901e734fb8ebcd0574"],
  ["0007_external_ownership_epoch_cleanup_phases.sql", "402b083c10f2740c6c3ac8089b0b4d0bf47e26acad4ac0cbc70ec86fa11e1540"],
  ["0008_shared_cell_admission_fence.sql", "0b8c161c4ba7e9f9cd9154ba9f008ec534b4b8b97023de9b8f8a63f8d2756c90"],
];
const sealedCatalogStart = sealedMigrationCatalog.indexOf(
  "export const SHARED_CELL_POSTGRES_REVIEWED_MIGRATION_CATALOG",
);
const sealedCatalogEnd = sealedMigrationCatalog.indexOf(
  "] as const);",
  sealedCatalogStart,
);
assert.ok(sealedCatalogStart >= 0 && sealedCatalogEnd > sealedCatalogStart);
const sealedCatalogBlock = sealedMigrationCatalog.slice(
  sealedCatalogStart,
  sealedCatalogEnd,
);
let previousCatalogPosition = -1;
for (const [filename, checksum] of sealedCatalogEntries) {
  const filenamePosition = sealedCatalogBlock.indexOf(`filename: "${filename}"`);
  const checksumPosition = sealedCatalogBlock.indexOf(
    `checksum: "${checksum}"`,
    filenamePosition,
  );
  assert.ok(filenamePosition > previousCatalogPosition, `${filename} moved or is missing`);
  assert.ok(checksumPosition > filenamePosition, `${filename} checksum changed or is missing`);
  previousCatalogPosition = filenamePosition;
}
assert.equal((sealedCatalogBlock.match(/filename:/g) ?? []).length, 8);
assert.doesNotMatch(sealedCatalogBlock, /0009_/);

assertIncludesAll(
  testSource,
  [
    "inspectSharedCellAuthorCompensation",
    "executeReviewedSharedCellAuthorCompensation",
    "recoverSharedCellAuthorCompensation",
    "compileSharedCellAuthorCompensationPlan",
    "executeReviewedSharedCellAuthorDeleteChangeSet",
    "executeReviewedSharedCellAuthorDeleteStack",
    "inspectSharedCellAuthorDeleteChangeSet",
    "inspectSharedCellAuthorDeleteStack",
    "recoverReviewedSharedCellAuthorDeleteChangeSet",
    "recoverReviewedSharedCellAuthorDeleteStack",
    "safeToAuthorRevoke",
    "AccessDenied",
    "REVIEW_IN_PROGRESS",
    "DELETE_IN_PROGRESS",
    "compensationGrant",
    "Inspect can renew an exact CS-missing rollover window",
  ],
  "author compensation tests",
);
assertIncludesAll(
  adapterTestSource,
  [
    "DescribeChangeSet reads every page",
    "only exact target-bound provider errors prove missing",
    "narrow mutation adapters send only their exact reviewed envelopes",
    "dormant runtime shares one lazy MFA provider",
    "installed dormant runtime construction performs no AWS request",
  ],
  "author compensation AWS adapter tests",
);
assertIncludesAll(
  persistenceTestSource,
  [
    "0009 defines independent append-only durable compensation state",
    "every submitted phase permanently recover-only until revoke",
    "write-ahead mutation requests are exact-target",
    "completion and Locked receipts are closed",
    "prepared review windows roll forward only after the DB cutoff",
    "Neon write CTEs hydrate new rows from RETURNING",
  ],
  "author compensation persistence contract tests",
);
assertIncludesAll(
  neonOperationStoreTestSource,
  [
    "constructor is I/O-free",
    "expired ready takeover uses DB clock",
    "beginSubmission rechecks controller digest",
    "Locked advancement derives direct completion from the persisted missing receipt",
    "heartbeat matches the full live handle",
    "stale full handles fail closed",
  ],
  "Neon author compensation operation store tests",
);
assertIncludesAll(
  controllerTestSource,
  [
    "write-ahead CAS precedes the sole AWS mutation",
    "a pre-boundary abort releases the claim with an independent live cleanup signal",
    "an invalid prepared snapshot releases with the returned advanced handle",
    "a Change Set phase that proves the Stack missing hands Locked directly to completion",
    "a rejected write-ahead CAS delegates zero AWS mutations",
    "mutation-free recover completes",
    "phase isolation rejects a sibling-only mutation port before write-ahead",
  ],
  "durable author compensation controller tests",
);
assert.doesNotMatch(
  runtime,
  /shared-cell-author-compensation/,
  "offline compensation must remain absent from the runtime root",
);

const tests = spawnSync(
  process.execPath,
  [
    "--experimental-loader",
    "./tests/cloudflare-loader.mjs",
    "--test",
    "tests/shared-cell-author-compensation.test.ts",
    "tests/aws-sdk-shared-cell-author-compensation.test.ts",
    "tests/shared-cell-author-compensation-persistence.test.ts",
    "tests/neon-shared-cell-author-compensation-operation-store.test.ts",
    "tests/shared-cell-author-compensation-controller.test.ts",
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
  `Shared Cell author compensation tests failed.\n${tests.stdout}\n${tests.stderr}`,
);

console.log(
  "B5 Shared Cell author compensation validated locally (phase-specific inspect/recover, durable DB-clock claims, append-only 0009 persistence, write-ahead CAS before each narrow delegate, mutation-free recovery, separate revoke handoff, sealed 0001-0008 catalog, default-off controller, no runtime wiring or AWS/Neon call).",
);
