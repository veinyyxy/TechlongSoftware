import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { compileLiveDirectCostReadinessV1, describeVerifiedCostSnapshotV1, compileSingleTenantLifecycleIamV1, compileDisabledSealedDrainScheduleV3 } from "../lib/deployments/execution/cell-deployment-prerequisites-v1.ts";
import { DIRECT_COST_SCOPE_V1 as s, directExpectedSettingsV1, type DirectCostManifestV1 } from "../lib/deployments/execution/direct-cost-controls-v1.ts";
import { COST_RECOVERY_SCOPE_V1, type RecoverySnapshotV1 } from "../lib/deployments/execution/cost-stack-recovery-v1.ts";
import type { CostSettingsV1 } from "../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import type { PreparedLifecycleDeploymentReviewInput } from "../lib/deployments/execution/tenant-lifecycle-prepared-review.ts";
import { sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY } from "../lib/deployments/execution/shared-cell-cleanup-authority.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 } from "../lib/deployments/execution/sealed-cell-cleanup-lambda-context-v3.ts";

const now = Date.parse("2026-10-12T16:00:00.000Z"), kms = "arn:aws:kms:ca-central-1:402010193138:key/12345678-1234-1234-1234-123456789012";
function costFixture() {
  const before = { stack: { id: s.stackId, parameters: { MonthlyBudgetUsd: "10" } }, budget: { config: { BudgetLimit: { Amount: "10", Unit: "USD" }, TimePeriod: s.budgetTimePeriod }, notifications: [] }, table: { id: s.tableId, maxRead: 5, maxWrite: 2 } } as unknown as CostSettingsV1;
  const m = { before, manifestSha256: "a".repeat(64), reviewedAt: now - 7200000, expiresAt: now - 3600000 } as DirectCostManifestV1;
  const v: RecoverySnapshotV1 = { observedAt: now, inventory: { observedAt: now, settings: directExpectedSettingsV1(m, "complete"), stackStatus: s.stackStatus, tableStatus: "ACTIVE", changeSets: [], permissionsAllowed: false },
    disableRollback: true, stableEvent: structuredClone(s.completedEvent), latestStackEvent: structuredClone(s.completedEvent), stackEvents: [structuredClone(s.completedEvent)], permissionsAllowed: false,
    changeSets: COST_RECOVERY_SCOPE_V1.trackedChangeSetIds.map((id, n) => ({ id, present: true, status: n === 2 ? "CREATE_COMPLETE" : "FAILED", executionStatus: n === 2 ? "EXECUTE_FAILED" : "OBSOLETE" })) };
  return { m, v };
}
test("fresh verified-snapshot seam recognizes 50/100/2 and retained CFN10, never activation", async () => {
  const { m, v } = costFixture(), r = await describeVerifiedCostSnapshotV1(m, v, now);
  assert.equal(r.budgetUsd, 50); assert.equal(r.cfnParameterUsd, 10); assert.equal(r.intentionalCfnAmountDrift, true);
  assert.equal(r.maxReadUnits, 100); assert.equal(r.deploymentAuthorized, false); assert.equal(r.authorityInstallationAuthorized, false);
  assert.equal(r.runtimeEnabled, false); assert.equal(r.validUntil, now + 30000); assert.equal(r.cloudWrites, 0);
});
test("stale evidence, under/over cap, mismatched period and CFN correction cannot pass", async () => {
  for (const kind of ["stale", "clock", "read5", "read101", "write3", "budget10", "cfn50", "period", "event"]) {
    const { m, v } = costFixture();
    if (kind === "stale") v.inventory.observedAt -= 30001; if (kind === "clock") v.observedAt += 1;
    if (kind === "read5") v.inventory.settings.table.maxRead = 5; if (kind === "read101") v.inventory.settings.table.maxRead = 101;
    if (kind === "write3") v.inventory.settings.table.maxWrite = 3; if (kind === "budget10") v.inventory.settings.budget.config.BudgetLimit = { Amount: "10", Unit: "USD" };
    if (kind === "cfn50") v.inventory.settings.stack.parameters.MonthlyBudgetUsd = "50";
    if (kind === "period") v.inventory.settings.budget.config.TimePeriod = { Start: "2026-08-01T00:00:00Z", End: "2087-06-15T00:00:00Z" };
    if (kind === "event") v.latestStackEvent = null;
    await assert.rejects(() => describeVerifiedCostSnapshotV1(m, v, now));
  }
});
test("production cost compiler rejects unapproved or forged manifest before diagnostic pass", async () => {
  const { m, v } = costFixture(); await assert.rejects(() => compileLiveDirectCostReadinessV1(m, v, {}, now), /UNAPPROVED_COST_OVERRIDE/);
});
async function iamInput() {
  const owner = { appInstanceId: "review-instance", workspaceId: "workspace", productId: "product", environmentId: "environment", cellKey: "cell-sandbox-1" }, hash = await sha256Hex(owner);
  const deployment: PreparedLifecycleDeploymentReviewInput = { imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
    taskDefinitionArn: "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:999", notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    tenantFence: { schemaVersion: 1, generation: 1, ownerDeploymentId: "review-deployment", ownershipMarker: `tl_owner_${hash.slice(0, 32)}_g1`, identity: { schemaVersion: 1, ...owner,
      databaseName: "tenant_review_db", roleName: "tenant_review_role", stableIdentityHash: hash, secretName: `techlong/sandbox/tenant/reviewinstance_${hash.slice(0, 10)}/runtime` } },
    managementTarget: { cellId: "cell-sandbox-1", clusterArn: "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1", databaseClusterIdentifier: "techlong-sandbox-cell-sandbox-1",
      managementPort: 5432, managementDatabase: "cell_admin", managementUsername: "cell_admin", managementEndpoint: "techlong-sandbox-cell-sandbox-1.cluster-fixture123.ca-central-1.rds.amazonaws.com",
      managementSecretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-fixture123-ABC123", sharedCellEvidenceHash: "b".repeat(64) } };
  return { deployment, generationSecretArn: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${deployment.tenantFence.identity.secretName}/g1-ABC123`, managementKmsKeyArn: kms, generationKmsKeyArn: kms };
}
test("single-tenant boundary and inline bind physical Secrets, two baselines and exact epoch keys", async () => {
  const i = await iamInput(), r = await compileSingleTenantLifecycleIamV1(i, now), statements = r.boundaryDocument.Statement;
  assert.deepEqual(r.boundaryDocument, r.inlinePolicyDocument); assert.equal(r.existingExecutionRoleUnchanged, true); assert.equal(r.oldBoundaryNotDeleted, true);
  assert.equal(r.permissionsInstallationAuthorized, false); assert.equal(r.runtimeEnabled, false); assert.equal(r.mode, "DATA_ONLY_NOT_INSTALLABLE");
  assert.deepEqual(statements.find(s => s.Sid === "ReadCurrentDatabaseSecrets")?.Resource, [i.deployment.managementTarget.managementSecretArn, i.generationSecretArn]);
  assert.equal(canonicalJson(statements).includes("??????"), false); assert.equal(canonicalJson(statements).includes("tenant:*"), false);
  const leading = (statements.find(s => s.Sid === "ReadExactActivationAndTenantEpoch")?.Condition as Record<string, Record<string, string[]>>)["ForAllValues:StringEquals"]["dynamodb:LeadingKeys"];
  assert.deepEqual(leading, ["runtime:cell-sandbox-1:lifecycle-v2", `tenant:${i.deployment.tenantFence.identity.stableIdentityHash}`]);
  const material = { roleName: r.roleName, roleArn: r.roleArn, boundaryName: r.boundaryName, inlinePolicyName: r.inlinePolicyName, boundaryDocument: r.boundaryDocument, inlinePolicyDocument: r.inlinePolicyDocument, preparedDeploymentReviewSha256: r.preparedDeploymentReviewSha256 };
  assert.equal(r.candidateSha256, await sha256Hex(material)); assert.equal(Object.isFrozen(r.boundaryDocument.Statement), true);
});
test("KMS ceiling limits actual keys, forwarding service, caller and exact Secret context", async () => {
  const i = await iamInput(), r = await compileSingleTenantLifecycleIamV1(i, now), k = r.boundaryDocument.Statement.find(s => s.Sid === "DecryptOnlyTwoSecretsViaSecretsManager")!;
  assert.deepEqual(k.Resource, [kms]); assert.deepEqual(k.Condition, { StringEquals: { "kms:ViaService": "secretsmanager.ca-central-1.amazonaws.com", "kms:CallerAccount": "402010193138", "kms:EncryptionContext:SecretARN": [i.deployment.managementTarget.managementSecretArn, i.generationSecretArn] } });
  const deny = r.boundaryDocument.Statement.find(s => s.Sid === "DenyAllOtherActions")!; assert.equal(deny.Effect, "Deny");
  assert.equal((deny.NotAction as string[]).some(a => /Delete|RunTask|PassRole|PutItem|UpdateItem|CreateSecret/.test(a)), false);
});
test("other generation, logical-only Secret, alias/foreign KMS, unreviewed fields or tenant identity reject", async () => {
  for (const k of ["generation", "logical", "alias", "foreign", "extra", "identity"]) {
    const i = await iamInput(); if (k === "generation") i.generationSecretArn = i.generationSecretArn.replace("/g1-", "/g2-");
    if (k === "logical") i.generationSecretArn = i.generationSecretArn.slice(0, -7); if (k === "alias") i.generationKmsKeyArn = "alias/aws/secretsmanager";
    if (k === "foreign") i.managementKmsKeyArn = kms.replace("ca-central-1", "us-east-1"); if (k === "extra") Object.assign(i, { approved: true });
    if (k === "identity") i.deployment.tenantFence.identity.appInstanceId = "foreign";
    await assert.rejects(() => compileSingleTenantLifecycleIamV1(i, now));
  }
});
async function scheduleInput() {
  const f = await sealedEvidenceFixture(); const provisionItem = { authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY, schema_version: 2, revision: 1, record_json: canonicalJson(f.predecessor) };
  return { provisionItem, now: Date.parse(f.predecessor.cellExpiresAt) - 60000 };
}
test("post-provision schedule uses actual schema3 drain lineage, disabled/zero retry/no auto-delete", async () => {
  const i = await scheduleInput(), r = await compileDisabledSealedDrainScheduleV3(i), p = r.resource.Properties;
  assert.equal(p.State, "DISABLED"); assert.equal(p.ActionAfterCompletion, "NONE"); assert.equal(p.Target.RetryPolicy.MaximumRetryAttempts, 0);
  assert.equal(r.event.schemaVersion, 3); assert.equal(r.event.action, "coordinate_reviewed_sealed_cell_ttl_cleanup_v3");
  assert.equal(r.event.certificateSha256, REGISTERED_SEALED_CERTIFICATE_SHA256_V3); assert.equal(r.event.expectedProvisionItemSha256, await sha256Hex(i.provisionItem));
  assert.equal(p.Target.Input, canonicalJson(r.event)); assert.ok(r.stackId.endsWith("/12345678-1234-1234-1234-123456789012"));
  assert.equal(r.paidCellApplyReady, false); assert.equal(r.scheduleEnableAuthorized, false); assert.equal(r.scheduleInstallationAuthorized, false);
  assert.ok(r.blockers.includes("post_drain_zero_evidence_and_deletion_authority_issuance"));
});
test("schedule rejects due/past/long TTL and forged exact provision record", async () => {
  const base = await scheduleInput();
  await assert.rejects(() => compileDisabledSealedDrainScheduleV3({ ...base, now: base.now + 60000 }));
  await assert.rejects(() => compileDisabledSealedDrainScheduleV3({ ...base, now: base.now - 10800000 }));
  const record = JSON.parse(base.provisionItem.record_json); record.stackId = record.stackId.replace("techlong-sandbox-cell-sandbox-1", "other-cell");
  await assert.rejects(() => compileDisabledSealedDrainScheduleV3({ ...base, provisionItem: { ...base.provisionItem, record_json: canonicalJson(record) } }));
  await assert.rejects(() => compileDisabledSealedDrainScheduleV3({ ...base, provisionItem: { ...base.provisionItem, schema_version: 3 } }));
});
test("read-only CLI exposes no workload/IAM writer, secret-value read or fake coordinate", () => {
  const t = readFileSync(new URL("../ops/aws-sandbox/scripts/review-cell-deployment-prerequisites-v1.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(t, /UpdateTableCommand|PutItemCommand|CreatePolicyCommand|PutRolePolicyCommand|GetSecretValueCommand|InvokeCommand|DeleteStackCommand|--mode.*Run/);
  assert.ok(t.includes("runtime.snapshot(false)")); assert.ok(t.includes("compileLiveDirectCostReadinessV1")); assert.ok(t.includes("ResourceNotFoundException"));
  assert.ok(t.includes("reportIsNotExecutableApprovalManifest: true")); assert.ok(t.includes("AWS_MAX_ATTEMPTS: \"1\""));
});
