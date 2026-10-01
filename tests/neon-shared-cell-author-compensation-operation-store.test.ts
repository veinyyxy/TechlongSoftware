import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import {
  NeonSharedCellAuthorCompensationOperationStore,
  type NeonSharedCellAuthorCompensationSqlClient,
} from "../lib/deployments/execution/neon-shared-cell-author-compensation-operation-store.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES,
  SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
  type SharedCellAuthorCompensationCandidate,
} from "../lib/deployments/execution/shared-cell-author-compensation.ts";
import { SharedCellAuthorCompensationStoreError } from "../lib/deployments/execution/shared-cell-author-compensation-operation-store.ts";

const operationSha256 = "a".repeat(64);
const controllerContractSha256 = "b".repeat(64);
const compensationPlanSha256 = "c".repeat(64);
const phasePlanSha256 = "d".repeat(64);
const grantReceiptSha256 = "e".repeat(64);
const claimToken = `scac_${"1".repeat(32)}`;
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  "techlong-sandbox-cell-sandbox-1/12345678-1234-4234-8234-123456789012";
const changeSetArn =
  "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/" +
  "techlong-sandbox-cell-sandbox-1-1111111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const stableToken = `b5-author-comp-${operationSha256.slice(0, 32)}`;
const now = Date.parse("2026-09-28T12:00:00.000Z");
const stackName = "techlong-sandbox-cell-sandbox-1";
const rawSha256 = "1".repeat(64);
const templateBody = {
  AWSTemplateFormatVersion: "2010-09-09",
  Resources: Object.fromEntries(
    SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES.map((resourceType, index) => [
      `ReviewedResource${String(index + 1).padStart(2, "0")}`,
      { Type: resourceType, Properties: {} },
    ]),
  ),
};
const canonicalSha256 = createHash("sha256")
  .update(canonicalJson(templateBody), "utf8")
  .digest("hex");

function reviewedCandidate(): SharedCellAuthorCompensationCandidate {
  return {
    schemaVersion: 1,
    accountId: "402010193138",
    region: "ca-central-1",
    stackName,
    stackId,
    compensationGrant: {
      reviewedAt: "2026-09-28T11:59:00.000Z",
      expiresAt: "2026-09-28T12:59:00.000Z",
    },
    immutableTemplate: {
      url:
        "https://techlong-sandbox-build-source-402010193138-ca-central-1." +
        `s3.ca-central-1.amazonaws.com/b5-shared-cell/templates/sha256/${rawSha256}.json`,
      rawSha256,
      canonicalSha256,
    },
    changeSet: {
      name: `${stackName}-${rawSha256.slice(0, 16)}`,
      arn: changeSetArn,
      type: "CREATE",
      roleArn: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
      capabilities: [],
      includeNestedStacks: false,
      resourceTypes: [...SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES],
      parameters: [
        { ParameterKey: "AvailabilityZoneA", ParameterValue: "ca-central-1a" },
        { ParameterKey: "AvailabilityZoneB", ParameterValue: "ca-central-1b" },
        {
          ParameterKey: "CertificateArn",
          ParameterValue:
            "arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-4234-8234-123456789012",
        },
        {
          ParameterKey: "ControlTrustStoreArn",
          ParameterValue:
            "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/control/0123456789abcdef",
        },
        {
          ParameterKey: "CellJanitorFunctionArn",
          ParameterValue:
            "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
        },
        {
          ParameterKey: "CellSchedulerInvokeRoleArn",
          ParameterValue:
            "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
        },
        {
          ParameterKey: "CellSchedulerGroupName",
          ParameterValue: "techlong-sandbox-cell",
        },
        { ParameterKey: "CleanupAt", ParameterValue: "2026-09-28T15:00:00" },
      ],
      tags: [
        { Key: "Environment", Value: "aws-sandbox" },
        { Key: "ManagedBy", Value: "techlong-cell-operator" },
        { Key: "CellId", Value: "cell-sandbox-1" },
        { Key: "ExpiresAt", Value: "2026-09-28T15:00:00.000Z" },
      ],
    },
  };
}

