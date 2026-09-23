import { canonicalJson, sha256Hex } from "./hash.ts";
import { SHARED_CELL_CLEANUP_AUTHORITY_KEY } from "./shared-cell-cleanup-authority.ts";

export const SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID =
  "402010193138" as const;
export const SHARED_CELL_AUTHOR_COMPENSATION_REGION = "ca-central-1" as const;
export const SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME =
  "techlong-sandbox-cell-sandbox-1" as const;
export const SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole" as const;
export const SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN =
  "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator" as const;

const templateBucket =
  "techlong-sandbox-build-source-402010193138-ca-central-1";
const digestPattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const stackIdPattern = new RegExp(
  "^arn:aws:cloudformation:ca-central-1:402010193138:stack/" +
  `${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME}/` +
  "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$",
);
const changeSetNamePattern = new RegExp(
  `^${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME}-[a-f0-9]{16}$`,
);
const canonicalUtcPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumGrantLifetimeMs = 60 * 60_000;
const deleteChangeSetMinimumRemainingMs = 10 * 60_000;
const deleteStackMinimumRemainingMs = 5 * 60_000;

export const SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES = Object.freeze([
  "AWS::Scheduler::Schedule",
  "AWS::EC2::VPC",
  "AWS::EC2::InternetGateway",
  "AWS::EC2::VPCGatewayAttachment",
  "AWS::EC2::Subnet",
  "AWS::EC2::RouteTable",
  "AWS::EC2::Route",
  "AWS::EC2::SubnetRouteTableAssociation",
  "AWS::EC2::SecurityGroup",
  "AWS::EC2::SecurityGroupIngress",
  "AWS::ECS::Cluster",
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::ElasticLoadBalancingV2::Listener",
  "AWS::ElasticLoadBalancingV2::ListenerRule",
  "AWS::RDS::DBSubnetGroup",
  "AWS::Logs::LogGroup",
  "AWS::RDS::DBCluster",
  "AWS::RDS::DBInstance",
] as const);

const parameterKeys = Object.freeze([
  "AvailabilityZoneA",
  "AvailabilityZoneB",
  "CertificateArn",
  "ControlTrustStoreArn",
  "CellJanitorFunctionArn",
  "CellSchedulerInvokeRoleArn",
  "CellSchedulerGroupName",
  "CleanupAt",
] as const);
const tagKeys = Object.freeze([
  "Environment",
  "ManagedBy",
  "CellId",
  "ExpiresAt",
] as const);

export class SharedCellAuthorCompensationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellAuthorCompensationError(code, message, retryable);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value as Record<string, unknown>).sort()) ===
    canonicalJson([...keys].sort())
  );
}

function immutableClone<T>(value: T, code: string): Readonly<T> {
  try {
    return Object.freeze(JSON.parse(canonicalJson(value)) as T);
  } catch {
    return fail(code, "The approved compensation candidate is not immutable JSON.");
  }
}

function requireNotAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function canonicalUtc(value: unknown): boolean {
  if (typeof value !== "string" || !canonicalUtcPattern.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function readClock(now: (() => number) | undefined): number {
  let value: number;
  try {
    value = (now ?? Date.now)();
  } catch {
    return fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CLOCK_INVALID",
      "The compensation clock could not be read.",
    );
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CLOCK_INVALID",
      "The compensation clock must return a non-negative safe integer.",
    );
  }
  return value;
}

export interface SharedCellAuthorCompensationParameter {
  ParameterKey: (typeof parameterKeys)[number];
  ParameterValue: string;
}

export interface SharedCellAuthorCompensationTag {
  Key: (typeof tagKeys)[number];
  Value: string;
}

export interface SharedCellAuthorCompensationCandidate {
  schemaVersion: 1;
  accountId: typeof SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID;
  region: typeof SHARED_CELL_AUTHOR_COMPENSATION_REGION;
  stackName: typeof SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME;
  stackId: string;
  compensationGrant: {
    reviewedAt: string;
    expiresAt: string;
  };
  immutableTemplate: {
    url: string;
    rawSha256: string;
    canonicalSha256: string;
  };
  changeSet: {
    name: string;
    arn: string;
    type: "CREATE";
    roleArn: typeof SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN;
    capabilities: [];
    includeNestedStacks: false;
    resourceTypes: readonly string[];
    parameters: readonly SharedCellAuthorCompensationParameter[];
    tags: readonly SharedCellAuthorCompensationTag[];
  };
}

