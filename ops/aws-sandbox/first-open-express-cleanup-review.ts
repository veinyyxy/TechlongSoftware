import type { CloudFormationStackObservation, TenantExternalOperationFence } from "../../lib/deployments/execution/contracts.ts";
import { FIRST_OPEN_EXPRESS_ENDPOINT, FIRST_OPEN_MANAGEMENT_SQL_USER } from "../../lib/deployments/execution/aurora-express-bootstrap-v3.ts";
import { assertTenantRuntimeSecretArn } from "../../lib/deployments/execution/ecs-one-shot-task.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { assertInitialSecretVersion, firstOnboardingInitialSecretVersion,
  type FirstOnboardingDatabaseIdentity } from "../../lib/deployments/execution/first-onboarding-express.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_SQL_DEFINER } from "./first-open-express-management.ts";
import { sameFirstOpenFence, stopFirstOpen, validOid } from "./first-open-express-scope.ts";

const archiveSha256 = FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256;
const stackPrefix = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;

const supervisedCleanupScope = {
  jobId: s.jobId,
  instanceId: s.instanceId,
  deploymentId: s.deploymentId,
  generation: 1,
  // The shared Cell is the outer baseline, not a target of this tenant review.
  order: "workload_database_role_generation_secret_then_cell",
  workload: {
    callerArn: `arn:aws:iam::${s.account}:user/techlong-sandbox-dev`, serviceRoleArn: s.cfnRole,
    action: "cloudformation:DeleteStack", stackName: SANDBOX_FIRST_OPEN_STACK, stackIdFromProvisionReceipt: true,
    exactLogicalResources: ["TenantLogGroup", "TenantTaskDefinition", "TenantTargetGroup", "TenantBusinessControlDenyRule",
      "TenantListenerRule", "TenantControlListenerRule", "TenantService"],
  },
  postgres: {
    clusterArn: s.clusterArn, clusterResourceId: s.clusterId, endpoint: FIRST_OPEN_EXPRESS_ENDPOINT, port: 5432,
    serverVersionNum: 170009, maintenanceDatabase: "postgres", maintenanceDatabaseOid: "5",
    roleArn: s.lifecycleRole, sessionName: "first-open-fc41597f-cleanup-g1",
    dbConnectResource: `arn:aws:rds-db:${s.region}:${s.account}:dbuser:${s.clusterId}/${FIRST_OPEN_MANAGEMENT_SQL_USER}`,
    login: FIRST_OPEN_MANAGEMENT_SQL_USER, databaseName: s.tenantDatabase, databaseOwner: FIRST_OPEN_MANAGEMENT_SQL_USER,
    applicationLogin: s.tenantRole, applicationRoleAdmin: FIRST_OPEN_SQL_DEFINER,
    // A distinct schema must not change the two-function creation-contract
    // preimage. The separately reviewable SQL template is not installed.
    guardedRoleRoutine: "first_open_fc41597f_cleanup.cleanup_role(text,oid)",
    databaseAndRoleOidsFromProvisionReceipt: true, forceDatabaseDrop: false,
  },
  generationSecret: {
    callerArn: `arn:aws:iam::${s.account}:user/techlong-sandbox-dev`, action: "secretsmanager:DeleteSecret", name: s.secretName,
    arnAndVersionFromProvisionReceipt: true, forceDeleteWithoutRecovery: false,
  },
  sharedCellIncluded: false,
  tenantMediaIncluded: false,
  automaticOrRetryAuthorized: false,
} as const;

const effectiveRequirements = {
  sourceDeleteTenantStack: true,
  cfnDeleteOnlyTenantResources: true,
  cleanupLoginPostWriteWindow: true,
  // IAM pins the dbuser, not a PostgreSQL dbname. The separately reviewed
  // protected client must itself pin the maintenance connection (and never
  // export credentials); the Lifecycle owner still has native owner rights.
  onlyExactRdsDbLogin: true,
  postgres17_9MaintenanceOnly: true,
  exactDatabaseOwnerDrop: true,
  guardedApplicationRoleDrop: true,
  // DeleteSecret concerns the whole Secret. Exact ARN/fit of its sole g1
  // version must be independently rechecked, not supplied as a delete filter.
  sourceDeleteOnlyExactG1: true,
  postCreateLineageRecheckRequired: true,
} as const;

