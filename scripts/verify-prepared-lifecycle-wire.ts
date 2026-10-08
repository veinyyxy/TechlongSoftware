// Cross-repository contract check only. No SDK transport, database connection,
// filesystem write or live deployment proof. Backend root is explicit CLI input.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compilePreparedLifecycleDeploymentReview } from "../lib/deployments/execution/tenant-lifecycle-prepared-review.ts";
import { preparedBaselinePins, preparedLifecycleCommands } from "../lib/deployments/execution/tenant-lifecycle-prepared-contract.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

if (process.argv.length !== 3) throw new Error("Pass the checked-out Backend repository root.");
const requireBackend = createRequire(pathToFileURL(resolve(process.argv[2], "package.json")));
const { parseTenantLifecycleTaskInput } = requireBackend("./services/saas/tenant_lifecycle_service.js");
const { validatePreparedProductionInvocation, activationFromItem } = requireBackend("./services/saas/tenant_lifecycle_admission.js");
const { BASELINE_CATALOG_PINS } = requireBackend("./services/saas/tenant_baseline_catalog.js");
assert.equal(BASELINE_CATALOG_PINS.archiveSha256, preparedBaselinePins.archiveSha256);
assert.equal(BASELINE_CATALOG_PINS.manifestSha256, preparedBaselinePins.manifestSha256);
const ownership = { appInstanceId: "wire-instance", workspaceId: "workspace", productId: "product",
  environmentId: "environment", cellKey: "cell-sandbox-1" };
const hash = await sha256Hex(ownership), now = Date.now();
const fence = { schemaVersion: 1 as const, generation: 1, ownerDeploymentId: "wire-deployment",
  ownershipMarker: `tl_owner_${hash.slice(0, 32)}_g1`, identity: { schemaVersion: 1 as const, ...ownership,
    databaseName: "tenant_wire_db", roleName: "tenant_wire_role", stableIdentityHash: hash,
    secretName: `techlong/sandbox/tenant/wireinstance_${hash.slice(0, 10)}/runtime` } };
const review = await compilePreparedLifecycleDeploymentReview({
  imageUri: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:${"a".repeat(64)}`,
  taskDefinitionArn: "arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:999",
  tenantFence: fence, notBefore: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
  managementTarget: { cellId: "cell-sandbox-1", clusterArn: "arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1",
    databaseClusterIdentifier: "techlong-sandbox-cell-sandbox-1", managementPort: 5432, managementDatabase: "cell_admin", managementUsername: "cell_admin",
    managementEndpoint: "techlong-sandbox-cell-sandbox-1.cluster-wirefixture.ca-central-1.rds.amazonaws.com",
    managementSecretArn: "arn:aws:secretsmanager:ca-central-1:402010193138:secret:rds!cluster-wirefixture-ABC123",
    sharedCellEvidenceHash: "b".repeat(64) },
}, now);
const cell = Object.fromEntries(review.taskDefinitionDraft.containerDefinitions[0].environment.map(e => [e.name, e.value]));
let checked = 0;
for (const [operation, command] of Object.entries(preparedLifecycleCommands)) {
  const cleanup = operation === "destroy", epoch = cleanup ? 2 : 1;
  const environment = { ...cell, ...review.authorityEnvironment, TENANT_DATABASE_OPERATION: operation,
    TENANT_RUNTIME_SECRET_ARN: `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${fence.identity.secretName}/g1-ABC123`,
    TENANT_RESOURCE_GENERATION: "1", TENANT_OWNERSHIP_MARKER: fence.ownershipMarker,
    TENANT_EXTERNAL_OPERATION_EPOCH: String(epoch), TENANT_EXTERNAL_OPERATION_MARKER: `tl_epoch_${hash.slice(0, 24)}_g1_e${epoch}`,
    TENANT_EXTERNAL_OPERATION_HASH: "c".repeat(64),
    ...(["restore_approved_baseline", "migrate_saas", "verify"].includes(operation) ? { APPROVED_TENANT_BASELINE_SHA256: preparedBaselinePins.archiveSha256 } : {}),
    ...(cleanup ? { TENANT_PREDECESSOR_PROVISION_EPOCH: "1", TENANT_PREDECESSOR_PROVISION_MARKER: `tl_epoch_${hash.slice(0, 24)}_g1_e1`,
      TENANT_PREDECESSOR_PROVISION_OPERATION_HASH: "d".repeat(64) } : {}),
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: `/v2/credentials/${"1".repeat(32)}`,
    ECS_CONTAINER_METADATA_URI_V4: `http://169.254.170.2/v4/${"2".repeat(32)}`,
  };
  const parsed = parseTenantLifecycleTaskInput({ command: command[0], environment });
  const coordinates = validatePreparedProductionInvocation(["/usr/local/bin/node", "db/tenant_lifecycle_prepared.js", ...command], environment, parsed);
  assert.equal(coordinates.authorityKey, `tenant:${hash}`);
  assert.equal(coordinates.ownerDeploymentId, fence.ownerDeploymentId);
  assert.equal(parsed.managementTarget.targetDatabaseName, fence.identity.databaseName);
  assert.equal(activationFromItem(review.activationItemDraft, parsed, now).receiptSchemaVersion, 2);
  checked++;
}
process.stdout.write(JSON.stringify({ outcome: "CROSS_REPOSITORY_PREPARED_WIRE_VERIFIED", operationsChecked: checked,
  cloudMutationPerformed: false, databaseAccessPerformed: false, runtimeEnabled: false, baselineApproved: false }) + "\n");