export interface SharedCellAuthorCompensationReadPort {
  readonly region: string;
  getCallerIdentity(input: { signal: AbortSignal; }): Promise<unknown>;
  describeStack(input: {
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  getOriginalTemplate(input: {
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
  listStackResourcesPage(input: {
    stackNameOrId: string;
    nextToken: string | null;
    signal: AbortSignal;
  }): Promise<unknown>;
  describeChangeSet(input: {
    changeSetNameOrArn: string;
    stackNameOrId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}

/** This port deliberately has no Put/Delete operation. */
export interface StrongSharedCellAuthorAuthorityReadPort {
  readStrong(input: {
    authorityKey: typeof SHARED_CELL_CLEANUP_AUTHORITY_KEY;
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface SharedCellAuthorCompensationMutationPort {
  readonly region: string;
  getCallerIdentity(input: { signal: AbortSignal; }): Promise<unknown>;
  deleteChangeSet(input: {
    request: {
      ChangeSetName: string;
      StackName: string;
    };
    signal: AbortSignal;
  }): Promise<unknown>;
  deleteStack(input: {
    request: {
      StackName: string;
      DeletionMode: "STANDARD";
      ClientRequestToken: string;
    };
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface SharedCellAuthorCompensationSummary {
  schemaVersion: 1;
  action: "compensate_shared_cell_author_create_placeholder";
  phase: "INSPECTED" | "COMPENSATED" | "RECOVERED";
  observedState: "REVIEW_IN_PROGRESS" | "DELETE_IN_PROGRESS" | "MISSING";
  accountId: typeof SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID;
  region: typeof SHARED_CELL_AUTHOR_COMPENSATION_REGION;
  stackName: typeof SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME;
  stackId: string;
  changeSetName: string;
  changeSetArn: string;
  templateRawSha256: string;
  templateCanonicalSha256: string;
  compensationPlanSha256: string;
  deleteStackClientRequestToken: string;
  mutationPerformed: boolean;
  safeToAuthorRevoke: boolean;
}

interface BaseSettings {
  evidence: SharedCellAuthorCompensationReadPort;
  authority: StrongSharedCellAuthorAuthorityReadPort;
  candidate: SharedCellAuthorCompensationCandidate;
  signal: AbortSignal;
  now?: () => number;
}

interface ExecuteSettings extends BaseSettings {
  mutations: SharedCellAuthorCompensationMutationPort;
  approvedCompensationPlanSha256: string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface RecoverSettings extends BaseSettings {
  approvedCompensationPlanSha256: string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface NormalizedCandidate extends SharedCellAuthorCompensationCandidate {
  changeSet: SharedCellAuthorCompensationCandidate["changeSet"] & {
    resourceTypes: readonly string[];
    parameters: readonly SharedCellAuthorCompensationParameter[];
    tags: readonly SharedCellAuthorCompensationTag[];
  };
}

type Observation = "REVIEW_IN_PROGRESS" | "DELETE_IN_PROGRESS" | "MISSING";
type ExecutionObservation =
  | "REVIEW_CHANGE_SET_PRESENT"
  | "REVIEW_CHANGE_SET_MISSING"
  | "DELETE_IN_PROGRESS"
  | "MISSING";

function assertExactInput(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(record(value));
  if (
    !required.every((key) => keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_INPUT_INVALID",
      "Compensation input contains missing or unexpected fields.",
    );
  }
}

function normalizeEntries(
  values: unknown,
  keys: readonly string[],
  entryKeys: readonly [string, string],
  code: string,
): readonly Record<string, string>[] {
  const expectedIndexes = keys.map((_, index) => String(index));
  if (
    !Array.isArray(values) ||
    values.length !== keys.length ||
    canonicalJson(Object.keys(values).sort()) !==
    canonicalJson([...expectedIndexes].sort())
  ) {
    fail(code, "The reviewed candidate list has the wrong cardinality.");
  }
  const normalized: Record<string, string>[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(values, index)) {
      fail(code, "The reviewed candidate list contains a sparse entry.");
    }
    const value = values[index];
    if (
      !exactKeys(value, entryKeys) ||
      record(value)[entryKeys[0]] !== keys[index] ||
      typeof record(value)[entryKeys[1]] !== "string" ||
      (record(value)[entryKeys[1]] as string).length === 0
    ) {
      fail(code, "The reviewed candidate list drifted from its exact ordering.");
    }
    normalized.push({
      [entryKeys[0]]: record(value)[entryKeys[0]] as string,
      [entryKeys[1]]: record(value)[entryKeys[1]] as string,
    });
  }
  return Object.freeze(normalized.map((entry) => Object.freeze(entry)));
}

function normalizeCandidate(value: unknown): Readonly<NormalizedCandidate> {
  if (
    !exactKeys(value, [
      "accountId",
      "changeSet",
      "compensationGrant",
      "immutableTemplate",
      "region",
      "schemaVersion",
      "stackId",
      "stackName",
    ])
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      "The approved compensation candidate has missing or unexpected fields.",
    );
  }
  const candidate = record(value);
  const stackId = candidate.stackId;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.accountId !== SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID ||
    candidate.region !== SHARED_CELL_AUTHOR_COMPENSATION_REGION ||
    candidate.stackName !== SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME ||
    typeof stackId !== "string" ||
    !stackIdPattern.test(stackId)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      "The compensation candidate is outside the exact Sandbox Cell boundary.",
    );
  }

  const compensationGrant = record(candidate.compensationGrant);
  if (
    !exactKeys(compensationGrant, ["expiresAt", "reviewedAt"]) ||
    !canonicalUtc(compensationGrant.reviewedAt) ||
    !canonicalUtc(compensationGrant.expiresAt)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      "The compensation grant window must contain exact canonical UTC instants.",
    );
  }
  const reviewedAt = Date.parse(compensationGrant.reviewedAt as string);
  const expiresAt = Date.parse(compensationGrant.expiresAt as string);
  if (
    expiresAt <= reviewedAt ||
    expiresAt - reviewedAt > maximumGrantLifetimeMs
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      "The compensation grant lifetime must be greater than zero and at most 60 minutes.",
    );
  }

  const immutableTemplate = record(candidate.immutableTemplate);
  if (
    !exactKeys(immutableTemplate, ["canonicalSha256", "rawSha256", "url"]) ||
    typeof immutableTemplate.rawSha256 !== "string" ||
    !digestPattern.test(immutableTemplate.rawSha256) ||
    typeof immutableTemplate.canonicalSha256 !== "string" ||
    !digestPattern.test(immutableTemplate.canonicalSha256) ||
    immutableTemplate.url !==
    `https://${templateBucket}.s3.ca-central-1.amazonaws.com/` +
    `b5-shared-cell/templates/sha256/${immutableTemplate.rawSha256}.json`
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      "The immutable Shared Cell template binding is invalid.",
    );
  }

  const changeSet = record(candidate.changeSet);
  if (
    !exactKeys(changeSet, [
      "arn",
      "capabilities",
      "includeNestedStacks",
      "name",
      "parameters",
      "resourceTypes",
      "roleArn",
      "tags",
      "type",
    ]) ||
    typeof changeSet.name !== "string" ||
    !changeSetNamePattern.test(changeSet.name) ||
    changeSet.name !==
    `${SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME}-${immutableTemplate.rawSha256.slice(0, 16)}` ||
    typeof changeSet.arn !== "string" ||
    changeSet.arn !==
    `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/${changeSet.name}/` +
    (changeSet.arn.split("/").at(-1) ?? "") ||
    !uuidPattern.test(changeSet.arn.split("/").at(-1) ?? "") ||
    changeSet.type !== "CREATE" ||
    changeSet.roleArn !== SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN ||
    !Array.isArray(changeSet.capabilities) ||
    changeSet.capabilities.length !== 0 ||
    changeSet.includeNestedStacks !== false ||
    !Array.isArray(changeSet.resourceTypes) ||
    canonicalJson(changeSet.resourceTypes) !==
    canonicalJson(SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      "The exact CREATE Change Set binding is invalid.",
    );
  }

  const parameters = normalizeEntries(
    changeSet.parameters,
    parameterKeys,
    ["ParameterKey", "ParameterValue"],
    "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
  ) as unknown as readonly SharedCellAuthorCompensationParameter[];
  const tags = normalizeEntries(
    changeSet.tags,
    tagKeys,
    ["Key", "Value"],
    "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
  ) as unknown as readonly SharedCellAuthorCompensationTag[];
  const tagMap = Object.fromEntries(tags.map((tag) => [tag.Key, tag.Value]));
  if (
    tagMap.Environment !== "aws-sandbox" ||
    tagMap.ManagedBy !== "techlong-cell-operator" ||
    tagMap.CellId !== "cell-sandbox-1" ||
    !canonicalUtc(tagMap.ExpiresAt)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
      "The exact four ownership tags are invalid.",
    );
  }

  return immutableClone(
    {
      schemaVersion: 1,
      accountId: SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID,
      region: SHARED_CELL_AUTHOR_COMPENSATION_REGION,
      stackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
      stackId,
      compensationGrant: {
        reviewedAt: compensationGrant.reviewedAt as string,
        expiresAt: compensationGrant.expiresAt as string,
      },
      immutableTemplate: {
        url: immutableTemplate.url as string,
        rawSha256: immutableTemplate.rawSha256,
        canonicalSha256: immutableTemplate.canonicalSha256,
      },
      changeSet: {
        name: changeSet.name,
        arn: changeSet.arn,
        type: "CREATE",
        roleArn: SHARED_CELL_AUTHOR_COMPENSATION_ROLE_ARN,
        capabilities: [],
        includeNestedStacks: false,
        resourceTypes: [...SHARED_CELL_AUTHOR_COMPENSATION_RESOURCE_TYPES],
        parameters,
        tags,
      },
    } satisfies NormalizedCandidate,
    "SHARED_CELL_AUTHOR_COMPENSATION_CANDIDATE_INVALID",
  );
}

function pinEvidence(
  value: SharedCellAuthorCompensationReadPort,
): SharedCellAuthorCompensationReadPort {
  if (
    !value ||
    typeof value !== "object" ||
    value.region !== SHARED_CELL_AUTHOR_COMPENSATION_REGION ||
    typeof value.getCallerIdentity !== "function" ||
    typeof value.describeStack !== "function" ||
    typeof value.getOriginalTemplate !== "function" ||
    typeof value.listStackResourcesPage !== "function" ||
    typeof value.describeChangeSet !== "function"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PORT_INVALID",
      "The compensation evidence port is invalid or outside ca-central-1.",
    );
  }
  const pinned: SharedCellAuthorCompensationReadPort = {
    region: value.region,
    getCallerIdentity: (input) => value.getCallerIdentity.call(value, input),
    describeStack: (input) => value.describeStack.call(value, input),
    getOriginalTemplate: (input) => value.getOriginalTemplate.call(value, input),
    listStackResourcesPage: (input) =>
      value.listStackResourcesPage.call(value, input),
    describeChangeSet: (input) => value.describeChangeSet.call(value, input),
  };
  return Object.freeze(pinned);
}

function pinAuthority(
  value: StrongSharedCellAuthorAuthorityReadPort,
): StrongSharedCellAuthorAuthorityReadPort {
  if (!value || typeof value !== "object" || typeof value.readStrong !== "function") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PORT_INVALID",
      "The strong authority reader is invalid.",
    );
  }
  const pinned: StrongSharedCellAuthorAuthorityReadPort = {
    readStrong: (input) => value.readStrong.call(value, input),
  };
  return Object.freeze(pinned);
}

function pinMutations(
  value: SharedCellAuthorCompensationMutationPort,
): SharedCellAuthorCompensationMutationPort {
  if (
    !value ||
    typeof value !== "object" ||
    value.region !== SHARED_CELL_AUTHOR_COMPENSATION_REGION ||
    typeof value.getCallerIdentity !== "function" ||
    typeof value.deleteChangeSet !== "function" ||
    typeof value.deleteStack !== "function"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PORT_INVALID",
      "The compensation mutation port is invalid.",
    );
  }
  const pinned: SharedCellAuthorCompensationMutationPort = {
    region: value.region,
    getCallerIdentity: (input) => value.getCallerIdentity.call(value, input),
    deleteChangeSet: (input) => value.deleteChangeSet.call(value, input),
    deleteStack: (input) => value.deleteStack.call(value, input),
  };
  return Object.freeze(pinned);
}

async function callRead<T>(
  signal: AbortSignal,
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  requireNotAborted(signal);
  try {
    const value = await operation();
    requireNotAborted(signal);
    return value;
  } catch (error) {
    requireNotAborted(signal);
    if (error instanceof SharedCellAuthorCompensationError) throw error;
    return fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_READ_UNCERTAIN",
      `${label} failed; AccessDenied, timeout and ambiguous provider errors never prove absence.`,
      true,
    );
  }
}

async function assertCaller(
  evidence: SharedCellAuthorCompensationReadPort,
  signal: AbortSignal,
): Promise<void> {
  const identity = await callRead(signal, "GetCallerIdentity", () =>
    evidence.getCallerIdentity({ signal }),
  );
  if (
    !exactKeys(identity, ["accountId", "arn"]) ||
    record(identity).accountId !== SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID ||
    record(identity).arn !== SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CALLER_INVALID",
      "Compensation requires the exact CellOperator assumed-role session.",
    );
  }
}

