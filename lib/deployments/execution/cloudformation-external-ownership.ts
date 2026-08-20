import {
  awsSandboxTenantStackName,
  tenantStackExternalOperationTagKeys,
  tenantStackOperationTagKey,
  tenantStackStableOwnershipTagKeys,
} from "../cloudformation/tenant-stack.ts";
import type {
  AwsDeploymentPort,
  CloudFormationStackObservation,
  TenantExternalOperationFence,
  TenantExternalOperationIntent,
  TenantExternalOwnershipPort,
  TenantExternalOwnershipProof,
} from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;

function fail(code: string, message: string, retryable = false): Error {
  return Object.assign(new Error(message), { code, retryable });
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort())
  );
}

/**
 * Safe, provider-persisted form of an external epoch. The provider record is
 * deliberately smaller than TenantExternalOperationFence: it contains no
 * database, role, Secret or customer values.
 */
export interface TenantExternalEpochAuthorityRecord {
  schemaVersion: 1;
  stableIdentityHash: string;
  generation: number;
  epoch: number;
  intent: TenantExternalOperationIntent;
  ownerDeploymentId: string;
  operationHash: string;
  marker: string;
  /** One non-recursive previous coordinate, retained for exact cleanup readback. */
  predecessor: TenantExternalEpochAuthorityCoordinate | null;
}

export interface TenantExternalEpochAuthorityCoordinate {
  schemaVersion: 1;
  generation: number;
  epoch: number;
  intent: TenantExternalOperationIntent;
  ownerDeploymentId: string;
  operationHash: string;
  marker: string;
}

export type TenantExternalEpochAuthorityCandidate = Omit<
  TenantExternalEpochAuthorityRecord,
  "predecessor"
>;

export interface TenantExternalEpochAuthoritySnapshot {
  /** Stable, non-secret key used by the authority for one tenant resource. */
  authorityKey: string;
  /**
   * Opaque, non-secret version used as the compare side of compare-and-set.
   * Implementations must not put credentials or bearer tokens in this value.
   */
  revision: string;
  record: TenantExternalEpochAuthorityRecord | null;
}

/**
 * The only component authorized to install an external epoch.
 *
 * `compareAndSet` MUST be one linearizable provider-side conditional write. It
 * must compare both expected.revision and expected.record before replacing the
 * value. The authority implementation—not its caller—MUST derive predecessor
 * from the conditionally matched stored record: null for initial provision,
 * the preceding same-generation provision for an update or cleanup, or the
 * preceding-generation cleanup for a reopened provision. The candidate
 * deliberately has no predecessor field. A describe/get followed by an
 * unconditional write does not implement this contract. CloudFormation Stack
 * tags do not provide this primitive and therefore cannot be used as this
 * authority.
 */
export interface AtomicTenantExternalEpochAuthorityPort {
  observe(input: {
    authorityKey: string;
    signal: AbortSignal;
  }): Promise<TenantExternalEpochAuthoritySnapshot>;
  compareAndSet(input: {
    authorityKey: string;
    expected: TenantExternalEpochAuthoritySnapshot;
    next: TenantExternalEpochAuthorityCandidate;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: TenantExternalEpochAuthoritySnapshot;
  }>;
}

export class AtomicTenantExternalEpochAuthorityDisabledError extends Error {
  readonly code = "TENANT_EXTERNAL_EPOCH_AUTHORITY_DISABLED";
  readonly retryable = false;

