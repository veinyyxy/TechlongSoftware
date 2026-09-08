import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  assertSharedCellCleanupAuthorityActive,
  SHARED_CELL_CLEANUP_AUTHORITY_KEY,
  validateSharedCellCleanupAuthorityItem,
  type SharedCellCleanupAuthorityRecord,
  type SharedCellCleanupAuthoritySnapshot,
} from "./shared-cell-cleanup-authority.ts";

export const SHARED_CELL_CLEANUP_DELETION_ACCOUNT_ID = "402010193138" as const;
export const SHARED_CELL_CLEANUP_DELETION_REGION = "ca-central-1" as const;
export const SHARED_CELL_CLEANUP_DELETION_STACK_NAME =
  "techlong-sandbox-cell-sandbox-1" as const;
export const SHARED_CELL_CLEANUP_DELETION_ROLE_ARN =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const;
export const SHARED_CELL_CLEANUP_DELETION_CALLER_ROLE =
  "TechlongSandboxCellJanitorExecutionRole" as const;

const cellId = "cell-sandbox-1";
const environmentId = "env_aws_sandbox_ca_central_1";
const maximumEvidenceAgeMs = 5 * 60_000;
const digestPattern = /^[a-f0-9]{64}$/;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const callerArnPattern =
  /^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxCellJanitorExecutionRole\/[A-Za-z0-9+=,.@_-]{2,64}$/;
const sessionPattern = /^[A-Za-z0-9+=,.@_-]{2,64}$/;
const canonicalUtcPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const exactTenantSupportStacks = new Set([
  "techlong-sandbox-tenant-b5j3",
  "techlong-sandbox-tenant-b5j4logs",
]);
const maximumPages = 100;

export class SharedCellCleanupDeletionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellCleanupDeletionError(code, message, retryable);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function canonicalClone<T>(value: T, code: string, label: string): T {
  try {
    const serialized = canonicalJson(value);
    if (typeof serialized !== "string") throw new Error("not JSON");
    return JSON.parse(serialized) as T;
  } catch {
    return fail(code, `${label} is not immutable JSON data.`);
  }
}

function canonicalUtc(value: unknown, label: string): number {
  if (typeof value !== "string" || !canonicalUtcPattern.test(value)) {
    fail(
      "SHARED_CELL_DELETE_EVIDENCE_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail("SHARED_CELL_DELETE_EVIDENCE_INVALID", `${label} is invalid.`);
  }
  return parsed;
}

function readClock(clock: () => number): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      "SHARED_CELL_DELETE_CLOCK_INVALID",
      "The Shared Cell deletion clock could not be read.",
    );
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "SHARED_CELL_DELETE_CLOCK_INVALID",
      "The Shared Cell deletion clock is invalid.",
    );
  }
  return value;
}

function requireNotAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

