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
  grantLifecycle: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-author-compensation-grant-lifecycle.ts",
  ),
  grantLifecycleTest: path.join(
    repositoryRoot,
    "tests/shared-cell-author-compensation-grant-lifecycle.test.ts",
  ),
  grantController: path.join(
    repositoryRoot,
    "lib/deployments/execution/shared-cell-author-compensation-grant-controller.ts",
  ),
  grantControllerTest: path.join(
    repositoryRoot,
    "tests/shared-cell-author-compensation-grant-controller.test.ts",
  ),
  managementAdapter: path.join(repositoryRoot, "lib/deployments/execution/aws-sdk-shared-cell-author-compensation-management.ts"),
  managementEntry: path.join(repositoryRoot, "lib/deployments/execution/shared-cell-author-compensation-management-entry.ts"),
  managementTest: path.join(repositoryRoot, "tests/aws-sdk-shared-cell-author-compensation-management.test.ts"),
  managementReviewer: path.join(scriptDirectory, "review-b5-shared-cell-author-compensation-management.ts"),
  persistenceMigration: path.join(
    repositoryRoot,
    "db/postgres-migrations/0009_shared_cell_author_compensation_persistence.sql",
  ),
  lifecycleMigration: path.join(
    repositoryRoot,
    "db/postgres-migrations/0010_shared_cell_author_compensation_grant_lifecycle.sql",
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
  grantLifecycle,
  grantLifecycleTestSource,
  grantController,
  grantControllerTestSource,
  managementAdapter,
  managementEntry,
  managementTestSource,
  managementReviewer,
  persistenceMigration,
  lifecycleMigration,
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

assert.match(wrapper, /\[ValidateSet\('LocalValidate', 'ReviewManagement'\)\]/);
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
    "beginLifecycleAction",
    "completeLifecycleAction",
    "beginSubmission",
    "recordLockedAndAdvance",
    "controllerContractSha256",
    "delete_change_set_recover_only",
    "delete_stack_recover_only",
    "delete_change_set_revoke_required",
    "delete_stack_revoke_required",
    "missing_proven_locked",
    "SharedCellAuthorCompensationWindowExpiredLockedReceipt",
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
    "beginLifecycleAction",
    "completeLifecycleAction",
    "beginSubmission",
    "recordLockedAndAdvance",
    "shared_cell_author_compensation_operations",
    "shared_cell_author_compensation_review_windows",
    "shared_cell_author_compensation_phase_attempts",
    "shared_cell_author_compensation_lifecycle_actions",
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
const beginLifecycleSource = methodSource(
  neonOperationStore,
  "beginLifecycleAction",
  "completeLifecycleAction",
);
assert.match(
  beginLifecycleSource,
  /INSERT INTO shared_cell_author_compensation_lifecycle_actions/,
);
assert.match(
  beginLifecycleSource,
  /NOT EXISTS \([\s\S]*?uncertain\.status = 'recover_only'/,
);
const completeLifecycleSource = methodSource(
  neonOperationStore,
  "completeLifecycleAction",
  "preparePhase",
);
assert.match(
  completeLifecycleSource,
  /UPDATE shared_cell_author_compensation_lifecycle_actions action[\s\S]*?SET status = 'completed'/,
);
assert.match(
  completeLifecycleSource,
  /operation\.lease_owner = \$2 AND operation\.claim_token = \$3[\s\S]*?operation\.lease_attempt = \$4 AND operation\.state_revision = \$5/,
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
assert.doesNotMatch(
  controller.slice(
    controller.indexOf(
      "export async function executeClaimedSharedCellAuthorCompensationPhase",
    ),
    controller.indexOf(
      "export async function recoverClaimedSharedCellAuthorCompensationPhase",
    ),
  ),
  /\.preparePhase\(/,
  "the phase controller must require a completed durable grant lifecycle action",
);
assert.match(
  controller,
  /async deleteChangeSet\(value\)\s*\{[\s\S]*?await beginSubmission\([\s\S]*?\);\s*return runIndependentDurableBoundary\(\(signal\) =>\s*delegate\.deleteChangeSet\(\{ \.\.\.value, signal \}\)/,
  "DeleteChangeSet must cross the durable write-ahead CAS before delegation",
);
assert.match(
  controller,
  /async deleteStack\(value\)\s*\{[\s\S]*?await beginSubmission\([\s\S]*?\);\s*return runIndependentDurableBoundary\(\(signal\) =>\s*delegate\.deleteStack\(\{ \.\.\.value, signal \}\)/,
  "DeleteStack must cross the durable write-ahead CAS before delegation",
);
assert.match(
  controller,
  /const durableMutationTimeoutMs = 30_000;[\s\S]*?new AbortController\(\)[\s\S]*?setTimeout\([\s\S]*?dispatch\.abort\(\)[\s\S]*?clearTimeout\(timeout\)/,
  "post-write-ahead delegation must use an independent bounded signal",
);
assert.match(
  controller,
  /signal\.throwIfAborted\(\);[\s\S]*?submissionBoundaryEntered = true;[\s\S]*?runIndependentDurableBoundary\([\s\S]*?input\.store\.beginSubmission\([\s\S]*?signal: boundarySignal/,
  "the durable phase CAS must cross an independent boundary after the final caller abort check",
);
assert.match(
  grantController,
  /input\.signal\.throwIfAborted\(\);[\s\S]*?runIndependentDurableBoundary\(\(boundarySignal\) =>[\s\S]*?input\.store\.beginLifecycleAction\([\s\S]*?signal: boundarySignal/,
  "the durable Grant/Revoke CAS must cross an independent boundary after the final caller abort check",
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

assertIncludesAll(
  grantLifecycle,
  [
    "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_DEFAULT_ENABLED",
    "false as const",
    "SharedCellAuthorCompensationLifecycleReceiptProducer",
    "compileSharedCellAuthorCompensationLifecycleContract",
    "SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID",
    "readManagementObservation",
    "maximumObservationSpanMs",
    "createPhaseGrantReceipt",
    "createPhaseCompletedLockedReceipt",
    "createWindowExpiredLockedReceipt",
    "shared_cell_author_compensation_window_expired_locked_verified",
  ],
  "trusted grant lifecycle receipt producer",
);
assert.doesNotMatch(grantLifecycle, /from\s+["']@aws-sdk|process\.env|Date\.now\(/);

assertIncludesAll(
  grantController,
  [
    "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_CONTROLLER_DEFAULT_ENABLED",
    "false as const",
    "compileSharedCellAuthorCompensationGrantActionRequest",
    "compileSharedCellAuthorCompensationRevokeActionRequest",
    "executeClaimedSharedCellAuthorCompensationPhaseGrant",
    "recoverClaimedSharedCellAuthorCompensationPhaseGrant",
    "executeClaimedSharedCellAuthorCompensationPhaseRevoke",
    "recoverClaimedSharedCellAuthorCompensationPhaseRevoke",
    "beginLifecycleAction",
    "completeLifecycleAction",
    "POST_SUBMIT_UNCERTAIN",
  ],
  "durable grant/revoke lifecycle controller",
);
const grantRecoverySource = grantController.slice(
  grantController.indexOf(
    "export async function recoverClaimedSharedCellAuthorCompensationPhaseGrant",
  ),
  grantController.indexOf("interface RevokeInput"),
);
const revokeRecoverySource = grantController.slice(
  grantController.indexOf(
    "export async function recoverClaimedSharedCellAuthorCompensationPhaseRevoke",
  ),
);
assert.doesNotMatch(grantRecoverySource, /\bmutations\s*:/);
assert.doesNotMatch(revokeRecoverySource, /\bmutations\s*:/);
assert.doesNotMatch(grantRecoverySource, /\.installPhaseGrant\(/);
assert.doesNotMatch(revokeRecoverySource, /\.revokePhaseGrant\(/);

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
assert.match(
  lifecycleMigration,
  /CREATE TABLE shared_cell_author_compensation_lifecycle_actions\s*\(/,
);
assert.ok(
  postgresSchema
    .replace(/\r\n/g, "\n")
    .includes(lifecycleMigration.replace(/\r\n/g, "\n").trim()),
  "PostgreSQL desired schema must contain the exact 0010 lifecycle migration",
);
assert.ok(
  postgresSchemaTypes.includes("shared_cell_author_compensation_lifecycle_actions"),
  "PostgreSQL schema types are missing lifecycle actions",
);
assertIncludesAll(
  postgresSchemaTypes,
  [
    "shared_cell_author_compensation_operations_last_error_code_check",
    "shared_cell_author_compensation_operations_last_error_sha256_check",
    "shared_cell_author_compensation_phase_attempts_completion_receipt_sha256_check",
    "scac_lifecycle_request_shape_check",
    "scac_lifecycle_receipt_shape_check",
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
assertIncludesAll(
  lifecycleMigration,
  [
    "J5g-j3 durable grant/revoke lifecycle",
    "shared_cell_author_compensation_lifecycle_actions",
    "scac_lifecycle_one_recover_only_per_operation",
    "lifecycle_action_started",
    "lifecycle_action_completed",
    "A completed durable GRANT action is required before ready",
    "A completed WINDOW_EXPIRED REVOKE action is required before review reset",
    "A completed PHASE_COMPLETED REVOKE action is required before Locked advancement",
    "attempt.attempt_number = OLD.current_attempt_number",
    "DEFERRABLE INITIALLY IMMEDIATE",
  ],
  "0010 grant/revoke lifecycle migration",
);
assert.match(
  lifecycleMigration,
  /CREATE TRIGGER shared_cell_author_compensation_lifecycle_actions_transition\s+BEFORE INSERT OR UPDATE OR DELETE\s+ON shared_cell_author_compensation_lifecycle_actions\s+FOR EACH ROW EXECUTE FUNCTION enforce_scac_lifecycle_action_transition\(\)/,
);
assert.match(
  lifecycleMigration,
  /NEW\.state = 'missing_proven_locked'[\s\S]*?observedState[\s\S]*?'MISSING'[\s\S]*?NEW\.state = 'awaiting_delete_stack_review'[\s\S]*?OLD\.current_phase = 'DELETE_CHANGE_SET'[\s\S]*?'REVIEW_IN_PROGRESS'/,
);
assert.doesNotMatch(lifecycleMigration, /ON DELETE CASCADE/i);
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
assert.doesNotMatch(sealedCatalogBlock, /0009_|0010_/);

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
    "0010 durably fences every grant and revoke lifecycle transition",
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
    "readOperation rejects a phase attempt from a different review window",
    "expired ready takeover uses DB clock",
    "a lifecycle write-ahead action forces recover-only claim mode",
    "beginLifecycleAction persists exact GRANT intent",
    "completeLifecycleAction atomically completes GRANT",
    "completeLifecycleAction preserves a late GRANT as revoke-only reconciliation",
    "beginLifecycleAction binds a completed-phase REVOKE to both durable predecessor receipts",
    "completeLifecycleAction closes an expired ready grant to fresh review and clears the claim",
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
    "write-ahead CAS precedes the sole AWS mutation and completion returns a live revoke claim",
    "a just-completed Grant can hand its live claim directly to the phase controller",
    "a grant-ready phase with a mismatched lifecycle request digest fails closed",
    "a revoke-only reconciled grant is rejected before claim or phase mutation",
    "a pre-claim abort performs no durable or AWS operation",
    "a caller abort after phase write-ahead cannot suppress the sole AWS delegate",
    "a prepared phase without a completed durable grant fails closed and releases",
    "a Change Set phase that proves the Stack missing hands Locked directly to completion",
    "a rejected write-ahead CAS delegates zero AWS mutations",
    "mutation-free recover completes",
    "phase isolation rejects a sibling-only mutation port before write-ahead",
  ],
  "durable author compensation controller tests",
);
assertIncludesAll(
  grantLifecycleTestSource,
  [
    "constructor-only, and brands stable exact evidence",
    "distinct hash-bound Locked receipts",
    "management readback fails closed",
    "late grant reconciliation is revoke-only",
  ],
  "grant lifecycle receipt tests",
);
assertIncludesAll(
  grantControllerTestSource,
  [
    "requests bind the exact management Stack",
    "persists recover-only intent before the sole delegate",
    "a rejected grant write-ahead delegates zero mutation",
    "a mismatched durable lifecycle request digest delegates zero mutation",
    "a caller abort after lifecycle write-ahead cannot suppress the sole Grant or Revoke delegate",
    "recovery never receives a mutation port",
    "late grant reconciliation hands its live claim directly to revoke-only cleanup",
    "completed-phase revoke accepts the live phase claim without waiting or reclaiming",
    "ready grant after cutoff revokes to Locked",
    "reconciled read-only without a second delegate",
  ],
  "grant/revoke lifecycle controller tests",
);
assert.doesNotMatch(
  runtime,
  /shared-cell-author-compensation/,
  "offline compensation must remain absent from the runtime root",
);
assertIncludesAll(managementAdapter, [
  "SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_DEFAULT_ENABLED = false",
  "ConsistentRead: true", "fromLoginCredentials", "maxAttempts: 1",
  "compilePreparedSharedCellAuthorCompensationManagementAction", "this.submitted = true",
], "dormant management adapter");
assertIncludesAll(managementEntry, [
  "SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_ENTRY_DEFAULT_ENABLED = false",
  "LIFECYCLE_RECEIPT_REQUIRES_CELL_MISSING", "MIGRATIONS_0009_0010_NOT_APPLIED",
  "executeClaimedSharedCellAuthorCompensationPhaseGrant", "recoverClaimedSharedCellAuthorCompensationPhaseRevoke",
], "dormant management entry");
assertIncludesAll(managementTestSource, [
  "brackets exact absence with strong authority reads", "concurrent reuse cannot submit twice",
  "lost ExecuteChangeSet responses never cause a second submission",
  "successful durable write-ahead before any provider mutation",
  "login-only lazy shared credentials",
], "management adapter tests");
assert.doesNotMatch(managementReviewer, /createAwsSdk|createNeon|DATABASE_URL|dotenv/);

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
    "tests/shared-cell-author-compensation-grant-lifecycle.test.ts",
    "tests/shared-cell-author-compensation-grant-controller.test.ts",
    "tests/aws-sdk-shared-cell-author-compensation-management.test.ts",
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
  "B5 Shared Cell author compensation validated locally (durable 0009/0010 lifecycle, trusted two-read receipts, exact prepared management ExecuteChangeSet adapter, login-only dormant SDK construction, local review entry, write-ahead CAS before mutation, read-only recovery, sealed 0001-0008 catalog, default-off, no AWS/Neon call).",
);