  constructor() {
    super("The atomic tenant external-epoch authority is not configured.");
  }
}

/** Fail-closed default. There is intentionally no in-memory production fallback. */
export class DisabledAtomicTenantExternalEpochAuthority
  implements AtomicTenantExternalEpochAuthorityPort
{
  private disabled(signal: AbortSignal): never {
    signal.throwIfAborted();
    throw new AtomicTenantExternalEpochAuthorityDisabledError();
  }

  observe(input: {
    authorityKey: string;
    signal: AbortSignal;
  }): Promise<TenantExternalEpochAuthoritySnapshot> {
    return Promise.reject(this.disabled(input.signal));
  }

  compareAndSet(input: {
    authorityKey: string;
    expected: TenantExternalEpochAuthoritySnapshot;
    next: TenantExternalEpochAuthorityCandidate;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: TenantExternalEpochAuthoritySnapshot;
  }> {
    return Promise.reject(this.disabled(input.signal));
  }
}

export interface TenantWorkloadOwnershipObservation {
  stackName: string;
  state: CloudFormationStackObservation["state"];
  stackId: string | null;
  tags: Record<string, string>;
}

/** Read-only compatibility boundary. It never grants ownership and is not CAS. */
export interface TenantWorkloadOwnershipReadbackPort {
  observe(input: {
    pendingFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<TenantWorkloadOwnershipObservation>;
}

/**
 * CloudFormation provides compatibility readback only. This adapter invokes
 * DescribeStacks and has no create, update, delete or tag mutation path.
 */
export class CloudFormationTenantOwnershipReadback
  implements TenantWorkloadOwnershipReadbackPort
{
  private readonly aws: AwsDeploymentPort;

  constructor(aws: AwsDeploymentPort) {
    this.aws = aws;
  }

  async observe(input: {
    pendingFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<TenantWorkloadOwnershipObservation> {
    input.signal.throwIfAborted();
    const stackName = awsSandboxTenantStackName(
      input.pendingFence.resourceFence.identity.appInstanceId,
    );
    const observed = await this.aws.describeTenantStack(stackName, {
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    return {
      stackName,
      state: observed.state,
      stackId: observed.stackId,
      tags: observed.tags,
    };
  }
}

function authorityKey(fence: TenantExternalOperationFence): string {
  return `tenant:${fence.resourceFence.identity.stableIdentityHash}`;
}

function authorityRecord(
  fence: TenantExternalOperationFence,
  predecessor: TenantExternalEpochAuthorityCoordinate | null,
): TenantExternalEpochAuthorityRecord {
  return {
    schemaVersion: 1,
    stableIdentityHash: fence.resourceFence.identity.stableIdentityHash,
    generation: fence.resourceFence.generation,
    epoch: fence.epoch,
    intent: fence.intent,
    ownerDeploymentId: fence.ownerDeploymentId,
    operationHash: fence.operationHash,
    marker: fence.marker,
    predecessor,
  };
}

function authorityCandidate(
  fence: TenantExternalOperationFence,
): TenantExternalEpochAuthorityCandidate {
  return {
    schemaVersion: 1,
    stableIdentityHash: fence.resourceFence.identity.stableIdentityHash,
    generation: fence.resourceFence.generation,
    epoch: fence.epoch,
    intent: fence.intent,
    ownerDeploymentId: fence.ownerDeploymentId,
    operationHash: fence.operationHash,
    marker: fence.marker,
  };
}

function coordinate(
  record: TenantExternalEpochAuthorityRecord,
): TenantExternalEpochAuthorityCoordinate {
  const {
    schemaVersion,
    generation,
    epoch,
    intent,
    ownerDeploymentId,
    operationHash,
    marker,
  } = record;
  return {
    schemaVersion,
    generation,
    epoch,
    intent,
    ownerDeploymentId,
    operationHash,
    marker,
  };
}

function assertCoordinate(
  value: TenantExternalEpochAuthorityCoordinate,
  stableIdentityHash: string,
): void {
  if (
    !value ||
    typeof value !== "object" ||
    !hasExactKeys(value, [
      "schemaVersion",
      "generation",
      "epoch",
      "intent",
      "ownerDeploymentId",
      "operationHash",
      "marker",
    ]) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    !["provision", "cleanup"].includes(value.intent) ||
    !value.ownerDeploymentId ||
    !digestPattern.test(value.operationHash) ||
    value.marker !==
      `tl_epoch_${stableIdentityHash.slice(0, 24)}` +
        `_g${value.generation}_e${value.epoch}`
  ) {
    throw fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "The external epoch authority returned an invalid predecessor coordinate.",
    );
  }
}

function assertPendingFence(fence: TenantExternalOperationFence): void {
  const resource = fence?.resourceFence;
  if (
    fence?.schemaVersion !== 1 ||
    fence.state !== "pending_external" ||
    !resource ||
    resource.schemaVersion !== 1 ||
    fence.ownerDeploymentId !== resource.ownerDeploymentId ||
    !digestPattern.test(resource.identity.stableIdentityHash) ||
    !Number.isSafeInteger(resource.generation) ||
    resource.generation < 1 ||
    !Number.isSafeInteger(fence.epoch) ||
    fence.epoch < 1 ||
    !digestPattern.test(fence.operationHash) ||
    fence.marker !==
      `tl_epoch_${resource.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${resource.generation}_e${fence.epoch}`
  ) {
    throw fail(
      "TENANT_EXTERNAL_OWNERSHIP_FENCE_INVALID",
      "External ownership installation requires one exact pending epoch fence.",
    );
  }
}

function assertAuthorityRecord(
  record: TenantExternalEpochAuthorityRecord,
  expectedStableIdentityHash: string,
): void {
  if (
    !record ||
    typeof record !== "object" ||
    !hasExactKeys(record, [
      "schemaVersion",
      "stableIdentityHash",
      "generation",
      "epoch",
      "intent",
      "ownerDeploymentId",
      "operationHash",
      "marker",
      "predecessor",
    ]) ||
    record?.schemaVersion !== 1 ||
    record.stableIdentityHash !== expectedStableIdentityHash ||
    !digestPattern.test(record.stableIdentityHash) ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 1 ||
    !Number.isSafeInteger(record.epoch) ||
    record.epoch < 1 ||
    !["provision", "cleanup"].includes(record.intent) ||
    !record.ownerDeploymentId ||
    !digestPattern.test(record.operationHash) ||
    record.marker !==
      `tl_epoch_${record.stableIdentityHash.slice(0, 24)}` +
        `_g${record.generation}_e${record.epoch}`
  ) {
    throw fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "The external epoch authority returned an invalid record.",
    );
  }
  if (record.predecessor !== null) {
    assertCoordinate(record.predecessor, expectedStableIdentityHash);
  }
  if (record.intent === "cleanup") {
    const previous = record.predecessor;
    if (
      !previous ||
      previous.intent !== "provision" ||
      previous.generation !== record.generation ||
      previous.epoch >= record.epoch ||
      previous.ownerDeploymentId !== record.ownerDeploymentId
    ) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
        "A cleanup epoch must retain its exact same-generation provision predecessor.",
      );
    }
  } else if (record.predecessor === null) {
    if (record.generation !== 1) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
        "Only an initial generation-one provision may omit its predecessor.",
      );
    }
  } else {
    const previous = record.predecessor;
    const sameGenerationUpdate =
      previous.intent === "provision" &&
      previous.generation === record.generation &&
      previous.epoch < record.epoch &&
      previous.ownerDeploymentId === record.ownerDeploymentId;
    const reopenedGeneration =
      previous.intent === "cleanup" &&
      previous.generation === record.generation - 1 &&
      record.epoch === 1;
    if (!sameGenerationUpdate && !reopenedGeneration) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
        "A provision epoch must retain its exact same-generation provision or previous-generation cleanup predecessor.",
      );
    }
  }
}

