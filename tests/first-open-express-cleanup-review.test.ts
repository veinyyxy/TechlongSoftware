import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOnboardingInitialSecretVersion } from "../lib/deployments/execution/first-onboarding-express.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { firstOpenCleanupPermissionEvidenceMatches, firstOpenSupervisedCleanupDraft,
  reviewFirstOpenCleanupIdentity, type FirstOpenCleanupObservation,
  type FirstOpenCleanupProvisionReceipt } from "../ops/aws-sandbox/first-open-express-cleanup-review.ts";

const capabilityFixture = () => ({
  scope: firstOpenSupervisedCleanupDraft().scope,
  effective: {
    sourceDeleteTenantStack: true, cfnDeleteOnlyTenantResources: true, cleanupLoginPostWriteWindow: true,
    onlyExactRdsDbLogin: true, postgres17_9MaintenanceOnly: true, exactDatabaseOwnerDrop: true,
    guardedApplicationRoleDrop: true, sourceDeleteOnlyExactG1: true, postCreateLineageRecheckRequired: true,
  },
  // Only a synthetic shape regression; these are not source evidence.
  grantedPathEvidence: { awsSha256: "a".repeat(64), postgresSha256: "b".repeat(64), guardedRoleRoutineSha256: "c".repeat(64) },
});

test("the fixed review-only proposal separates cloud owner, PG17.9 DB owner and the non-login role admin", () => {
  const draft = firstOpenSupervisedCleanupDraft(), { scope } = draft;
  assert.equal(draft.status, "AUTHORITY_AND_EFFECTIVE_PATH_UNPROVED");
  assert.equal(draft.cleanupAuthorized, false);
  assert.equal(draft.executionApprovalSha256, null);
  assert.equal(draft.exactPermissionsVerified, false);
  assert.equal(scope.workload.callerArn, "arn:aws:iam::402010193138:user/techlong-sandbox-dev");
  assert.equal(scope.workload.action, "cloudformation:DeleteStack");
  assert.equal(scope.workload.serviceRoleArn, s.cfnRole);
  assert.equal(scope.workload.stackName, SANDBOX_FIRST_OPEN_STACK);
  assert.ok(scope.workload.stackIdFromProvisionReceipt);
  assert.equal(scope.postgres.clusterResourceId, s.clusterId);
  assert.equal(scope.postgres.serverVersionNum, 170009);
  assert.equal(scope.postgres.maintenanceDatabase, "postgres");
  assert.equal(scope.postgres.login, "sf_fc41597f_lifecycle");
  assert.equal(scope.postgres.databaseOwner, scope.postgres.login);
  assert.equal(scope.postgres.roleArn, s.lifecycleRole);
  assert.equal(scope.postgres.sessionName, "first-open-fc41597f-cleanup-g1");
  assert.equal(scope.postgres.applicationRoleAdmin, "sf_fc41597f_lifecycle_definer");
  assert.equal(scope.postgres.guardedRoleRoutine, "first_open_fc41597f_cleanup.cleanup_role(text,oid)");
  assert.equal(scope.postgres.databaseName, s.tenantDatabase);
  assert.ok(scope.postgres.databaseAndRoleOidsFromProvisionReceipt);
  assert.equal(scope.generationSecret.name, s.secretName);
  assert.ok(scope.generationSecret.arnAndVersionFromProvisionReceipt);
  assert.equal(scope.generationSecret.forceDeleteWithoutRecovery, false);
  assert.equal(scope.sharedCellIncluded, false);
  assert.equal(scope.tenantMediaIncluded, false);
  assert.equal(scope.automaticOrRetryAuthorized, false);
  assert.equal(firstOpenCleanupPermissionEvidenceMatches(draft), false);
});

