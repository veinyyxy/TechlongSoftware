import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  advanceSharedCellCleanupAuthority,
  assertSharedCellCleanupAuthorityActive,
  compileSharedCellCleanupAuthorityCandidateItem,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  validateSharedCellAuthorityItem,
  validateSharedCellCleanupAuthorityItem,
  type AtomicSharedCellCleanupAuthorityPort,
  type SharedCellAuthorityItem,
  type SharedCellCleanupAuthorization,
  type SharedCellCleanupAuthorityItem,
  type SharedCellCleanupAuthorityRecord,
  type SharedCellCleanupAuthoritySnapshot,
  type SharedCellCleanupStackEvidence,
  type SharedCellProvisionAuthorityCoordinate,
  type SharedCellProvisionAuthorityRecord,
} from "./shared-cell-cleanup-authority.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const environmentId = "env_aws_sandbox_ca_central_1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const cellCloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
const maximumEvidenceAgeMs = 30_000;
const digestPattern = /^[a-f0-9]{64}$/;
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f-]{36}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const verifiedStackEvidence = new WeakSet<object>();
const verifiedZeroTenantEvidence = new WeakSet<object>();
const stackEvidencePorts = new WeakSet<object>();
const zeroTenantEvidencePorts = new WeakSet<object>();
const grantBoundCasPorts = new WeakSet<object>();

export class SharedCellCleanupAuthorityOperatorError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellCleanupAuthorityOperatorError(code, message, retryable);
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value as Record<string, unknown>).sort()) ===
      canonicalJson([...expected].sort())
  );
}

function assertInputKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_INPUT_INVALID",
      "Shared Cell cleanup operator input is malformed.",
    );
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (
    keys.some((key) => !required.includes(key) && !optional.includes(key)) ||
    required.some((key) => !keys.includes(key))
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_INPUT_INVALID",
      "Shared Cell cleanup operator input contains missing or unexpected fields.",
    );
  }
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_MANIFEST_INVALID",
      `${label} must be a positive safe integer.`,
    );
  }
}

function canonicalUtc(value: unknown, label: string): number {
  if (typeof value !== "string" || !utcPattern.test(value)) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_TIME_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_TIME_INVALID",
      `${label} is not a real canonical UTC instant.`,
    );
  }
  return parsed;
}

function pinnedClock(value: (() => number) | undefined): () => number {
  if (value !== undefined && typeof value !== "function") {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_CLOCK_INVALID",
      "The cleanup operator clock is invalid.",
    );
  }
  return value ?? Date.now;
}

function readClock(clock: () => number): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_OPERATOR_CLOCK_INVALID",
      "The cleanup operator clock could not be read.",
    );
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_CLOCK_INVALID",
      "The cleanup operator clock is not a positive safe integer.",
    );
  }
  return value;
}

function assertApprovedDigest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_DIGEST_INVALID",
      "The approved cleanup candidate SHA-256 must be an exact lowercase digest.",
    );
  }
}

export interface VerifiedSharedCellCleanupStackEvidence {
  readonly schemaVersion: 1;
  readonly verified: true;
  readonly observedAt: number;
  readonly accountId: typeof accountId;
  readonly region: typeof region;
  readonly cellId: typeof cellId;
  readonly stackName: typeof stackName;
  readonly stackId: string;
  readonly stackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  readonly cellExpiresAt: string;
  readonly templateCanonicalSha256: string;
  readonly resourceInventorySha256: string;
  readonly cloudFormationRoleArn: typeof cellCloudFormationRoleArn;
}

export interface VerifiedSharedCellZeroTenantEvidence {
  readonly schemaVersion: 1;
  readonly verified: true;
  readonly observedAt: number;
  readonly accountId: typeof accountId;
  readonly region: typeof region;
  readonly cellId: typeof cellId;
  readonly environmentId: typeof environmentId;
  readonly activeTenantCount: 0;
  readonly activeCapacityReservationCount: 0;
  readonly nonterminalDeploymentCount: 0;
  readonly liveTenantResourceCount: 0;
  readonly nonterminalTenantCleanupScheduleCount: 0;
  readonly sourceSnapshotSha256: string;
}

export interface ReadSharedCellCleanupEvidenceInput {
  predecessor: Readonly<SharedCellProvisionAuthorityRecord>;
  signal: AbortSignal;
}

/**
 * A production implementation must complete a fresh live Stack/template/
 * inventory readback before it calls markVerified(). No production collector
 * is installed by this dormant slice.
 */
export abstract class SharedCellCleanupStackEvidencePort {
  protected constructor() {
    stackEvidencePorts.add(this);
  }

  protected markVerified(
    value: VerifiedSharedCellCleanupStackEvidence,
  ): VerifiedSharedCellCleanupStackEvidence {
    const snapshot = Object.freeze({ ...value });
    assertStackEvidenceShape(snapshot);
    verifiedStackEvidence.add(snapshot);
    return snapshot;
  }

  abstract readVerifiedCleanupStackEvidence(
    input: ReadSharedCellCleanupEvidenceInput,
  ): Promise<VerifiedSharedCellCleanupStackEvidence>;
}