export interface SharedCellCleanupDeletionEvidenceReadPort {
  readonly region: string;
  getCallerIdentity(input: { signal: AbortSignal }): Promise<unknown>;
  listStackNamesPage(input: {
    nextToken: string | null;
    signal: AbortSignal;
  }): Promise<unknown>;
  describeCellStack(input: {
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  getOriginalTemplate(input: {
    stackId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  listStackResourcesPage(input: {
    stackId: string;
    nextToken: string | null;
    signal: AbortSignal;
  }): Promise<unknown>;
  readStrongZeroTenantOwnershipSnapshot(input: {
    signal: AbortSignal;
  }): Promise<unknown>;
}

/** Read-only by construction: no CAS/Put method is available to the deleter. */
export interface StrongSharedCellCleanupAuthorityReadPort {
  readStrong(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<SharedCellCleanupAuthoritySnapshot>;
}

export interface SharedCellCleanupDeleteStackPort {
  deleteStack(input: {
    request: {
      StackName: string;
      RoleARN: typeof SHARED_CELL_CLEANUP_DELETION_ROLE_ARN;
      ClientRequestToken: string;
      DeletionMode: "STANDARD";
    };
    signal: AbortSignal;
  }): Promise<unknown>;
}

interface StackSnapshot {
  stackName: typeof SHARED_CELL_CLEANUP_DELETION_STACK_NAME;
  stackId: string;
  stackStatus: string;
  roleArn: typeof SHARED_CELL_CLEANUP_DELETION_ROLE_ARN;
  terminationProtection: false;
  parentId: null;
  rootId: null;
  tags: {
    Environment: "aws-sandbox";
    ManagedBy: "techlong-cell-operator";
    CellId: "cell-sandbox-1";
    ExpiresAt: string;
  };
}

interface InventoryEntry {
  logicalResourceId: string;
  physicalResourceId: string;
  resourceStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  resourceType: string;
}

interface EvidenceSnapshot {
  stack: StackSnapshot;
  templateCanonicalSha256: string;
  resourceInventorySha256: string;
}

interface ZeroTenantOwnershipSource {
  activeTenantIds: [];
  activeCapacityReservationIds: [];
  nonterminalDeploymentIds: [];
  liveTenantResourceIds: [];
  nonterminalTenantCleanupScheduleIds: [];
}

interface ZeroTenantOwnershipSnapshot {
  schemaVersion: 1;
  accountId: typeof SHARED_CELL_CLEANUP_DELETION_ACCOUNT_ID;
  region: typeof SHARED_CELL_CLEANUP_DELETION_REGION;
  cellId: "cell-sandbox-1";
  environmentId: "env_aws_sandbox_ca_central_1";
  observedAt: number;
  activeTenantCount: 0;
  activeCapacityReservationCount: 0;
  nonterminalDeploymentCount: 0;
  liveTenantResourceCount: 0;
  nonterminalTenantCleanupScheduleCount: 0;
  sourceSnapshot: ZeroTenantOwnershipSource;
  sourceSnapshotSha256: string;
}

interface VerifiedCycle {
  evidence: Readonly<EvidenceSnapshot>;
  authority: Readonly<SharedCellCleanupAuthorityRecord>;
  zeroTenant: Readonly<ZeroTenantOwnershipSnapshot>;
}

const verifiedCycles = new WeakSet<object>();

interface DeleteIntent {
  schemaVersion: 1;
  action: "delete_shared_cell_stack";
  accountId: typeof SHARED_CELL_CLEANUP_DELETION_ACCOUNT_ID;
  region: typeof SHARED_CELL_CLEANUP_DELETION_REGION;
  cellId: "cell-sandbox-1";
  stackName: typeof SHARED_CELL_CLEANUP_DELETION_STACK_NAME;
  stackId: string;
  roleArn: typeof SHARED_CELL_CLEANUP_DELETION_ROLE_ARN;
  cellExpiresAt: string;
  templateCanonicalSha256: string;
  resourceInventorySha256: string;
  ownerDeploymentId: string;
  generation: number;
  provisionEpoch: number;
  provisionMarker: string;
  provisionOperationHash: string;
  cleanupEpoch: number;
  cleanupMarker: string;
  cleanupOperationHash: string;
  cleanupExpiresAt: string;
  authorityRevision: number;
  authorityRecordHash: string;
  zeroTenantSourceSnapshotSha256: string;
}

export type SharedCellCleanupDeletionPhase =
  | "INSPECTED"
  | "DELETED"
  | "RECOVERED";

export interface SharedCellCleanupDeletionSummary extends DeleteIntent {
  phase: SharedCellCleanupDeletionPhase;
  mutationPerformed: boolean;
  deletionPlanSha256: string;
  clientRequestToken: string;
}

interface ReadSettings {
  evidence: SharedCellCleanupDeletionEvidenceReadPort;
  authority: StrongSharedCellCleanupAuthorityReadPort;
  signal: AbortSignal;
  now?: () => number;
}

interface ExecuteSettings extends ReadSettings {
  deleter: SharedCellCleanupDeleteStackPort;
  approvedDeletionPlanSha256: string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface RecoverSettings extends ReadSettings {
  approvedDeletionPlanSha256: string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

function assertInput(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (!exactKeys(value, [...required, ...Object.keys(record(value)).filter((key) => optional.includes(key))])) {
    fail(
      "SHARED_CELL_DELETE_INPUT_INVALID",
      "Shared Cell deletion input contains missing or unexpected fields.",
    );
  }
  for (const key of required) {
    if (!Object.hasOwn(record(value), key)) {
      fail(
        "SHARED_CELL_DELETE_INPUT_INVALID",
        "Shared Cell deletion input contains missing or unexpected fields.",
      );
    }
  }
}

function pinEvidence(
  value: SharedCellCleanupDeletionEvidenceReadPort,
): SharedCellCleanupDeletionEvidenceReadPort {
  if (
    !value ||
    typeof value !== "object" ||
    value.region !== SHARED_CELL_CLEANUP_DELETION_REGION ||
    typeof value.getCallerIdentity !== "function" ||
    typeof value.listStackNamesPage !== "function" ||
    typeof value.describeCellStack !== "function" ||
    typeof value.getOriginalTemplate !== "function" ||
    typeof value.listStackResourcesPage !== "function" ||
    typeof value.readStrongZeroTenantOwnershipSnapshot !== "function"
  ) {
    fail(
      "SHARED_CELL_DELETE_PORT_INVALID",
      "The Shared Cell deletion evidence reader is invalid or outside ca-central-1.",
    );
  }
  const pinned: SharedCellCleanupDeletionEvidenceReadPort = {
    region: value.region,
    getCallerIdentity: (input) => value.getCallerIdentity.call(value, input),
    listStackNamesPage: (input) => value.listStackNamesPage.call(value, input),
    describeCellStack: (input) => value.describeCellStack.call(value, input),
    getOriginalTemplate: (input) => value.getOriginalTemplate.call(value, input),
    listStackResourcesPage: (input) =>
      value.listStackResourcesPage.call(value, input),
    readStrongZeroTenantOwnershipSnapshot: (input) =>
      value.readStrongZeroTenantOwnershipSnapshot.call(value, input),
  };
  return Object.freeze(pinned);
}

function pinAuthority(
  value: StrongSharedCellCleanupAuthorityReadPort,
): StrongSharedCellCleanupAuthorityReadPort {
  if (!value || typeof value !== "object" || typeof value.readStrong !== "function") {
    fail(
      "SHARED_CELL_DELETE_PORT_INVALID",
      "The strong cleanup-authority reader is invalid.",
    );
  }
  const readStrong = value.readStrong;
  const pinned: StrongSharedCellCleanupAuthorityReadPort = {
    readStrong: (input) => readStrong.call(value, input),
  };
  return Object.freeze(pinned);
}

function pinDeleter(
  value: SharedCellCleanupDeleteStackPort,
): SharedCellCleanupDeleteStackPort {
  if (!value || typeof value !== "object" || typeof value.deleteStack !== "function") {
    fail("SHARED_CELL_DELETE_PORT_INVALID", "The DeleteStack port is invalid.");
  }
  const deleteStack = value.deleteStack;
  const pinned: SharedCellCleanupDeleteStackPort = {
    deleteStack: (input) => deleteStack.call(value, input),
  };
  return Object.freeze(pinned);
}

async function assertCaller(
  evidence: SharedCellCleanupDeletionEvidenceReadPort,
  signal: AbortSignal,
): Promise<void> {
  requireNotAborted(signal);
  const value = await evidence.getCallerIdentity({ signal });
  requireNotAborted(signal);
  if (
    !exactKeys(value, ["accountId", "arn"]) ||
    record(value).accountId !== SHARED_CELL_CLEANUP_DELETION_ACCOUNT_ID ||
    typeof record(value).arn !== "string" ||
    !callerArnPattern.test(record(value).arn as string) ||
    !sessionPattern.test((record(value).arn as string).split("/").at(-1) ?? "")
  ) {
    fail(
      "SHARED_CELL_DELETE_CALLER_INVALID",
      "Shared Cell TTL deletion requires the exact Cell Janitor execution-role session.",
    );
  }
}

async function collectStackNames(
  evidence: SharedCellCleanupDeletionEvidenceReadPort,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  const tokens = new Set<string>();
  let nextToken: string | null = null;
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    requireNotAborted(signal);
    const value = await evidence.listStackNamesPage({ nextToken, signal });
    requireNotAborted(signal);
    if (!exactKeys(value, ["nextToken", "stackNames"])) {
      fail(
        "SHARED_CELL_DELETE_STACK_LIST_INVALID",
        "The complete CloudFormation Stack-name page is malformed.",
      );
    }
    const page = record(value);
    if (!Array.isArray(page.stackNames)) {
      fail(
        "SHARED_CELL_DELETE_STACK_LIST_INVALID",
        "The complete CloudFormation Stack-name page is malformed.",
      );
    }
    for (const name of page.stackNames) {
      if (typeof name !== "string" || name.length === 0 || names.has(name)) {
        fail(
          "SHARED_CELL_DELETE_STACK_LIST_INVALID",
          "CloudFormation Stack names are missing, duplicated or malformed.",
        );
      }
      names.add(name);
    }
    if (page.nextToken === null) return names;
    if (
      typeof page.nextToken !== "string" ||
      page.nextToken.length === 0 ||
      tokens.has(page.nextToken)
    ) {
      fail(
        "SHARED_CELL_DELETE_STACK_LIST_INVALID",
        "CloudFormation Stack-name pagination is empty or repeated.",
      );
    }
    tokens.add(page.nextToken);
    nextToken = page.nextToken;
  }
  return fail(
    "SHARED_CELL_DELETE_STACK_LIST_INVALID",
    "CloudFormation Stack-name pagination is excessive.",
  );
}

function assertNoDependentsOrUnexpectedCells(names: ReadonlySet<string>): void {
  const tenantStacks = [...names].filter(
    (name) =>
      name.startsWith("techlong-sandbox-tenant-") &&
      !exactTenantSupportStacks.has(name),
  );
  if (tenantStacks.length > 0) {
    fail(
      "SHARED_CELL_DELETE_TENANT_STACKS_PRESENT",
      "Shared Cell deletion is blocked while any tenant Stack exists.",
    );
  }
  const unexpectedCells = [...names].filter(
    (name) =>
      name.startsWith("techlong-sandbox-cell-") &&
      name !== SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
  );
  if (unexpectedCells.length > 0) {
    fail(
      "SHARED_CELL_DELETE_UNEXPECTED_CELL_STACKS",
      "Shared Cell deletion is blocked by an unexpected Cell Stack.",
    );
  }
}

function normalizeTags(value: unknown): StackSnapshot["tags"] {
  if (
    !exactKeys(value, ["CellId", "Environment", "ExpiresAt", "ManagedBy"]) ||
    record(value).Environment !== "aws-sandbox" ||
    record(value).ManagedBy !== "techlong-cell-operator" ||
    record(value).CellId !== cellId ||
    typeof record(value).ExpiresAt !== "string"
  ) {
    fail(
      "SHARED_CELL_DELETE_STACK_DRIFT",
      "The Shared Cell has missing, unexpected or drifting ownership tags.",
    );
  }
  canonicalUtc(record(value).ExpiresAt, "Stack ExpiresAt tag");
  return canonicalClone(
    value as StackSnapshot["tags"],
    "SHARED_CELL_DELETE_STACK_DRIFT",
    "Shared Cell tags",
  );
}

function normalizePresentStack(
  value: unknown,
  requireComplete: boolean,
): StackSnapshot {
  if (!exactKeys(value, ["stack", "state"]) || record(value).state !== "present") {
    fail(
      "SHARED_CELL_DELETE_STACK_READ_INVALID",
      "A present Shared Cell read is malformed.",
    );
  }
  const stack = record(record(value).stack);
  if (
    !exactKeys(stack, [
      "parentId",
      "roleArn",
      "rootId",
      "stackId",
      "stackName",
      "stackStatus",
      "tags",
      "terminationProtection",
    ]) ||
    stack.stackName !== SHARED_CELL_CLEANUP_DELETION_STACK_NAME ||
    typeof stack.stackId !== "string" ||
    !stackIdPattern.test(stack.stackId) ||
    typeof stack.stackStatus !== "string" ||
    stack.roleArn !== SHARED_CELL_CLEANUP_DELETION_ROLE_ARN ||
    stack.terminationProtection !== false ||
    stack.parentId !== null ||
    stack.rootId !== null ||
    (requireComplete &&
      !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.stackStatus))
  ) {
    fail(
      "SHARED_CELL_DELETE_STACK_DRIFT",
      "The target is not the exact reviewed root Shared Cell Stack and execution role.",
    );
  }
  return Object.freeze({
    stackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
    stackId: stack.stackId,
    stackStatus: stack.stackStatus,
    roleArn: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
    terminationProtection: false as const,
    parentId: null,
    rootId: null,
    tags: normalizeTags(stack.tags),
  });
}

function isExactMissing(value: unknown): boolean {
  return (
    exactKeys(value, ["proof", "stackName", "state"]) &&
    record(value).state === "missing" &&
    record(value).stackName === SHARED_CELL_CLEANUP_DELETION_STACK_NAME &&
    record(value).proof === "NAME_BOUND_VALIDATION_ERROR"
  );
}

function templateResources(template: unknown): Record<string, unknown> {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    fail(
      "SHARED_CELL_DELETE_TEMPLATE_INVALID",
      "The Original Shared Cell template is missing or malformed.",
    );
  }
  const cloned = canonicalClone(
    template,
    "SHARED_CELL_DELETE_TEMPLATE_INVALID",
    "Original Shared Cell template",
  );
  const resources = record(record(cloned).Resources);
  if (Object.keys(resources).length === 0) {
    fail(
      "SHARED_CELL_DELETE_TEMPLATE_INVALID",
      "The Original Shared Cell template has no resources.",
    );
  }
  return resources;
}

async function collectInventory(
  evidence: SharedCellCleanupDeletionEvidenceReadPort,
  stackId: string,
  expectedResources: Record<string, unknown>,
  signal: AbortSignal,
): Promise<InventoryEntry[]> {
  const entries: InventoryEntry[] = [];
  const logicalIds = new Set<string>();
  const tokens = new Set<string>();
  let nextToken: string | null = null;
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    requireNotAborted(signal);
    const value = await evidence.listStackResourcesPage({
      stackId,
      nextToken,
      signal,
    });
    requireNotAborted(signal);
    if (!exactKeys(value, ["nextToken", "resources"])) {
      fail(
        "SHARED_CELL_DELETE_INVENTORY_INVALID",
        "A complete Shared Cell resource-inventory page is malformed.",
      );
    }
    const page = record(value);
    if (!Array.isArray(page.resources)) {
      fail(
        "SHARED_CELL_DELETE_INVENTORY_INVALID",
        "A complete Shared Cell resource-inventory page is malformed.",
      );
    }
    for (const raw of page.resources) {
      const item = record(raw);
      if (
        !exactKeys(item, [
          "logicalResourceId",
          "physicalResourceId",
          "resourceStatus",
          "resourceType",
        ]) ||
        typeof item.logicalResourceId !== "string" ||
        item.logicalResourceId.length === 0 ||
        typeof item.physicalResourceId !== "string" ||
        item.physicalResourceId.length === 0 ||
        !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(
          String(item.resourceStatus),
        ) ||
        typeof item.resourceType !== "string" ||
        item.resourceType.length === 0 ||
        logicalIds.has(item.logicalResourceId)
      ) {
        fail(
          "SHARED_CELL_DELETE_INVENTORY_INVALID",
          "Shared Cell inventory entries are missing, duplicated or non-terminal.",
        );
      }
      const expectedType = record(expectedResources[item.logicalResourceId]).Type;
      if (expectedType !== item.resourceType) {
        fail(
          "SHARED_CELL_DELETE_INVENTORY_DRIFT",
          "Shared Cell inventory differs from its Original template.",
        );
      }
      logicalIds.add(item.logicalResourceId);
      entries.push({
        logicalResourceId: item.logicalResourceId,
        physicalResourceId: item.physicalResourceId,
        resourceStatus: item.resourceStatus as InventoryEntry["resourceStatus"],
        resourceType: item.resourceType,
      });
    }
    if (page.nextToken === null) break;
    if (
      typeof page.nextToken !== "string" ||
      page.nextToken.length === 0 ||
      tokens.has(page.nextToken)
    ) {
      fail(
        "SHARED_CELL_DELETE_INVENTORY_INVALID",
        "Shared Cell inventory pagination is empty or repeated.",
      );
    }
    tokens.add(page.nextToken);
    nextToken = page.nextToken;
    if (pageNumber === maximumPages - 1) {
      fail(
        "SHARED_CELL_DELETE_INVENTORY_INVALID",
        "Shared Cell inventory pagination is excessive.",
      );
    }
  }
  if (
    entries.length === 0 ||
    canonicalJson([...logicalIds].sort()) !==
      canonicalJson(Object.keys(expectedResources).sort())
  ) {
    fail(
      "SHARED_CELL_DELETE_INVENTORY_DRIFT",
      "Shared Cell inventory does not exactly cover its Original template.",
    );
  }
  return entries.sort((left, right) =>
    left.logicalResourceId.localeCompare(right.logicalResourceId),
  );
}

async function readPresentEvidence(
  evidence: SharedCellCleanupDeletionEvidenceReadPort,
  signal: AbortSignal,
): Promise<Readonly<EvidenceSnapshot>> {
  requireNotAborted(signal);
  const described = await evidence.describeCellStack({
    stackNameOrId: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
    signal,
  });
  requireNotAborted(signal);
  if (isExactMissing(described)) {
    fail(
      "SHARED_CELL_DELETE_STACK_MISSING",
      "The Shared Cell is already missing; use read-only recovery.",
    );
  }
  const stack = normalizePresentStack(described, true);
  const template = await evidence.getOriginalTemplate({
    stackId: stack.stackId,
    signal,
  });
  requireNotAborted(signal);
  const resources = templateResources(template);
  const inventory = await collectInventory(
    evidence,
    stack.stackId,
    resources,
    signal,
  );
  const templateCanonicalSha256 = await sha256Hex(template);
  const resourceInventorySha256 = await sha256Hex(inventory);
  requireNotAborted(signal);
  if (
    !digestPattern.test(templateCanonicalSha256) ||
    !digestPattern.test(resourceInventorySha256)
  ) {
    fail(
      "SHARED_CELL_DELETE_EVIDENCE_INVALID",
      "Shared Cell evidence hashes are invalid.",
    );
  }
  return Object.freeze({
    stack,
    templateCanonicalSha256,
    resourceInventorySha256,
  });
}

async function readZeroTenantOwnership(
  evidence: SharedCellCleanupDeletionEvidenceReadPort,
  signal: AbortSignal,
  now: number,
  cellExpiresAt: string,
): Promise<Readonly<ZeroTenantOwnershipSnapshot>> {
  requireNotAborted(signal);
  const cellExpiry = canonicalUtc(
    cellExpiresAt,
    "Zero-tenant ownership cellExpiresAt",
  );
  const raw = await evidence.readStrongZeroTenantOwnershipSnapshot({ signal });
  requireNotAborted(signal);
  if (
    !exactKeys(raw, [
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
      "sourceSnapshot",
      "sourceSnapshotSha256",
    ]) ||
    record(raw).schemaVersion !== 1 ||
    record(raw).accountId !== SHARED_CELL_CLEANUP_DELETION_ACCOUNT_ID ||
    record(raw).region !== SHARED_CELL_CLEANUP_DELETION_REGION ||
    record(raw).cellId !== cellId ||
    record(raw).environmentId !== environmentId ||
    record(raw).activeTenantCount !== 0 ||
    record(raw).activeCapacityReservationCount !== 0 ||
    record(raw).nonterminalDeploymentCount !== 0 ||
    record(raw).liveTenantResourceCount !== 0 ||
    record(raw).nonterminalTenantCleanupScheduleCount !== 0 ||
    !Number.isSafeInteger(record(raw).observedAt) ||
    Number(record(raw).observedAt) <= 0 ||
    Number(record(raw).observedAt) < cellExpiry ||
    Number(record(raw).observedAt) > now ||
    now - Number(record(raw).observedAt) > maximumEvidenceAgeMs ||
    typeof record(raw).sourceSnapshotSha256 !== "string" ||
    !digestPattern.test(record(raw).sourceSnapshotSha256 as string)
  ) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_INVALID",
      "A fresh strong zero-tenant ownership snapshot is missing, non-zero or outside the fixed Sandbox Cell.",
    );
  }
  const source = record(raw).sourceSnapshot;
  const sourceRecord = record(source);
  const sourceLists = [
    sourceRecord.activeTenantIds,
    sourceRecord.activeCapacityReservationIds,
    sourceRecord.nonterminalDeploymentIds,
    sourceRecord.liveTenantResourceIds,
    sourceRecord.nonterminalTenantCleanupScheduleIds,
  ];
  if (
    !exactKeys(source, [
      "activeCapacityReservationIds",
      "activeTenantIds",
      "liveTenantResourceIds",
      "nonterminalDeploymentIds",
      "nonterminalTenantCleanupScheduleIds",
    ]) ||
    sourceLists.some((value) => !Array.isArray(value) || value.length !== 0)
  ) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_INVALID",
      "The ownership source snapshot contains a tenant, reservation, deployment, resource or cleanup schedule.",
    );
  }
  if ((await sha256Hex(source)) !== record(raw).sourceSnapshotSha256) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_HASH_MISMATCH",
      "The strong zero-tenant ownership source hash does not match its canonical snapshot.",
    );
  }
  return Object.freeze(
    canonicalClone(
      raw as ZeroTenantOwnershipSnapshot,
      "SHARED_CELL_DELETE_ZERO_TENANT_INVALID",
      "Zero-tenant ownership snapshot",
    ),
  );
}

