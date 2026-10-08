import test from "node:test";
import assert from "node:assert/strict";
import { compilePreparedLifecycleDeploymentReview, type PreparedLifecycleDeploymentReviewInput } from "../lib/deployments/execution/tenant-lifecycle-prepared-review.ts";
import { preparedBaselinePins } from "../lib/deployments/execution/tenant-lifecycle-prepared-contract.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";

const now = Date.parse("2026-10-07T23:00:00.000Z");
async function input(): Promise<PreparedLifecycleDeploymentReviewInput> {
  const ownership = { appInstanceId: "review-instance", workspaceId: "workspace", productId: "product",
    environmentId: "environment", cellKey: "cell-sandbox-1" };
  const hash = await sha256Hex(ownership);
  return { imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
    taskDefinitionArn: "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:999",
    notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    tenantFence: { schemaVersion: 1, generation: 1, ownerDeploymentId: "review-deployment",
      ownershipMarker: `tl_owner_${hash.slice(0, 32)}_g1`, identity: { schemaVersion: 1, ...ownership,
        databaseName: "tenant_review_db", roleName: "tenant_review_role", stableIdentityHash: hash,
        secretName: `techlong/sandbox/tenant/reviewinstance_${hash.slice(0, 10)}/runtime` } },
    managementTarget: { cellId: "cell-sandbox-1", clusterArn: "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1",
      databaseClusterIdentifier: "techlong-sandbox-cell-sandbox-1", managementPort: 5432,
      managementDatabase: "cell_admin", managementUsername: "cell_admin",
      managementEndpoint: "techlong-sandbox-cell-sandbox-1.cluster-fixture123.ca-central-1.rds.amazonaws.com",
      managementSecretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-fixture123-ABC123",
      sharedCellEvidenceHash: "b".repeat(64) } };
}
test("data-only deployment draft pins prepared entrypoint, private scratch, and raw receipt-v2; no readiness grant", async () => {
  const i = await input(), r = await compilePreparedLifecycleDeploymentReview(i, now);
  const c = r.taskDefinitionDraft.containerDefinitions[0];
  assert.equal(r.mode, "review_only_not_installable");
  for (const flag of [r.runtimeEnabled, r.registrationAuthorized, r.permissionsInstallationAuthorized,
    r.activationInstallationAuthorized, r.baselineApproved, r.imagePublicationVerified, r.liveTaskDefinitionVerified]) assert.equal(flag, false);
  assert.equal(c.image, i.imageUri); assert.equal(c.user, "65532:65532"); assert.equal(c.readonlyRootFilesystem, true);
  assert.deepEqual(c.command, ["--check-bundle"]);
  assert.deepEqual(c.entryPoint, ["/usr/local/bin/node", "db/tenant_lifecycle_prepared.js"]);
  assert.deepEqual(c.mountPoints, [{ sourceVolume: "tenant-lifecycle-workspace", containerPath: "/tmp/tenant-lifecycle", readOnly: false }]);
  assert.deepEqual(r.taskDefinitionDraft.volumes, [{ name: "tenant-lifecycle-workspace" }]);
  const staticEnv = Object.fromEntries(c.environment.map(e => [e.name, e.value]));
  assert.equal("TENANT_DATABASE_NAME" in staticEnv, false); assert.equal("TENANT_OWNER_DEPLOYMENT_ID" in staticEnv, false);
  assert.equal("AWS_ACCESS_KEY_ID" in staticEnv, false); assert.equal("PGPASSWORD" in staticEnv, false);
  const record = JSON.parse(r.activationItemDraft.record_json.S);
  assert.equal(record.receiptSchemaVersion, 2); assert.equal(record.baseline.archive.sha256, preparedBaselinePins.archiveSha256);
  assert.equal(r.activationItemDraft.schema_version.N, "2");
  assert.equal(canonicalJson(record), r.activationItemDraft.record_json.S);
  assert.equal(r.monthlyBudgetTargetUsd, 50);
  const material = { taskDefinitionDraft: r.taskDefinitionDraft, activationItemDraft: r.activationItemDraft,
    taskRolePolicyDraft: r.taskRolePolicyDraft, executionRolePolicyDraft: r.executionRolePolicyDraft };
  assert.equal(r.reviewSha256, await sha256Hex({ lifecycleProtocol: "prepared_v2", authorityEnvironment: r.authorityEnvironment, ...material }));
  assert.equal(Object.isFrozen(c.environment), true); assert.equal(Object.isFrozen(record), false); // decoding is only data
  Object.assign(i.managementTarget, { managementEndpoint: "changed" });
  assert.notEqual(JSON.parse(r.activationItemDraft.record_json.S).managementTarget.managementEndpoint, "changed");
});
test("permission drafts only read exact authority keys/Secrets/baseline and publish one tenant generation receipts", async () => {
  const i = await input(), r = await compilePreparedLifecycleDeploymentReview(i, now);
  const statements = r.taskRolePolicyDraft.Statement;
  const actions = statements.flatMap(s => s.Action);
  assert.deepEqual([...new Set(actions)].sort(), ["dynamodb:GetItem", "ecs:DescribeTaskDefinition", "ecs:DescribeTasks",
    "s3:GetObject", "s3:PutObject", "secretsmanager:GetSecretValue"].sort());
  assert.equal(JSON.stringify(statements).includes("tenant:*"), false);
  const epoch = statements.find(s => s.Sid === "ReadExactActivationAndTenantEpoch")!;
  assert.deepEqual(epoch.Condition!["ForAllValues:StringEquals"]!["dynamodb:LeadingKeys"],
    ["runtime:cell-sandbox-1:lifecycle-v2", `tenant:${i.tenantFence.identity.stableIdentityHash}`]);
  const describe = statements.find(s => s.Sid === "DescribeTaskDefinitions")!;
  assert.deepEqual(describe.Resource, ["*"]); // AWS does not support resource-level scoping for this READ.
  const put = statements.find(s => s.Sid === "PublishGenerationReceipts")!;
  assert.ok(put.Resource[0].includes(`/g1/`)); assert.equal(put.Condition!.StringEquals!["s3:if-none-match"], "*");
  assert.equal(actions.some(a => /Delete|PutItem|Update|RunTask|PassRole|AssumeRole/.test(a)), false);
});
test("review rejects mutable tags, wrong namespace/region/cell, forged identity and expired/oversized windows", async () => {
  const base = await input();
  for (const patch of [{ imageUri: base.imageUri.replace(/@sha256:.*/, ":latest") },
    { taskDefinitionArn: base.taskDefinitionArn.replace(":999", "") },
    { expiresAt: new Date(now).toISOString() }, { expiresAt: new Date(now + 7 * 3600000).toISOString() },
    { managementTarget: { ...base.managementTarget, managementEndpoint: "localhost" } },
    { managementTarget: { ...base.managementTarget, managementSecretArn: base.managementTarget.managementSecretArn.replace("ca-central-1", "us-east-1") } },
    { tenantFence: { ...base.tenantFence, identity: { ...base.tenantFence.identity, appInstanceId: "foreign" } } }]) {
    await assert.rejects(() => compilePreparedLifecycleDeploymentReview({ ...base, ...patch }, now));
  }
});