/**
 * A production implementation must derive all five zero counts from one
 * strongly consistent ownership snapshot before it calls markVerified().
 */
export abstract class SharedCellZeroTenantEvidencePort {
  protected constructor() {
    zeroTenantEvidencePorts.add(this);
  }

  protected markVerified(
    value: VerifiedSharedCellZeroTenantEvidence,
  ): VerifiedSharedCellZeroTenantEvidence {
    const snapshot = Object.freeze({ ...value });
    assertZeroTenantEvidenceShape(snapshot);
    verifiedZeroTenantEvidence.add(snapshot);
    return snapshot;
  }

  abstract readVerifiedZeroTenantEvidence(
    input: ReadSharedCellCleanupEvidenceInput,
  ): Promise<VerifiedSharedCellZeroTenantEvidence>;
}

function assertStackEvidenceShape(
  value: VerifiedSharedCellCleanupStackEvidence,
): void {
  if (
    !exactKeys(value, [
      "accountId",
      "cellExpiresAt",
      "cellId",
      "cloudFormationRoleArn",
      "observedAt",
      "region",
      "resourceInventorySha256",
      "schemaVersion",
      "stackId",
      "stackName",
      "stackStatus",
      "templateCanonicalSha256",
      "verified",
    ]) ||
    value.schemaVersion !== 1 ||
    value.verified !== true ||
    value.accountId !== accountId ||
    value.region !== region ||
    value.cellId !== cellId ||
    value.stackName !== stackName ||
    !stackIdPattern.test(value.stackId) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(value.stackStatus) ||
    value.cloudFormationRoleArn !== cellCloudFormationRoleArn ||
    !Number.isSafeInteger(value.observedAt) ||
    value.observedAt <= 0 ||
    !digestPattern.test(value.templateCanonicalSha256) ||
    !digestPattern.test(value.resourceInventorySha256)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_STACK_EVIDENCE_INVALID",
      "Cleanup Stack evidence is missing, unexpected, drifting or outside the dedicated Cell role.",
    );
  }
  canonicalUtc(value.cellExpiresAt, "Cleanup Stack cellExpiresAt");
}

function assertZeroTenantEvidenceShape(
  value: VerifiedSharedCellZeroTenantEvidence,
): void {
  if (
    !exactKeys(value, [
      "accountId",
      "activeCapacityReservationCount",
      "activeTenantCount",
      "cellId",
      "environmentId",
      "liveTenantResourceCount",
      "nonterminalDeploymentCount",
      "nonterminalTenantCleanupScheduleCount",
      "observedAt",
      "region",
      "schemaVersion",
      "sourceSnapshotSha256",
      "verified",
    ]) ||
    value.schemaVersion !== 1 ||
    value.verified !== true ||
    value.accountId !== accountId ||
    value.region !== region ||
    value.cellId !== cellId ||
    value.environmentId !== environmentId ||
    value.activeTenantCount !== 0 ||
    value.activeCapacityReservationCount !== 0 ||
    value.nonterminalDeploymentCount !== 0 ||
    value.liveTenantResourceCount !== 0 ||
    value.nonterminalTenantCleanupScheduleCount !== 0 ||
    !Number.isSafeInteger(value.observedAt) ||
    value.observedAt <= 0 ||
    !digestPattern.test(value.sourceSnapshotSha256)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_ZERO_TENANT_EVIDENCE_INVALID",
      "Cleanup requires exact zero-tenant evidence from the fixed Sandbox environment.",
    );
  }
}

function assertBrandedFreshEvidence(input: {
  stack: VerifiedSharedCellCleanupStackEvidence;
  zeroTenant: VerifiedSharedCellZeroTenantEvidence;
  predecessor: SharedCellProvisionAuthorityRecord;
  now: number;
}): void {
  if (!verifiedStackEvidence.has(input.stack)) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_STACK_EVIDENCE_UNVERIFIED",
      "Cleanup Stack evidence was not produced by a trusted live collector.",
    );
  }
  if (!verifiedZeroTenantEvidence.has(input.zeroTenant)) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_ZERO_TENANT_EVIDENCE_UNVERIFIED",
      "Zero-tenant evidence was not produced by a trusted ownership collector.",
    );
  }
  assertStackEvidenceShape(input.stack);
  assertZeroTenantEvidenceShape(input.zeroTenant);
  const evidenceTimes = [input.stack.observedAt, input.zeroTenant.observedAt];
  const oldest = Math.min(...evidenceTimes);
  const newest = Math.max(...evidenceTimes);
  if (
    newest > input.now ||
    input.now - oldest > maximumEvidenceAgeMs ||
    newest - oldest > maximumEvidenceAgeMs
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_EVIDENCE_STALE",
      "Cleanup requires fresh Stack and zero-tenant evidence from one bounded review window.",
    );
  }
  const cellExpiry = canonicalUtc(input.stack.cellExpiresAt, "cellExpiresAt");
  if (cellExpiry > input.now) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_CELL_NOT_EXPIRED",
      "Cleanup authority cannot be reviewed before the Shared Cell expires.",
    );
  }
  if (oldest < cellExpiry) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_EVIDENCE_PREDATES_EXPIRY",
      "Stack and zero-tenant evidence must both be collected at or after Cell expiry.",
    );
  }
  if (
    input.stack.stackId !== input.predecessor.stackId ||
    input.stack.stackStatus !== input.predecessor.stackStatus ||
    input.stack.cellExpiresAt !== input.predecessor.cellExpiresAt ||
    input.stack.templateCanonicalSha256 !==
      input.predecessor.templateCanonicalSha256 ||
    input.stack.resourceInventorySha256 !==
      input.predecessor.resourceInventorySha256
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_EVIDENCE_LINEAGE_MISMATCH",
      "Fresh cleanup evidence does not reproduce the persisted provision lineage.",
    );
  }
}