function stableZeroTenant(value: ZeroTenantOwnershipSnapshot): unknown {
  const stable = { ...value } as Record<string, unknown>;
  delete stable.observedAt;
  return stable;
}

async function readStrongAuthority(
  authority: StrongSharedCellCleanupAuthorityReadPort,
  signal: AbortSignal,
): Promise<Readonly<SharedCellCleanupAuthorityRecord>> {
  requireNotAborted(signal);
  const snapshot = await authority.readStrong({
    authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
    signal,
  });
  requireNotAborted(signal);
  if (
    !exactKeys(snapshot, ["authorityKey", "item", "revision"]) ||
    snapshot.authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    snapshot.item === null ||
    snapshot.item.revision !== snapshot.revision
  ) {
    fail(
      "SHARED_CELL_DELETE_AUTHORITY_INVALID",
      "The strongly consistent cleanup-authority snapshot is malformed or absent.",
    );
  }
  const validated = await validateSharedCellCleanupAuthorityItem(snapshot.item);
  requireNotAborted(signal);
  return validated.record;
}

function assertEvidenceMatchesAuthority(
  evidence: Readonly<EvidenceSnapshot>,
  authority: Readonly<SharedCellCleanupAuthorityRecord>,
): void {
  if (
    evidence.stack.stackId !== authority.stackId ||
    evidence.stack.stackStatus !== authority.stackStatus ||
    evidence.stack.tags.ExpiresAt !== authority.cellExpiresAt ||
    evidence.templateCanonicalSha256 !== authority.templateCanonicalSha256 ||
    evidence.resourceInventorySha256 !== authority.resourceInventorySha256
  ) {
    fail(
      "SHARED_CELL_DELETE_AUTHORITY_DRIFT",
      "Live Shared Cell evidence differs from the cleanup-authorized lineage.",
    );
  }
}