async function assertMutationCaller(
  mutations: SharedCellAuthorCompensationMutationPort,
  signal: AbortSignal,
): Promise<void> {
  const identity = await callRead(signal, "mutation GetCallerIdentity", () =>
    mutations.getCallerIdentity({ signal }),
  );
  if (
    !exactKeys(identity, ["accountId", "arn"]) ||
    record(identity).accountId !== SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID ||
    record(identity).arn !== SHARED_CELL_AUTHOR_COMPENSATION_CALLER_ARN
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_MUTATION_CALLER_INVALID",
      "Compensation mutations require the exact CellOperator assumed-role session.",
    );
  }
}

async function assertAuthorityAbsent(
  authority: StrongSharedCellAuthorAuthorityReadPort,
  signal: AbortSignal,
): Promise<void> {
  const snapshot = await callRead(signal, "strong authority read", () =>
    authority.readStrong({
      authorityKey: SHARED_CELL_CLEANUP_AUTHORITY_KEY,
      signal,
    }),
  );
  if (
    !exactKeys(snapshot, ["authorityKey", "item", "revision"]) ||
    record(snapshot).authorityKey !== SHARED_CELL_CLEANUP_AUTHORITY_KEY ||
    !Number.isSafeInteger(record(snapshot).revision) ||
    Number(record(snapshot).revision) < 0
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_AUTHORITY_INVALID",
      "The strong Shared Cell authority snapshot is malformed.",
    );
  }
  const revision = Number(record(snapshot).revision);
  const item = record(snapshot).item;
  if ((item === null) !== (revision === 0)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_AUTHORITY_INVALID",
      "Strong authority absence requires item=null if and only if revision=0.",
    );
  }
  if (item !== null) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_AUTHORITY_PRESENT",
      "Strong Shared Cell authority must remain exactly ABSENT.",
    );
  }
}