export interface FirstOpenCleanupPermissionObservation {
  scope: typeof supervisedCleanupScope;
  effective: typeof effectiveRequirements;
  grantedPathEvidence: { awsSha256: string; postgresSha256: string; guardedRoleRoutineSha256: string };
}

/** No runtime executor is proved. Separate approval must first cover the
 * fixed cleanup-only credential path and guarded role routine, then accepted
 * independent observations of each provider/permission, without a delete. */
export function firstOpenSupervisedCleanupDraft() {
  return {
    status: "AUTHORITY_AND_EFFECTIVE_PATH_UNPROVED" as const,
    scope: structuredClone(supervisedCleanupScope),
    exactPermissionsVerified: false as const,
    cleanupAuthorized: false as const,
    executionApprovalSha256: null,
  };
}

const hasExactKeys = (input: unknown, keys: readonly string[]): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && Object.getPrototypeOf(input) === Object.prototype &&
  Reflect.ownKeys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key));

function matchesFixedShape(input: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(input) && input.length === expected.length &&
    Reflect.ownKeys(input).length === expected.length + 1 && expected.every((v, i) => Object.hasOwn(input, i) && matchesFixedShape(input[i], v));
  if (!expected || typeof expected !== "object") return input === expected;
  const keys = Object.keys(expected);
  return hasExactKeys(input, keys) && Object.entries(expected).every(([key, v]) => matchesFixedShape(input[key], v));
}

/** Checks the contents, *not* provenance, of an independent capability
 * projection. The runtime must bind these bytes to its approved, authenticated,
 * fresh receipt. Candidate policies, bare true/unknown results and simulation
 * alone are not capability proof. Real physical IDs/markers must still be
 * rechecked after provisioning under separately approved cleanup authority. */
export function firstOpenCleanupPermissionEvidenceMatches(observation: unknown): observation is FirstOpenCleanupPermissionObservation {
  const evidenceKeys = ["awsSha256", "postgresSha256", "guardedRoleRoutineSha256"];
  if (!hasExactKeys(observation, ["scope", "effective", "grantedPathEvidence"]) ||
    !matchesFixedShape(observation.scope, supervisedCleanupScope) || !matchesFixedShape(observation.effective, effectiveRequirements) ||
    !hasExactKeys(observation.grantedPathEvidence, evidenceKeys)) return false;
  const evidence = Object.values(observation.grantedPathEvidence);
  return evidence.length === evidenceKeys.length && evidence.every(x => typeof x === "string" && digest.test(x));
}

export interface FirstOpenCleanupProvisionReceipt {
  jobId: string;
  approvalSha256: string;
  externalFence: TenantExternalOperationFence;
  stackId: string;
  database: FirstOnboardingDatabaseIdentity;
  secret: { arn: string; versionId: string };
}

export interface FirstOpenCleanupObservation {
  stack: Pick<CloudFormationStackObservation, "state" | "rawStatus" | "stackId" | "tags">;
  database: FirstOnboardingDatabaseIdentity & { serverVersionNum: number; tlsVerified: boolean; transactionReadOnly: boolean };
  secret: Parameters<typeof assertInitialSecretVersion>[0] & { Name: string; Tags: { Key: string; Value: string }[] };
}

/** Review-only comparison for the full, unchanged post-create lineage. The
 * digest pins must come from separately authenticated receipts. This cannot
 * collect evidence, prove executor authority, handle partial creation or authorize deletion. */
