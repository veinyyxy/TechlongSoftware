import type { AwsSandboxSharedCellStackInput } from "../cloudformation/shared-cell-stack.ts";
import type { DeploymentEnvironment } from "../environment.ts";
import type { DeploymentExecutionBinding } from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  validateSharedCellAuthorityItem,
  type SharedCellAuthorityItem,
  type SharedCellProvisionAuthorityRecord,
} from "./shared-cell-cleanup-authority.ts";
import {
  compileSharedCellProvisionAuthorityCandidateItem,
  installInitialSharedCellProvisionAuthority,
  SharedCellProvisionAuthorityError,
  type AtomicSharedCellProvisionAuthorityPort,
  type SharedCellProvisionAuthorityCoordinateInput,
  type SharedCellProvisionAuthoritySnapshot,
} from "./shared-cell-provision-authority.ts";
import type {
  ReadSharedCellProvisionEvidenceInput,
  VerifiedSharedCellProvisionEvidence,
} from "./shared-cell-provision-evidence.ts";

const digestPattern = /^[a-f0-9]{64}$/;
const ownerPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;

export interface SharedCellProvisionEvidencePort {
  readVerifiedProvisionEvidence(
    input: ReadSharedCellProvisionEvidenceInput,
  ): Promise<VerifiedSharedCellProvisionEvidence>;
}

/**
 * Immutable-input description approved before an operator reads AWS. Dynamic
 * Stack identifiers stay out of this manifest and are proven by the live
 * evidence adapter instead.
 */
export interface SharedCellProvisionAuthorityOperatorManifest {
  environment: DeploymentEnvironment;
  binding: DeploymentExecutionBinding;
  stackInput: AwsSandboxSharedCellStackInput;
  coordinate: SharedCellProvisionAuthorityCoordinateInput;
}

export type SharedCellProvisionAuthorityOperatorPhase =
  | "INSPECTED"
  | "INSTALLED"
  | "RECOVERED";

export interface SharedCellProvisionAuthorityOperatorSummary {
  readonly schemaVersion: 1;
  readonly phase: SharedCellProvisionAuthorityOperatorPhase;
  readonly mutationPerformed: boolean;
  readonly evidenceObservedAt: number | null;
  readonly accountId: "402010193138";
  readonly region: "ca-central-1";
  readonly cellId: "cell-sandbox-1";
  readonly stackName: "techlong-sandbox-cell-sandbox-1";
  readonly stackId: string;
  readonly stackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  readonly cellExpiresAt: string;
  readonly templateCanonicalSha256: string;
  readonly resourceInventorySha256: string;
  readonly ownerDeploymentId: string;
  readonly generation: 1;
  readonly provisionEpoch: 1;
  readonly revision: 1;
  readonly provisionOperationHash: string;
  readonly recordHash: string;
  readonly candidateItemSha256: string;
}

interface InspectInput {
  evidence: SharedCellProvisionEvidencePort;
  authority: AtomicSharedCellProvisionAuthorityPort;
  manifest: SharedCellProvisionAuthorityOperatorManifest;
  signal: AbortSignal;
  now?: () => number;
}

interface ExecuteInput extends InspectInput {
  approvedCandidateItemSha256: string;
}

interface RecoverInput {
  authority: AtomicSharedCellProvisionAuthorityPort;
  approvedCandidateItemSha256: string;
  expectedOwnerDeploymentId: string;
  signal: AbortSignal;
}

interface CompiledCandidate {
  evidence: VerifiedSharedCellProvisionEvidence;
  item: Readonly<SharedCellAuthorityItem>;
  record: Readonly<SharedCellProvisionAuthorityRecord>;
  candidateItemSha256: string;
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellProvisionAuthorityError(code, message, retryable);
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
      "SHARED_CELL_PROVISION_OPERATOR_INPUT_INVALID",
      "Shared Cell provision operator input is malformed.",
    );
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const withoutOptional = keys.filter((key) => !optional.includes(key));
  if (
    canonicalJson(withoutOptional.sort()) !== canonicalJson([...required].sort()) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_INPUT_INVALID",
      "Shared Cell provision operator input contains missing or unexpected fields.",
    );
  }
}

