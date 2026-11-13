import type { DatabaseProfile } from "../execution/aurora-database-v2.ts";

/** Planner inputs are typed projections from trusted catalog/binding providers.
 * They are not an HTTP parser, an authorization decision, or live AWS evidence. */
export interface SoftwareRelease {
  id: string;
  productId: string;
  component: "tenant_api";
  version: string;
  status: "candidate" | "ecr_verified" | "revoked";
  source: {
    repository: string;
    commit: string;
    buildRunId: string;
    buildAttempt: number;
    artifactSha256: string;
  };
  image: {
    repository: string;
    manifestDigest: string;
    platformDigest: string;
    verificationSha256: string;
    runtimePlatform: "linux/amd64";
  };
  compatibility: {
    databaseProfiles: readonly DatabaseProfile[];
    schemaVersions: readonly string[];
    clientApiVersions: readonly string[];
    applicationPort: number;
    requiresMigration: boolean;
    startupWrites: boolean;
  };
}

export interface InstanceBinding {
  instanceId: string;
  workspaceId: string;
  productId: string;
  environmentId: string;
  accountId: string;
  region: string;
  stackId: string;
  initialized: boolean;
  status: "active" | "pending" | "suspended" | "failed";
  sourceRepository: string;
  imageRepository: string;
  runtimePlatform: "linux/amd64";
  applicationPort: number;
  clientApiVersion: string;
  desiredCount: number;
  templateSha256: string;
  configurationSha256: string;
  stateRevision: number;
  currentRelease: {
    id: string;
    manifestDigest: string;
    platformDigest: string;
  } | null;
}

export interface InstanceReleaseObservation {
  instanceId: string;
  stackId: string;
  observedAt: number;
  state: "RUNNING" | "STOPPED" | "PARTIAL";
  templateSha256: string;
  configurationSha256: string;
  imageUri: string;
  platformDigest: string;
  parameterKeys: readonly string[];
  servicePresent: boolean;
  albPresent: boolean;
  databaseAvailable: boolean;
  databaseProfile: DatabaseProfile;
  databaseSchemaVersion: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  operationInProgress: boolean;
  persistentUploadsReady: boolean;
}

export interface ReleaseSelection {
  requestId: string;
  requestedBy: string;
  workspaceId: string;
  instanceId: string;
  environmentId: string;
  releaseId: string;
}

export type ReleaseRequestStatus =
  | "REQUESTED" | "PREPARED" | "AWAITING_APPROVAL" | "CLAIMED"
  | "CHANGE_SET_CREATED" | "EXECUTING" | "VERIFYING" | "SUCCEEDED"
  | "NO_CHANGE" | "BLOCKED_RESTORE_REQUIRED" | "BLOCKED"
  | "REJECTED_CHANGE_SET" | "EXPIRED" | "REJECTED"
  | "FAILED_ROLLED_BACK_VERIFIED" | "FAILED_NEEDS_INSPECTION"
  | "RECONCILIATION_REQUIRED";

export interface ReleaseRequest extends ReleaseSelection {
  status: ReleaseRequestStatus;
  createdAt: number;
  planSha256: string | null;
}

export interface ReleasePlanningInput {
  selection: ReleaseSelection;
  binding: InstanceBinding;
  observation: InstanceReleaseObservation;
  release: SoftwareRelease;
  now: number;
}

export type ImageUpdateParameter =
  | { ParameterKey: string; ParameterValue: string }
  | { ParameterKey: string; UsePreviousValue: true };

export interface ImageUpdatePlan {
  schema: "techlong/instance-image-update-plan/v1";
  selection: ReleaseSelection;
  productId: string;
  component: "tenant_api";
  accountId: string;
  region: string;
  expectedStateRevision: number;
  observedAt: number;
  preparedAt: number;
  writeBefore: number;
  templateSha256: string;
  configurationSha256: string;
  desiredCount: number;
  compatibility: {
    databaseProfile: DatabaseProfile;
    databaseSchemaVersion: string;
    runtimePlatform: "linux/amd64";
    applicationPort: number;
    clientApiVersion: string;
    persistentUploadsReady: true;
  };
  from: { releaseId: string; imageUri: string; platformDigest: string };
  to: {
    releaseId: string;
    version: string;
    imageUri: string;
    platformDigest: string;
    sourceRepository: string;
    sourceCommit: string;
    buildRunId: string;
    buildAttempt: number;
    artifactSha256: string;
    imageVerificationSha256: string;
  };
  changeSet: {
    StackName: string;
    ChangeSetType: "UPDATE";
    UsePreviousTemplate: true;
    Parameters: ImageUpdateParameter[];
  };
  expectedChanges: readonly [
    { logicalId: "TenantTaskDefinition"; action: "Modify"; replacement: "True" },
    { logicalId: "TenantService"; action: "Modify"; replacement: "False" },
  ];
}

export type ReleasePlanBlocker =
  | "SELECTION_MISMATCH" | "PRODUCT_MISMATCH" | "INSTANCE_NOT_READY"
  | "RESTORE_REQUIRED" | "OPERATION_IN_PROGRESS" | "STALE_OBSERVATION"
  | "INVALID_BINDING" | "BASELINE_CHANGED" | "INVALID_PARAMETERS"
  | "RELEASE_NOT_AVAILABLE" | "INVALID_ARTIFACT" | "INCOMPATIBLE_RELEASE"
  | "REQUIRES_SEPARATE_CHANGE" | "PERSISTENCE_NOT_READY";

export type ReleasePlanningResult = {
  executionAuthorized: false;
  requiresLivePreflight: true;
} & (
  | { status: "PLANNED"; plan: ImageUpdatePlan; planSha256: string }
  | { status: "NO_CHANGE"; instanceId: string; currentReleaseId: string; requestedReleaseId: string }
  | { status: "BLOCKED" | "BLOCKED_RESTORE_REQUIRED"; reason: ReleasePlanBlocker }
);