test("capability evidence must describe the fixed guarded path, not a bare boolean or substitute actor", () => {
  const fixture = capabilityFixture(), scope = fixture.scope, effective = fixture.effective;
  assert.equal(firstOpenCleanupPermissionEvidenceMatches(fixture), true);
  for (const observation of [undefined, null, { exactPermissionsVerified: true },
    { ...fixture, scope: { ...scope, workload: { ...scope.workload, serviceRoleArn: s.workerRole } } },
    { ...fixture, scope: { ...scope, workload: { ...scope.workload, stackIdFromProvisionReceipt: false } } },
    { ...fixture, scope: { ...scope, postgres: { ...scope.postgres, serverVersionNum: 160014 } } },
    { ...fixture, scope: { ...scope, postgres: { ...scope.postgres, login: "postgres" } } },
    { ...fixture, scope: { ...scope, postgres: { ...scope.postgres, sessionName: "first-open-fc41597f-lifecycle-g1" } } },
    { ...fixture, scope: { ...scope, postgres: { ...scope.postgres, guardedRoleRoutine: "first_open_fc41597f.activate_role(text,oid)" } } },
    { ...fixture, scope: { ...scope, postgres: { ...scope.postgres, forceDatabaseDrop: true } } },
    { ...fixture, scope: { ...scope, sharedCellIncluded: true } },
    { ...fixture, scope: { ...scope, generationSecret: { ...scope.generationSecret, name: "*" } } },
    { ...fixture, scope: { ...scope, generationSecret: { ...scope.generationSecret, forceDeleteWithoutRecovery: true } } },
    { ...fixture, effective: { ...effective, cleanupLoginPostWriteWindow: "unknown" } },
    { ...fixture, effective: { ...effective, postCreateLineageRecheckRequired: false } },
    { ...fixture, effective: { ...effective, unknown: undefined } },
    { ...fixture, grantedPathEvidence: { ...fixture.grantedPathEvidence, guardedRoleRoutineSha256: "unknown" } },
    { ...fixture, grantedPathEvidence: { ...fixture.grantedPathEvidence, guardSql: "unexpected plaintext" } },
  ]) assert.equal(firstOpenCleanupPermissionEvidenceMatches(observation), false);
});