function operationRecord(overrides: Record<string, unknown> = {}) {
  return {
    operation_sha256: operationSha256,
    schema_version: 1,
    environment_id: "env_aws_sandbox_ca_central_1",
    account_id: "402010193138",
    region: "ca-central-1",
    stack_name: "techlong-sandbox-cell-sandbox-1",
    stack_id: stackId,
    change_set_arn: changeSetArn,
    operation_intent: JSON.stringify({ schemaVersion: 1, action: "test" }),
    delete_stack_client_request_token: stableToken,
    state: "delete_change_set_ready",
    current_phase: "DELETE_CHANGE_SET",
    current_window_number: 1,
    current_attempt_number: null,
    current_grant_receipt_sha256: grantReceiptSha256,
    state_revision: 12,
    lease_owner: "worker-new",
    claim_token: claimToken,
    lease_attempt: 5,
    lease_expires_at: now + 120_000,
    last_error_code: null,
    last_error_sha256: null,
    created_at: now - 600_000,
    updated_at: now,
    completed_at: null,
    ...overrides,
  };
}

function windowRecord(overrides: Record<string, unknown> = {}) {
  return {
    operation_sha256: operationSha256,
    phase: "DELETE_CHANGE_SET",
    window_number: 1,
    candidate: JSON.stringify({ schemaVersion: 1 }),
    compensation_plan_sha256: compensationPlanSha256,
    phase_plan_sha256: phasePlanSha256,
    controller_contract_sha256: controllerContractSha256,
    reviewed_at: now - 60_000,
    expires_at: now + 20 * 60_000,
    created_at: now - 60_000,
    ...overrides,
  };
}

function attemptRecord(overrides: Record<string, unknown> = {}) {
  return {
    operation_sha256: operationSha256,
    phase: "DELETE_CHANGE_SET",
    attempt_number: 1,
    window_number: 1,
    status: "recover_only",
    request: JSON.stringify({
      phase: "DELETE_CHANGE_SET",
      request: { ChangeSetName: changeSetArn, StackName: stackId },
    }),
    request_sha256: "f".repeat(64),
    client_request_token: null,
    lease_attempt: 5,
    prepared_revision: 13,
    completion_receipt: "{}",
    completion_receipt_sha256: null,
    started_at: now,
    updated_at: now,
    completed_at: null,
    ...overrides,
  };
}

function grantLifecycleRequest() {
  return {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_grant" as const,
    kind: "GRANT" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    windowNumber: 1,
    compensationPlanSha256,
    phasePlanSha256,
    controllerContractSha256,
    lifecycleContractSha256: "6".repeat(64),
    managementStackName: "techlong-s3-b5-cell-lifecycle-management" as const,
    managementStackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d" as const,
    managementChangeSetName: `techlong-j5gj3-grant-${"6".repeat(16)}`,
    targetRendererShape: "AuthorCompensationDeleteChangeSetGrant" as const,
    targetTemplateRawSha256: "7".repeat(64),
    targetTemplateCanonicalSha256: "8".repeat(64),
  };
}

function revokeLifecycleRequest(
  reason: "PHASE_COMPLETED" | "WINDOW_EXPIRED",
  completionReceiptSha256?: string,
) {
  const common = {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_revoke" as const,
    kind: "REVOKE" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    windowNumber: 1,
    grantReceiptSha256,
    lifecycleContractSha256: "6".repeat(64),
    managementStackName: "techlong-s3-b5-cell-lifecycle-management" as const,
    managementStackId:
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d" as const,
    managementChangeSetName: `techlong-j5gj3-revoke-${"6".repeat(16)}`,
    targetRendererShape: "Locked" as const,
    targetTemplateRawSha256: "7".repeat(64),
    targetTemplateCanonicalSha256: "8".repeat(64),
  };
  return reason === "PHASE_COMPLETED"
    ? {
        ...common,
        reason,
        completionReceiptSha256: completionReceiptSha256 ?? "0".repeat(64),
      }
    : { ...common, reason };
}

function lifecycleActionRecord(overrides: Record<string, unknown> = {}) {
  return {
    operation_sha256: operationSha256,
    phase: "DELETE_CHANGE_SET",
    window_number: 1,
    action_number: 1,
    action_kind: "GRANT",
    revoke_reason: null,
    status: "recover_only",
    request: JSON.stringify(grantLifecycleRequest()),
    request_sha256: "9".repeat(64),
    lease_attempt: 5,
    prepared_revision: 13,
    completion_receipt: "{}",
    completion_receipt_sha256: null,
    started_at: now,
    updated_at: now,
    completed_at: null,
    ...overrides,
  };
}