async function collectVerifiedCycle(input: {
  evidence: SharedCellCleanupDeletionEvidenceReadPort;
  authority: StrongSharedCellCleanupAuthorityReadPort;
  signal: AbortSignal;
  now: () => number;
}): Promise<Readonly<VerifiedCycle>> {
  await assertCaller(input.evidence, input.signal);
  const authorityBefore = await readStrongAuthority(
    input.authority,
    input.signal,
  );
  const beforeNow = readClock(input.now);
  assertSharedCellCleanupAuthorityActive(authorityBefore, beforeNow);
  const zeroTenantBefore = await readZeroTenantOwnership(
    input.evidence,
    input.signal,
    beforeNow,
    authorityBefore.cellExpiresAt,
  );
  const firstNames = await collectStackNames(input.evidence, input.signal);
  assertNoDependentsOrUnexpectedCells(firstNames);
  if (!firstNames.has(SHARED_CELL_CLEANUP_DELETION_STACK_NAME)) {
    fail(
      "SHARED_CELL_DELETE_STACK_MISSING",
      "The Shared Cell is absent from the complete Stack inventory; use read-only recovery.",
    );
  }
  const first = await readPresentEvidence(input.evidence, input.signal);
  const second = await readPresentEvidence(input.evidence, input.signal);
  if (canonicalJson(first) !== canonicalJson(second)) {
    fail(
      "SHARED_CELL_DELETE_EVIDENCE_CHANGED",
      "The Shared Cell Stack, Original template or resource inventory changed between fresh reads.",
      true,
    );
  }
  const finalNames = await collectStackNames(input.evidence, input.signal);
  assertNoDependentsOrUnexpectedCells(finalNames);
  if (
    !finalNames.has(SHARED_CELL_CLEANUP_DELETION_STACK_NAME) ||
    canonicalJson([...firstNames].sort()) !== canonicalJson([...finalNames].sort())
  ) {
    fail(
      "SHARED_CELL_DELETE_STACK_LIST_CHANGED",
      "The complete CloudFormation Stack inventory changed during evidence collection.",
      true,
    );
  }
  const afterNow = readClock(input.now);
  if (afterNow < beforeNow) {
    fail(
      "SHARED_CELL_DELETE_CLOCK_REGRESSED",
      "The Shared Cell deletion clock regressed during evidence collection.",
    );
  }
  const zeroTenantAfter = await readZeroTenantOwnership(
    input.evidence,
    input.signal,
    afterNow,
    authorityBefore.cellExpiresAt,
  );
  const authorityAfter = await readStrongAuthority(
    input.authority,
    input.signal,
  );
  assertSharedCellCleanupAuthorityActive(authorityAfter, afterNow);
  await assertCaller(input.evidence, input.signal);
  if (canonicalJson(authorityBefore) !== canonicalJson(authorityAfter)) {
    fail(
      "SHARED_CELL_DELETE_AUTHORITY_CHANGED",
      "Strong cleanup authority changed while live deletion evidence was collected.",
      true,
    );
  }
  if (
    canonicalJson(stableZeroTenant(zeroTenantBefore)) !==
    canonicalJson(stableZeroTenant(zeroTenantAfter))
  ) {
    fail(
      "SHARED_CELL_DELETE_ZERO_TENANT_CHANGED",
      "The strong zero-tenant ownership snapshot changed during evidence collection.",
      true,
    );
  }
  canonicalUtc(authorityAfter.cellExpiresAt, "Authority cellExpiresAt");
  assertEvidenceMatchesAuthority(second, authorityAfter);
  const cycle = Object.freeze({
    evidence: second,
    authority: authorityAfter,
    zeroTenant: zeroTenantAfter,
  });
  verifiedCycles.add(cycle);
  return cycle;
}