async function fixture() {
  const ownershipMarker = `tl_owner_${s.stableIdentity.slice(0, 32)}_g1`;
  const externalOperationMarker = `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1`;
  const operationHash = "a".repeat(64), approvalSha256 = "b".repeat(64), workspaceId = "wsp_test_fixture";
  const archiveSha256 = FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256;
  const externalFence: FirstOpenCleanupProvisionReceipt["externalFence"] = {
    schemaVersion: 1, epoch: 1, intent: "provision", state: "active", ownerDeploymentId: s.deploymentId,
    operationHash, marker: externalOperationMarker,
    resourceFence: { schemaVersion: 1, generation: 1, ownerDeploymentId: s.deploymentId, ownershipMarker,
      identity: { schemaVersion: 1, appInstanceId: s.instanceId, workspaceId, productId: s.productId, environmentId: s.environmentId,
        cellKey: "cell-sandbox-1", stableIdentityHash: s.stableIdentity, databaseName: s.tenantDatabase, roleName: s.tenantRole,
        secretName: s.secretName.slice(0, -3) } },
  };
  const arn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-Abc123`;
  const versionId = await firstOnboardingInitialSecretVersion({ approvalSha256, name: s.secretName,
    jobId: s.jobId, epoch: externalFence, baselineDigest: archiveSha256 });
  const provision: FirstOpenCleanupProvisionReceipt = {
    jobId: s.jobId, approvalSha256, externalFence, secret: { arn, versionId },
    stackId: `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/01234567-0123-0123-0123-0123456789ab`,
    database: { name: s.tenantDatabase, roleName: s.tenantRole, clusterResourceId: s.clusterId, schemaVersion: s.schemaVersion,
      ownershipMarker, baselineDigest: archiveSha256, databaseOid: "18100", roleOid: "18101", otherConnectableDatabases: 0 },
  };
  const observation: FirstOpenCleanupObservation = {
    stack: { stackId: provision.stackId, state: "ready", rawStatus: "CREATE_COMPLETE",
      tags: { Environment: "aws-sandbox", ManagedBy: "techlong-provisioner", CellId: "cell-sandbox-1", AppInstanceId: s.instanceId,
        WorkspaceId: workspaceId, ProductId: s.productId, DeploymentId: s.deploymentId, ResourceGeneration: "1",
        DeliveryTrack: "single-tenant-acceptance", CleanupMode: "supervised-reviewed", ExternalOperationEpoch: "1",
        ExternalOperationIntent: "provision", ExternalOperationMarker: externalOperationMarker, ExternalOperationHash: operationHash } },
    database: { ...provision.database, serverVersionNum: 170009, transactionReadOnly: true, tlsVerified: true },
    secret: { ARN: arn, Name: s.secretName, RotationEnabled: false, VersionIdsToStages: { [versionId]: ["AWSCURRENT"] },
      Tags: Object.entries({ ManagedBy: "techlong-sandbox", SecretSchema: "techlong-runtime-four-key-v2", DatabaseProfile: "express_iam",
        ResourceGeneration: "1", StableIdentity: s.stableIdentity, AppInstanceId: s.instanceId, DeploymentId: s.deploymentId, OwnershipMarker: ownershipMarker })
        .map(([Key, Value]) => ({ Key, Value })) },
  };
  return { provision, observation };
}

async function bind({ provision, observation }: Awaited<ReturnType<typeof fixture>>) {
  return { provision, observation, provisionSha256: await sha256Hex(provision), observationSha256: await sha256Hex(observation),
    signal: new AbortController().signal };
}

test("exact Sandbox g1/e1 post-create receipts match but do not authorize cleanup", async () => {
  const args = await bind(await fixture());
  assert.deepEqual(await reviewFirstOpenCleanupIdentity(args), {
    status: "POST_CREATE_IDENTITY_MATCHED_REVIEW_ONLY", provisionSha256: args.provisionSha256, observationSha256: args.observationSha256,
    cleanupAuthorized: false, exactPermissionsVerified: false,
  });
  args.observation.stack.tags.CellId = "replacement";
  await assert.rejects(reviewFirstOpenCleanupIdentity(args), /CLEANUP_RECEIPT_CHANGED/);
});

test("reject another stack UUID, unconfirmed create, or changed g1/e1 tags even with matching digests", async () => {
  const wrongStack = await fixture();
  wrongStack.observation.stack.stackId = wrongStack.provision.stackId.replace(/ab$/, "cd");
  await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(wrongStack)), /CLEANUP_STACK_CHANGED/);
  const partial = await fixture();
  partial.observation.stack.rawStatus = "CREATE_FAILED";
  await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(partial)), /CLEANUP_STACK_CHANGED/);
  const wrongGeneration = await fixture();
  wrongGeneration.observation.stack.tags.ResourceGeneration = "2";
  await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(wrongGeneration)), /CLEANUP_STACK_CHANGED/);
  const wrongEpoch = await fixture();
  wrongEpoch.provision.externalFence.epoch = 2;
  await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(wrongEpoch)), /FENCE_CHANGED/);
});

test("reject recreated database/login OIDs, PG16.14 and a different physical cluster", async () => {
  for (const change of [{ databaseOid: "18102" }, { roleOid: "18103" }, { serverVersionNum: 160014 },
    { clusterResourceId: "cluster-recreated" }, { transactionReadOnly: false }]) {
    const f = await fixture();
    Object.assign(f.observation.database, change);
    await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(f)), /CLEANUP_DATABASE_CHANGED/);
  }
});

test("reject a recreated, re-versioned or old-approval Secret", async () => {
  const wrongArn = await fixture();
  wrongArn.observation.secret.ARN = wrongArn.provision.secret.arn.replace(/Abc123$/, "Abc456");
  await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(wrongArn)), /SECRET_VERSION_CHANGED/);
  const wrongVersion = await fixture();
  wrongVersion.observation.secret.VersionIdsToStages!["c".repeat(64)] = ["AWSPREVIOUS"];
  await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(wrongVersion)), /SECRET_VERSION_CHANGED/);
  const wrongApproval = await fixture();
  wrongApproval.provision.approvalSha256 = "c".repeat(64);
  await assert.rejects(reviewFirstOpenCleanupIdentity(await bind(wrongApproval)), /CLEANUP_SECRET_CHANGED/);
});
