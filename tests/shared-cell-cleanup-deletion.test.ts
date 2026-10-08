import assert from "node:assert/strict";
import test from "node:test";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
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
  validateSharedCellCleanupAuthorityItem,
  type SharedCellCleanupAuthorityItem,
} from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { sharedCellAdmissionDrainIntent } from "../lib/deployments/execution/shared-cell-admission-fence.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import {
  createPreparedCellTtlJanitor,
  type PreparedCellCleanupJournal,
  type PreparedCellCleanupIntent,
  type PreparedCellCleanupReceipt,
} from "../lib/deployments/execution/prepared-cell-ttl-janitor.ts";
import {
  AwsSdkPreparedCellCleanupJournal,
  createAwsSdkPreparedCellTtlJanitor,
} from "../lib/deployments/execution/aws-sdk-prepared-cell-ttl-janitor.ts";

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

async function authorityItem(input: {
  cleanupEpoch?: number;
  revision?: number;
} = {}): Promise<Readonly<SharedCellCleanupAuthorityItem>> {
  const templateCanonicalSha256 = await sha256Hex(template);
  const resourceInventorySha256 = await sha256Hex(inventory);
  const provision = {
    schemaVersion: 2 as const,
    accountId: "402010193138" as const,
    region: "ca-central-1" as const,
    cellId: "cell-sandbox-1" as const,
    stackName: "techlong-sandbox-cell-sandbox-1" as const,
    stackId,
    stackStatus: "CREATE_COMPLETE" as const,
    cellExpiresAt,
    cloudFormationRoleArn: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
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
      cloudFormationRoleArn: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
      templateCanonicalSha256,
      resourceInventorySha256,
    },
    provision: {
      ownerDeploymentId: provision.ownerDeploymentId,
      generation: 1,
      epoch: 1,
      operationHash,
    },
    cleanup: {
      epoch: input.cleanupEpoch ?? 2,
      expiresAt: authorityExpiresAt,
    },
    revision: input.revision ?? 2,
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
  authorityDriftAt?: number;
  admissionFenceSha256?: string;
  admissionFenceDriftAt?: number;
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
  const driftItem = input.authorityDriftAt
    ? await authorityItem({ cleanupEpoch: 3, revision: 3 })
    : null;
  const authorityRecord = (await validateSharedCellCleanupAuthorityItem(item))
    .record;
  const admissionFenceSha256 =
    input.admissionFenceSha256 ??
    (await sha256Hex(sharedCellAdmissionDrainIntent(authorityRecord)));
  const ownershipSource = {
    admissionFence: {
      admissionState: "draining" as const,
      admissionEpoch: 1,
      admissionFenceSha256,
      admissionProvisionOperationHash: authorityRecord.provisionOperationHash,
      admissionStackId: authorityRecord.stackId,
      admissionCellExpiresAt: Date.parse(authorityRecord.cellExpiresAt),
      admissionChangedAt: now - 30_000,
    },
    activeTenantIds: [],
    activeCapacityReservationIds: [],
    nonterminalDeploymentIds: [],
    liveTenantResourceIds: [],
    nonterminalTenantCleanupScheduleIds: [],
  };

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
      const currentOwnershipSource = structuredClone(ownershipSource);
      if (input.admissionFenceDriftAt === zeroTenantReads) {
        currentOwnershipSource.admissionFence.admissionEpoch += 1;
      }
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
        sourceSnapshot: currentOwnershipSource,
        sourceSnapshotSha256: await sha256Hex(currentOwnershipSource),
      };
    },
  };

  const authority: StrongSharedCellCleanupAuthorityReadPort & {
    compareAndSet(): Promise<never>;
  } = {
    async readStrong() {
      authorityReads += 1;
      const currentItem =
        input.authorityDriftAt === authorityReads && driftItem
          ? driftItem
          : item;
      return {
        authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
        revision:
          input.malformedAuthorityAt === authorityReads
            ? currentItem.revision + 1
            : currentItem.revision,
        item: currentItem,
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

test("zero-tenant freshness uses the post-read local clock", async () => {
  const subject = await fixture();
  let clockReads = 0;
  const inspected = await inspectSharedCellCleanupDeletion({
    evidence: subject.evidence,
    authority: subject.authority,
    signal: signal(),
    now: () => {
      clockReads += 1;
      return clockReads === 1 ? now - 1 : now;
    },
  });
  assert.equal(inspected.phase, "INSPECTED");
  assert.equal(inspected.mutationPerformed, false);
  assert.equal(subject.deleteInputs.length, 0);
});

test("zero-tenant evidence still rejects a database clock ahead of post-read time", async () => {
  const subject = await fixture({ zeroTenantObservedAt: now + 1 });
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

test("zero-tenant evidence is bound to the cleanup-authorized admission fence", async () => {
  const subject = await fixture({ admissionFenceSha256: "0".repeat(64) });
  await assert.rejects(
    inspectSharedCellCleanupDeletion({
      evidence: subject.evidence,
      authority: subject.authority,
      signal: signal(),
      now: () => now,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_ADMISSION_FENCE_MISMATCH",
  );
  assert.equal(subject.deleteInputs.length, 0);
  assert.equal(subject.calls().authorityWrites, 0);
});

test("admission-fence drift across the immediate boundary blocks DeleteStack", async () => {
  const subject = await fixture({ admissionFenceDriftAt: 6 });
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
      "SHARED_CELL_DELETE_PREDELETE_DRIFT",
  );
  assert.equal(subject.calls().zeroTenantReads, 6);
  assert.equal(subject.deleteInputs.length, 0);
  assert.equal(subject.calls().authorityWrites, 0);
});

test("live Stack drift after the final zero-tenant snapshot blocks DeleteStack", async () => {
  const subject = await fixture({ mutateTemplateAt: 6 });
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
      "SHARED_CELL_DELETE_PREDELETE_DRIFT",
  );
  assert.equal(subject.calls().zeroTenantReads, 6);
  assert.equal(subject.calls().templateCalls, 6);
  assert.equal(subject.deleteInputs.length, 0);
  assert.equal(subject.calls().authorityWrites, 0);
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

test("authority expiry during the final caller check prevents DeleteStack", async () => {
  const subject = await fixture();
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
      now: () =>
        subject.calls().callerCalls >= 6
          ? Date.parse(authorityExpiresAt)
          : now,
      readbackDelayMs: 0,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_CLEANUP_AUTHORITY_EXPIRED",
  );
  assert.equal(subject.deleteInputs.length, 0);
});

test("a slow final caller check cannot outlive zero-tenant evidence", async () => {
  const subject = await fixture();
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
      now: () =>
        subject.calls().callerCalls >= 6 ? now + 6 * 60_000 : now,
      readbackDelayMs: 0,
    }),
    (error) =>
      (error as { code?: string }).code ===
      "SHARED_CELL_DELETE_PREDELETE_DRIFT",
  );
  assert.equal(subject.deleteInputs.length, 0);
});

test("authority drift during the final caller check prevents DeleteStack", async () => {
  const subject = await fixture({ authorityDriftAt: 7 });
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
      "SHARED_CELL_DELETE_PREDELETE_DRIFT",
  );
  assert.equal(subject.deleteInputs.length, 0);
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

function durableJournal(options: { lostIntentResponse?: boolean; lostReceiptResponse?: boolean; onClaim?: () => void } = {}) {
  const state: { intent: Readonly<PreparedCellCleanupIntent> | null; receipt: Readonly<PreparedCellCleanupReceipt> | null; claims: number; publications: number } =
    { intent: null, receipt: null, claims: 0, publications: 0 };
  const journal: PreparedCellCleanupJournal = {
    async readStrong() { return structuredClone({ intent: state.intent, receipt: state.receipt }); },
    async claimIntent({ intent }) {
      state.claims += 1;
      if (state.intent) return false;
      state.intent = structuredClone(intent);
      options.onClaim?.();
      if (options.lostIntentResponse) throw new Error("private provider diagnostic must not escape");
      return true;
    },
    async publishReceipt({ receipt }) {
      state.publications += 1;
      state.receipt ??= structuredClone(receipt);
      if (options.lostReceiptResponse) throw new Error("receipt response lost");
    },
  };
  return { state, journal };
}
async function ttlEvent(subject: Awaited<ReturnType<typeof fixture>>) {
  const plan = await inspectSharedCellCleanupDeletion({ evidence: subject.evidence, authority: subject.authority, signal: signal(), now: () => now });
  return { schemaVersion: 1, action: "execute_reviewed_cell_ttl_cleanup", approvedDeletionPlanSha256: plan.deletionPlanSha256 };
}
function ttlRoot(subject: Awaited<ReturnType<typeof fixture>>, journal: PreparedCellCleanupJournal, clock = () => now) {
  return createPreparedCellTtlJanitor({ evidence: subject.evidence, authority: subject.authority, deleter: subject.deleter,
    journal, now: clock, readbackAttempts: 1, readbackDelayMs: 0 });
}

test("prepared TTL root persists one slot, invokes the real core and replays only its immutable receipt", async () => {
  const subject = await fixture(); const durable = durableJournal();
  const root = ttlRoot(subject, durable.journal); const event = await ttlEvent(subject);
  assert.equal(root.cloudRuntimeInstalled, false); assert.equal(subject.deleteInputs.length, 0);
  const first = await root.run(event, signal());
  assert.equal(first.outcome, "DELETION_INDEPENDENTLY_VERIFIED");
  assert.equal(first.deleteStackAttempted, true); assert.equal(first.receipt.result.phase, "DELETED");
  assert.equal(durable.state.claims, 1); assert.equal(durable.state.publications, 1);
  assert.ok(durable.state.intent); assert.ok(durable.state.receipt);
  const calls = subject.calls();
  const replay = await root.run(event, signal());
  assert.equal(replay.outcome, "IMMUTABLE_RECEIPT_REPLAYED"); assert.equal(replay.deleteStackAttempted, false);
  assert.deepEqual(replay.receipt, first.receipt); assert.deepEqual(subject.calls(), calls);
  assert.equal(subject.deleteInputs.length, 1); assert.equal(subject.calls().authorityWrites, 0);
});

test("prepared TTL root rejects plan/extra event fields before any permanent slot or deletion", async () => {
  const subject = await fixture(); const durable = durableJournal(); const root = ttlRoot(subject, durable.journal);
  const event = await ttlEvent(subject);
  for (const invalid of [{ ...event, enabled: true }, { ...event, action: "delete_shared_cell_stack" }, { ...event, stackId }]) {
    await assert.rejects(root.run(invalid, signal()), (e: { code: string }) => e.code === "CELL_TTL_EVENT_INVALID");
  }
  await assert.rejects(root.run({ ...event, approvedDeletionPlanSha256: "a".repeat(64) }, signal()),
    (e: { code: string }) => e.code === "CELL_TTL_APPROVAL_MISMATCH");
  assert.equal(durable.state.claims, 0); assert.equal(subject.deleteInputs.length, 0);
});

test("lost durable slot response consumes the slot and never delegates DeleteStack on later invocations", async () => {
  const subject = await fixture(); const durable = durableJournal({ lostIntentResponse: true });
  const root = ttlRoot(subject, durable.journal); const event = await ttlEvent(subject);
  await assert.rejects(root.run(event, signal()), (e: { code: string; message: string }) =>
    e.code === "CELL_TTL_SLOT_WRITE_UNCERTAIN_RECOVER_ONLY" && !e.message.includes("private"));
  assert.ok(durable.state.intent); assert.equal(subject.deleteInputs.length, 0);
  await assert.rejects(root.run(event, signal())); // present Stack is not recovery success
  assert.equal(durable.state.claims, 1); assert.equal(subject.deleteInputs.length, 0);
  subject.setMissing();
  const recovered = await root.run(event, signal());
  assert.equal(recovered.deleteStackAttempted, false); assert.equal(recovered.receipt.result.phase, "RECOVERED");
});

test("lost DeleteStack response stays recovery-only across invocations and restart", async () => {
  const subject = await fixture({ behavior: "lost_still_present" }); const durable = durableJournal();
  const event = await ttlEvent(subject);
  await assert.rejects(ttlRoot(subject, durable.journal).run(event, signal()));
  await assert.rejects(ttlRoot(subject, durable.journal).run(event, signal()));
  assert.equal(subject.deleteInputs.length, 1); assert.equal(durable.state.claims, 1); assert.equal(durable.state.receipt, null);
  subject.setMissing();
  const result = await ttlRoot(subject, durable.journal).run(event, signal());
  assert.equal(result.deleteStackAttempted, false); assert.equal(result.receipt.result.mutationPerformed, false);
  assert.equal(subject.deleteInputs.length, 1);
});

test("lost immutable receipt response is resolved by strong readback, not another deletion or receipt write", async () => {
  const subject = await fixture(); const durable = durableJournal({ lostReceiptResponse: true });
  const root = ttlRoot(subject, durable.journal); const event = await ttlEvent(subject);
  const result = await root.run(event, signal());
  assert.equal(result.outcome, "DELETION_INDEPENDENTLY_VERIFIED"); assert.equal(subject.deleteInputs.length, 1);
  await root.run(event, signal()); assert.equal(durable.state.publications, 1); assert.equal(subject.deleteInputs.length, 1);
});

test("slow durable slot write cannot outlive the authority or final live fences", async () => {
  const subject = await fixture(); let current = now;
  const durable = durableJournal({ onClaim: () => { current = Date.parse(authorityExpiresAt) + 1; } });
  const root = ttlRoot(subject, durable.journal, () => current); const event = await ttlEvent(subject);
  await assert.rejects(root.run(event, signal()));
  assert.ok(durable.state.intent); assert.equal(subject.deleteInputs.length, 0);
  assert.equal(durable.state.receipt, null);
});

test("zero-tenant admission is re-read after slot persistence and blocks a newly visible tenant", async () => {
  const subject = await fixture(); let tenantAppeared = false;
  const read = subject.evidence.readStrongZeroTenantOwnershipSnapshot.bind(subject.evidence);
  subject.evidence.readStrongZeroTenantOwnershipSnapshot = async request => {
    const snapshot = await read(request) as Record<string, unknown>;
    return { ...snapshot, activeTenantCount: tenantAppeared ? 1 : 0 };
  };
  const durable = durableJournal({ onClaim: () => { tenantAppeared = true; } });
  const root = ttlRoot(subject, durable.journal); const event = await ttlEvent(subject);
  await assert.rejects(root.run(event, signal()));
  assert.ok(durable.state.intent); assert.equal(subject.deleteInputs.length, 0); assert.equal(durable.state.receipt, null);
});

test("an aborted TTL invocation never claims a durable slot or deletes", async () => {
  const subject = await fixture(); const durable = durableJournal(); const event = await ttlEvent(subject);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ttlRoot(subject, durable.journal).run(event, controller.signal));
  assert.equal(durable.state.claims, 0); assert.equal(subject.deleteInputs.length, 0);
});

test("concurrent prepared roots sharing the durable slot cannot submit two deletes", async () => {
  const subject = await fixture(); const durable = durableJournal(); const event = await ttlEvent(subject);
  const results = await Promise.allSettled([ttlRoot(subject, durable.journal).run(event, signal()), ttlRoot(subject, durable.journal).run(event, signal())]);
  assert.ok(results.some(result => result.status === "fulfilled"));
  assert.equal(subject.deleteInputs.length, 1); assert.ok(durable.state.intent); assert.ok(durable.state.receipt);
});

test("tampered or orphan historical receipt never authorizes a deletion", async () => {
  const subject = await fixture(); const durable = durableJournal(); const root = ttlRoot(subject, durable.journal);
  const event = await ttlEvent(subject); await root.run(event, signal());
  const valid = structuredClone(durable.state.receipt!);
  durable.state.intent = null;
  await assert.rejects(root.run(event, signal()), (e: { code: string }) => e.code === "CELL_TTL_RECEIPT_WITHOUT_INTENT");
  durable.state.intent = { schemaVersion: 1, plan: { ...valid.result, phase: "INSPECTED", mutationPerformed: false } };
  durable.state.receipt = { schemaVersion: 1, result: { ...valid.result, stackId: stackId.replace("12345678", "87654321") } };
  await assert.rejects(root.run(event, signal()), (e: { code: string }) => e.code === "CELL_TTL_JOURNAL_PLAN_MISMATCH");
  assert.equal(subject.deleteInputs.length, 1);
});

test("DynamoDB journal uses exact keys, conditional append-only writes and strongly consistent actual SDK commands", async () => {
  const subject = await fixture(); const plan = await inspectSharedCellCleanupDeletion({ evidence: subject.evidence, authority: subject.authority, signal: signal(), now: () => now });
  const rows = new Map<string, unknown>(); const calls: { name: string; input: Record<string, unknown> }[] = [];
  const Get = GetCommand as unknown as new (input: Record<string, unknown>) => { input: Record<string, unknown> };
  const Put = PutCommand as unknown as new (input: Record<string, unknown>) => { input: Record<string, unknown> };
  const store = new AwsSdkPreparedCellCleanupJournal({ commands: { get: Get, put: Put }, client: { async send(value, options) {
    assert.ok(options?.abortSignal);
    const command = value as { input: Record<string, unknown> }; calls.push({ name: command.constructor.name, input: command.input });
    assert.equal(command.input.TableName, "arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority");
    if (value instanceof Get) { assert.equal(command.input.ConsistentRead, true); const key = (command.input.Key as { authority_key: string }).authority_key;
      return rows.has(key) ? { Item: rows.get(key) } : {}; }
    assert.equal(command.input.ConditionExpression, "attribute_not_exists(#key)");
    const item = command.input.Item as { authority_key: string };
    if (rows.has(item.authority_key)) throw Object.assign(new Error("private diagnostic"), { name: "ConditionalCheckFailedException" });
    rows.set(item.authority_key, structuredClone(item)); return {};
  } } });
  const intent = { schemaVersion: 1 as const, plan }; const sig = signal();
  assert.deepEqual(await store.readStrong({ planSha256: plan.deletionPlanSha256, signal: sig }), { intent: null, receipt: null });
  assert.equal(await store.claimIntent({ intent, signal: sig }), true);
  assert.equal(await store.claimIntent({ intent, signal: sig }), false);
  await store.publishReceipt({ receipt: { schemaVersion: 1, result: { ...plan, phase: "RECOVERED", mutationPerformed: false } }, signal: sig });
  const snapshot = await store.readStrong({ planSha256: plan.deletionPlanSha256, signal: sig });
  assert.ok(snapshot.intent); assert.ok(snapshot.receipt); assert.equal(rows.size, 2);
  assert.deepEqual([...rows.keys()].sort(), [`cell-cleanup-intent:${plan.deletionPlanSha256}`, `cell-cleanup-receipt:${plan.deletionPlanSha256}`]);
  assert.ok(calls.every(call => ["GetCommand", "PutCommand"].includes(call.name)));
});

test("actual AWS SDK prepared TTL assembly remains dormant and does not call the ownership source", async () => {
  let reads = 0;
  const root = await createAwsSdkPreparedCellTtlJanitor({ zeroTenantOwnership: {
    async readStrongZeroTenantOwnershipSnapshot() { reads += 1; throw new Error("construction must not read"); },
  } });
  assert.equal(root.mode, "prepared_not_installed"); assert.equal(root.cloudRuntimeInstalled, false); assert.equal(reads, 0);
});