function assertVerifiedCycle(value: unknown): asserts value is VerifiedCycle {
  if (!value || typeof value !== "object" || !verifiedCycles.has(value)) {
    fail(
      "SHARED_CELL_DELETE_EVIDENCE_UNVERIFIED",
      "Shared Cell deletion requires an internally verified evidence cycle.",
    );
  }
}

function deleteIntent(cycle: VerifiedCycle): DeleteIntent {
  assertVerifiedCycle(cycle);
  const authority = cycle.authority;
  return Object.freeze({
    schemaVersion: 1 as const,
    action: "delete_shared_cell_stack" as const,
    accountId: SHARED_CELL_CLEANUP_DELETION_ACCOUNT_ID,
    region: SHARED_CELL_CLEANUP_DELETION_REGION,
    cellId: "cell-sandbox-1" as const,
    stackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
    stackId: authority.stackId,
    roleArn: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
    cellExpiresAt: authority.cellExpiresAt,
    templateCanonicalSha256: authority.templateCanonicalSha256,
    resourceInventorySha256: authority.resourceInventorySha256,
    ownerDeploymentId: authority.ownerDeploymentId,
    generation: authority.generation,
    provisionEpoch: authority.provisionEpoch,
    provisionMarker: authority.provisionMarker,
    provisionOperationHash: authority.provisionOperationHash,
    cleanupEpoch: authority.cleanupEpoch,
    cleanupMarker: authority.cleanupMarker,
    cleanupOperationHash: authority.cleanupOperationHash,
    cleanupExpiresAt: authority.expiresAt,
    authorityRevision: authority.revision,
    authorityRecordHash: authority.recordHash,
    zeroTenantSourceSnapshotSha256:
      cycle.zeroTenant.sourceSnapshotSha256,
  });
}

