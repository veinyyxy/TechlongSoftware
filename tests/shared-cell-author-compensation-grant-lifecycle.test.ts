import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_DEFAULT_ENABLED,
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID,
  SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME,
  SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_CALLER_ARN,
  SharedCellAuthorCompensationGrantLifecycleError,
  SharedCellAuthorCompensationLifecycleReceiptProducer,
  compileSharedCellAuthorCompensationLifecycleContract,
  type SharedCellAuthorCompensationLifecycleContract,
  type SharedCellAuthorCompensationLifecycleContractInput,
  type SharedCellAuthorCompensationLifecycleRendererShape,
  type SharedCellAuthorCompensationManagementObservation,
} from "../lib/deployments/execution/shared-cell-author-compensation-grant-lifecycle.ts";
import {
  sharedCellAuthorCompensationReceiptSha256,
  type SharedCellAuthorCompensationPhaseCompletionReceipt,
} from "../lib/deployments/execution/shared-cell-author-compensation-operation-store.ts";

const accountId = "402010193138" as const;
const region = "ca-central-1" as const;
const operatorBoundaryArn =
  "arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary";
const operatorRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellOperatorRole";
const executionBoundaryArn =
  "arn:aws:iam::402010193138:policy/TechlongSandboxCellCloudFormationExecutionBoundary";
const executionRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";

const digests = Object.freeze({
  operation: "a".repeat(64),
  compensation: "b".repeat(64),
  phase: "c".repeat(64),
  controller: "d".repeat(64),
  templateRaw: "e".repeat(64),
  templateCanonical: "f".repeat(64),
  operatorBoundary: "1".repeat(64),
  executionBoundary: "2".repeat(64),
  operatorTrust: "3".repeat(64),
  executionTrust: "4".repeat(64),
});

function contractInput(
  rendererShape: SharedCellAuthorCompensationLifecycleRendererShape,
  input: Partial<SharedCellAuthorCompensationLifecycleContractInput> = {},
): SharedCellAuthorCompensationLifecycleContractInput {
  return {
    schemaVersion: 1,
    operationSha256: digests.operation,
    phase: "DELETE_CHANGE_SET",
    windowNumber: 1,
    compensationPlanSha256: digests.compensation,
    phasePlanSha256: digests.phase,
    controllerContractSha256: digests.controller,
    reviewedAt: "2026-09-29T12:00:00.000Z",
    expiresAt: "2026-09-29T12:20:00.000Z",
    rendererShape,
    templateRawSha256: digests.templateRaw,
    templateCanonicalSha256: digests.templateCanonical,
    operatorBoundaryDocumentSha256: digests.operatorBoundary,
    executionBoundaryDocumentSha256: digests.executionBoundary,
    operatorTrustPolicySha256: digests.operatorTrust,
    executionTrustPolicySha256: digests.executionTrust,
    ...input,
  };
}

function safetyState(shape: SharedCellAuthorCompensationLifecycleRendererShape) {
  return shape === "Locked"
    ? "LOCKED_IAM_MANAGEMENT_ROOT_APPLY_ENABLED_EXECUTION_NOT_APPROVED_NO_PAID_CELL"
    : shape === "AuthorCompensationDeleteChangeSetGrant"
      ? "OFFLINE_ONLY_AUTHORCOMPENSATIONDELETECHANGESETGRANT_NOT_APPLY_ENABLED_NO_PAID_CELL_APPROVAL"
      : "OFFLINE_ONLY_AUTHORCOMPENSATIONDELETESTACKGRANT_NOT_APPLY_ENABLED_NO_PAID_CELL_APPROVAL";
}