function assertAuthoritySnapshot(
  snapshot: TenantExternalEpochAuthoritySnapshot,
  key: string,
  stableIdentityHash: string,
): void {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !hasExactKeys(snapshot, ["authorityKey", "revision", "record"]) ||
    snapshot?.authorityKey !== key ||
    !revisionPattern.test(snapshot.revision) ||
    (snapshot.record !== null && typeof snapshot.record !== "object")
  ) {
    throw fail(
      "TENANT_EXTERNAL_EPOCH_AUTHORITY_INVALID",
      "The external epoch authority returned an invalid snapshot.",
    );
  }
  if (snapshot.record) {
    assertAuthorityRecord(snapshot.record, stableIdentityHash);
  }
}

function deriveNextAuthorityRecord(
  current: TenantExternalEpochAuthorityRecord | null,
  fence: TenantExternalOperationFence,
): { outcome: "install" | "already_current"; next: TenantExternalEpochAuthorityRecord } {
  const next = authorityRecord(
    fence,
    current ? coordinate(current) : null,
  );
  if (!current) {
    if (next.intent !== "provision") {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_UNADOPTED",
        "Cleanup cannot adopt a resource with no provider-side provision epoch.",
      );
    }
    if (next.generation !== 1) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_AUTHORITY_UNADOPTED",
        "A later resource generation cannot recreate missing provider-side authority history.",
      );
    }
    assertAuthorityRecord(next, next.stableIdentityHash);
    return { outcome: "install", next };
  }
  const replay = authorityRecord(fence, current.predecessor);
  if (canonicalJson(current) === canonicalJson(replay)) {
    return { outcome: "already_current", next: current };
  }
  // Epochs are scoped to a resource generation. Compare the generation first;
  // a destroyed resource reopens as generation N+1 at epoch 1.
  if (next.generation < current.generation) {
    throw fail(
      "TENANT_EXTERNAL_EPOCH_STALE",
      "The pending resource generation is older than the provider-side authority.",
    );
  }
  if (next.generation > current.generation + 1) {
    throw fail(
      "TENANT_EXTERNAL_EPOCH_FUTURE_GENERATION",
      "The pending resource generation skips the provider-side authority.",
    );
  }
  if (next.generation === current.generation) {
    if (next.epoch < current.epoch) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_STALE",
        "The pending epoch is older than the provider-side authority.",
      );
    }
    if (next.epoch === current.epoch) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_DRIFT",
        "The provider-side epoch coordinate contains different immutable data.",
      );
    }
    if (current.ownerDeploymentId !== next.ownerDeploymentId) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_OWNER_DRIFT",
        "A resource generation cannot change its provider-side deployment owner.",
      );
    }
    if (
      current.intent === "provision" &&
      (next.intent === "provision" || next.intent === "cleanup")
    ) {
      assertAuthorityRecord(next, next.stableIdentityHash);
      return { outcome: "install", next };
    }
    throw fail(
      "TENANT_EXTERNAL_EPOCH_TRANSITION_INVALID",
      "A resource generation permits only a newer provision-to-cleanup transition.",
    );
  }
  if (
    current.intent === "cleanup" &&
    next.intent === "provision" &&
    next.epoch === 1
  ) {
    assertAuthorityRecord(next, next.stableIdentityHash);
    return { outcome: "install", next };
  }
  throw fail(
    "TENANT_EXTERNAL_EPOCH_TRANSITION_INVALID",
    "A new resource generation requires a completed cleanup followed by provision epoch 1.",
  );
}