function snapshotRow(
  operation: Record<string, unknown>,
  window: Record<string, unknown> | null,
  attempt: Record<string, unknown> | null = null,
  lifecycleAction: Record<string, unknown> | null = null,
) {
  return {
    operation_record: JSON.stringify(operation),
    window_record: window === null ? null : JSON.stringify(window),
    attempt_record: attempt === null ? null : JSON.stringify(attempt),
    lifecycle_action_record:
      lifecycleAction === null ? null : JSON.stringify(lifecycleAction),
  };
}

function client(
  responder: (
    statement: string,
    values: unknown[],
    call: number,
  ) => Promise<unknown> | unknown,
) {
  const calls: Array<{
    statement: string;
    values: unknown[];
    options: unknown;
  }> = [];
  const sql: NeonSharedCellAuthorCompensationSqlClient = {
    async query(statement, values, options) {
      calls.push({ statement, values, options });
      return responder(statement, values, calls.length);
    },
  };
  return { sql, calls };
}

test("constructor is I/O-free and fails fast on invalid dependencies", () => {
  const fake = client(() => ({ rows: [] }));
  new NeonSharedCellAuthorCompensationOperationStore(fake.sql, () => claimToken);
  assert.equal(fake.calls.length, 0);
  assert.throws(
    () =>
      new NeonSharedCellAuthorCompensationOperationStore(
        {} as NeonSharedCellAuthorCompensationSqlClient,
      ),
    (error) =>
      error instanceof SharedCellAuthorCompensationStoreError &&
      error.code === "NEON_SHARED_CELL_AUTHOR_COMPENSATION_CLIENT_INVALID",
  );
});