export async function reviewFirstOpenCleanupIdentity(input: {
  provision: FirstOpenCleanupProvisionReceipt; provisionSha256: string;
  observation: FirstOpenCleanupObservation; observationSha256: string; signal: AbortSignal;
}) {
  const { provisionSha256, observationSha256, signal } = input;
  signal.throwIfAborted();
  const p = structuredClone(input.provision), o = structuredClone(input.observation);
  if (p.jobId !== s.jobId || !digest.test(p.approvalSha256) ||
    await sha256Hex(p) !== provisionSha256 || await sha256Hex(o) !== observationSha256) return stopFirstOpen("CLEANUP_RECEIPT_CHANGED");
  const fence = p.externalFence.resourceFence;
  sameFirstOpenFence({ fence, externalFence: p.externalFence, signal });
  const { identity, ownershipMarker } = fence, e = p.externalFence;
  const workloadTags = {
    Environment: "aws-sandbox", ManagedBy: "techlong-provisioner", CellId: identity.cellKey,
    AppInstanceId: s.instanceId, WorkspaceId: identity.workspaceId, ProductId: s.productId,
    DeploymentId: s.deploymentId, ResourceGeneration: "1", DeliveryTrack: "single-tenant-acceptance", CleanupMode: "supervised-reviewed",
    ExternalOperationEpoch: "1", ExternalOperationIntent: "provision", ExternalOperationMarker: e.marker, ExternalOperationHash: e.operationHash,
  };
  if (!p.stackId.startsWith(stackPrefix) || !uuid.test(p.stackId.slice(stackPrefix.length)) ||
    o.stack.stackId !== p.stackId || o.stack.state !== "ready" || o.stack.rawStatus !== "CREATE_COMPLETE" ||
    Object.entries(workloadTags).some(([k, v]) => o.stack.tags[k] !== v)) return stopFirstOpen("CLEANUP_STACK_CHANGED");

  const { serverVersionNum, tlsVerified, transactionReadOnly, ...database } = o.database;
  if (serverVersionNum !== 170009 || tlsVerified !== true || transactionReadOnly !== true ||
    !validOid(database.databaseOid) || !validOid(database.roleOid) || database.name !== s.tenantDatabase ||
    database.roleName !== s.tenantRole || database.clusterResourceId !== s.clusterId || database.ownershipMarker !== ownershipMarker ||
    database.baselineDigest !== archiveSha256 || database.schemaVersion !== s.schemaVersion || database.otherConnectableDatabases !== 0 ||
    canonicalJson(database) !== canonicalJson(p.database)) return stopFirstOpen("CLEANUP_DATABASE_CHANGED");

  assertTenantRuntimeSecretArn(p.secret.arn, { accountId: s.account, region: s.region, physicalSecretName: s.secretName });
  const versionId = await firstOnboardingInitialSecretVersion({ approvalSha256: p.approvalSha256, name: s.secretName,
    jobId: s.jobId, epoch: e, baselineDigest: archiveSha256 });
  const secretTags = { ManagedBy: "techlong-sandbox", SecretSchema: "techlong-runtime-four-key-v2", DatabaseProfile: "express_iam",
    ResourceGeneration: "1", StableIdentity: s.stableIdentity, AppInstanceId: s.instanceId, DeploymentId: s.deploymentId, OwnershipMarker: ownershipMarker };
  if (p.secret.versionId !== versionId || o.secret.Name !== s.secretName ||
    o.secret.Tags.length !== Object.keys(secretTags).length ||
    Object.entries(secretTags).some(([k, v]) => o.secret.Tags.filter(t => t.Key === k && t.Value === v).length !== 1) ||
    o.secret.VersionIdsToStages?.[versionId]?.length !== 1) return stopFirstOpen("CLEANUP_SECRET_CHANGED");
  assertInitialSecretVersion(o.secret, p.secret.arn, versionId);
  signal.throwIfAborted();
  return Object.freeze({ status: "POST_CREATE_IDENTITY_MATCHED_REVIEW_ONLY" as const,
    provisionSha256, observationSha256, cleanupAuthorized: false as const, exactPermissionsVerified: false as const });
}