function assertStableWorkloadTags(
  observation: TenantWorkloadOwnershipObservation,
  fence: TenantExternalOperationFence,
): void {
  const expected: Record<(typeof tenantStackStableOwnershipTagKeys)[number], string> = {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-provisioner",
    AppInstanceId: fence.resourceFence.identity.appInstanceId,
    CellId: fence.resourceFence.identity.cellKey,
    ResourceGeneration: String(fence.resourceFence.generation),
  };
  for (const key of tenantStackStableOwnershipTagKeys) {
    if (observation.tags[key] !== expected[key]) {
      throw fail(
        "TENANT_WORKLOAD_OWNERSHIP_MISMATCH",
        `CloudFormation workload tag ${key} does not match the tenant fence.`,
      );
    }
  }
  if (
    observation.tags[tenantStackOperationTagKey] !== fence.ownerDeploymentId
  ) {
    throw fail(
      "TENANT_WORKLOAD_OWNER_MISMATCH",
      "CloudFormation workload belongs to a different deployment.",
    );
  }
}

function observedWorkloadEpoch(
  observation: TenantWorkloadOwnershipObservation,
): {
  epoch: number;
  intent: TenantExternalOperationIntent;
  marker: string;
  operationHash: string;
} {
  const epochText = observation.tags.ExternalOperationEpoch;
  const epoch = Number(epochText);
  const intent = observation.tags.ExternalOperationIntent;
  const marker = observation.tags.ExternalOperationMarker;
  const operationHash = observation.tags.ExternalOperationHash;
  if (
    !/^[1-9][0-9]*$/.test(epochText ?? "") ||
    !Number.isSafeInteger(epoch) ||
    !["provision", "cleanup"].includes(intent) ||
    !marker ||
    !digestPattern.test(operationHash ?? "")
  ) {
    throw fail(
      "TENANT_WORKLOAD_EXTERNAL_EPOCH_INVALID",
      "CloudFormation workload external epoch tags are missing or invalid.",
    );
  }
  return {
    epoch,
    intent: intent as TenantExternalOperationIntent,
    marker,
    operationHash,
  };
}