export interface SharedCellCleanupAuthorityOperatorManifest {
  expectedProvision: SharedCellProvisionAuthorityCoordinate;
  cleanup: SharedCellCleanupAuthorization;
}

function snapshotManifest(
  value: SharedCellCleanupAuthorityOperatorManifest,
): SharedCellCleanupAuthorityOperatorManifest {
  if (
    !exactKeys(value, ["cleanup", "expectedProvision"]) ||
    !exactKeys(value.expectedProvision, [
      "epoch",
      "generation",
      "operationHash",
      "ownerDeploymentId",
    ]) ||
    !exactKeys(value.cleanup, ["epoch", "expiresAt"])
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_MANIFEST_INVALID",
      "The cleanup review manifest contains missing or unexpected fields.",
    );
  }
  positiveInteger(value.expectedProvision.generation, "generation");
  positiveInteger(value.expectedProvision.epoch, "provision epoch");
  positiveInteger(value.cleanup.epoch, "cleanup epoch");
  if (
    typeof value.expectedProvision.ownerDeploymentId !== "string" ||
    !ownerPattern.test(value.expectedProvision.ownerDeploymentId) ||
    !digestPattern.test(value.expectedProvision.operationHash) ||
    value.cleanup.epoch <= value.expectedProvision.epoch
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_MANIFEST_INVALID",
      "The cleanup review manifest has invalid or non-advancing lineage coordinates.",
    );
  }
  canonicalUtc(value.cleanup.expiresAt, "cleanup expiresAt");
  try {
    return JSON.parse(
      canonicalJson(value),
    ) as SharedCellCleanupAuthorityOperatorManifest;
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_OPERATOR_MANIFEST_INVALID",
      "The cleanup review manifest is not immutable JSON data.",
    );
  }
}

export interface StrongReadSharedCellCleanupAuthorityPort {
  observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot>;
}

function pinnedAuthority(
  value: StrongReadSharedCellCleanupAuthorityPort,
): StrongReadSharedCellCleanupAuthorityPort {
  if (!value || typeof value !== "object" || typeof value.observe !== "function") {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_PORT_INVALID",
      "The strong-read cleanup authority port is invalid.",
    );
  }
  const observe = value.observe;
  return Object.freeze({
    observe: (input: {
      authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
      signal: AbortSignal;
    }) => observe.call(value, input),
  });
}

function pinnedStackEvidence(
  value: SharedCellCleanupStackEvidencePort,
): Pick<SharedCellCleanupStackEvidencePort, "readVerifiedCleanupStackEvidence"> {
  if (
    !value ||
    typeof value !== "object" ||
    !stackEvidencePorts.has(value) ||
    typeof value.readVerifiedCleanupStackEvidence !== "function"
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_STACK_PORT_UNVERIFIED",
      "The cleanup Stack evidence collector is not a branded port.",
    );
  }
  const read = value.readVerifiedCleanupStackEvidence;
  return Object.freeze({
    readVerifiedCleanupStackEvidence: (input) => read.call(value, input),
  });
}

function pinnedZeroTenantEvidence(
  value: SharedCellZeroTenantEvidencePort,
): Pick<SharedCellZeroTenantEvidencePort, "readVerifiedZeroTenantEvidence"> {
  if (
    !value ||
    typeof value !== "object" ||
    !zeroTenantEvidencePorts.has(value) ||
    typeof value.readVerifiedZeroTenantEvidence !== "function"
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_ZERO_TENANT_PORT_UNVERIFIED",
      "The zero-tenant evidence collector is not a branded port.",
    );
  }
  const read = value.readVerifiedZeroTenantEvidence;
  return Object.freeze({
    readVerifiedZeroTenantEvidence: (input) => read.call(value, input),
  });
}

export interface SharedCellCleanupAuthorityCasGrant {
  readonly schemaVersion: 1;
  readonly authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
  readonly fromState: "provision_verified";
  readonly toState: "cleanup_authorized";
  readonly expectedPredecessorItemSha256: string;
  readonly approvedCandidateItemSha256: string;
  readonly expiresAt: string;
}

/**
 * Execute accepts only this separately injected CAS capability. It deliberately
 * has no CloudFormation delete method, so the authority writer and a future
 * Cell deleter cannot collapse into one privilege surface. The grant may be
 * shorter-lived than the cleanup authorization, but never longer-lived.
 */