function observation(
  contract: SharedCellAuthorCompensationLifecycleContract,
  observedAt: string,
): SharedCellAuthorCompensationManagementObservation {
  return {
    schemaVersion: 1,
    accountId,
    region,
    callerArn: SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_CALLER_ARN,
    rendererShape: contract.rendererShape,
    stack: {
      name: SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME,
      id: SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID,
      status: "UPDATE_COMPLETE",
      roleArn: null,
      parentId: null,
      rootId: null,
      terminationProtection: false,
      templateRawSha256: contract.templateRawSha256,
      templateCanonicalSha256: contract.templateCanonicalSha256,
      safetyState: safetyState(contract.rendererShape),
      resources: [
        {
          logicalId: "CellOperatorBoundary",
          resourceType: "AWS::IAM::ManagedPolicy",
          physicalResourceId: operatorBoundaryArn,
          resourceStatus: "UPDATE_COMPLETE",
        },
        {
          logicalId: "CellOperatorRole",
          resourceType: "AWS::IAM::Role",
          physicalResourceId: "TechlongSandboxCellOperatorRole",
          resourceStatus: "UPDATE_COMPLETE",
        },
        {
          logicalId: "CellCloudFormationExecutionBoundary",
          resourceType: "AWS::IAM::ManagedPolicy",
          physicalResourceId: executionBoundaryArn,
          resourceStatus: "UPDATE_COMPLETE",
        },
        {
          logicalId: "CellCloudFormationExecutionRole",
          resourceType: "AWS::IAM::Role",
          physicalResourceId: "TechlongSandboxCellCloudFormationExecutionRole",
          resourceStatus: "UPDATE_COMPLETE",
        },
      ],
    },
    policies: [
      {
        logicalId: "CellOperatorBoundary",
        arn: operatorBoundaryArn,
        name: "TechlongSandboxCellOperatorBoundary",
        defaultVersionId: "v2",
        versionIds: ["v1", "v2"],
        defaultDocumentSha256: contract.operatorBoundaryDocumentSha256,
        attachmentCount: 1,
        permissionsBoundaryUsageCount: 1,
        identityRoleArns: [operatorRoleArn],
        boundaryRoleArns: [operatorRoleArn],
      },
      {
        logicalId: "CellCloudFormationExecutionBoundary",
        arn: executionBoundaryArn,
        name: "TechlongSandboxCellCloudFormationExecutionBoundary",
        defaultVersionId: "v1",
        versionIds: ["v1"],
        defaultDocumentSha256: contract.executionBoundaryDocumentSha256,
        attachmentCount: 0,
        permissionsBoundaryUsageCount: 1,
        identityRoleArns: [],
        boundaryRoleArns: [executionRoleArn],
      },
    ],
    roles: [
      {
        logicalId: "CellOperatorRole",
        arn: operatorRoleArn,
        name: "TechlongSandboxCellOperatorRole",
        permissionsBoundaryArn: operatorBoundaryArn,
        attachedPolicyArns: [operatorBoundaryArn],
        inlinePolicyNames: [],
        trustPolicySha256: contract.operatorTrustPolicySha256,
      },
      {
        logicalId: "CellCloudFormationExecutionRole",
        arn: executionRoleArn,
        name: "TechlongSandboxCellCloudFormationExecutionRole",
        permissionsBoundaryArn: executionBoundaryArn,
        attachedPolicyArns: [],
        inlinePolicyNames: [],
        trustPolicySha256: contract.executionTrustPolicySha256,
      },
    ],
    cellStackState: "MISSING",
    authorityState: "ABSENT",
    observedAt,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface MutableObservationFixture {
  callerArn: string;
  region: string;
  authorityState: string;
  stack: {
    templateRawSha256: string;
    resources: unknown[];
  };
  policies: Array<{ defaultDocumentSha256: string }>;
  roles: Array<{ inlinePolicyNames: string[]; trustPolicySha256: string }>;
}

function producerFrom(observations: unknown[]) {
  let calls = 0;
  const producer = new SharedCellAuthorCompensationLifecycleReceiptProducer({
    async readManagementObservation() {
      const value = observations[calls++];
      if (value === undefined) throw new Error("unexpected read");
      return value;
    },
  });
  return { producer, calls: () => calls };
}

function lifecycleError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof SharedCellAuthorCompensationGrantLifecycleError);
    assert.equal(error.code, code);
    return true;
  };
}

test("lifecycle receipt producer is dormant, constructor-only, and brands stable exact evidence", async () => {
  assert.equal(
    SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_DEFAULT_ENABLED,
    false,
  );
  const contract = await compileSharedCellAuthorCompensationLifecycleContract(
    contractInput("AuthorCompensationDeleteChangeSetGrant"),
  );
  const source = producerFrom([
    observation(contract, "2026-09-29T12:05:00.000Z"),
    observation(contract, "2026-09-29T12:05:00.001Z"),
  ]);
  assert.equal(source.calls(), 0);
  const evidence = await source.producer.reviewTarget({
    contract,
    signal: new AbortController().signal,
  });
  assert.equal(source.calls(), 2);
  assert.match(evidence.evidenceSha256, /^[a-f0-9]{64}$/);

  const receipt = await source.producer.createPhaseGrantReceipt({
    contract,
    evidence,
  });
  assert.equal(receipt.operationSha256, contract.operationSha256);
  assert.equal(receipt.phase, "DELETE_CHANGE_SET");
  assert.equal(receipt.disposition, "PHASE_EXECUTION_ALLOWED");
  assert.equal(receipt.grantEvidenceSha256, evidence.evidenceSha256);

  await assert.rejects(
    source.producer.createPhaseGrantReceipt({
      contract,
      evidence: clone(evidence),
    }),
    lifecycleError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_UNTRUSTED",
    ),
  );
});