function assertGrantWindow(
  candidate: NormalizedCandidate,
  now: (() => number) | undefined,
  minimumRemainingMs: number,
  operation: string,
): void {
  const current = readClock(now);
  const reviewedAt = Date.parse(candidate.compensationGrant.reviewedAt);
  const expiresAt = Date.parse(candidate.compensationGrant.expiresAt);
  if (current < reviewedAt || current >= expiresAt) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_INACTIVE",
      `The compensation grant is not active for ${operation}.`,
    );
  }
  if (expiresAt - current <= minimumRemainingMs) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_MARGIN_INSUFFICIENT",
      `The compensation grant lacks the required safety margin for ${operation}.`,
    );
  }
}

function isMissing(
  value: unknown,
  targetKey: "stackName" | "stackNameOrId" | "changeSetArn",
  targetValue: string,
  proof: "NAME_BOUND_VALIDATION_ERROR" | "ARN_BOUND_VALIDATION_ERROR",
): boolean {
  return (
    exactKeys(value, [targetKey, "proof", "state"]) &&
    record(value).state === "missing" &&
    record(value)[targetKey] === targetValue &&
    record(value).proof === proof
  );
}

function assertExactPlaceholderStack(
  value: unknown,
  candidate: NormalizedCandidate,
  expectedStatus: "REVIEW_IN_PROGRESS" | "DELETE_IN_PROGRESS",
): void {
  if (!exactKeys(value, ["stack", "state"]) || record(value).state !== "present") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DRIFT",
      "The target is neither exact missing nor an exact review placeholder.",
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
    stack.stackName !== candidate.stackName ||
    stack.stackId !== candidate.stackId ||
    stack.stackStatus !== expectedStatus ||
    canonicalJson(stack.tags) !== canonicalJson(candidate.changeSet.tags) ||
    stack.terminationProtection !== false ||
    stack.roleArn !== candidate.changeSet.roleArn ||
    stack.parentId !== null ||
    stack.rootId !== null
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DRIFT",
      `Only the exact top-level ${expectedStatus} placeholder is accepted in this phase.`,
    );
  }
}

function presentStackStatus(value: unknown): unknown {
  return record(record(value).stack).stackStatus;
}

function assertNoOriginalTemplate(value: unknown, candidate: NormalizedCandidate): void {
  if (
    !isMissing(
      value,
      "stackNameOrId",
      candidate.stackId,
      "NAME_BOUND_VALIDATION_ERROR",
    )
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_TEMPLATE_DRIFT",
      "The review placeholder unexpectedly has an Original template.",
    );
  }
}

function assertZeroResources(value: unknown): void {
  if (
    !exactKeys(value, ["nextToken", "resources"]) ||
    record(value).nextToken !== null ||
    !Array.isArray(record(value).resources) ||
    (record(value).resources as unknown[]).length !== 0
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_RESOURCES_PRESENT",
      "The review placeholder must have exactly zero Stack resources.",
    );
  }
}