export abstract class GrantBoundSharedCellCleanupAuthorityCasPort
  implements AtomicSharedCellCleanupAuthorityPort
{
  readonly grant: Readonly<SharedCellCleanupAuthorityCasGrant>;

  protected constructor(grant: SharedCellCleanupAuthorityCasGrant) {
    if (
      !exactKeys(grant, [
        "approvedCandidateItemSha256",
        "authorityKey",
        "expectedPredecessorItemSha256",
        "expiresAt",
        "fromState",
        "schemaVersion",
        "toState",
      ]) ||
      grant.schemaVersion !== 1 ||
      grant.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
      grant.fromState !== "provision_verified" ||
      grant.toState !== "cleanup_authorized" ||
      !digestPattern.test(grant.expectedPredecessorItemSha256) ||
      !digestPattern.test(grant.approvedCandidateItemSha256)
    ) {
      fail(
        "SHARED_CELL_CLEANUP_OPERATOR_GRANT_INVALID",
        "The cleanup CAS capability is not bound to one exact reviewed transition.",
      );
    }
    canonicalUtc(grant.expiresAt, "CAS grant expiresAt");
    this.grant = Object.freeze({ ...grant });
    grantBoundCasPorts.add(this);
  }

  abstract observe(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot>;

  abstract compareAndSet(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    expected: SharedCellCleanupAuthoritySnapshot;
    next: SharedCellCleanupAuthorityItem;
    signal: AbortSignal;
  }): Promise<{
    applied: boolean;
    snapshot: SharedCellCleanupAuthoritySnapshot;
  }>;
}

function pinnedGrantBoundWriter(
  value: GrantBoundSharedCellCleanupAuthorityCasPort,
): GrantBoundSharedCellCleanupAuthorityCasPort {
  if (
    !value ||
    typeof value !== "object" ||
    !grantBoundCasPorts.has(value) ||
    typeof value.observe !== "function" ||
    typeof value.compareAndSet !== "function"
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_WRITER_UNVERIFIED",
      "Execute requires a branded grant-bound cleanup CAS capability.",
    );
  }
  const observe = value.observe;
  const compareAndSet = value.compareAndSet;
  const grant = value.grant;
  return Object.freeze({
    grant,
    observe: (input: {
      authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
      signal: AbortSignal;
    }) => observe.call(value, input),
    compareAndSet: (input: {
      authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
      expected: SharedCellCleanupAuthoritySnapshot;
      next: SharedCellCleanupAuthorityItem;
      signal: AbortSignal;
    }) => compareAndSet.call(value, input),
  }) as GrantBoundSharedCellCleanupAuthorityCasPort;
}

async function validatedPredecessor(
  authority: StrongReadSharedCellCleanupAuthorityPort,
  manifest: SharedCellCleanupAuthorityOperatorManifest,
  signal: AbortSignal,
): Promise<{
  snapshot: SharedCellCleanupAuthoritySnapshot;
  item: Readonly<SharedCellAuthorityItem>;
  record: Readonly<SharedCellProvisionAuthorityRecord>;
  itemSha256: string;
}> {
  signal.throwIfAborted();
  const snapshot = await authority.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal,
  });
  signal.throwIfAborted();
  if (
    !exactKeys(snapshot, ["authorityKey", "item", "revision"]) ||
    snapshot.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    snapshot.item === null ||
    snapshot.item.revision !== snapshot.revision
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_PREDECESSOR_INVALID",
      "The cleanup predecessor strong-read snapshot is missing or malformed.",
    );
  }
  const validated = await validateSharedCellAuthorityItem(snapshot.item);
  signal.throwIfAborted();
  if (validated.record.state !== "provision_verified") {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_PREDECESSOR_STATE_INVALID",
      "Cleanup review requires an exact provision_verified predecessor.",
    );
  }
  const expected = manifest.expectedProvision;
  if (
    validated.record.ownerDeploymentId !== expected.ownerDeploymentId ||
    validated.record.generation !== expected.generation ||
    validated.record.provisionEpoch !== expected.epoch ||
    validated.record.provisionOperationHash !== expected.operationHash
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_PREDECESSOR_LINEAGE_MISMATCH",
      "The persisted owner, generation, provision epoch or operation hash drifted from the reviewed manifest.",
    );
  }
  const itemSha256 = await sha256Hex(validated.item);
  signal.throwIfAborted();
  return {
    snapshot,
    item: validated.item,
    record: validated.record,
    itemSha256,
  };
}

interface CompiledCleanupCandidate {
  predecessor: Awaited<ReturnType<typeof validatedPredecessor>>;
  stackEvidence: VerifiedSharedCellCleanupStackEvidence;
  zeroTenantEvidence: VerifiedSharedCellZeroTenantEvidence;
  item: Readonly<SharedCellCleanupAuthorityItem>;
  record: Readonly<SharedCellCleanupAuthorityRecord>;
  candidateItemSha256: string;
  stackEvidenceSha256: string;
  zeroTenantEvidenceSha256: string;
}