test("createOrLoad hydrates the current window for an existing progressed operation", async () => {
  const fake = client(() => ({
    rows: [
      {
        ...snapshotRow(operationRecord(), windowRecord()),
        was_created: false,
      },
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const result = await store.createOrLoadOperation({
    candidate: reviewedCandidate(),
    environmentId: "env_aws_sandbox_ca_central_1",
    signal: new AbortController().signal,
  });

  assert.equal(result.outcome, "existing");
  assert.equal(result.snapshot.operation.currentWindowNumber, 1);
  assert.equal(result.snapshot.currentWindow?.windowNumber, 1);
  assert.match(
    fake.calls[0].statement,
    /FROM selected operation_row[\s\S]*?LEFT JOIN shared_cell_author_compensation_review_windows review_window/,
  );
  assert.match(
    fake.calls[0].statement,
    /LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt/,
  );
});

test("readOperation rejects a phase attempt from a different review window", async () => {
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({ current_attempt_number: 1 }),
        windowRecord(),
        attemptRecord({ window_number: 2 }),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);

  await assert.rejects(
    store.readOperation({
      operationSha256,
      signal: new AbortController().signal,
    }),
    (error) => {
      assert.ok(error instanceof SharedCellAuthorCompensationStoreError);
      assert.equal(
        error.code,
        "NEON_SHARED_CELL_AUTHOR_COMPENSATION_RECEIPT_INVALID",
      );
      assert.equal(
        error.message,
        "The durable compensation database returned an invalid snapshot linkage.",
      );
      assert.equal(error.retryable, true);
      return true;
    },
  );
  assert.equal(fake.calls.length, 1);
  assert.match(
    fake.calls[0].statement,
    /phase_attempt\.window_number = operation_row\.current_window_number/,
  );
});

test("expired ready takeover uses DB clock, fresh fencing, and preserves exact grant readiness", async () => {
  const fake = client((_statement, values) => ({
    rows: [
      snapshotRow(
        operationRecord({
          lease_owner: values[1],
          claim_token: values[2],
          lease_attempt: 5,
          state_revision: 12,
          state: "delete_change_set_ready",
          current_grant_receipt_sha256: grantReceiptSha256,
        }),
        windowRecord(),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(
    fake.sql,
    () => claimToken,
  );
  const signal = new AbortController().signal;
  const claim = await store.claimExactOperation({
    operationSha256,
    workerId: "worker-new",
    leaseDurationMs: 120_000,
    signal,
  });
  assert.equal(claim?.mode, "PREPARE");
  assert.equal(claim?.snapshot.operation.state, "delete_change_set_ready");
  assert.equal(
    claim?.snapshot.operation.currentGrantReceiptSha256,
    grantReceiptSha256,
  );
  assert.equal(claim?.handle.claimToken, claimToken);
  assert.match(fake.calls[0].statement, /clock_timestamp\(\)/);
  assert.match(
    fake.calls[0].statement,
    /'delete_change_set_ready'[\s\S]*?lease_expires_at <= db_clock\.now_ms/,
  );
  assert.match(fake.calls[0].statement, /claim_token = \$3/);
  assert.match(fake.calls[0].statement, /lease_attempt = operation\.lease_attempt \+ 1/);
  assert.match(fake.calls[0].statement, /state_revision = operation\.state_revision \+ 1/);
  assert.deepEqual(fake.calls[0].options, {
    fullResults: true,
    fetchOptions: { signal },
  });
});

test("a lifecycle write-ahead action forces recover-only claim mode even while the operation is prepared", async () => {
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({
          state: "delete_change_set_prepared",
          current_grant_receipt_sha256: null,
        }),
        windowRecord(),
        null,
        lifecycleActionRecord(),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const claim = await store.claimExactOperation({
    operationSha256,
    workerId: "worker-new",
    leaseDurationMs: 120_000,
    signal: new AbortController().signal,
  });

  assert.equal(claim?.mode, "RECOVER_ONLY");
  assert.equal(claim?.snapshot.currentLifecycleAction?.kind, "GRANT");
  assert.equal(claim?.snapshot.currentLifecycleAction?.status, "recover_only");
  assert.match(fake.calls[0].statement, /shared_cell_author_compensation_lifecycle_actions/);
  assert.match(fake.calls[0].statement, /ORDER BY action\.action_number DESC/);
});

test("beginLifecycleAction persists exact GRANT intent before any external mutation", async () => {
  const request = grantLifecycleRequest();
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({
          state: "delete_change_set_prepared",
          current_grant_receipt_sha256: null,
          state_revision: 13,
        }),
        windowRecord(),
        null,
        lifecycleActionRecord(),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const claim = await store.beginLifecycleAction({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 12,
      leaseExpiresAt: now + 120_000,
    },
    windowNumber: 1,
    request,
    signal: new AbortController().signal,
  });

  assert.equal(claim?.mode, "RECOVER_ONLY");
  assert.equal(claim?.snapshot.currentLifecycleAction?.actionNumber, 1);
  assert.match(fake.calls[0].statement, /INSERT INTO shared_cell_author_compensation_lifecycle_actions/);
  assert.match(fake.calls[0].statement, /'recover_only', \$12, \$13/);
  assert.match(fake.calls[0].statement, /'lifecycle_action_started'/);
  assert.match(fake.calls[0].statement, /operation\.lease_owner = \$2 AND operation\.claim_token = \$3/);
  assert.match(fake.calls[0].statement, /NOT EXISTS \([\s\S]*?uncertain\.status = 'recover_only'/);
  assert.equal(fake.calls[0].values[11], canonicalJson(request));
  assert.equal(fake.calls[0].values[14], 1);
});

test("completeLifecycleAction atomically completes GRANT and returns the advanced live claim", async () => {
  const receipt = {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_phase_grant_verified" as const,
    disposition: "PHASE_EXECUTION_ALLOWED" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    compensationPlanSha256,
    phasePlanSha256,
    controllerContractSha256,
    grantEvidenceSha256: "5".repeat(64),
    observedAt: "2026-09-28T12:00:01.000Z",
  };
  const receiptSha256 = createHash("sha256")
    .update(canonicalJson(receipt), "utf8")
    .digest("hex");
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({
          state_revision: 14,
          current_grant_receipt_sha256: receiptSha256,
        }),
        windowRecord(),
        null,
        lifecycleActionRecord({
          status: "completed",
          completion_receipt: JSON.stringify(receipt),
          completion_receipt_sha256: receiptSha256,
          completed_at: now + 1_000,
          updated_at: now + 1_000,
        }),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const completed = await store.completeLifecycleAction({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 13,
      leaseExpiresAt: now + 120_000,
    },
    actionNumber: 1,
    receipt,
    signal: new AbortController().signal,
  });

  assert.equal(completed?.claim?.mode, "PREPARE");
  assert.equal(completed?.snapshot.operation.state, "delete_change_set_ready");
  assert.equal(completed?.snapshot.currentLifecycleAction?.status, "completed");
  assert.match(fake.calls[0].statement, /UPDATE shared_cell_author_compensation_lifecycle_actions/);
  assert.match(fake.calls[0].statement, /'lifecycle_action_completed'/);
  assert.match(fake.calls[0].statement, /FROM updated operation_row[\s\S]*?action_complete lifecycle_action/);
  assert.match(
    fake.calls[0].statement,
    /review_window\.expires_at - action\.started_at > \$18/,
  );
  assert.match(
    fake.calls[0].statement,
    /PHASE_EXECUTION_ALLOWED'[\s\S]*?review_window\.expires_at - db_clock\.now_ms > \$18/,
  );
  assert.match(
    fake.calls[0].statement,
    /REVOKE_ONLY'[\s\S]*?review_window\.expires_at - \$13 <= \$18/,
  );
});

test("completeLifecycleAction preserves a late GRANT as revoke-only reconciliation", async () => {
  const receipt = {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_phase_grant_verified" as const,
    disposition: "REVOKE_ONLY" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    compensationPlanSha256,
    phasePlanSha256,
    controllerContractSha256,
    grantEvidenceSha256: "5".repeat(64),
    observedAt: "2026-09-28T12:11:00.000Z",
  };
  const receiptSha256 = createHash("sha256")
    .update(canonicalJson(receipt), "utf8")
    .digest("hex");
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({
          state_revision: 14,
          current_grant_receipt_sha256: receiptSha256,
        }),
        windowRecord(),
        null,
        lifecycleActionRecord({
          status: "completed",
          completion_receipt: JSON.stringify(receipt),
          completion_receipt_sha256: receiptSha256,
          completed_at: now + 1_000,
          updated_at: now + 1_000,
        }),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const completed = await store.completeLifecycleAction({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 13,
      leaseExpiresAt: now + 120_000,
    },
    actionNumber: 1,
    receipt,
    signal: new AbortController().signal,
  });

  assert.equal(
    (
      completed?.snapshot.currentLifecycleAction
        ?.completionReceipt as typeof receipt
    ).disposition,
    "REVOKE_ONLY",
  );
  assert.equal(
    JSON.parse(String(fake.calls[0].values[10])).disposition,
    "REVOKE_ONLY",
  );
  assert.equal(fake.calls[0].values[12], Date.parse(receipt.observedAt));
});

test("beginLifecycleAction binds a completed-phase REVOKE to both durable predecessor receipts", async () => {
  const completionReceipt = {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_phase_completed" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    compensationPlanSha256,
    phasePlanSha256,
    controllerContractSha256,
    observedState: "REVIEW_IN_PROGRESS" as const,
    mutationPerformed: true,
    evidenceSha256: "4".repeat(64),
    observedAt: "2026-09-28T12:05:00.000Z",
  };
  const completionReceiptSha256 = createHash("sha256")
    .update(canonicalJson(completionReceipt), "utf8")
    .digest("hex");
  const request = revokeLifecycleRequest(
    "PHASE_COMPLETED",
    completionReceiptSha256,
  );
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({
          state: "delete_change_set_revoke_required",
          current_attempt_number: 1,
          state_revision: 14,
        }),
        windowRecord(),
        attemptRecord({
          status: "completed",
          completion_receipt: JSON.stringify(completionReceipt),
          completion_receipt_sha256: completionReceiptSha256,
          completed_at: now,
        }),
        lifecycleActionRecord({
          action_number: 2,
          action_kind: "REVOKE",
          revoke_reason: "PHASE_COMPLETED",
          request: JSON.stringify(request),
        }),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const claim = await store.beginLifecycleAction({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 13,
      leaseExpiresAt: now + 120_000,
    },
    windowNumber: 1,
    request,
    signal: new AbortController().signal,
  });

  assert.equal(claim?.mode, "RECOVER_ONLY");
  assert.equal(claim?.snapshot.currentLifecycleAction?.kind, "REVOKE");
  assert.match(
    fake.calls[0].statement,
    /grant_action\.status = 'completed'[\s\S]*?attempt\.status = 'completed'/,
  );
  assert.match(
    fake.calls[0].statement,
    /attempt\.completion_receipt_sha256 = \$17/,
  );
  assert.equal(fake.calls[0].values[15], grantReceiptSha256);
  assert.equal(fake.calls[0].values[16], completionReceiptSha256);
});

test("completeLifecycleAction closes an expired ready grant to fresh review and clears the claim", async () => {
  const receipt = {
    schemaVersion: 1 as const,
    action:
      "shared_cell_author_compensation_window_expired_locked_verified" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    grantReceiptSha256,
    lockedEvidenceSha256: "5".repeat(64),
    observedAt: "2026-09-28T12:11:00.000Z",
  };
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({
          state: "awaiting_delete_change_set_review",
          current_window_number: null,
          current_grant_receipt_sha256: null,
          state_revision: 14,
          lease_owner: null,
          claim_token: null,
          lease_expires_at: null,
        }),
        null,
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const completed = await store.completeLifecycleAction({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 13,
      leaseExpiresAt: now + 120_000,
    },
    actionNumber: 2,
    receipt,
    signal: new AbortController().signal,
  });

  assert.equal(completed?.claim, null);
  assert.equal(
    completed?.snapshot.operation.state,
    "awaiting_delete_change_set_review",
  );
  assert.equal(completed?.snapshot.operation.currentWindowNumber, null);
  assert.equal(completed?.snapshot.currentLifecycleAction, null);
  assert.match(
    fake.calls[0].statement,
    /review_window\.expires_at - db_clock\.now_ms <= \$18/,
  );
  assert.match(
    fake.calls[0].statement,
    /lease_owner = CASE WHEN \$9 = 'GRANT'[\s\S]*?ELSE NULL END/,
  );
  assert.equal(fake.calls[0].values[9], "WINDOW_EXPIRED");
  assert.equal(fake.calls[0].values[18], grantReceiptSha256);
});

test("beginSubmission rechecks controller digest and returns a recover-only empty-receipt attempt", async () => {
  const fake = client((_statement, _values, call) => {
    if (call === 1) {
      return { rows: [snapshotRow(operationRecord(), windowRecord())] };
    }
    return {
      rows: [
        snapshotRow(
          operationRecord({
            state: "delete_change_set_recover_only",
            current_attempt_number: 1,
            state_revision: 13,
          }),
          windowRecord(),
          attemptRecord(),
        ),
      ],
    };
  });
  const store = new NeonSharedCellAuthorCompensationOperationStore(
    fake.sql,
    () => claimToken,
  );
  const signal = new AbortController().signal;
  const receipt = await store.beginSubmission({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 12,
      leaseExpiresAt: now + 120_000,
    },
    windowNumber: 1,
    controllerContractSha256,
    mutation: {
      phase: "DELETE_CHANGE_SET",
      request: { ChangeSetName: changeSetArn, StackName: stackId },
    },
    signal,
  });
  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[1].statement, /controller_contract_sha256 = \$10/);
  assert.match(fake.calls[1].statement, /review_window\.expires_at - db_clock\.now_ms > \$11/);
  assert.match(fake.calls[1].statement, /INSERT INTO shared_cell_author_compensation_phase_attempts/);
  assert.match(fake.calls[1].statement, /'recover_only', \$12, \$13/);
  assert.match(fake.calls[1].statement, /operation\.lease_owner = \$2 AND operation\.claim_token = \$3/);
  assert.match(fake.calls[1].statement, /operation\.lease_attempt = \$4 AND operation\.state_revision = \$5/);
  assert.equal(fake.calls[1].values[9], controllerContractSha256);
  assert.equal(receipt?.snapshot.operation.state, "delete_change_set_recover_only");
  assert.equal(receipt?.snapshot.currentAttempt?.completionReceipt, null);
  assert.equal(receipt?.attemptNumber, 1);
  assert.match(receipt?.requestSha256 ?? "", /^[a-f0-9]{64}$/);
});

test("Locked advancement derives direct completion from the persisted missing receipt", async () => {
  const completionReceiptSha256 = "9".repeat(64);
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({
          state: "missing_proven_locked",
          current_phase: null,
          current_window_number: null,
          current_attempt_number: null,
          current_grant_receipt_sha256: null,
          state_revision: 15,
          lease_owner: null,
          claim_token: null,
          lease_expires_at: null,
          completed_at: now + 60_000,
        }),
        null,
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const snapshot = await store.recordLockedAndAdvance({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 14,
      leaseExpiresAt: now + 120_000,
    },
    lockedReceipt: {
      schemaVersion: 1,
      action: "shared_cell_author_compensation_locked_verified",
      operationSha256,
      phase: "DELETE_CHANGE_SET",
      completionReceiptSha256,
      lockedEvidenceSha256: "8".repeat(64),
      observedAt: "2026-09-28T12:01:00.000Z",
    },
    signal: new AbortController().signal,
  });

  assert.equal(snapshot?.operation.state, "missing_proven_locked");
  assert.equal(snapshot?.operation.currentPhase, null);
  assert.equal(snapshot?.operation.completedAt, now + 60_000);
  assert.equal(fake.calls[0].values.length, 12);
  assert.equal(fake.calls[0].values[8], completionReceiptSha256);
  assert.match(
    fake.calls[0].statement,
    /completion_receipt::jsonb #>> '\{observedState\}'/,
  );
  assert.match(fake.calls[0].statement, /SET state = eligible\.next_state/);
  assert.match(
    fake.calls[0].statement,
    /eligible\.next_state = 'missing_proven_locked'[\s\S]*?THEN eligible\.now_ms/,
  );
});

test("heartbeat matches the full live handle and does not bump the state revision", async () => {
  const nextExpiry = now + 180_000;
  const fake = client(() => ({
    rows: [
      snapshotRow(
        operationRecord({ lease_expires_at: nextExpiry }),
        windowRecord(),
      ),
    ],
  }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const handle = await store.heartbeat({
    handle: {
      operationSha256,
      workerId: "worker-new",
      claimToken,
      leaseAttempt: 5,
      stateRevision: 12,
      leaseExpiresAt: now + 120_000,
    },
    leaseDurationMs: 180_000,
    signal: new AbortController().signal,
  });
  assert.equal(handle?.stateRevision, 12);
  assert.equal(handle?.leaseExpiresAt, nextExpiry);
  assert.match(fake.calls[0].statement, /operation\.lease_expires_at > db_clock\.now_ms/);
  assert.match(fake.calls[0].statement, /operation\.state_revision = \$5/);
  assert.doesNotMatch(
    fake.calls[0].statement,
    /state_revision\s*=\s*operation\.state_revision\s*\+/,
  );
});

test("receipt methods reject cross-operation evidence before querying", async () => {
  const fake = client(() => ({ rows: [] }));
  const store = new NeonSharedCellAuthorCompensationOperationStore(fake.sql);
  const handle = {
    operationSha256,
    workerId: "worker-new",
    claimToken,
    leaseAttempt: 5,
    stateRevision: 12,
    leaseExpiresAt: now + 120_000,
  };
  const wrongOperation = "9".repeat(64);
  await assert.rejects(
    store.preparePhase({
      handle,
      windowNumber: 1,
      grantReceipt: {
        schemaVersion: 1,
        action: "shared_cell_author_compensation_phase_grant_verified",
        disposition: "PHASE_EXECUTION_ALLOWED",
        operationSha256: wrongOperation,
        phase: "DELETE_CHANGE_SET",
        compensationPlanSha256,
        phasePlanSha256,
        controllerContractSha256,
        grantEvidenceSha256: "8".repeat(64),
        observedAt: "2026-09-28T12:00:00.000Z",
      },
      signal: new AbortController().signal,
    }),
    (error) =>
      error instanceof SharedCellAuthorCompensationStoreError &&
      error.code === "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_MISMATCH",
  );
  assert.equal(fake.calls.length, 0);
});

test("stale full handles fail closed and provider failures never disclose messages", async () => {
  const empty = client(() => ({ rows: [] }));
  const stale = await new NeonSharedCellAuthorCompensationOperationStore(
    empty.sql,
  ).heartbeat({
    handle: {
      operationSha256,
      workerId: "worker-old",
      claimToken: `scac_${"2".repeat(32)}`,
      leaseAttempt: 4,
      stateRevision: 11,
      leaseExpiresAt: now - 1,
    },
    leaseDurationMs: 60_000,
    signal: new AbortController().signal,
  });
  assert.equal(stale, null);
  assert.match(empty.calls[0].statement, /lease_expires_at = \$6/);

  const failed = client(() => {
    throw new Error("postgres://secret-user:secret-password@hidden.example/db");
  });
  await assert.rejects(
    new NeonSharedCellAuthorCompensationOperationStore(
      failed.sql,
      () => claimToken,
    ).claimExactOperation({
      operationSha256,
      workerId: "worker-new",
      leaseDurationMs: 60_000,
      signal: new AbortController().signal,
    }),
    (error) => {
      assert.equal(
        (error as SharedCellAuthorCompensationStoreError).code,
        "NEON_SHARED_CELL_AUTHOR_COMPENSATION_WRITE_UNCERTAIN",
      );
      assert.doesNotMatch(String((error as Error).message), /secret|hidden\.example/i);
      return true;
    },
  );
});