function assertChangeSet(value: unknown, candidate: NormalizedCandidate): void {
  if (!exactKeys(value, ["changeSet", "state"]) || record(value).state !== "present") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
      "The exact approved CREATE Change Set is not present.",
    );
  }
  const actual = record(record(value).changeSet);
  const expected = {
    changeSetName: candidate.changeSet.name,
    changeSetArn: candidate.changeSet.arn,
    stackName: candidate.stackName,
    stackId: candidate.stackId,
    changeSetType: "CREATE",
    status: "CREATE_COMPLETE",
    executionStatus: "AVAILABLE",
    roleArn: candidate.changeSet.roleArn,
    templateUrl: candidate.immutableTemplate.url,
    templateRawSha256: candidate.immutableTemplate.rawSha256,
    templateCanonicalSha256: candidate.immutableTemplate.canonicalSha256,
    capabilities: [],
    includeNestedStacks: false,
    resourceTypes: candidate.changeSet.resourceTypes,
    parameters: candidate.changeSet.parameters,
    tags: candidate.changeSet.tags,
  };
  if (
    !exactKeys(actual, Object.keys(expected)) ||
    canonicalJson(actual) !== canonicalJson(expected)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
      "The CREATE Change Set drifted from its exact immutable candidate.",
    );
  }
}

async function readStack(
  evidence: SharedCellAuthorCompensationReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
): Promise<unknown> {
  return callRead(signal, "DescribeStacks", () =>
    evidence.describeStack({ stackNameOrId: candidate.stackName, signal }),
  );
}

async function readTemplate(
  evidence: SharedCellAuthorCompensationReadPort,
  stackNameOrId: string,
  signal: AbortSignal,
): Promise<unknown> {
  return callRead(signal, "GetTemplate(Original)", () =>
    evidence.getOriginalTemplate({ stackNameOrId, signal }),
  );
}

async function readResources(
  evidence: SharedCellAuthorCompensationReadPort,
  stackNameOrId: string,
  signal: AbortSignal,
): Promise<unknown> {
  return callRead(signal, "ListStackResources", () =>
    evidence.listStackResourcesPage({
      stackNameOrId,
      nextToken: null,
      signal,
    }),
  );
}

async function readChangeSet(
  evidence: SharedCellAuthorCompensationReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
): Promise<unknown> {
  return callRead(signal, "DescribeChangeSet", () =>
    evidence.describeChangeSet({
      changeSetNameOrArn: candidate.changeSet.arn,
      stackNameOrId: candidate.stackId,
      signal,
    }),
  );
}

function isStackMissing(value: unknown, candidate: NormalizedCandidate): boolean {
  return isMissing(
    value,
    "stackName",
    candidate.stackName,
    "NAME_BOUND_VALIDATION_ERROR",
  );
}

function isTemplateMissing(value: unknown, stackNameOrId: string): boolean {
  return isMissing(
    value,
    "stackNameOrId",
    stackNameOrId,
    "NAME_BOUND_VALIDATION_ERROR",
  );
}

function isResourcesMissing(value: unknown, stackNameOrId: string): boolean {
  return isMissing(
    value,
    "stackNameOrId",
    stackNameOrId,
    "NAME_BOUND_VALIDATION_ERROR",
  );
}

function isChangeSetMissing(value: unknown, candidate: NormalizedCandidate): boolean {
  return isMissing(
    value,
    "changeSetArn",
    candidate.changeSet.arn,
    "ARN_BOUND_VALIDATION_ERROR",
  );
}

async function observeOneStackCycle(
  evidence: SharedCellAuthorCompensationReadPort,
  authority: StrongSharedCellAuthorAuthorityReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
  allowDeleting: boolean,
): Promise<Observation> {
  await assertCaller(evidence, signal);
  await assertAuthorityAbsent(authority, signal);
  const stack = await readStack(evidence, candidate, signal);
  const stackMissing = isStackMissing(stack, candidate);
  let presentStatus: "REVIEW_IN_PROGRESS" | "DELETE_IN_PROGRESS" | null = null;
  if (!stackMissing) {
    const status = presentStackStatus(stack);
    if (status === "REVIEW_IN_PROGRESS") {
      assertExactPlaceholderStack(stack, candidate, "REVIEW_IN_PROGRESS");
      presentStatus = "REVIEW_IN_PROGRESS";
    } else if (status === "DELETE_IN_PROGRESS" && allowDeleting) {
      assertExactPlaceholderStack(stack, candidate, "DELETE_IN_PROGRESS");
      presentStatus = "DELETE_IN_PROGRESS";
    } else {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DRIFT",
        "The Stack is not in an exact state accepted by this compensation phase.",
      );
    }
  }
  // Absence must be name-bound. A deleted Stack can remain describable by StackId.
  const stackNameOrId = stackMissing ? candidate.stackName : candidate.stackId;
  const template = await readTemplate(evidence, stackNameOrId, signal);
  const resources = await readResources(evidence, stackNameOrId, signal);
  await assertAuthorityAbsent(authority, signal);

  const missing =
    stackMissing &&
    isTemplateMissing(template, candidate.stackName) &&
    isResourcesMissing(resources, candidate.stackName);
  if (missing) return "MISSING";
  if (isStackMissing(stack, candidate)) {
    if (allowDeleting) {
      // CloudFormation's name-bound APIs can converge at different times after
      // an accepted DeleteStack. This is only a pending read state: it never
      // proves absence and never authorizes another mutation.
      return "DELETE_IN_PROGRESS";
    }
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_MISSING_PROOF_INVALID",
      "DescribeStacks, GetTemplate(Original), and ListStackResources did not agree on exact absence.",
    );
  }
  assertNoOriginalTemplate(template, candidate);
  if (
    presentStatus === "DELETE_IN_PROGRESS" &&
    isResourcesMissing(resources, candidate.stackId)
  ) {
    return "DELETE_IN_PROGRESS";
  }
  assertZeroResources(resources);
  return presentStatus as "REVIEW_IN_PROGRESS" | "DELETE_IN_PROGRESS";
}