function assertWorkloadMatchesCoordinate(
  observation: TenantWorkloadOwnershipObservation,
  fence: TenantExternalOperationFence,
  expected: TenantExternalEpochAuthorityCoordinate,
): void {
  // Missing is safe: there is no workload that an old or drifting operation
  // could accidentally update/delete. If a stack exists, however, every
  // immutable predecessor field must match before authority can advance.
  if (observation.state === "missing") return;
  if (!observation.stackId) {
    throw fail(
      "TENANT_WORKLOAD_READBACK_INVALID",
      "CloudFormation returned a workload without a stack id.",
    );
  }
  assertStableWorkloadTags(observation, fence);
  const current = observedWorkloadEpoch(observation);
  const expectedMarker =
    `tl_epoch_${fence.resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
    `_g${fence.resourceFence.generation}_e${current.epoch}`;
  if (current.marker !== expectedMarker) {
    throw fail(
      "TENANT_WORKLOAD_EXTERNAL_EPOCH_INVALID",
      "CloudFormation workload marker does not match its epoch coordinate.",
    );
  }
  if (
    current.epoch === expected.epoch &&
    current.intent === expected.intent &&
    current.marker === expected.marker &&
    current.operationHash === expected.operationHash
  ) {
    return;
  }
  throw fail(
    "TENANT_WORKLOAD_CLEANUP_FIRST_REQUIRED",
    "CloudFormation does not match the authority-derived workload predecessor.",
  );
}

function expectedWorkloadPredecessor(
  next: TenantExternalEpochAuthorityRecord,
): TenantExternalEpochAuthorityCoordinate | null {
  // Initial and reopened provision create a fresh workload and therefore
  // require the stable stack name to remain absent until repository activation.
  if (
    next.intent === "provision" &&
    (next.predecessor === null || next.predecessor.intent === "cleanup")
  ) {
    return null;
  }
  return next.predecessor;
}

function assertWorkloadBeforeAuthorityActivation(
  observation: TenantWorkloadOwnershipObservation,
  fence: TenantExternalOperationFence,
  predecessor: TenantExternalEpochAuthorityCoordinate | null,
): void {
  if (predecessor === null) {
    if (observation.state !== "missing") {
      throw fail(
        "TENANT_WORKLOAD_AUTHORITY_ADOPTION_REQUIRED",
        "Initial or reopened provision requires an absent CloudFormation workload; explicit import or cleanup is required.",
      );
    }
    return;
  }
  assertWorkloadMatchesCoordinate(observation, fence, predecessor);
}

function safeWorkloadEvidence(
  observation: TenantWorkloadOwnershipObservation,
): Record<string, unknown> {
  const tags: Record<string, string> = {};
  for (const key of [
    ...tenantStackStableOwnershipTagKeys,
    tenantStackOperationTagKey,
    ...tenantStackExternalOperationTagKeys,
  ]) {
    if (observation.tags[key]) tags[key] = observation.tags[key];
  }
  return {
    stackName: observation.stackName,
    state: observation.state,
    stackId: observation.stackId,
    tags,
  };
}

/**
 * Offline-ready composition for a future real provider. Authority installation
 * is linearizable; CloudFormation is only a compatibility/readback guard. No
 * default worker wiring constructs this class.
 */
export class AuthorityBackedTenantExternalOwnershipProvider
  implements TenantExternalOwnershipPort
{
  private readonly authority: AtomicTenantExternalEpochAuthorityPort;
  private readonly workload: TenantWorkloadOwnershipReadbackPort;

  constructor(input: {
    authority: AtomicTenantExternalEpochAuthorityPort;
    workload: TenantWorkloadOwnershipReadbackPort;
  }) {
    this.authority = input.authority;
    this.workload = input.workload;
  }

  async installAndObserve(input: {
    pendingFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<TenantExternalOwnershipProof> {
    input.signal.throwIfAborted();
    assertPendingFence(input.pendingFence);
    const key = authorityKey(input.pendingFence);

    // Authority availability and monotonicity are checked before any later
    // CloudFormation mutation can be authorized by the repository.
    const before = await this.authority.observe({
      authorityKey: key,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertAuthoritySnapshot(
      before,
      key,
      input.pendingFence.resourceFence.identity.stableIdentityHash,
    );
    const transition = deriveNextAuthorityRecord(before.record, input.pendingFence);
    const next = transition.next;
    const workloadPredecessor = expectedWorkloadPredecessor(next);

    const workloadBefore = await this.workload.observe({
      pendingFence: input.pendingFence,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertWorkloadBeforeAuthorityActivation(
      workloadBefore,
      input.pendingFence,
      workloadPredecessor,
    );

    if (transition.outcome === "install") {
      const result = await this.authority.compareAndSet({
        authorityKey: key,
        expected: before,
        next: authorityCandidate(input.pendingFence),
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      assertAuthoritySnapshot(result.snapshot, key, next.stableIdentityHash);
      if (!result.applied || canonicalJson(result.snapshot.record) !== canonicalJson(next)) {
        throw fail(
          "TENANT_EXTERNAL_EPOCH_CAS_CONFLICT",
          "The atomic external epoch compare-and-set was not applied.",
          true,
        );
      }
    }

    // Independent provider readback is mandatory even when CAS returned the
    // expected value or this is an idempotent replay.
    const observed = await this.authority.observe({
      authorityKey: key,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertAuthoritySnapshot(observed, key, next.stableIdentityHash);
    if (canonicalJson(observed.record) !== canonicalJson(next)) {
      throw fail(
        "TENANT_EXTERNAL_EPOCH_READBACK_MISMATCH",
        "The external epoch authority did not read back the exact installed value.",
      );
    }

    const workloadAfter = await this.workload.observe({
      pendingFence: input.pendingFence,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    // CloudFormation is read-only at this boundary. For an in-generation
    // provision update (and for cleanup), it must still be the exact previous
    // provision on both sides of authority CAS. Only after repository
    // activation may the separately fenced Apply/Delete adapter mutate it.
    assertWorkloadBeforeAuthorityActivation(
      workloadAfter,
      input.pendingFence,
      workloadPredecessor,
    );

    const evidence = {
      provider: "atomic-external-epoch-authority",
      authorityKey: observed.authorityKey,
      authorityRevisionHash: await sha256Hex(observed.revision),
      authorityRecord: observed.record,
      workloadReadbackBefore: safeWorkloadEvidence(workloadBefore),
      workloadReadbackAfter: safeWorkloadEvidence(workloadAfter),
    };
    return {
      schemaVersion: 1,
      pendingFence: input.pendingFence,
      evidenceHash: await sha256Hex(evidence),
      evidence,
    };
  }
}