async function compileFreshCandidate(input: {
  authority: StrongReadSharedCellCleanupAuthorityPort;
  stackEvidence: Pick<
    SharedCellCleanupStackEvidencePort,
    "readVerifiedCleanupStackEvidence"
  >;
  zeroTenantEvidence: Pick<
    SharedCellZeroTenantEvidencePort,
    "readVerifiedZeroTenantEvidence"
  >;
  manifest: SharedCellCleanupAuthorityOperatorManifest;
  signal: AbortSignal;
  now: () => number;
}): Promise<CompiledCleanupCandidate> {
  const predecessor = await validatedPredecessor(
    input.authority,
    input.manifest,
    input.signal,
  );
  input.signal.throwIfAborted();
  const evidenceInput = Object.freeze({
    predecessor: predecessor.record,
    signal: input.signal,
  });
  const stackEvidence = await input.stackEvidence.readVerifiedCleanupStackEvidence(
    evidenceInput,
  );
  input.signal.throwIfAborted();
  const zeroTenantEvidence =
    await input.zeroTenantEvidence.readVerifiedZeroTenantEvidence(evidenceInput);
  input.signal.throwIfAborted();
  const compileNow = readClock(input.now);
  assertBrandedFreshEvidence({
    stack: stackEvidence,
    zeroTenant: zeroTenantEvidence,
    predecessor: predecessor.record,
    now: compileNow,
  });
  const projectedStackEvidence: SharedCellCleanupStackEvidence = {
    stackName: stackEvidence.stackName,
    stackId: stackEvidence.stackId,
    stackStatus: stackEvidence.stackStatus,
    cellExpiresAt: stackEvidence.cellExpiresAt,
    templateCanonicalSha256: stackEvidence.templateCanonicalSha256,
    resourceInventorySha256: stackEvidence.resourceInventorySha256,
  };
  const item = await compileSharedCellCleanupAuthorityCandidateItem({
    cell: projectedStackEvidence,
    provision: input.manifest.expectedProvision,
    cleanup: input.manifest.cleanup,
    revision: predecessor.snapshot.revision + 1,
    now: compileNow,
  });
  input.signal.throwIfAborted();
  const validated = await validateSharedCellCleanupAuthorityItem(item);
  input.signal.throwIfAborted();
  const candidateItemSha256 = await sha256Hex(validated.item);
  const stackEvidenceSha256 = await sha256Hex(stackEvidence);
  const zeroTenantEvidenceSha256 = await sha256Hex(zeroTenantEvidence);
  input.signal.throwIfAborted();

  const after = await validatedPredecessor(
    input.authority,
    input.manifest,
    input.signal,
  );
  if (
    after.itemSha256 !== predecessor.itemSha256 ||
    canonicalJson(after.item) !== canonicalJson(predecessor.item)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_PREDECESSOR_CHANGED",
      "The provision predecessor changed while cleanup evidence was collected.",
      true,
    );
  }
  return {
    predecessor,
    stackEvidence,
    zeroTenantEvidence,
    item: validated.item,
    record: validated.record,
    candidateItemSha256,
    stackEvidenceSha256,
    zeroTenantEvidenceSha256,
  };
}

export type SharedCellCleanupAuthorityOperatorPhase =
  | "INSPECTED"
  | "AUTHORIZED"
  | "RECOVERED";

export interface SharedCellCleanupAuthorityOperatorSummary {
  readonly schemaVersion: 1;
  readonly phase: SharedCellCleanupAuthorityOperatorPhase;
  readonly mutationPerformed: boolean;
  readonly deletionPerformed: false;
  readonly accountId: typeof accountId;
  readonly region: typeof region;
  readonly cellId: typeof cellId;
  readonly stackName: typeof stackName;
  readonly generation: number;
  readonly provisionEpoch: number;
  readonly cleanupEpoch: number;
  readonly revision: number;
  readonly expiresAt: string;
  readonly stackEvidenceObservedAt: number | null;
  readonly zeroTenantEvidenceObservedAt: number | null;
  readonly ownerDeploymentIdSha256: string;
  readonly predecessorItemSha256: string;
  readonly stackEvidenceSha256: string | null;
  readonly zeroTenantEvidenceSha256: string | null;
  readonly recordHash: string;
  readonly cleanupOperationHash: string;
  readonly candidateItemSha256: string;
}

async function summary(
  phase: SharedCellCleanupAuthorityOperatorPhase,
  mutationPerformed: boolean,
  candidate: {
    predecessorItemSha256: string;
    record: Readonly<SharedCellCleanupAuthorityRecord>;
    candidateItemSha256: string;
    stackEvidenceObservedAt: number | null;
    zeroTenantEvidenceObservedAt: number | null;
    stackEvidenceSha256: string | null;
    zeroTenantEvidenceSha256: string | null;
  },
): Promise<Readonly<SharedCellCleanupAuthorityOperatorSummary>> {
  return Object.freeze({
    schemaVersion: 1 as const,
    phase,
    mutationPerformed,
    deletionPerformed: false as const,
    accountId: candidate.record.accountId,
    region: candidate.record.region,
    cellId: candidate.record.cellId,
    stackName: candidate.record.stackName,
    generation: candidate.record.generation,
    provisionEpoch: candidate.record.provisionEpoch,
    cleanupEpoch: candidate.record.cleanupEpoch,
    revision: candidate.record.revision,
    expiresAt: candidate.record.expiresAt,
    stackEvidenceObservedAt: candidate.stackEvidenceObservedAt,
    zeroTenantEvidenceObservedAt: candidate.zeroTenantEvidenceObservedAt,
    ownerDeploymentIdSha256: await sha256Hex(
      candidate.record.ownerDeploymentId,
    ),
    predecessorItemSha256: candidate.predecessorItemSha256,
    stackEvidenceSha256: candidate.stackEvidenceSha256,
    zeroTenantEvidenceSha256: candidate.zeroTenantEvidenceSha256,
    recordHash: candidate.record.recordHash,
    cleanupOperationHash: candidate.record.cleanupOperationHash,
    candidateItemSha256: candidate.candidateItemSha256,
  });
}