async function observeCompensationState(
  evidence: SharedCellAuthorCompensationReadPort,
  authority: StrongSharedCellAuthorAuthorityReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
  allowDeleting: boolean,
  allowMissingChangeSet: boolean,
): Promise<ExecutionObservation> {
  const first = await observeOneStackCycle(
    evidence,
    authority,
    candidate,
    signal,
    allowDeleting,
  );
  if (first === "MISSING") {
    const firstChangeSetMissing = await observeChangeSetMissingCycle(
      evidence,
      authority,
      candidate,
      signal,
    );
    const second = await observeOneStackCycle(
      evidence,
      authority,
      candidate,
      signal,
      allowDeleting,
    );
    const secondChangeSetMissing =
      second === "MISSING"
        ? await observeChangeSetMissingCycle(
          evidence,
          authority,
          candidate,
          signal,
        )
        : false;
    if (
      second !== "MISSING" ||
      !firstChangeSetMissing ||
      !secondChangeSetMissing
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_MISSING_UNSTABLE",
        "The Stack and exact Change Set were not stably missing across two complete proof cycles.",
        true,
      );
    }
    return "MISSING";
  }

  if (first === "DELETE_IN_PROGRESS") return "DELETE_IN_PROGRESS";

  const changeSet = await readChangeSet(evidence, candidate, signal);
  if (isChangeSetMissing(changeSet, candidate)) {
    if (!allowMissingChangeSet) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
        "The approved Change Set is missing while its review placeholder remains.",
      );
    }
    await assertAuthorityAbsent(authority, signal);
    return "REVIEW_CHANGE_SET_MISSING";
  } else {
    assertChangeSet(changeSet, candidate);
  }
  await assertAuthorityAbsent(authority, signal);
  return "REVIEW_CHANGE_SET_PRESENT";
}

async function observeChangeSetMissingCycle(
  evidence: SharedCellAuthorCompensationReadPort,
  authority: StrongSharedCellAuthorAuthorityReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
): Promise<boolean> {
  await assertCaller(evidence, signal);
  await assertAuthorityAbsent(authority, signal);
  const observed = await readChangeSet(evidence, candidate, signal);
  await assertAuthorityAbsent(authority, signal);
  if (isChangeSetMissing(observed, candidate)) return true;
  assertChangeSet(observed, candidate);
  return false;
}

async function planIntent(candidate: NormalizedCandidate): Promise<{
  hash: string;
  clientToken: string;
}> {
  const intent = {
    schemaVersion: 1,
    action: "compensate_shared_cell_author_create_placeholder",
    accountId: candidate.accountId,
    region: candidate.region,
    stackName: candidate.stackName,
    stackId: candidate.stackId,
    compensationGrant: candidate.compensationGrant,
    immutableTemplate: candidate.immutableTemplate,
    changeSet: candidate.changeSet,
    authorityRequirement: "ABSENT",
    operations: ["DeleteChangeSet", "DeleteStack"],
    deleteStack: {
      deletionMode: "STANDARD",
      retainResources: [],
      forceDeleteStack: false,
      roleArn: null,
    },
    successFence: {
      consecutiveMissingCycles: 2,
      reads: [
        "DescribeStacks(name-bound)",
        "GetTemplate(Original)",
        "ListStackResources",
        "DescribeChangeSet(exact ARN)",
      ],
      authorRevokeIsSeparate: true,
    },
  };
  const hash = await sha256Hex(intent);
  const stableDeleteStackTokenHash = await sha256Hex({
    schemaVersion: 1,
    action: "delete_shared_cell_author_create_placeholder",
    accountId: candidate.accountId,
    region: candidate.region,
    stackName: candidate.stackName,
    stackId: candidate.stackId,
    immutableTemplate: candidate.immutableTemplate,
    changeSet: candidate.changeSet,
    deletionMode: "STANDARD",
    retainResources: [],
    forceDeleteStack: false,
    roleArn: null,
  });
  return {
    hash,
    clientToken: `b5-author-comp-${stableDeleteStackTokenHash.slice(0, 32)}`,
  };
}

function summary(
  candidate: NormalizedCandidate,
  plan: { hash: string; clientToken: string; },
  phase: SharedCellAuthorCompensationSummary["phase"],
  observedState: Observation,
  mutationPerformed: boolean,
): Readonly<SharedCellAuthorCompensationSummary> {
  return immutableClone(
    {
      schemaVersion: 1,
      action: "compensate_shared_cell_author_create_placeholder",
      phase,
      observedState,
      accountId: SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID,
      region: SHARED_CELL_AUTHOR_COMPENSATION_REGION,
      stackName: SHARED_CELL_AUTHOR_COMPENSATION_STACK_NAME,
      stackId: candidate.stackId,
      changeSetName: candidate.changeSet.name,
      changeSetArn: candidate.changeSet.arn,
      templateRawSha256: candidate.immutableTemplate.rawSha256,
      templateCanonicalSha256: candidate.immutableTemplate.canonicalSha256,
      compensationPlanSha256: plan.hash,
      deleteStackClientRequestToken: plan.clientToken,
      mutationPerformed,
      safeToAuthorRevoke: observedState === "MISSING",
    },
    "SHARED_CELL_AUTHOR_COMPENSATION_RESULT_INVALID",
  );
}