test("phase completion and expired ready windows receive distinct hash-bound Locked receipts", async () => {
  const grantContract =
    await compileSharedCellAuthorCompensationLifecycleContract(
      contractInput("AuthorCompensationDeleteChangeSetGrant"),
    );
  const grantSource = producerFrom([
    observation(grantContract, "2026-09-29T12:05:00.000Z"),
    observation(grantContract, "2026-09-29T12:05:00.001Z"),
  ]);
  const grantEvidence = await grantSource.producer.reviewTarget({
    contract: grantContract,
    signal: new AbortController().signal,
  });
  const grantReceipt = await grantSource.producer.createPhaseGrantReceipt({
    contract: grantContract,
    evidence: grantEvidence,
  });

  const lockedContract =
    await compileSharedCellAuthorCompensationLifecycleContract(
      contractInput("Locked", {
        templateRawSha256: "5".repeat(64),
        templateCanonicalSha256: "6".repeat(64),
        operatorBoundaryDocumentSha256: "7".repeat(64),
      }),
    );
  const completionSource = producerFrom([
    observation(lockedContract, "2026-09-29T12:07:00.000Z"),
    observation(lockedContract, "2026-09-29T12:07:00.001Z"),
  ]);
  const completionEvidence = await completionSource.producer.reviewTarget({
    contract: lockedContract,
    signal: new AbortController().signal,
  });
  const completionReceipt = {
    schemaVersion: 1,
    action: "shared_cell_author_compensation_phase_completed",
    operationSha256: lockedContract.operationSha256,
    phase: lockedContract.phase,
    compensationPlanSha256: lockedContract.compensationPlanSha256,
    phasePlanSha256: lockedContract.phasePlanSha256,
    controllerContractSha256: lockedContract.controllerContractSha256,
    observedState: "REVIEW_IN_PROGRESS",
    mutationPerformed: true,
    evidenceSha256: "8".repeat(64),
    observedAt: "2026-09-29T12:06:00.000Z",
  } as const satisfies SharedCellAuthorCompensationPhaseCompletionReceipt;
  const locked =
    await completionSource.producer.createPhaseCompletedLockedReceipt({
      contract: lockedContract,
      evidence: completionEvidence,
      completionReceipt,
    });
  assert.equal(
    locked.completionReceiptSha256,
    await sharedCellAuthorCompensationReceiptSha256(completionReceipt),
  );

  const expirySource = producerFrom([
    observation(lockedContract, "2026-09-29T12:11:00.000Z"),
    observation(lockedContract, "2026-09-29T12:11:00.001Z"),
  ]);
  const expiryEvidence = await expirySource.producer.reviewTarget({
    contract: lockedContract,
    signal: new AbortController().signal,
  });
  const expired = await expirySource.producer.createWindowExpiredLockedReceipt({
    contract: lockedContract,
    evidence: expiryEvidence,
    grantReceipt,
  });
  assert.equal(
    expired.grantReceiptSha256,
    await sharedCellAuthorCompensationReceiptSha256(grantReceipt),
  );
  assert.equal(expired.lockedEvidenceSha256, expiryEvidence.evidenceSha256);
});