async function planned(cycle: VerifiedCycle): Promise<{
  intent: DeleteIntent;
  deletionPlanSha256: string;
  clientRequestToken: string;
}> {
  const intent = deleteIntent(cycle);
  const deletionPlanSha256 = await sha256Hex(intent);
  if (!digestPattern.test(deletionPlanSha256)) {
    fail("SHARED_CELL_DELETE_PLAN_INVALID", "The deletion-plan digest is invalid.");
  }
  return {
    intent,
    deletionPlanSha256,
    clientRequestToken: `cell-delete-${deletionPlanSha256}`,
  };
}

function assertApprovedDigest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(
      "SHARED_CELL_DELETE_APPROVAL_INVALID",
      "The approved deletion-plan SHA-256 is invalid.",
    );
  }
}

function summary(
  phase: SharedCellCleanupDeletionPhase,
  mutationPerformed: boolean,
  plan: Awaited<ReturnType<typeof planned>>,
): Readonly<SharedCellCleanupDeletionSummary> {
  return Object.freeze({
    ...plan.intent,
    phase,
    mutationPerformed,
    deletionPlanSha256: plan.deletionPlanSha256,
    clientRequestToken: plan.clientRequestToken,
  });
}

async function immediateRecheck(input: {
  evidence: SharedCellCleanupDeletionEvidenceReadPort;
  authority: StrongSharedCellCleanupAuthorityReadPort;
  approved: Awaited<ReturnType<typeof planned>>;
  signal: AbortSignal;
  now: () => number;
}): Promise<void> {
  await assertCaller(input.evidence, input.signal);
  const beforeNow = readClock(input.now);
  const authorityBefore = await readStrongAuthority(
    input.authority,
    input.signal,
  );
  assertSharedCellCleanupAuthorityActive(authorityBefore, beforeNow);
  const zeroTenantBefore = await readZeroTenantOwnership(
    input.evidence,
    input.signal,
    beforeNow,
    authorityBefore.cellExpiresAt,
  );
  const names = await collectStackNames(input.evidence, input.signal);
  assertNoDependentsOrUnexpectedCells(names);
  if (!names.has(SHARED_CELL_CLEANUP_DELETION_STACK_NAME)) {
    fail(
      "SHARED_CELL_DELETE_PREDELETE_MISSING",
      "The Shared Cell disappeared immediately before DeleteStack; use recovery.",
      true,
    );
  }
  const evidence = await readPresentEvidence(input.evidence, input.signal);
  const authorityAfter = await readStrongAuthority(
    input.authority,
    input.signal,
  );
  const afterNow = readClock(input.now);
  if (
    afterNow < beforeNow ||
    canonicalJson(authorityBefore) !== canonicalJson(authorityAfter)
  ) {
    fail(
      "SHARED_CELL_DELETE_PREDELETE_DRIFT",
      "Strong cleanup authority or the clock changed across the immediate destructive boundary.",
      true,
    );
  }
  assertSharedCellCleanupAuthorityActive(authorityAfter, afterNow);
  const zeroTenantAfter = await readZeroTenantOwnership(
    input.evidence,
    input.signal,
    afterNow,
    authorityAfter.cellExpiresAt,
  );
  if (
    canonicalJson(stableZeroTenant(zeroTenantBefore)) !==
    canonicalJson(stableZeroTenant(zeroTenantAfter))
  ) {
    fail(
      "SHARED_CELL_DELETE_PREDELETE_DRIFT",
      "Strong zero-tenant ownership changed across the immediate destructive boundary.",
      true,
    );
  }
  assertEvidenceMatchesAuthority(evidence, authorityAfter);
  const cycle = Object.freeze({
    evidence,
    authority: authorityAfter,
    zeroTenant: zeroTenantAfter,
  });
  verifiedCycles.add(cycle);
  const current = await planned(cycle);
  requireNotAborted(input.signal);
  if (
    current.deletionPlanSha256 !== input.approved.deletionPlanSha256 ||
    canonicalJson(current.intent) !== canonicalJson(input.approved.intent)
  ) {
    fail(
      "SHARED_CELL_DELETE_PREDELETE_DRIFT",
      "Caller-adjacent live evidence or strong authority no longer matches the approved deletion plan.",
    );
  }
  await assertCaller(input.evidence, input.signal);
  requireNotAborted(input.signal);
}