function assertDigest(value: unknown): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_DIGEST_INVALID",
      "The approved compensation-plan digest is invalid.",
    );
  }
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
  const attempts = input.readbackAttempts ?? 12;
  const delayMs = input.readbackDelayMs ?? 5_000;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 2 ||
    attempts > 100 ||
    !Number.isSafeInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > 60_000 ||
    (input.wait !== undefined && typeof input.wait !== "function")
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_INPUT_INVALID",
      "The bounded compensation readback settings are invalid.",
    );
  }
  return {
    attempts,
    delayMs,
    wait:
      input.wait ??
      ((delay, signal) =>
        new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, delay);
          signal.addEventListener("abort", onAbort, { once: true });
        })),
  };
}

async function waitForChangeSetMissing(
  evidence: SharedCellAuthorCompensationReadPort,
  authority: StrongSharedCellAuthorAuthorityReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
  settings: ReturnType<typeof readbackSettings>,
): Promise<void> {
  for (let attempt = 0; attempt < settings.attempts; attempt += 1) {
    await assertCaller(evidence, signal);
    await assertAuthorityAbsent(authority, signal);
    const observed = await readChangeSet(evidence, candidate, signal);
    await assertAuthorityAbsent(authority, signal);
    if (isChangeSetMissing(observed, candidate)) return;
    assertChangeSet(observed, candidate);
    if (attempt + 1 < settings.attempts) {
      await settings.wait(settings.delayMs, signal);
      requireNotAborted(signal);
    }
  }
  fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DELETE_UNCERTAIN",
    "The exact Change Set was not authoritatively absent within the bounded window; never resubmit deletion blindly.",
    true,
  );
}

async function waitForStableStackMissing(
  evidence: SharedCellAuthorCompensationReadPort,
  authority: StrongSharedCellAuthorAuthorityReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
  settings: ReturnType<typeof readbackSettings>,
): Promise<void> {
  let consecutive = 0;
  for (let attempt = 0; attempt < settings.attempts; attempt += 1) {
    const observed = await observeOneStackCycle(
      evidence,
      authority,
      candidate,
      signal,
      true,
    );
    const changeSetMissing =
      observed === "MISSING"
        ? await observeChangeSetMissingCycle(
          evidence,
          authority,
          candidate,
          signal,
        )
        : false;
    consecutive =
      observed === "MISSING" && changeSetMissing ? consecutive + 1 : 0;
    if (consecutive === 2) return;
    if (attempt + 1 < settings.attempts) {
      await settings.wait(settings.delayMs, signal);
      requireNotAborted(signal);
    }
  }
  fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_STACK_DELETE_UNCERTAIN",
    "The placeholder was not proven exactly missing twice within the bounded window; Recover is read-only and mutation must not be repeated.",
    true,
  );
}

export async function inspectSharedCellAuthorCompensation(
  input: BaseSettings,
): Promise<Readonly<SharedCellAuthorCompensationSummary>> {
  assertExactInput(
    input,
    ["authority", "candidate", "evidence", "signal"],
    ["now"],
  );
  const candidate = normalizeCandidate(input.candidate);
  assertGrantWindow(
    candidate,
    input.now,
    deleteChangeSetMinimumRemainingMs,
    "Inspect",
  );
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const state = await observeCompensationState(
    evidence,
    authority,
    candidate,
    input.signal,
    false,
    true,
  );
  const plan = await planIntent(candidate);
  return summary(
    candidate,
    plan,
    "INSPECTED",
    state === "MISSING" ? "MISSING" : "REVIEW_IN_PROGRESS",
    false,
  );
}