test("management readback fails closed on identity, template, IAM, inventory, and stability drift", async (t) => {
  const contract = await compileSharedCellAuthorCompensationLifecycleContract(
    contractInput("AuthorCompensationDeleteChangeSetGrant"),
  );
  const baseline = observation(contract, "2026-09-29T12:05:00.000Z");
  const cases: Array<[string, (value: MutableObservationFixture) => void]> = [
    ["caller", (value) => (value.callerArn = operatorRoleArn)],
    ["region", (value) => (value.region = "us-east-1")],
    ["template", (value) => (value.stack.templateRawSha256 = "9".repeat(64))],
    ["inventory", (value) => value.stack.resources.pop()],
    [
      "policy",
      (value) => (value.policies[0].defaultDocumentSha256 = "9".repeat(64)),
    ],
    ["role", (value) => value.roles[0].inlinePolicyNames.push("unexpected")],
    ["authority", (value) => (value.authorityState = "PRESENT")],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, async () => {
      const drifted = clone(baseline) as unknown as MutableObservationFixture;
      mutate(drifted);
      const source = producerFrom([
        drifted,
        observation(contract, "2026-09-29T12:05:00.001Z"),
      ]);
      await assert.rejects(
        source.producer.reviewTarget({
          contract,
          signal: new AbortController().signal,
        }),
        lifecycleError(
          "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
        ),
      );
    });
  }

  const unstable = clone(baseline) as unknown as MutableObservationFixture;
  unstable.roles[0].trustPolicySha256 = "9".repeat(64);
  const source = producerFrom([
    baseline,
    {
      ...unstable,
      observedAt: "2026-09-29T12:05:00.001Z",
    },
  ]);
  await assert.rejects(
    source.producer.reviewTarget({
      contract,
      signal: new AbortController().signal,
    }),
    lifecycleError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
    ),
  );

  const repeated = producerFrom([baseline, clone(baseline)]);
  await assert.rejects(
    repeated.producer.reviewTarget({
      contract,
      signal: new AbortController().signal,
    }),
    lifecycleError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_UNSTABLE",
    ),
  );
});

test("late grant reconciliation is revoke-only while expired-window Locked proof remains cutoff-bound", async () => {
  const grantContract =
    await compileSharedCellAuthorCompensationLifecycleContract(
      contractInput("AuthorCompensationDeleteChangeSetGrant"),
    );
  const tooLate = producerFrom([
    observation(grantContract, "2026-09-29T12:10:00.000Z"),
    observation(grantContract, "2026-09-29T12:10:00.001Z"),
  ]);
  const tooLateEvidence = await tooLate.producer.reviewTarget({
    contract: grantContract,
    signal: new AbortController().signal,
  });
  const revokeOnlyReceipt = await tooLate.producer.createPhaseGrantReceipt({
    contract: grantContract,
    evidence: tooLateEvidence,
  });
  assert.equal(revokeOnlyReceipt.disposition, "REVOKE_ONLY");

  const earlyGrantSource = producerFrom([
    observation(grantContract, "2026-09-29T12:05:00.000Z"),
    observation(grantContract, "2026-09-29T12:05:00.001Z"),
  ]);
  const earlyGrantEvidence = await earlyGrantSource.producer.reviewTarget({
    contract: grantContract,
    signal: new AbortController().signal,
  });
  const earlyGrantReceipt =
    await earlyGrantSource.producer.createPhaseGrantReceipt({
      contract: grantContract,
      evidence: earlyGrantEvidence,
    });
  const lockedContract =
    await compileSharedCellAuthorCompensationLifecycleContract(
      contractInput("Locked", {
        templateRawSha256: "5".repeat(64),
        templateCanonicalSha256: "6".repeat(64),
        operatorBoundaryDocumentSha256: "7".repeat(64),
      }),
    );
  const beforeCutoff = producerFrom([
    observation(lockedContract, "2026-09-29T12:09:59.998Z"),
    observation(lockedContract, "2026-09-29T12:09:59.999Z"),
  ]);
  const beforeCutoffEvidence = await beforeCutoff.producer.reviewTarget({
    contract: lockedContract,
    signal: new AbortController().signal,
  });
  await assert.rejects(
    beforeCutoff.producer.createWindowExpiredLockedReceipt({
      contract: lockedContract,
      evidence: beforeCutoffEvidence,
      grantReceipt: earlyGrantReceipt,
    }),
    lifecycleError(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_WINDOW_OPEN",
    ),
  );

  const afterCutoff = producerFrom([
    observation(lockedContract, "2026-09-29T12:10:00.000Z"),
    observation(lockedContract, "2026-09-29T12:10:00.001Z"),
  ]);
  const afterCutoffEvidence = await afterCutoff.producer.reviewTarget({
    contract: lockedContract,
    signal: new AbortController().signal,
  });
  const locked = await afterCutoff.producer.createWindowExpiredLockedReceipt({
    contract: lockedContract,
    evidence: afterCutoffEvidence,
    grantReceipt: earlyGrantReceipt,
  });
  assert.equal(locked.observedAt, "2026-09-29T12:10:00.001Z");
});