async function defaultWait(delayMs: number, signal: AbortSignal): Promise<void> {
  requireNotAborted(signal);
  if (delayMs === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  requireNotAborted(signal);
}

function readbackSettings(input: {
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): {
  attempts: number;
  delayMs: number;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
} {
  const attempts = input.readbackAttempts ?? 3;
  const delayMs = input.readbackDelayMs ?? 250;
  const wait = input.wait ?? defaultWait;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 10 ||
    !Number.isSafeInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > 5_000 ||
    typeof wait !== "function"
  ) {
    fail(
      "SHARED_CELL_DELETE_READBACK_CONFIG_INVALID",
      "Shared Cell deletion readback bounds are invalid.",
    );
  }
  return { attempts, delayMs, wait };
}

async function confirmAuthoritativeMissing(input: {
  evidence: SharedCellCleanupDeletionEvidenceReadPort;
  expectedStackId: string;
  signal: AbortSignal;
  attempts: number;
  delayMs: number;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  let lastStatus: string | null = null;
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    if (attempt > 0) await input.wait(input.delayMs, input.signal);
    await assertCaller(input.evidence, input.signal);
    const names = await collectStackNames(input.evidence, input.signal);
    assertNoDependentsOrUnexpectedCells(names);
    await assertCaller(input.evidence, input.signal);
    const observed = await input.evidence.describeCellStack({
      stackNameOrId: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
      signal: input.signal,
    });
    requireNotAborted(input.signal);
    if (isExactMissing(observed)) {
      if (names.has(SHARED_CELL_CLEANUP_DELETION_STACK_NAME)) {
        fail(
          "SHARED_CELL_DELETE_MISSING_CONTRADICTION",
          "DescribeStacks reported name-bound missing while the complete Stack inventory still contains the Cell.",
        );
      }
      return;
    }
    if (!names.has(SHARED_CELL_CLEANUP_DELETION_STACK_NAME)) {
      fail(
        "SHARED_CELL_DELETE_MISSING_CONTRADICTION",
        "The complete Stack inventory omitted a still-described Shared Cell.",
      );
    }
    const stack = normalizePresentStack(observed, false);
    if (stack.stackId !== input.expectedStackId) {
      fail(
        "SHARED_CELL_DELETE_STACK_REPLACED",
        "The Shared Cell Stack name now resolves to a different StackId.",
      );
    }
    lastStatus = stack.stackStatus;
    if (
      stack.stackStatus === "DELETE_FAILED" ||
      stack.stackStatus === "ROLLBACK_FAILED" ||
      stack.stackStatus.endsWith("_ROLLBACK_FAILED")
    ) {
      fail(
        "SHARED_CELL_DELETE_TERMINAL_FAILURE",
        `Shared Cell deletion entered terminal state ${stack.stackStatus}.`,
        true,
      );
    }
  }
  fail(
    lastStatus === "DELETE_IN_PROGRESS"
      ? "SHARED_CELL_DELETE_IN_PROGRESS"
      : "SHARED_CELL_DELETE_UNCONFIRMED",
    "The Shared Cell was not authoritatively confirmed missing within the bounded readback window.",
    true,
  );
}

export async function inspectSharedCellCleanupDeletion(
  input: ReadSettings,
): Promise<Readonly<SharedCellCleanupDeletionSummary>> {
  assertInput(input, ["authority", "evidence", "signal"], ["now"]);
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const cycle = await collectVerifiedCycle({
    evidence,
    authority,
    signal: input.signal,
    now: input.now ?? Date.now,
  });
  return summary("INSPECTED", false, await planned(cycle));
}

export async function executeReviewedSharedCellCleanupDeletion(
  input: ExecuteSettings,
): Promise<Readonly<SharedCellCleanupDeletionSummary>> {
  assertInput(
    input,
    [
      "approvedDeletionPlanSha256",
      "authority",
      "deleter",
      "evidence",
      "signal",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertApprovedDigest(input.approvedDeletionPlanSha256);
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const deleter = pinDeleter(input.deleter);
  const now = input.now ?? Date.now;
  const readback = readbackSettings(input);
  const cycle = await collectVerifiedCycle({
    evidence,
    authority,
    signal: input.signal,
    now,
  });
  const plan = await planned(cycle);
  if (plan.deletionPlanSha256 !== input.approvedDeletionPlanSha256) {
    fail(
      "SHARED_CELL_DELETE_PLAN_MISMATCH",
      "Fresh double-read evidence does not reproduce the approved deletion plan.",
    );
  }
  await immediateRecheck({
    evidence,
    authority,
    approved: plan,
    signal: input.signal,
    now,
  });

  let responseLost = false;
  try {
    const result = await deleter.deleteStack({
      request: {
        StackName: plan.intent.stackId,
        RoleARN: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
        ClientRequestToken: plan.clientRequestToken,
        DeletionMode: "STANDARD",
      },
      signal: input.signal,
    });
    if (!exactKeys(result, ["operation"]) || record(result).operation !== "delete_submitted") {
      responseLost = true;
    }
  } catch (error) {
    if (input.signal.aborted) {
      const uncertain = new SharedCellCleanupDeletionError(
        "SHARED_CELL_DELETE_POST_SUBMIT_UNCERTAIN",
        "DeleteStack may have been submitted before abort; use read-only recovery.",
        true,
      );
      Object.defineProperty(uncertain, "cause", { value: error });
      throw uncertain;
    }
    responseLost = true;
  }

  try {
    await confirmAuthoritativeMissing({
      evidence,
      expectedStackId: plan.intent.stackId,
      signal: input.signal,
      ...readback,
    });
  } catch (error) {
    const uncertain = new SharedCellCleanupDeletionError(
      responseLost
        ? "SHARED_CELL_DELETE_RESPONSE_UNCERTAIN"
        : "SHARED_CELL_DELETE_POST_SUBMIT_UNCERTAIN",
      responseLost
        ? "DeleteStack response was lost or malformed and read-only recovery did not prove the Stack missing."
        : "DeleteStack was accepted but bounded read-only recovery did not prove the Stack missing; use Recover and never resubmit blindly.",
      true,
    );
    Object.defineProperty(uncertain, "cause", { value: error });
    throw uncertain;
  }
  return summary(responseLost ? "RECOVERED" : "DELETED", true, plan);
}

export async function recoverReviewedSharedCellCleanupDeletion(
  input: RecoverSettings,
): Promise<Readonly<SharedCellCleanupDeletionSummary>> {
  assertInput(
    input,
    ["approvedDeletionPlanSha256", "authority", "evidence", "signal"],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertApprovedDigest(input.approvedDeletionPlanSha256);
  const evidence = pinEvidence(input.evidence);
  const authorityPort = pinAuthority(input.authority);
  const readback = readbackSettings(input);
  await assertCaller(evidence, input.signal);
  const authority = await readStrongAuthority(authorityPort, input.signal);
  const zeroTenant = await readZeroTenantOwnership(
    evidence,
    input.signal,
    readClock(input.now ?? Date.now),
    authority.cellExpiresAt,
  );
  const syntheticEvidence: EvidenceSnapshot = Object.freeze({
    stack: Object.freeze({
      stackName: SHARED_CELL_CLEANUP_DELETION_STACK_NAME,
      stackId: authority.stackId,
      stackStatus: authority.stackStatus,
      roleArn: SHARED_CELL_CLEANUP_DELETION_ROLE_ARN,
      terminationProtection: false as const,
      parentId: null,
      rootId: null,
      tags: Object.freeze({
        Environment: "aws-sandbox" as const,
        ManagedBy: "techlong-cell-operator" as const,
        CellId: "cell-sandbox-1" as const,
        ExpiresAt: authority.cellExpiresAt,
      }),
    }),
    templateCanonicalSha256: authority.templateCanonicalSha256,
    resourceInventorySha256: authority.resourceInventorySha256,
  });
  const cycle = Object.freeze({
    evidence: syntheticEvidence,
    authority,
    zeroTenant,
  });
  verifiedCycles.add(cycle);
  const plan = await planned(cycle);
  if (plan.deletionPlanSha256 !== input.approvedDeletionPlanSha256) {
    fail(
      "SHARED_CELL_DELETE_RECOVERY_PLAN_MISMATCH",
      "Strong authority does not reproduce the approved deletion plan.",
    );
  }
  await confirmAuthoritativeMissing({
    evidence,
    expectedStackId: plan.intent.stackId,
    signal: input.signal,
    ...readback,
  });
  return summary("RECOVERED", false, plan);
}
