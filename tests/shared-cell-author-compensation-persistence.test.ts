import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SHARED_CELL_AUTHOR_COMPENSATION_OPERATION_STATES,
  SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS,
  SharedCellAuthorCompensationStoreError,
  assertSharedCellAuthorCompensationLockedReceipt,
  assertSharedCellAuthorCompensationPhaseCompletionReceipt,
  compileSharedCellAuthorCompensationMutationRequest,
  sharedCellAuthorCompensationReceiptSha256,
  type SharedCellAuthorCompensationOperation,
} from "../lib/deployments/execution/shared-cell-author-compensation-operation-store.ts";

const digest = (character: string) => character.repeat(64);
const operationSha256 = digest("a");
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  "techlong-sandbox-cell-sandbox-1/12345678-1234-4234-8234-123456789012";
const changeSetArn =
  "arn:aws:cloudformation:ca-central-1:402010193138:changeSet/" +
  "techlong-sandbox-cell-sandbox-1-1111111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const stableToken = `b5-author-comp-${operationSha256.slice(0, 32)}`;

const operationTargets: Pick<
  SharedCellAuthorCompensationOperation,
  "changeSetArn" | "deleteStackClientRequestToken" | "stackId"
> = {
  changeSetArn,
  deleteStackClientRequestToken: stableToken,
  stackId,
};