interface InspectInput {
  authority: StrongReadSharedCellCleanupAuthorityPort;
  stackEvidence: SharedCellCleanupStackEvidencePort;
  zeroTenantEvidence: SharedCellZeroTenantEvidencePort;
  manifest: SharedCellCleanupAuthorityOperatorManifest;
  signal: AbortSignal;
  now?: () => number;
}

interface ExecuteInput extends InspectInput {
  writer: GrantBoundSharedCellCleanupAuthorityCasPort;
  approvedCandidateItemSha256: string;
}

interface RecoverInput {
  authority: StrongReadSharedCellCleanupAuthorityPort;
  approvedCandidateItemSha256: string;
  expectedOwnerDeploymentId: string;
  signal: AbortSignal;
}

export async function inspectSharedCellCleanupAuthorityCandidate(
  input: InspectInput,
): Promise<Readonly<SharedCellCleanupAuthorityOperatorSummary>> {
  assertInputKeys(
    input,
    ["authority", "manifest", "signal", "stackEvidence", "zeroTenantEvidence"],
    ["now"],
  );
  const authority = pinnedAuthority(input.authority);
  const stackEvidence = pinnedStackEvidence(input.stackEvidence);
  const zeroTenantEvidence = pinnedZeroTenantEvidence(input.zeroTenantEvidence);
  const manifest = snapshotManifest(input.manifest);
  const now = pinnedClock(input.now);
  const candidate = await compileFreshCandidate({
    authority,
    stackEvidence,
    zeroTenantEvidence,
    manifest,
    signal: input.signal,
    now,
  });
  const result = await summary("INSPECTED", false, {
    predecessorItemSha256: candidate.predecessor.itemSha256,
    record: candidate.record,
    candidateItemSha256: candidate.candidateItemSha256,
    stackEvidenceObservedAt: candidate.stackEvidence.observedAt,
    zeroTenantEvidenceObservedAt: candidate.zeroTenantEvidence.observedAt,
    stackEvidenceSha256: candidate.stackEvidenceSha256,
    zeroTenantEvidenceSha256: candidate.zeroTenantEvidenceSha256,
  });
  input.signal.throwIfAborted();
  return result;
}