function snapshotManifest(
  value: SharedCellProvisionAuthorityOperatorManifest,
): SharedCellProvisionAuthorityOperatorManifest {
  if (
    !exactKeys(value, ["binding", "coordinate", "environment", "stackInput"]) ||
    !exactKeys(value.coordinate, ["epoch", "generation", "ownerDeploymentId"]) ||
    value.coordinate.generation !== 1 ||
    value.coordinate.epoch !== 1 ||
    typeof value.coordinate.ownerDeploymentId !== "string" ||
    !ownerPattern.test(value.coordinate.ownerDeploymentId)
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_MANIFEST_INVALID",
      "The reviewed manifest must describe only generation 1 and provision epoch 1.",
    );
  }
  try {
    return JSON.parse(canonicalJson(value)) as SharedCellProvisionAuthorityOperatorManifest;
  } catch {
    return fail(
      "SHARED_CELL_PROVISION_OPERATOR_MANIFEST_INVALID",
      "The reviewed manifest is not immutable JSON data.",
    );
  }
}

function pinnedAuthority(
  value: AtomicSharedCellProvisionAuthorityPort,
): AtomicSharedCellProvisionAuthorityPort {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.observe !== "function" ||
    typeof value.installIfAbsent !== "function"
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_PORT_INVALID",
      "The provision authority port is invalid.",
    );
  }
  const observe = value.observe;
  const installIfAbsent = value.installIfAbsent;
  const pinned: AtomicSharedCellProvisionAuthorityPort = {
    observe: (input) => observe.call(value, input),
    installIfAbsent: (input) => installIfAbsent.call(value, input),
  };
  return Object.freeze(pinned);
}

function pinnedEvidence(
  value: SharedCellProvisionEvidencePort,
): SharedCellProvisionEvidencePort {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.readVerifiedProvisionEvidence !== "function"
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_PORT_INVALID",
      "The provision evidence port is invalid.",
    );
  }
  const read = value.readVerifiedProvisionEvidence;
  const pinned: SharedCellProvisionEvidencePort = {
    readVerifiedProvisionEvidence: (input) => read.call(value, input),
  };
  return Object.freeze(pinned);
}

function pinnedClock(value: (() => number) | undefined): () => number {
  if (value !== undefined && typeof value !== "function") {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_CLOCK_INVALID",
      "The provision operator clock is invalid.",
    );
  }
  return value ?? Date.now;
}

function assertApprovedDigest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_DIGEST_INVALID",
      "The approved candidate item SHA-256 must be an exact lowercase digest.",
    );
  }
}

function assertNotAbortedAfterInstall(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new SharedCellProvisionAuthorityError(
    "SHARED_CELL_PROVISION_OPERATOR_ABORTED_AFTER_WRITE",
    "The operator was aborted after install submission; resolve the outcome with read-only recovery.",
    true,
  );
  if (signal.reason !== undefined) {
    Object.defineProperty(error, "cause", { value: signal.reason });
  }
  throw error;
}

async function validateSnapshot(
  snapshot: SharedCellProvisionAuthoritySnapshot,
): Promise<{
  item: Readonly<SharedCellAuthorityItem> | null;
  record: Readonly<SharedCellProvisionAuthorityRecord> | null;
}> {
  if (
    !exactKeys(snapshot, ["authorityKey", "item", "revision"]) ||
    snapshot.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    (snapshot.revision === 0) !== (snapshot.item === null) ||
    (snapshot.item !== null && snapshot.item.revision !== snapshot.revision)
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_SNAPSHOT_INVALID",
      "The Shared Cell authority snapshot is malformed.",
    );
  }
  if (snapshot.item === null) return { item: null, record: null };
  const validated = await validateSharedCellAuthorityItem(snapshot.item);
  if (validated.record.state !== "provision_verified") {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_STATE_INVALID",
      "The Shared Cell authority is not an initial provision predecessor.",
    );
  }
  return {
    item: validated.item,
    record: validated.record,
  };
}

async function requireAbsent(
  authority: AtomicSharedCellProvisionAuthorityPort,
  signal: AbortSignal,
  code: string,
): Promise<void> {
  signal.throwIfAborted();
  const snapshot = await authority.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal,
  });
  signal.throwIfAborted();
  const validated = await validateSnapshot(snapshot);
  signal.throwIfAborted();
  if (validated.item !== null) {
    fail(
      code,
      "The fixed Shared Cell authority key is already present; use read-only recovery instead.",
    );
  }
}