test("0009 defines independent append-only durable compensation state", async () => {
  const migration = await readFile(
    new URL("../db/postgres-migrations/0009_shared_cell_author_compensation_persistence.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "shared_cell_author_compensation_operations",
    "shared_cell_author_compensation_review_windows",
    "shared_cell_author_compensation_phase_attempts",
    "shared_cell_author_compensation_events",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}\\b`));
  }
  assert.match(migration, /operation_sha256 text PRIMARY KEY[\s\S]*?\^\[a-f0-9\]\{64\}\$/);
  assert.match(migration, /controller_contract_sha256 text NOT NULL/);
  assert.match(migration, /status text NOT NULL DEFAULT 'recover_only'/);
  assert.match(migration, /shared_cell_author_compensation_windows_append_only/);
  assert.match(migration, /shared_cell_author_compensation_events_append_only/);
  assert.match(migration, /Completed Shared Cell author compensation attempt is immutable/);
  assert.match(migration, /Completed Shared Cell author compensation operation is immutable/);
  assert.match(migration, /ON DELETE RESTRICT/g);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
  assert.doesNotMatch(migration, /deployment_jobs|deployment_tenant_cleanup_phases/);
});

test("prepared review windows roll forward only after the DB cutoff and before any grant or attempt", async () => {
  const migration = await readFile(
    new URL("../db/postgres-migrations/0009_shared_cell_author_compensation_persistence.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    migration,
    /NEW\.state IN \('delete_change_set_prepared', 'delete_stack_prepared'\)/,
  );
  assert.match(
    migration,
    /NEW\.current_window_number = OLD\.current_window_number \+ 1/,
  );
  assert.match(
    migration,
    /OLD\.current_attempt_number IS NULL AND NEW\.current_attempt_number IS NULL/,
  );
  assert.match(
    migration,
    /OLD\.current_grant_receipt_sha256 IS NULL[\s\S]*?NEW\.current_grant_receipt_sha256 IS NULL/,
  );
  assert.match(
    migration,
    /prior_window\.expires_at[\s\S]*?clock_timestamp\(\)[\s\S]*?WHEN 'DELETE_CHANGE_SET' THEN 600000[\s\S]*?WHEN 'DELETE_STACK' THEN 300000/,
  );
  assert.match(
    migration,
    /OLD\.state = 'delete_change_set_revoke_required' AND NEW\.state = 'missing_proven_locked'/,
  );
});

test("Neon write CTEs hydrate new rows from RETURNING and keep rollover narrowly fenced", async () => {
  const adapter = await readFile(
    new URL(
      "../lib/deployments/execution/neon-shared-cell-author-compensation-operation-store.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const method = (start: string, end: string) => {
    const startIndex = adapter.indexOf(`async ${start}`);
    const endIndex = adapter.indexOf(`async ${end}`, startIndex + 1);
    assert.notEqual(startIndex, -1);
    assert.notEqual(endIndex, -1);
    return adapter.slice(startIndex, endIndex);
  };

  const create = method("createOrLoadOperation", "appendReviewedWindow");
  assert.match(
    create,
    /SELECT inserted\.\*, true AS was_created[\s\S]*?UNION ALL[\s\S]*?NOT EXISTS \(SELECT 1 FROM inserted\)/,
  );
  assert.match(create, /FROM selected operation_row/);
  assert.match(
    create,
    /LEFT JOIN shared_cell_author_compensation_review_windows review_window/,
  );
  assert.match(
    create,
    /LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt/,
  );

  const append = method("appendReviewedWindow", "claimExactOperation");
  assert.match(append, /operation\.state = \$4[\s\S]*?operation\.state = \$5/);
  assert.match(
    append,
    /current_window\.expires_at - db_clock\.now_ms <= \$12/,
  );
  assert.match(append, /FOR UPDATE OF operation/);
  assert.match(append, /FROM updated operation_row[\s\S]*?JOIN window_insert review_window/);

  const claim = method("claimExactOperation", "preparePhase");
  assert.match(claim, /LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt/);
  assert.doesNotMatch(claim, /JOIN attempt_insert phase_attempt/);

  const prepare = method("preparePhase", "beginSubmission");
  assert.match(prepare, /LEFT JOIN shared_cell_author_compensation_phase_attempts phase_attempt/);
  assert.doesNotMatch(prepare, /JOIN attempt_complete phase_attempt/);

  const begin = method("beginSubmission", "completePhase");
  assert.match(begin, /FROM updated operation_row[\s\S]*?JOIN attempt_insert phase_attempt/);

  const complete = method("completePhase", "recordLockedAndAdvance");
  assert.match(
    complete,
    /FROM updated operation_row[\s\S]*?JOIN attempt_complete phase_attempt/,
  );

  const locked = method("recordLockedAndAdvance", "heartbeat");
  assert.match(
    locked,
    /NULL::text AS window_record, NULL::text AS attempt_record[\s\S]*?FROM updated operation_row/,
  );
  assert.match(
    locked,
    /attempt\.completion_receipt::jsonb #>> '\{observedState\}'/,
  );
  assert.match(locked, /SET state = eligible\.next_state/);
  assert.match(
    locked,
    /eligible\.next_state = 'missing_proven_locked'[\s\S]*?THEN eligible\.now_ms/,
  );
});

test("the state vocabulary makes every submitted phase permanently recover-only until revoke", () => {
  assert.deepEqual(
    SHARED_CELL_AUTHOR_COMPENSATION_OPERATION_STATES.filter((state) =>
      state.endsWith("recover_only"),
    ),
    ["delete_change_set_recover_only", "delete_stack_recover_only"],
  );
  assert.deepEqual(
    SHARED_CELL_AUTHOR_COMPENSATION_OPERATION_STATES.filter((state) =>
      state.endsWith("revoke_required"),
    ),
    ["delete_change_set_revoke_required", "delete_stack_revoke_required"],
  );
  assert.equal(SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS.DELETE_CHANGE_SET, 600_000);
  assert.equal(SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS.DELETE_STACK, 300_000);
});

test("write-ahead mutation requests are exact-target and deterministically hashed", async () => {
  const deleteChangeSet = await compileSharedCellAuthorCompensationMutationRequest(
    operationTargets,
    {
      phase: "DELETE_CHANGE_SET",
      request: { ChangeSetName: changeSetArn, StackName: stackId },
    },
  );
  assert.match(deleteChangeSet.requestSha256, /^[a-f0-9]{64}$/);
  assert.equal(deleteChangeSet.clientRequestToken, null);
  assert.equal(
    deleteChangeSet.requestSha256,
    (
      await compileSharedCellAuthorCompensationMutationRequest(
        operationTargets,
        deleteChangeSet.request,
      )
    ).requestSha256,
  );

  const deleteStack = await compileSharedCellAuthorCompensationMutationRequest(
    operationTargets,
    {
      phase: "DELETE_STACK",
      request: {
        StackName: stackId,
        DeletionMode: "STANDARD",
        ClientRequestToken: stableToken,
      },
    },
  );
  assert.equal(deleteStack.clientRequestToken, stableToken);

  await assert.rejects(
    compileSharedCellAuthorCompensationMutationRequest(operationTargets, {
      phase: "DELETE_STACK",
      request: {
        StackName: stackId,
        DeletionMode: "STANDARD",
        ClientRequestToken: `${stableToken}-drift`,
      },
    }),
    (error) =>
      error instanceof SharedCellAuthorCompensationStoreError &&
      error.code === "SHARED_CELL_AUTHOR_COMPENSATION_STORE_REQUEST_INVALID",
  );
});

test("completion and Locked receipts are closed, exact, and digest-bound", async () => {
  const completion = {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_phase_completed" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    compensationPlanSha256: digest("b"),
    phasePlanSha256: digest("c"),
    controllerContractSha256: digest("d"),
    observedState: "MISSING" as const,
    mutationPerformed: false,
    evidenceSha256: digest("e"),
    observedAt: "2026-09-28T12:00:00.000Z",
  };
  assertSharedCellAuthorCompensationPhaseCompletionReceipt(completion);
  const completionReceiptSha256 = await sharedCellAuthorCompensationReceiptSha256(completion);
  const locked = {
    schemaVersion: 1 as const,
    action: "shared_cell_author_compensation_locked_verified" as const,
    operationSha256,
    phase: "DELETE_CHANGE_SET" as const,
    completionReceiptSha256,
    lockedEvidenceSha256: digest("f"),
    observedAt: "2026-09-28T12:01:00.000Z",
  };
  assertSharedCellAuthorCompensationLockedReceipt(locked);
  assert.match(await sharedCellAuthorCompensationReceiptSha256(locked), /^[a-f0-9]{64}$/);

  assert.throws(
    () =>
      assertSharedCellAuthorCompensationLockedReceipt({
        ...locked,
        unexpected: "field",
      }),
    (error) =>
      error instanceof SharedCellAuthorCompensationStoreError &&
      error.code === "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID",
  );
  assert.throws(
    () =>
      assertSharedCellAuthorCompensationPhaseCompletionReceipt({
        ...completion,
        phase: "DELETE_STACK",
        observedState: "REVIEW_IN_PROGRESS",
      }),
    (error) =>
      error instanceof SharedCellAuthorCompensationStoreError &&
      error.code === "SHARED_CELL_AUTHOR_COMPENSATION_STORE_RECEIPT_INVALID",
  );
});
