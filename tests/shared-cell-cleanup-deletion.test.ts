import assert from "node:assert/strict";
import test from "node:test";
import {
  executeReviewedSharedCellCleanupDeletion,
  inspectSharedCellCleanupDeletion,
  recoverReviewedSharedCellCleanupDeletion,
  SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
  type SharedCellCleanupDeleteStackPort,
  type SharedCellCleanupDeletionEvidenceReadPort,
  type StrongSharedCellCleanupAuthorityReadPort,
} from "../lib/deployments/execution/shared-cell-cleanup-deletion.ts";
import {
  compileSharedCellCleanupAuthorityCandidateItem,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type SharedCellCleanupAuthorityItem,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const now = Date.UTC(2026, 8, 7, 12, 0, 0);
const cellExpiresAt = new Date(now - 60_000).toISOString();
const authorityExpiresAt = new Date(now + 15 * 60_000).toISOString();
const stackName = "techlong-sandbox-cell-sandbox-1";
const stackId =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${stackName}/12345678-1234-1234-1234-123456789012`;
const janitorCaller =
  "arn:aws:sts::402010193138:assumed-role/" +
  "TechlongSandboxCellJanitorExecutionRole/cell-janitor";
const template = {
  AWSTemplateFormatVersion: "2010-09-09",
  Resources: {
    CellCluster: { Type: "AWS::ECS::Cluster" },
    CellLogGroup: { Type: "AWS::Logs::LogGroup" },
  },
};
const inventory = [
  {
    logicalResourceId: "CellCluster",
    physicalResourceId: "cell-sandbox-1",
    resourceStatus: "CREATE_COMPLETE",
    resourceType: "AWS::ECS::Cluster",
  },
  {
    logicalResourceId: "CellLogGroup",
    physicalResourceId: "/aws/techlong/cell-sandbox-1",
    resourceStatus: "CREATE_COMPLETE",
    resourceType: "AWS::Logs::LogGroup",
  },
];

async function authorityItem(): Promise<Readonly<SharedCellCleanupAuthorityItem>> {
  const templateCanonicalSha256 = await sha256Hex(template);
  const resourceInventorySha256 = await sha256Hex(inventory);
  const provision = {
    schemaVersion: 1 as const,
    accountId: "402010193138" as const,
    region: "ca-central-1" as const,
    cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const,
    stackId,
    stackStatus: "CREATE_COMPLETE" as const,
    cellExpiresAt,
    templateCanonicalSha256,
    resourceInventorySha256,
    ownerDeploymentId: "deployment_cell_owner_1",
    generation: 1,
    provisionEpoch: 1,
    provisionMarker: sharedCellAuthorityMarker({ generation: 1, epoch: 1 }),
  };
  const operationHash = await sha256Hex(
    sharedCellProvisionOperationIntent(provision),
  );
  return compileSharedCellCleanupAuthorityCandidateItem({
    cell: {
      stackName: "techlong-sandbox-cell-sandbox-1",
      stackId,
      stackStatus: "CREATE_COMPLETE",
      cellExpiresAt,
      templateCanonicalSha256,
      resourceInventorySha256,
    },
    provision: {
      ownerDeploymentId: provision.ownerDeploymentId,
      generation: 1,
      epoch: 1,
      operationHash,
    },
    cleanup: { epoch: 2, expiresAt: authorityExpiresAt },
    revision: 2,
    now,
  });
}

type DeleteBehavior =
  | "success"
  | "lost_then_missing"
  | "lost_still_present"
  | "accepted_still_present"
  | "delete_failed"
  | "rollback_failed";

async function fixture(input: {
  callerArn?: string;
  callerAt?: (call: number) => string;
  stackRoleArn?: string;
  stackNames?: string[];
  mutateTemplateAt?: number;
  nonzeroOwnershipAt?: number;
  zeroTenantObservedAt?: number;
  malformedAuthorityAt?: number;
  behavior?: DeleteBehavior;
  authority?: SharedCellCleanupAuthorityItem;
} = {}) {
  let present = true;
  let status = "CREATE_COMPLETE";
  let callerCalls = 0;
  let describeCalls = 0;
  let templateCalls = 0;
  let resourceCalls = 0;
  let authorityReads = 0;
  let authorityWrites = 0;
  let zeroTenantReads = 0;
  const deleteInputs: Parameters<SharedCellCleanupDeleteStackPort["deleteStack"]>[0][] = [];
  const fixedNames = input.stackNames;
  const item = input.authority ?? (await authorityItem());
  const ownershipSource = {
    activeTenantIds: [],
    activeCapacityReservationIds: [],
    nonterminalDeploymentIds: [],
    liveTenantResourceIds: [],
    nonterminalTenantCleanupScheduleIds: [],
  };
  const ownershipSourceHash = await sha256Hex(ownershipSource);

  const stack = () => ({
    state: "present",
    stack: {
      stackName,
      stackId,
      stackStatus: status,
      roleArn: input.stackRoleArn ?? SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
      terminationProtection: false,
      parentId: null,
      rootId: null,
      tags: {
        Environment: "aws-sandbox",
        ManagedBy: "techlong-cell-operator",
        CellId: "cell-sandbox-1",
        ExpiresAt: cellExpiresAt,
      },
    },
  });

  const evidence: SharedCellCleanupDeletionEvidenceReadPort = {
    region: "ca-central-1",
    async getCallerIdentity() {
      callerCalls += 1;
      return {
        accountId: "402010193138",
        arn:
          input.callerAt?.(callerCalls) ?? input.callerArn ?? janitorCaller,
      };
    },
    async listStackNamesPage() {
      const names = fixedNames ?? (present ? [stackName] : []);
      return { stackNames: [...names], nextToken: null };
    },
    async describeCellStack() {
      describeCalls += 1;
      return present
        ? stack()
        : {
            state: "missing",
            stackName,
            proof: "NAME_BOUND_VALIDATION_ERROR",
          };
    },
    async getOriginalTemplate() {
      templateCalls += 1;
      if (input.mutateTemplateAt === templateCalls) {
        return {
          ...template,
          Description: "drift",
        };
      }
      return structuredClone(template);
    },
    async listStackResourcesPage() {
      resourceCalls += 1;
      return { resources: structuredClone(inventory), nextToken: null };
    },
    async readStrongZeroTenantOwnershipSnapshot() {
      zeroTenantReads += 1;
      return {
        schemaVersion: 1,
        accountId: "402010193138",
        region: "ca-central-1",
        cellId: "cell-sandbox-1",
        environmentId: "env_aws_sandbox_ca_central_1",
        observedAt: input.zeroTenantObservedAt ?? now,
        activeTenantCount:
          input.nonzeroOwnershipAt === zeroTenantReads ? 1 : 0,
        activeCapacityReservationCount: 0,
        nonterminalDeploymentCount: 0,
        liveTenantResourceCount: 0,
        nonterminalTenantCleanupScheduleCount: 0,
        sourceSnapshot: structuredClone(ownershipSource),
        sourceSnapshotSha256: ownershipSourceHash,
      };
    },
  };

  const authority: StrongSharedCellCleanupAuthorityReadPort & {
    compareAndSet(): Promise<never>;
  } = {
    async readStrong() {
      authorityReads += 1;
      return {
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        revision:
          input.malformedAuthorityAt === authorityReads
            ? item.revision + 1
            : item.revision,
        item,
      };
    },
    async compareAndSet() {
      authorityWrites += 1;
      throw new Error("cleanup deleter must not write authority");
    },
  };

  const behavior = input.behavior ?? "success";
  const deleter: SharedCellCleanupDeleteStackPort = {
    async deleteStack(request) {
      deleteInputs.push(structuredClone(request));
      if (behavior === "success") {
        present = false;
        return { operation: "delete_submitted" };
      }
      if (behavior === "lost_then_missing") {
        present = false;
        throw new Error("DeleteStack response lost");
      }
      if (behavior === "accepted_still_present") {
        return { operation: "delete_submitted" };
      }
      if (behavior === "delete_failed") status = "DELETE_FAILED";
      if (behavior === "rollback_failed") status = "ROLLBACK_FAILED";
      throw new Error("DeleteStack response lost");
    },
  };

  return {
    evidence,
    authority,
    deleter,
    deleteInputs,
    calls: () => ({
      callerCalls,
      describeCalls,
      templateCalls,
      resourceCalls,
      authorityReads,
      authorityWrites,
      zeroTenantReads,
    }),
    setMissing: () => {
      present = false;
    },
  };
}

const signal = () => new AbortController().signal;
const noWait = async () => {};

test("inspect double-reads stable exact evidence and strong authority without mutation", async () => {
  const subject = await fixture();
  const result = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => now,
  });
  assert.equal(result.phase, "INSPECTED");
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.roleArn, SHARED_CELL_CLEANUP_DELETION_ROLE_ARN);
  assert.equal(result.stackId, stackId);
  assert.match(result.deletionPlanSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.clientRequestToken, `cell-delete-${result.deletionPlanSha256}`);
  assert.deepEqual(subject.calls(), {
    callerCalls: 2,
    describeCalls: 2,
    templateCalls: 2,
    resourceCalls: 2,
    authorityReads: 2,
    authorityWrites: 0,
    zeroTenantReads: 2,
  });
  assert.equal(subject.deleteInputs.length, 0);
});

test("only the Cell Janitor execution-role session can enter cleanup", async () => {
  for (const callerArn of [
    "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/operator",
    "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/provisioner",
    "arn:aws:iam::402010193138:role/TechlongSandboxCellJanitorExecutionRole",
  ]) {
    const subject = await fixture({ callerArn });
    await assert.rejects(
      inspectSharedCellCleanupDeletion({
        evidence: subject.evidence,
        authority: subject.authority,
        signal: signal(),
        now: () => now,
      }),
      (error) =>
        (error as { code?: string }).code === "SHARED_CELL_DELETE_CALLER_INVALID",
    );
    assert.equal(subject.calls().describeCalls, 0);
  }
});

test("the generic predecessor CloudFormation role is not a valid deletion target", async () => {
  const subject = await fixture({
    stackRoleArn:
      "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole",
  });
  await assert.rejects(
    inspectSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      signal: signal(),
      now: () => now,
    }),
    (error) =>
      (error as { code?: string }).code === "SHARED_CELL_DELETE_STACK_DRIFT",
  );
  assert.equal(subject.deleteInputs.length, 0);
});

test("unstable Original template evidence fails before approval", async () => {
  const subject = await fixture({ mutateTemplateAt: 2 });
  await assert.rejects(
    inspectSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      signal: signal(),
      now: () => now,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_EVIDENCE_CHANGED",
  );
  assert.equal(subject.deleteInputs.length, 0);
});

test("strong cleanup authority must remain exact across the evidence sandwich", async () => {
  const subject = await fixture({ malformedAuthorityAt: 2 });
  await assert.rejects(
    inspectSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      signal: signal(),
      now: () => now,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_AUTHORITY_INVALID",
  );
  assert.equal(subject.calls().describeCalls, 2);
  assert.equal(subject.deleteInputs.length, 0);
});

test("tenant or unexpected Cell Stack inventory blocks all target evidence reads", async () => {
  for (const forbidden of [
    "techlong-sandbox-tenant-live-one",
    "techlong-sandbox-cell-foreign",
  ]) {
    const subject = await fixture({ stackNames: [stackName, forbidden] });
    await assert.rejects(
      inspectSharedCellCleanupDeletion({
        evidence: subject.evidence,
        authority: subject.authority,
        signal: signal(),
        now: () => now,
      }),
      (error) =>
        String((error as { code?: string }).code).startsWith(
          "SHARED_CELL_DELETE_",
        ),
    );
    assert.equal(subject.calls().describeCalls, 0);
    assert.equal(subject.deleteInputs.length, 0);
  }
});

test("strong zero-tenant ownership is double-read and rechecked before DeleteStack", async () => {
  const subject = await fixture({ nonzeroOwnershipAt: 6 });
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => now,
  });
  await assert.rejects(
    executeReviewedSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      deleter: subject.deleter,
      approvedDeletionPlanSha256: inspected.deletionPlanSha256,
      signal: signal(),
      now: () => now,
      readbackDelayMs: 0,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_ZERO_TENANT_INVALID",
  );
  assert.equal(subject.deleteInputs.length, 0);
  assert.equal(subject.calls().authorityWrites, 0);
});

test("zero-tenant ownership collected before Cell expiry is rejected", async () => {
  const subject = await fixture({
    zeroTenantObservedAt: Date.parse(cellExpiresAt) - 1,
  });
  await assert.rejects(
    inspectSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      signal: signal(),
      now: () => now,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_ZERO_TENANT_INVALID",
  );
  assert.equal(subject.deleteInputs.length, 0);
});

test("execute recompiles, rechecks at the boundary and sends one exact STANDARD DeleteStack", async () => {
  const subject = await fixture();
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => now,
  });
  const result = await executeReviewedSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    deleter: subject.deleter,
    approvedDeletionPlanSha256: inspected.deletionPlanSha256,
    signal: signal(),
    now: () => now,
    readbackDelayMs: 0,
  });
  assert.equal(result.phase, "DELETED");
  assert.equal(result.mutationPerformed, true);
  assert.equal(subject.deleteInputs.length, 1);
  assert.deepEqual(subject.deleteInputs[0].request, {
    StackName: stackId,
    RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
    ClientRequestToken: inspected.clientRequestToken,
    DeletionMode: "STANDARD",
  });
  assert.equal(
    Object.hasOwn(subject.deleteInputs[0].request, "RetainResources"),
    false,
  );
  assert.equal(subject.calls().authorityWrites, 0);
});

test("caller drift in the final pre-DeleteStack check prevents mutation", async () => {
  const approvedSubject = await fixture();
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: approvedSubject.evidence,
    authority: approvedSubject.authority,
    signal: signal(),
    now: () => now,
  });
  const executeSubject = await fixture({
    callerAt: (call) =>
      call === 4
        ? "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/operator"
        : janitorCaller,
  });
  await assert.rejects(
    executeReviewedSharedCellCleanupDeletion({
      evidence: executeSubject.evidence,
      authority: executeSubject.authority,
      deleter: executeSubject.deleter,
      approvedDeletionPlanSha256: inspected.deletionPlanSha256,
      signal: signal(),
      now: () => now,
      readbackDelayMs: 0,
    }),
    (error) =>
      (error as { code?: string }).code === "SHARED_CELL_DELETE_CALLER_INVALID",
  );
  assert.equal(executeSubject.deleteInputs.length, 0);
});

test("a lost DeleteStack response is recovered only by authoritative missing readback", async () => {
  const subject = await fixture({ behavior: "lost_then_missing" });
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => now,
  });
  const result = await executeReviewedSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    deleter: subject.deleter,
    approvedDeletionPlanSha256: inspected.deletionPlanSha256,
    signal: signal(),
    now: () => now,
    readbackDelayMs: 0,
  });
  assert.equal(result.phase, "RECOVERED");
  assert.equal(result.mutationPerformed, true);
  assert.equal(subject.deleteInputs.length, 1);
  assert.equal(subject.calls().authorityWrites, 0);
});

test("a lost response with a present Stack stays uncertain and is never retried", async () => {
  const subject = await fixture({ behavior: "lost_still_present" });
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => now,
  });
  await assert.rejects(
    executeReviewedSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      deleter: subject.deleter,
      approvedDeletionPlanSha256: inspected.deletionPlanSha256,
      signal: signal(),
      now: () => now,
      readbackAttempts: 2,
      readbackDelayMs: 0,
      wait: noWait,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_RESPONSE_UNCERTAIN",
  );
  assert.equal(subject.deleteInputs.length, 1);
});

test("an accepted DeleteStack followed by readback failure becomes post-submit uncertain", async () => {
  const subject = await fixture({ behavior: "accepted_still_present" });
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => now,
  });
  await assert.rejects(
    executeReviewedSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      deleter: subject.deleter,
      approvedDeletionPlanSha256: inspected.deletionPlanSha256,
      signal: signal(),
      now: () => now,
      readbackAttempts: 1,
      readbackDelayMs: 0,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_POST_SUBMIT_UNCERTAIN",
  );
  assert.equal(subject.deleteInputs.length, 1);
});

test("DELETE_FAILED and ROLLBACK_FAILED can never become deletion success", async () => {
  for (const behavior of ["delete_failed", "rollback_failed"] as const) {
    const subject = await fixture({ behavior });
    const inspected = await inspectSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      signal: signal(),
      now: () => now,
    });
    await assert.rejects(
      executeReviewedSharedCellCleanupDeletion({
        evidence: subject.evidence,
        authority: subject.authority,
        deleter: subject.deleter,
        approvedDeletionPlanSha256: inspected.deletionPlanSha256,
        signal: signal(),
        now: () => now,
        readbackAttempts: 1,
        readbackDelayMs: 0,
      }),
      (error) => {
        assert.equal(
          (error as { code?: string }).code,
          "SHARED_CELL_DELETE_RESPONSE_UNCERTAIN",
        );
        assert.equal(
          ((error as { cause?: { code?: string } }).cause?.code),
          "SHARED_CELL_DELETE_TERMINAL_FAILURE",
        );
        return true;
      },
    );
    assert.equal(subject.deleteInputs.length, 1);
  }
});

test("recover is pure read and accepts only exact name-bound missing proof", async () => {
  const subject = await fixture();
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => now,
  });
  subject.setMissing();
  const recovered = await recoverReviewedSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    approvedDeletionPlanSha256: inspected.deletionPlanSha256,
    signal: signal(),
    now: () => now,
    readbackAttempts: 1,
    readbackDelayMs: 0,
  });
  assert.equal(recovered.phase, "RECOVERED");
  assert.equal(recovered.mutationPerformed, false);
  assert.equal(subject.deleteInputs.length, 0);
  assert.equal(subject.calls().authorityWrites, 0);
});