async function compileFreshCandidate(input: {
  evidence: SharedCellProvisionEvidencePort;
  manifest: SharedCellProvisionAuthorityOperatorManifest;
  signal: AbortSignal;
  now: () => number;
}): Promise<CompiledCandidate> {
  input.signal.throwIfAborted();
  const evidence = await input.evidence.readVerifiedProvisionEvidence({
    environment: input.manifest.environment,
    binding: input.manifest.binding,
    stackInput: input.manifest.stackInput,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  const item = await compileSharedCellProvisionAuthorityCandidateItem({
    evidence,
    coordinate: input.manifest.coordinate,
    revision: 1,
    now: input.now(),
  });
  input.signal.throwIfAborted();
  const validated = await validateSharedCellAuthorityItem(item);
  input.signal.throwIfAborted();
  if (
    validated.record.state !== "provision_verified" ||
    validated.record.generation !== 1 ||
    validated.record.provisionEpoch !== 1 ||
    validated.record.revision !== 1 ||
    validated.item.revision !== 1
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_CANDIDATE_INVALID",
      "The compiler did not produce the exact initial provision predecessor.",
    );
  }
  const candidateItemSha256 = await sha256Hex(validated.item);
  input.signal.throwIfAborted();
  return {
    evidence,
    item,
    record: validated.record,
    candidateItemSha256,
  };
}

function summary(
  phase: SharedCellProvisionAuthorityOperatorPhase,
  mutationPerformed: boolean,
  candidate: {
    evidenceObservedAt: number | null;
    record: Readonly<SharedCellProvisionAuthorityRecord>;
    candidateItemSha256: string;
  },
): Readonly<SharedCellProvisionAuthorityOperatorSummary> {
  const record = candidate.record;
  return Object.freeze({
    schemaVersion: 1 as const,
    phase,
    mutationPerformed,
    evidenceObservedAt: candidate.evidenceObservedAt,
    accountId: record.accountId,
    region: record.region,
    cellId: record.cellId,
    stackName: record.stackName,
    stackId: record.stackId,
    stackStatus: record.stackStatus,
    cellExpiresAt: record.cellExpiresAt,
    templateCanonicalSha256: record.templateCanonicalSha256,
    resourceInventorySha256: record.resourceInventorySha256,
    ownerDeploymentId: record.ownerDeploymentId,
    generation: 1 as const,
    provisionEpoch: 1 as const,
    revision: 1 as const,
    provisionOperationHash: record.provisionOperationHash,
    recordHash: record.recordHash,
    candidateItemSha256: candidate.candidateItemSha256,
  });
}

export async function inspectSharedCellProvisionAuthorityCandidate(
  input: InspectInput,
): Promise<Readonly<SharedCellProvisionAuthorityOperatorSummary>> {
  assertInputKeys(input, ["authority", "evidence", "manifest", "signal"], ["now"]);
  const authority = pinnedAuthority(input.authority);
  const evidence = pinnedEvidence(input.evidence);
  const manifest = snapshotManifest(input.manifest);
  const signal = input.signal;
  const now = pinnedClock(input.now);

  await requireAbsent(
    authority,
    signal,
    "SHARED_CELL_PROVISION_OPERATOR_INSPECT_ALREADY_PRESENT",
  );
  const candidate = await compileFreshCandidate({
    evidence,
    manifest,
    signal,
    now,
  });
  await requireAbsent(
    authority,
    signal,
    "SHARED_CELL_PROVISION_OPERATOR_INSPECT_RACE",
  );
  return summary("INSPECTED", false, {
    evidenceObservedAt: candidate.evidence.observedAt,
    ...candidate,
  });
}

export async function executeReviewedSharedCellProvisionAuthorityInstall(
  input: ExecuteInput,
): Promise<Readonly<SharedCellProvisionAuthorityOperatorSummary>> {
  assertInputKeys(
    input,
    [
      "approvedCandidateItemSha256",
      "authority",
      "evidence",
      "manifest",
      "signal",
    ],
    ["now"],
  );
  assertApprovedDigest(input.approvedCandidateItemSha256);
  const approvedCandidateItemSha256 = input.approvedCandidateItemSha256;
  const authority = pinnedAuthority(input.authority);
  const evidence = pinnedEvidence(input.evidence);
  const manifest = snapshotManifest(input.manifest);
  const signal = input.signal;
  const now = pinnedClock(input.now);

  await requireAbsent(
    authority,
    signal,
    "SHARED_CELL_PROVISION_OPERATOR_EXECUTE_ALREADY_PRESENT",
  );
  const candidate = await compileFreshCandidate({
    evidence,
    manifest,
    signal,
    now,
  });
  if (candidate.candidateItemSha256 !== approvedCandidateItemSha256) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_CANDIDATE_MISMATCH",
      "Fresh live evidence does not reproduce the reviewed candidate digest.",
    );
  }
  signal.throwIfAborted();

  let installSubmitted = false;
  const trackingAuthority: AtomicSharedCellProvisionAuthorityPort = {
    observe: (request) => authority.observe(request),
    installIfAbsent: async (request) => {
      installSubmitted = true;
      return authority.installIfAbsent(request);
    },
  };
  const installed = await installInitialSharedCellProvisionAuthority({
    port: trackingAuthority,
    evidence: candidate.evidence,
    coordinate: manifest.coordinate,
    signal,
    now,
  });
  assertNotAbortedAfterInstall(signal);
  if (!installSubmitted) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_EXECUTE_RACE",
      "The authority appeared after execute preflight; confirm it with read-only recovery.",
    );
  }
  const installedSha256 = await sha256Hex(installed);
  assertNotAbortedAfterInstall(signal);
  if (
    installedSha256 !== approvedCandidateItemSha256 ||
    canonicalJson(installed) !== canonicalJson(candidate.item)
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_RESULT_MISMATCH_AFTER_WRITE",
      "The installed authority differs from the reviewed candidate; the outcome is uncertain.",
      true,
    );
  }
  return summary("INSTALLED", true, {
    evidenceObservedAt: candidate.evidence.observedAt,
    ...candidate,
  });
}