export async function executeReviewedSharedCellCleanupAuthorityAdvance(
  input: ExecuteInput,
): Promise<Readonly<SharedCellCleanupAuthorityOperatorSummary>> {
  assertInputKeys(
    input,
    [
      "approvedCandidateItemSha256",
      "authority",
      "manifest",
      "signal",
      "stackEvidence",
      "writer",
      "zeroTenantEvidence",
    ],
    ["now"],
  );
  assertApprovedDigest(input.approvedCandidateItemSha256);
  const approvedCandidateItemSha256 = input.approvedCandidateItemSha256;
  const authority = pinnedAuthority(input.authority);
  const stackEvidence = pinnedStackEvidence(input.stackEvidence);
  const zeroTenantEvidence = pinnedZeroTenantEvidence(input.zeroTenantEvidence);
  const writer = pinnedGrantBoundWriter(input.writer);
  const manifest = snapshotManifest(input.manifest);
  const now = pinnedClock(input.now);
  const candidate = await compileFreshCandidate({
    authority,
    stackEvidence,
    zeroTenantEvidence,
    manifest,
    signal: input.signal,
    now,
  });
  if (candidate.candidateItemSha256 !== approvedCandidateItemSha256) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_CANDIDATE_MISMATCH",
      "Fresh cleanup evidence does not reproduce the reviewed candidate digest.",
    );
  }
  if (
    writer.grant.approvedCandidateItemSha256 !==
      approvedCandidateItemSha256 ||
    writer.grant.expectedPredecessorItemSha256 !==
      candidate.predecessor.itemSha256 ||
    canonicalUtc(writer.grant.expiresAt, "CAS grant expiresAt") >
      canonicalUtc(manifest.cleanup.expiresAt, "cleanup expiresAt")
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_GRANT_MISMATCH",
      "The CAS capability is not bound to the exact predecessor, candidate and expiry.",
    );
  }
  const preWriteNow = readClock(now);
  if (canonicalUtc(writer.grant.expiresAt, "CAS grant expiresAt") <= preWriteNow) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_GRANT_EXPIRED",
      "The cleanup CAS grant expired before submission.",
    );
  }
  input.signal.throwIfAborted();

  let casSubmitted = false;
  const trackingPort: AtomicSharedCellCleanupAuthorityPort = {
    observe: (request) => writer.observe(request),
    compareAndSet: async (request) => {
      const expectedItem = request.expected.item;
      if (!expectedItem) {
        fail(
          "SHARED_CELL_CLEANUP_OPERATOR_WRITE_SCOPE_INVALID",
          "The reviewed cleanup CAS cannot bootstrap an empty authority key.",
        );
      }
      const expectedSha256 = await sha256Hex(expectedItem);
      const nextSha256 = await sha256Hex(request.next);
      if (
        expectedSha256 !== writer.grant.expectedPredecessorItemSha256 ||
        nextSha256 !== writer.grant.approvedCandidateItemSha256
      ) {
        fail(
          "SHARED_CELL_CLEANUP_OPERATOR_WRITE_SCOPE_INVALID",
          "The submitted CAS differs from the exact grant-bound transition.",
        );
      }
      const submissionNow = readClock(now);
      assertBrandedFreshEvidence({
        stack: candidate.stackEvidence,
        zeroTenant: candidate.zeroTenantEvidence,
        predecessor: candidate.predecessor.record,
        now: submissionNow,
      });
      if (
        canonicalUtc(writer.grant.expiresAt, "CAS grant expiresAt") <=
        submissionNow
      ) {
        fail(
          "SHARED_CELL_CLEANUP_OPERATOR_GRANT_EXPIRED",
          "The cleanup CAS grant expired before provider submission.",
        );
      }
      casSubmitted = true;
      return writer.compareAndSet(request);
    },
  };

  let advanced: Readonly<SharedCellCleanupAuthorityItem>;
  try {
    advanced = await advanceSharedCellCleanupAuthority({
      port: trackingPort,
      cell: {
        stackName: candidate.stackEvidence.stackName,
        stackId: candidate.stackEvidence.stackId,
        stackStatus: candidate.stackEvidence.stackStatus,
        cellExpiresAt: candidate.stackEvidence.cellExpiresAt,
        templateCanonicalSha256:
          candidate.stackEvidence.templateCanonicalSha256,
        resourceInventorySha256:
          candidate.stackEvidence.resourceInventorySha256,
      },
      provision: manifest.expectedProvision,
      cleanup: manifest.cleanup,
      signal: input.signal,
      now,
    });
  } catch (error) {
    if (!casSubmitted) throw error;
    const uncertain = new SharedCellCleanupAuthorityOperatorError(
      "SHARED_CELL_CLEANUP_OPERATOR_WRITE_UNCERTAIN",
      "Cleanup authority CAS was submitted but did not complete exact verification; use read-only recovery.",
      true,
    );
    Object.defineProperty(uncertain, "cause", { value: error });
    throw uncertain;
  }
  if (!casSubmitted) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_EXECUTE_RACE",
      "The authority advanced before this operator submitted its CAS; use read-only recovery.",
      true,
    );
  }
  const advancedSha256 = await sha256Hex(advanced);
  if (
    advancedSha256 !== approvedCandidateItemSha256 ||
    canonicalJson(advanced) !== canonicalJson(candidate.item)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_RESULT_MISMATCH_AFTER_WRITE",
      "The advanced authority differs from the reviewed cleanup candidate.",
      true,
    );
  }

  try {
    input.signal.throwIfAborted();
    const readback = await authority.observe({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    if (!readback.item) {
      fail(
        "SHARED_CELL_CLEANUP_OPERATOR_READBACK_MISMATCH_AFTER_WRITE",
        "The cleanup authority disappeared after CAS.",
        true,
      );
    }
    const readbackValidated = await validateSharedCellCleanupAuthorityItem(
      readback.item,
    );
    const readbackSha256 = await sha256Hex(readbackValidated.item);
    input.signal.throwIfAborted();
    if (
      readback.revision !== candidate.record.revision ||
      readbackSha256 !== approvedCandidateItemSha256
    ) {
      fail(
        "SHARED_CELL_CLEANUP_OPERATOR_READBACK_MISMATCH_AFTER_WRITE",
        "The cleanup authority did not independently read back as the reviewed candidate.",
        true,
      );
    }
    assertSharedCellCleanupAuthorityActive(
      readbackValidated.record,
      readClock(now),
      true,
    );
  } catch (error) {
    if (
      error instanceof SharedCellCleanupAuthorityOperatorError &&
      error.code === "SHARED_CELL_CLEANUP_OPERATOR_WRITE_UNCERTAIN"
    ) {
      throw error;
    }
    const uncertain = new SharedCellCleanupAuthorityOperatorError(
      "SHARED_CELL_CLEANUP_OPERATOR_READBACK_UNCERTAIN",
      "Cleanup authority CAS completed but independent strong readback was not exact; use recovery.",
      true,
    );
    Object.defineProperty(uncertain, "cause", { value: error });
    throw uncertain;
  }
  const result = await summary("AUTHORIZED", true, {
    predecessorItemSha256: candidate.predecessor.itemSha256,
    record: candidate.record,
    candidateItemSha256: candidate.candidateItemSha256,
    stackEvidenceObservedAt: candidate.stackEvidence.observedAt,
    zeroTenantEvidenceObservedAt: candidate.zeroTenantEvidence.observedAt,
    stackEvidenceSha256: candidate.stackEvidenceSha256,
    zeroTenantEvidenceSha256: candidate.zeroTenantEvidenceSha256,
  });
  if (input.signal.aborted) {
    const uncertain = new SharedCellCleanupAuthorityOperatorError(
      "SHARED_CELL_CLEANUP_OPERATOR_ABORTED_AFTER_WRITE",
      "The operator was aborted after cleanup CAS submission; resolve the outcome with read-only recovery.",
      true,
    );
    if (input.signal.reason !== undefined) {
      Object.defineProperty(uncertain, "cause", { value: input.signal.reason });
    }
    throw uncertain;
  }
  return result;
}

export async function recoverReviewedSharedCellCleanupAuthorityAdvance(
  input: RecoverInput,
): Promise<Readonly<SharedCellCleanupAuthorityOperatorSummary>> {
  assertInputKeys(
    input,
    [
      "approvedCandidateItemSha256",
      "authority",
      "expectedOwnerDeploymentId",
      "signal",
    ],
  );
  assertApprovedDigest(input.approvedCandidateItemSha256);
  if (
    typeof input.expectedOwnerDeploymentId !== "string" ||
    !ownerPattern.test(input.expectedOwnerDeploymentId)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_OWNER_INVALID",
      "The expected cleanup authority owner is invalid.",
    );
  }
  const authority = pinnedAuthority(input.authority);
  input.signal.throwIfAborted();
  const snapshot = await authority.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  if (!snapshot.item || snapshot.revision !== snapshot.item.revision) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_ABSENT",
      "No exact cleanup authority is present at the fixed key.",
    );
  }
  const validated = await validateSharedCellCleanupAuthorityItem(snapshot.item);
  input.signal.throwIfAborted();
  if (validated.record.ownerDeploymentId !== input.expectedOwnerDeploymentId) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_LINEAGE_MISMATCH",
      "The cleanup authority owner differs from the reviewed lineage.",
    );
  }
  const candidateItemSha256 = await sha256Hex(validated.item);
  input.signal.throwIfAborted();
  if (candidateItemSha256 !== input.approvedCandidateItemSha256) {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_DIGEST_MISMATCH",
      "The observed cleanup authority differs from the reviewed candidate digest.",
    );
  }
  const predecessorRecord = {
    ...validated.record,
    state: "provision_verified" as const,
  };
  const predecessorUnsigned: Record<string, unknown> = {
    schemaVersion: predecessorRecord.schemaVersion,
    accountId: predecessorRecord.accountId,
    region: predecessorRecord.region,
    cellId: predecessorRecord.cellId,
    stackName: predecessorRecord.stackName,
    stackId: predecessorRecord.stackId,
    stackStatus: predecessorRecord.stackStatus,
    cellExpiresAt: predecessorRecord.cellExpiresAt,
    templateCanonicalSha256: predecessorRecord.templateCanonicalSha256,
    resourceInventorySha256: predecessorRecord.resourceInventorySha256,
    ownerDeploymentId: predecessorRecord.ownerDeploymentId,
    generation: predecessorRecord.generation,
    provisionEpoch: predecessorRecord.provisionEpoch,
    provisionMarker: predecessorRecord.provisionMarker,
    provisionOperationHash: predecessorRecord.provisionOperationHash,
    revision: predecessorRecord.revision - 1,
    state: predecessorRecord.state,
  };
  const predecessorItem: SharedCellAuthorityItem = {
    authority_key: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    schema_version: 1,
    revision: predecessorRecord.revision - 1,
    record_json: canonicalJson({
      ...predecessorUnsigned,
      recordHash: await sha256Hex(predecessorUnsigned),
    }),
  };
  let validatedPredecessor: Awaited<
    ReturnType<typeof validateSharedCellAuthorityItem>
  >;
  try {
    validatedPredecessor = await validateSharedCellAuthorityItem(predecessorItem);
  } catch (error) {
    const mismatch = new SharedCellCleanupAuthorityOperatorError(
      "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_LINEAGE_MISMATCH",
      "The cleanup authority cannot reconstruct one exact provision predecessor.",
    );
    Object.defineProperty(mismatch, "cause", { value: error });
    throw mismatch;
  }
  input.signal.throwIfAborted();
  if (validatedPredecessor.record.state !== "provision_verified") {
    fail(
      "SHARED_CELL_CLEANUP_OPERATOR_RECOVERY_LINEAGE_MISMATCH",
      "The cleanup authority does not reconstruct an exact provision predecessor.",
    );
  }
  const result = await summary("RECOVERED", false, {
    predecessorItemSha256: await sha256Hex(validatedPredecessor.item),
    record: validated.record,
    candidateItemSha256,
    stackEvidenceObservedAt: null,
    zeroTenantEvidenceObservedAt: null,
    stackEvidenceSha256: null,
    zeroTenantEvidenceSha256: null,
  });
  input.signal.throwIfAborted();
  return result;
}