export async function executeReviewedSharedCellAuthorCompensation(
  input: ExecuteSettings,
): Promise<Readonly<SharedCellAuthorCompensationSummary>> {
  assertExactInput(
    input,
    [
      "approvedCompensationPlanSha256",
      "authority",
      "candidate",
      "evidence",
      "mutations",
      "signal",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertDigest(input.approvedCompensationPlanSha256);
  const candidate = normalizeCandidate(input.candidate);
  assertGrantWindow(
    candidate,
    input.now,
    deleteStackMinimumRemainingMs,
    "Execute",
  );
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const mutations = pinMutations(input.mutations);
  const bounded = readbackSettings(input);
  const plan = await planIntent(candidate);
  if (plan.hash !== input.approvedCompensationPlanSha256) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PLAN_MISMATCH",
      "Fresh compensation intent does not match the approved plan digest.",
    );
  }

  // Once a mutation delegate is entered, cancellation remains ambiguous until
  // all reconciliation for the latest submitted phase has completed.
  let submittedPhase: "CHANGE_SET" | "STACK" | null = null;
  try {
    let state = await observeCompensationState(
      evidence,
      authority,
      candidate,
      input.signal,
      true,
      true,
    );
    if (state === "MISSING") {
      return summary(candidate, plan, "COMPENSATED", "MISSING", false);
    }
    if (state === "DELETE_IN_PROGRESS") {
      await waitForStableStackMissing(
        evidence,
        authority,
        candidate,
        input.signal,
        bounded,
      );
      return summary(candidate, plan, "COMPENSATED", "MISSING", false);
    }

    let mutationPerformed = false;
    if (state === "REVIEW_CHANGE_SET_PRESENT") {
      assertGrantWindow(
        candidate,
        input.now,
        deleteChangeSetMinimumRemainingMs,
        "DeleteChangeSet",
      );
      // Fresh exact reinspection immediately before the first and only write.
      state = await observeCompensationState(
        evidence,
        authority,
        candidate,
        input.signal,
        true,
        true,
      );
      if (state === "MISSING") {
        return summary(candidate, plan, "COMPENSATED", "MISSING", false);
      }
      if (state === "DELETE_IN_PROGRESS") {
        await waitForStableStackMissing(
          evidence,
          authority,
          candidate,
          input.signal,
          bounded,
        );
        return summary(candidate, plan, "COMPENSATED", "MISSING", false);
      }
      if (state === "REVIEW_CHANGE_SET_PRESENT") {
        await assertMutationCaller(mutations, input.signal);
        await assertAuthorityAbsent(authority, input.signal);
        assertGrantWindow(
          candidate,
          input.now,
          deleteChangeSetMinimumRemainingMs,
          "DeleteChangeSet",
        );
        requireNotAborted(input.signal);
        submittedPhase = "CHANGE_SET";
        try {
          await mutations.deleteChangeSet({
            request: {
              ChangeSetName: candidate.changeSet.arn,
              StackName: candidate.stackId,
            },
            signal: input.signal,
          });
          mutationPerformed = true;
          requireNotAborted(input.signal);
        } catch {
          mutationPerformed = true;
          if (input.signal.aborted) {
            fail(
              "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN",
              "DeleteChangeSet may have been submitted before cancellation; use read-only recovery or a freshly inspected resume plan and never replay blindly.",
              true,
            );
          }
          // A lost response is reconciled below. The mutation is never repeated.
        }

        await waitForChangeSetMissing(
          evidence,
          authority,
          candidate,
          input.signal,
          bounded,
        );
        state = await observeCompensationState(
          evidence,
          authority,
          candidate,
          input.signal,
          true,
          true,
        );
      }
    }

    if (state === "MISSING") {
      return summary(
        candidate,
        plan,
        "COMPENSATED",
        "MISSING",
        mutationPerformed,
      );
    }
    if (state === "DELETE_IN_PROGRESS") {
      await waitForStableStackMissing(
        evidence,
        authority,
        candidate,
        input.signal,
        bounded,
      );
      return summary(
        candidate,
        plan,
        "COMPENSATED",
        "MISSING",
        mutationPerformed,
      );
    }
    if (state !== "REVIEW_CHANGE_SET_MISSING") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
        "The Change Set reappeared after exact absence; DeleteStack is blocked.",
      );
    }

    assertGrantWindow(
      candidate,
      input.now,
      deleteStackMinimumRemainingMs,
      "DeleteStack",
    );
    // Fresh exact CS-missing reinspection immediately before DeleteStack.
    state = await observeCompensationState(
      evidence,
      authority,
      candidate,
      input.signal,
      true,
      true,
    );
    if (state === "MISSING") {
      return summary(
        candidate,
        plan,
        "COMPENSATED",
        "MISSING",
        mutationPerformed,
      );
    }
    if (state === "DELETE_IN_PROGRESS") {
      await waitForStableStackMissing(
        evidence,
        authority,
        candidate,
        input.signal,
        bounded,
      );
      return summary(
        candidate,
        plan,
        "COMPENSATED",
        "MISSING",
        mutationPerformed,
      );
    }
    if (state !== "REVIEW_CHANGE_SET_MISSING") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
        "DeleteStack requires a fresh exact Change Set NotFound proof.",
      );
    }
    await assertMutationCaller(mutations, input.signal);
    await assertAuthorityAbsent(authority, input.signal);
    assertGrantWindow(
      candidate,
      input.now,
      deleteStackMinimumRemainingMs,
      "DeleteStack",
    );
    requireNotAborted(input.signal);
    submittedPhase = "STACK";
    try {
      await mutations.deleteStack({
        request: {
          StackName: candidate.stackId,
          DeletionMode: "STANDARD",
          ClientRequestToken: plan.clientToken,
        },
        signal: input.signal,
      });
      mutationPerformed = true;
      requireNotAborted(input.signal);
    } catch {
      mutationPerformed = true;
      if (input.signal.aborted) {
        fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN",
          "DeleteStack may have been submitted before cancellation; use read-only Recover and never replay blindly.",
          true,
        );
      }
      // A lost response is reconciled below. The mutation is never repeated.
    }

    await waitForStableStackMissing(
      evidence,
      authority,
      candidate,
      input.signal,
      bounded,
    );
    return summary(candidate, plan, "COMPENSATED", "MISSING", mutationPerformed);
  } catch (error) {
    if (input.signal.aborted && submittedPhase === "STACK") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN",
        "DeleteStack may have been submitted before cancellation; use read-only Recover and never replay blindly.",
        true,
      );
    }
    if (input.signal.aborted && submittedPhase === "CHANGE_SET") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN",
        "DeleteChangeSet may have been submitted before cancellation; use read-only recovery or a freshly inspected resume plan and never replay blindly.",
        true,
      );
    }
    throw error;
  }
}

export async function recoverSharedCellAuthorCompensation(
  input: RecoverSettings,
): Promise<Readonly<SharedCellAuthorCompensationSummary>> {
  assertExactInput(
    input,
    [
      "approvedCompensationPlanSha256",
      "authority",
      "candidate",
      "evidence",
      "signal",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertDigest(input.approvedCompensationPlanSha256);
  const candidate = normalizeCandidate(input.candidate);
  if (input.now !== undefined) readClock(input.now);
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const bounded = readbackSettings(input);
  const plan = await planIntent(candidate);
  if (plan.hash !== input.approvedCompensationPlanSha256) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PLAN_MISMATCH",
      "Recovery intent does not match the approved plan digest.",
    );
  }
  const observed = await observeCompensationState(
    evidence,
    authority,
    candidate,
    input.signal,
    true,
    true,
  );
  if (observed === "MISSING") {
    return summary(candidate, plan, "RECOVERED", "MISSING", false);
  }
  if (observed === "DELETE_IN_PROGRESS") {
    await waitForStableStackMissing(
      evidence,
      authority,
      candidate,
      input.signal,
      bounded,
    );
    return summary(candidate, plan, "RECOVERED", "MISSING", false);
  }
  fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_RECOVERY_BLOCKED",
    "The exact REVIEW_IN_PROGRESS placeholder remains. Recovery is read-only and will never repeat either mutation.",
    true,
  );
}
