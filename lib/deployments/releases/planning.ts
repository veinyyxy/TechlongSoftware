import { sha256Hex } from "../execution/hash.ts";
import type {
  ImageUpdateParameter,
  ImageUpdatePlan,
  ReleasePlanBlocker,
  ReleasePlanningInput,
  ReleasePlanningResult,
} from "./contract.ts";

export const RELEASE_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 60 * 1000;
const planningOnly = { executionAuthorized: false, requiresLivePreflight: true } as const;
const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const isDigest = (value: string) => /^sha256:[a-f0-9]{64}$/.test(value);

function blocked(reason: ReleasePlanBlocker): ReleasePlanningResult {
  return {
    ...planningOnly,
    status: reason === "RESTORE_REQUIRED" ? "BLOCKED_RESTORE_REQUIRED" : "BLOCKED",
    reason,
  };
}

/** Deterministic, I/O-free draft. No credentials, database, AWS client or apply port. */
export async function planInstanceRelease(input: ReleasePlanningInput): Promise<ReleasePlanningResult> {
  const { selection: request, binding: b, observation: o, release: r, now } = input;
  if (!request.requestId || !request.requestedBy || request.instanceId !== b.instanceId ||
    request.workspaceId !== b.workspaceId || request.environmentId !== b.environmentId ||
    request.releaseId !== r.id || o.instanceId !== b.instanceId || o.stackId !== b.stackId) {
    return blocked("SELECTION_MISMATCH");
  }
  if (r.productId !== b.productId) return blocked("PRODUCT_MISMATCH");
  const current = b.currentRelease;
  if (!b.initialized || b.status !== "active" || !current) return blocked("INSTANCE_NOT_READY");
  if (o.state !== "RUNNING" || !o.servicePresent || !o.albPresent || !o.databaseAvailable) {
    return blocked("RESTORE_REQUIRED");
  }
  if (o.operationInProgress) return blocked("OPERATION_IN_PROGRESS");
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(o.observedAt) ||
    o.observedAt < 0 || o.observedAt > now || now >= o.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS) {
    return blocked("STALE_OBSERVATION");
  }

  const stack = /^arn:aws:cloudformation:([^:]+):(\d{12}):stack\/[^/]+\/[a-f0-9-]{36}$/.exec(b.stackId);
  const repositoryPrefix = `${b.accountId}.dkr.ecr.${b.region}.amazonaws.com/`;
  if (!stack || stack[1] !== b.region || stack[2] !== b.accountId ||
    !b.imageRepository.startsWith(repositoryPrefix) ||
    !/^[a-z0-9][a-z0-9._/-]*$/.test(b.imageRepository.slice(repositoryPrefix.length)) ||
    !isHash(b.templateSha256) || !isHash(b.configurationSha256) ||
    !isDigest(current.manifestDigest) || !isDigest(current.platformDigest) ||
    !Number.isSafeInteger(b.stateRevision) || b.stateRevision < 0 ||
    !Number.isSafeInteger(b.desiredCount) || b.desiredCount < 1) {
    return blocked("INVALID_BINDING");
  }
  const currentImage = `${b.imageRepository}@${current.manifestDigest}`;
  if (o.templateSha256 !== b.templateSha256 || o.configurationSha256 !== b.configurationSha256 ||
    o.imageUri !== currentImage || o.platformDigest !== current.platformDigest) {
    return blocked("BASELINE_CHANGED");
  }
  if (o.desiredCount !== b.desiredCount || o.runningCount !== b.desiredCount || o.pendingCount !== 0) {
    return blocked("INSTANCE_NOT_READY");
  }
  if (!o.parameterKeys.includes("ImageUri") || new Set(o.parameterKeys).size !== o.parameterKeys.length) {
    return blocked("INVALID_PARAMETERS");
  }
  if (r.status !== "ecr_verified") return blocked("RELEASE_NOT_AVAILABLE");
  if (r.component !== "tenant_api" || r.image.repository !== b.imageRepository || r.source.repository !== b.sourceRepository ||
    !isDigest(r.image.manifestDigest) || !isDigest(r.image.platformDigest) ||
    !isHash(r.image.verificationSha256) || !isHash(r.source.artifactSha256) ||
    !/^[a-f0-9]{40}$/.test(r.source.commit)) {
    return blocked("INVALID_ARTIFACT");
  }
  const compatibility = r.compatibility;
  if (r.image.runtimePlatform !== b.runtimePlatform ||
    compatibility.applicationPort !== b.applicationPort ||
    !compatibility.databaseProfiles.includes(o.databaseProfile) ||
    !compatibility.schemaVersions.includes(o.databaseSchemaVersion) ||
    !compatibility.clientApiVersions.includes(b.clientApiVersion)) {
    return blocked("INCOMPATIBLE_RELEASE");
  }
  if (compatibility.requiresMigration || compatibility.startupWrites) return blocked("REQUIRES_SEPARATE_CHANGE");
  if (!o.persistentUploadsReady) return blocked("PERSISTENCE_NOT_READY");

  const imageUri = `${r.image.repository}@${r.image.manifestDigest}`;
  if (imageUri === currentImage) {
    if (r.image.platformDigest !== current.platformDigest) return blocked("INVALID_ARTIFACT");
    return {
      ...planningOnly,
      status: "NO_CHANGE",
      instanceId: b.instanceId,
      currentReleaseId: current.id,
      requestedReleaseId: r.id,
    };
  }

  const plan: ImageUpdatePlan = {
    schema: "techlong/instance-image-update-plan/v1",
    selection: {
      requestId: request.requestId, requestedBy: request.requestedBy, workspaceId: request.workspaceId,
      instanceId: request.instanceId, environmentId: request.environmentId, releaseId: request.releaseId,
    },
    productId: b.productId,
    component: "tenant_api",
    accountId: b.accountId,
    region: b.region,
    expectedStateRevision: b.stateRevision,
    observedAt: o.observedAt,
    preparedAt: now,
    writeBefore: o.observedAt + RELEASE_SNAPSHOT_MAX_AGE_MS,
    templateSha256: b.templateSha256,
    configurationSha256: b.configurationSha256,
    desiredCount: b.desiredCount,
    compatibility: {
      databaseProfile: o.databaseProfile, databaseSchemaVersion: o.databaseSchemaVersion,
      runtimePlatform: b.runtimePlatform, applicationPort: b.applicationPort,
      clientApiVersion: b.clientApiVersion, persistentUploadsReady: true,
    },
    from: { releaseId: current.id, imageUri: currentImage, platformDigest: current.platformDigest },
    to: {
      releaseId: r.id, version: r.version, imageUri, platformDigest: r.image.platformDigest,
      sourceRepository: r.source.repository, sourceCommit: r.source.commit,
      buildRunId: r.source.buildRunId, buildAttempt: r.source.buildAttempt,
      artifactSha256: r.source.artifactSha256, imageVerificationSha256: r.image.verificationSha256,
    },
    changeSet: {
      StackName: b.stackId,
      ChangeSetType: "UPDATE",
      UsePreviousTemplate: true,
      Parameters: [...o.parameterKeys].sort().map((ParameterKey): ImageUpdateParameter =>
        ParameterKey === "ImageUri" ? { ParameterKey, ParameterValue: imageUri } : { ParameterKey, UsePreviousValue: true }),
    },
    expectedChanges: [
      { logicalId: "TenantTaskDefinition", action: "Modify", replacement: "True" },
      { logicalId: "TenantService", action: "Modify", replacement: "False" },
    ],
  };
  return { ...planningOnly, status: "PLANNED", plan, planSha256: await sha256Hex(plan) };
}