export async function recoverReviewedSharedCellProvisionAuthorityInstall(
  input: RecoverInput,
): Promise<Readonly<SharedCellProvisionAuthorityOperatorSummary>> {
  assertInputKeys(input, [
    "approvedCandidateItemSha256",
    "authority",
    "expectedOwnerDeploymentId",
    "signal",
  ]);
  assertApprovedDigest(input.approvedCandidateItemSha256);
  if (
    typeof input.expectedOwnerDeploymentId !== "string" ||
    !ownerPattern.test(input.expectedOwnerDeploymentId)
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_OWNER_INVALID",
      "The expected provision authority owner is invalid.",
    );
  }
  const approvedCandidateItemSha256 = input.approvedCandidateItemSha256;
  const expectedOwnerDeploymentId = input.expectedOwnerDeploymentId;
  const authority = pinnedAuthority(input.authority);
  const signal = input.signal;
  signal.throwIfAborted();
  const snapshot = await authority.observe({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal,
  });
  signal.throwIfAborted();
  const validated = await validateSnapshot(snapshot);
  signal.throwIfAborted();
  if (!validated.item || !validated.record) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_RECOVERY_ABSENT",
      "No provision authority exists at the fixed key.",
    );
  }
  if (
    validated.item.revision !== 1 ||
    validated.record.revision !== 1 ||
    validated.record.generation !== 1 ||
    validated.record.provisionEpoch !== 1 ||
    validated.record.ownerDeploymentId !== expectedOwnerDeploymentId
  ) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_RECOVERY_LINEAGE_MISMATCH",
      "The observed authority is not the reviewed initial lineage.",
    );
  }
  const candidateItemSha256 = await sha256Hex(validated.item);
  signal.throwIfAborted();
  if (candidateItemSha256 !== approvedCandidateItemSha256) {
    fail(
      "SHARED_CELL_PROVISION_OPERATOR_RECOVERY_DIGEST_MISMATCH",
      "The observed authority item does not match the reviewed candidate digest.",
    );
  }
  return summary("RECOVERED", false, {
    evidenceObservedAt: null,
    record: validated.record,
    candidateItemSha256,
  });
}
