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
  getChangeSetTemplate(input: {
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

/** Narrow phase port: it is intentionally incapable of deleting a Stack. */
export interface SharedCellAuthorDeleteChangeSetMutationPort {
  readonly region: string;
  getCallerIdentity(input: { signal: AbortSignal; }): Promise<unknown>;
  deleteChangeSet(input: {
    request: {
      ChangeSetName: string;
      StackName: string;
    };
    signal: AbortSignal;
  }): Promise<unknown>;
  readonly deleteStack?: never;
}

/** Narrow phase port: it is intentionally incapable of deleting a Change Set. */
export interface SharedCellAuthorDeleteStackMutationPort {
  readonly region: string;
  getCallerIdentity(input: { signal: AbortSignal; }): Promise<unknown>;
  deleteStack(input: {
    request: {
      StackName: string;
      DeletionMode: "STANDARD";
      ClientRequestToken: string;
    };
    signal: AbortSignal;
  }): Promise<unknown>;
  readonly deleteChangeSet?: never;
}

export type SharedCellAuthorCompensationPhase =
  | "DELETE_CHANGE_SET"
  | "DELETE_STACK";

export interface SharedCellAuthorCompensationCompiledPlan {
  readonly schemaVersion: 1;
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: Readonly<
    Record<SharedCellAuthorCompensationPhase, string>
  >;
  readonly deleteStackClientRequestToken: string;
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

interface DeleteChangeSetExecuteSettings extends BaseSettings {
  mutations: SharedCellAuthorDeleteChangeSetMutationPort;
  approvedCompensationPlanSha256: string;
  approvedPhasePlanSha256: string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface DeleteStackExecuteSettings extends BaseSettings {
  mutations: SharedCellAuthorDeleteStackMutationPort;
  approvedCompensationPlanSha256: string;
  approvedPhasePlanSha256: string;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface PhaseRecoverSettings extends BaseSettings {
  approvedCompensationPlanSha256: string;
  approvedPhasePlanSha256: string;
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

export interface SharedCellAuthorDeleteChangeSetSummary {
  readonly schemaVersion: 1;
  readonly action: "delete_shared_cell_author_change_set";
  readonly phase: "DELETE_CHANGE_SET";
  readonly observedState: Observation;
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly deleteStackClientRequestToken: string;
  readonly stackId: string;
  readonly changeSetArn: string;
  readonly mutationPerformed: boolean;
  readonly readyForDeleteStackReview: boolean;
  /** The temporary DeleteChangeSet grant can and must now be revoked. */
  readonly safeToRevokePhaseGrant: true;
  readonly safeToAuthorRevoke: boolean;
}

export interface SharedCellAuthorDeleteStackSummary {
  readonly schemaVersion: 1;
  readonly action: "delete_shared_cell_author_stack";
  readonly phase: "DELETE_STACK";
  readonly observedState: Observation;
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly deleteStackClientRequestToken: string;
  readonly stackId: string;
  readonly changeSetArn: string;
  readonly mutationPerformed: boolean;
  /** The temporary DeleteStack grant can and must now be revoked. */
  readonly safeToRevokePhaseGrant: true;
  readonly safeToAuthorRevoke: boolean;
}

export interface SharedCellAuthorDeleteChangeSetInspectionSummary {
  readonly schemaVersion: 1;
  readonly action: "inspect_shared_cell_author_delete_change_set";
  readonly phase: "DELETE_CHANGE_SET";
  readonly observedState: Observation;
  readonly changeSetState: "PRESENT" | "MISSING";
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly deleteStackClientRequestToken: string;
  readonly stackId: string;
  readonly changeSetArn: string;
  readonly mutationPerformed: false;
  readonly readyForPhase: boolean;
  readonly readyForDeleteStackReview: boolean;
  readonly safeToAuthorRevoke: boolean;
}

export interface SharedCellAuthorDeleteStackInspectionSummary {
  readonly schemaVersion: 1;
  readonly action: "inspect_shared_cell_author_delete_stack";
  readonly phase: "DELETE_STACK";
  readonly observedState: Observation;
  readonly changeSetState: "MISSING";
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly deleteStackClientRequestToken: string;
  readonly stackId: string;
  readonly changeSetArn: string;
  readonly mutationPerformed: false;
  readonly readyForPhase: boolean;
  readonly safeToAuthorRevoke: boolean;
}

export interface SharedCellAuthorDeleteChangeSetRecoverySummary {
  readonly schemaVersion: 1;
  readonly action: "recover_shared_cell_author_delete_change_set";
  readonly phase: "DELETE_CHANGE_SET";
  readonly observedState: Observation;
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly deleteStackClientRequestToken: string;
  readonly stackId: string;
  readonly changeSetArn: string;
  readonly mutationPerformed: false;
  readonly readyForDeleteStackReview: boolean;
  readonly safeToRevokePhaseGrant: true;
  readonly safeToAuthorRevoke: boolean;
}

export interface SharedCellAuthorDeleteStackRecoverySummary {
  readonly schemaVersion: 1;
  readonly action: "recover_shared_cell_author_delete_stack";
  readonly phase: "DELETE_STACK";
  readonly observedState: "MISSING";
  readonly operationSha256: string;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly deleteStackClientRequestToken: string;
  readonly stackId: string;
  readonly changeSetArn: string;
  readonly mutationPerformed: false;
  readonly safeToRevokePhaseGrant: true;
  readonly safeToAuthorRevoke: true;
}

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
    typeof value.describeChangeSet !== "function" ||
    typeof value.getChangeSetTemplate !== "function"
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
    getChangeSetTemplate: (input) =>
      value.getChangeSetTemplate.call(value, input),
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

function pinDeleteChangeSetMutations(
  value: SharedCellAuthorDeleteChangeSetMutationPort,
): SharedCellAuthorDeleteChangeSetMutationPort {
  if (
    !value ||
    typeof value !== "object" ||
    value.region !== SHARED_CELL_AUTHOR_COMPENSATION_REGION ||
    typeof value.getCallerIdentity !== "function" ||
    typeof value.deleteChangeSet !== "function" ||
    typeof (value as { deleteStack?: unknown }).deleteStack !== "undefined"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PORT_INVALID",
      "The DeleteChangeSet phase requires an exact narrow mutation port.",
    );
  }
  const pinned: SharedCellAuthorDeleteChangeSetMutationPort = {
    region: value.region,
    getCallerIdentity: (input) => value.getCallerIdentity.call(value, input),
    deleteChangeSet: (input) => value.deleteChangeSet.call(value, input),
  };
  return Object.freeze(pinned);
}

function pinDeleteStackMutations(
  value: SharedCellAuthorDeleteStackMutationPort,
): SharedCellAuthorDeleteStackMutationPort {
  if (
    !value ||
    typeof value !== "object" ||
    value.region !== SHARED_CELL_AUTHOR_COMPENSATION_REGION ||
    typeof value.getCallerIdentity !== "function" ||
    typeof value.deleteStack !== "function" ||
    typeof (value as { deleteChangeSet?: unknown }).deleteChangeSet !== "undefined"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PORT_INVALID",
      "The DeleteStack phase requires an exact narrow mutation port.",
    );
  }
  const pinned: SharedCellAuthorDeleteStackMutationPort = {
    region: value.region,
    getCallerIdentity: (input) => value.getCallerIdentity.call(value, input),
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
  mutations: {
    getCallerIdentity(input: { signal: AbortSignal; }): Promise<unknown>;
  },
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
  proof:
    | "NAME_BOUND_VALIDATION_ERROR"
    | "ARN_BOUND_CHANGE_SET_NOT_FOUND",
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

interface ObservedChangeSetResourceChange {
  type: "Resource";
  action: "Add";
  logicalResourceId: string;
  resourceType: string;
}

function assertChangeSet(
  value: unknown,
  candidate: NormalizedCandidate,
): readonly ObservedChangeSetResourceChange[] {
  if (!exactKeys(value, ["changeSet", "state"]) || record(value).state !== "present") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
      "The exact approved CREATE Change Set is not present.",
    );
  }
  const actual = record(record(value).changeSet);
  if (
    !exactKeys(actual, [
      "capabilities",
      "changeSetArn",
      "changeSetName",
      "changes",
      "description",
      "executionStatus",
      "importExistingResources",
      "includeNestedStacks",
      "notificationArns",
      "onStackFailure",
      "parameters",
      "parentChangeSetId",
      "rootChangeSetId",
      "stackId",
      "stackName",
      "status",
      "tags",
    ]) ||
    actual.changeSetName !== candidate.changeSet.name ||
    actual.changeSetArn !== candidate.changeSet.arn ||
    actual.stackName !== candidate.stackName ||
    actual.stackId !== candidate.stackId ||
    (actual.description !== null && typeof actual.description !== "string") ||
    actual.status !== "CREATE_COMPLETE" ||
    actual.executionStatus !== "AVAILABLE" ||
    canonicalJson(actual.capabilities) !== canonicalJson([]) ||
    actual.includeNestedStacks !== false ||
    canonicalJson(actual.parameters) !==
      canonicalJson(candidate.changeSet.parameters) ||
    canonicalJson(actual.tags) !== canonicalJson(candidate.changeSet.tags) ||
    canonicalJson(actual.notificationArns) !== canonicalJson([]) ||
    actual.parentChangeSetId !== null ||
    actual.rootChangeSetId !== null ||
    actual.onStackFailure !== "DELETE" ||
    actual.importExistingResources !== false
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
      "The provider-observed Change Set drifted from its exact safe constants.",
    );
  }

  const changes = actual.changes;
  if (
    !Array.isArray(changes) ||
    changes.length === 0 ||
    canonicalJson(Object.keys(changes).sort()) !==
      canonicalJson(changes.map((_, index) => String(index)).sort())
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
      "The provider-observed Change Set changes are missing or sparse.",
    );
  }
  const logicalIds = new Set<string>();
  const observed: ObservedChangeSetResourceChange[] = [];
  for (const change of changes) {
    const entry = record(change);
    if (
      !exactKeys(entry, [
        "action",
        "logicalResourceId",
        "resourceType",
        "type",
      ]) ||
      entry.type !== "Resource" ||
      entry.action !== "Add" ||
      typeof entry.logicalResourceId !== "string" ||
      !/^[A-Za-z][A-Za-z0-9]{0,254}$/.test(entry.logicalResourceId) ||
      logicalIds.has(entry.logicalResourceId) ||
      typeof entry.resourceType !== "string" ||
      !candidate.changeSet.resourceTypes.includes(entry.resourceType)
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
        "Every provider-observed Change must be one unique approved Resource Add.",
      );
    }
    logicalIds.add(entry.logicalResourceId);
    observed.push({
      type: "Resource",
      action: "Add",
      logicalResourceId: entry.logicalResourceId,
      resourceType: entry.resourceType,
    });
  }
  const observedTypes = [...new Set(observed.map((change) => change.resourceType))]
    .sort();
  if (
    canonicalJson(observedTypes) !==
    canonicalJson([...candidate.changeSet.resourceTypes].sort())
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
      "The Change Set does not cover all 18 exact approved resource types.",
    );
  }
  return Object.freeze(observed.map((change) => Object.freeze(change)));
}

async function assertChangeSetTemplate(
  value: unknown,
  candidate: NormalizedCandidate,
  changes: readonly ObservedChangeSetResourceChange[],
): Promise<void> {
  if (
    !exactKeys(value, ["changeSetArn", "stackId", "state", "templateBody"]) ||
    record(value).state !== "present" ||
    record(value).changeSetArn !== candidate.changeSet.arn ||
    record(value).stackId !== candidate.stackId
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_TEMPLATE_DRIFT",
      "GetTemplate did not return the exact Change Set and Stack binding.",
    );
  }
  const templateBody = record(value).templateBody;
  if (
    !templateBody ||
    typeof templateBody !== "object" ||
    Array.isArray(templateBody)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_TEMPLATE_DRIFT",
      "The Change Set template body is not parsed canonical JSON.",
    );
  }
  let canonicalSha256: string;
  try {
    canonicalSha256 = await sha256Hex(canonicalJson(templateBody));
  } catch {
    return fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_TEMPLATE_DRIFT",
      "The Change Set template body cannot be canonicalized.",
    );
  }
  if (canonicalSha256 !== candidate.immutableTemplate.canonicalSha256) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_TEMPLATE_DRIFT",
      "The Change Set template canonical SHA-256 drifted from review.",
    );
  }

  const resources = record(templateBody).Resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_TEMPLATE_DRIFT",
      "The canonical Change Set template has no exact Resources object.",
    );
  }
  const expected = Object.entries(resources as Record<string, unknown>).map(
    ([logicalResourceId, resource]) => {
      const resourceType = record(resource).Type;
      if (
        !/^[A-Za-z][A-Za-z0-9]{0,254}$/.test(logicalResourceId) ||
        typeof resourceType !== "string" ||
        !candidate.changeSet.resourceTypes.includes(resourceType)
      ) {
        fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_TEMPLATE_DRIFT",
          "The canonical template contains an unapproved resource change.",
        );
      }
      return { logicalResourceId, resourceType };
    },
  );
  const normalize = (
    entries: readonly { logicalResourceId: string; resourceType: string; }[],
  ) => entries.map((entry) => ({
    logicalResourceId: entry.logicalResourceId,
    resourceType: entry.resourceType,
  })).sort((left, right) =>
    left.logicalResourceId.localeCompare(right.logicalResourceId));
  if (
    canonicalJson(normalize(expected)) !==
    canonicalJson(normalize(changes))
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_DRIFT",
      "DescribeChangeSet Resource Adds do not exactly match the canonical template.",
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

async function readChangeSetTemplate(
  evidence: SharedCellAuthorCompensationReadPort,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
): Promise<unknown> {
  return callRead(signal, "GetTemplate(ChangeSet)", () =>
    evidence.getChangeSetTemplate({
      changeSetNameOrArn: candidate.changeSet.arn,
      stackNameOrId: candidate.stackId,
      signal,
    }),
  );
}

async function assertPresentChangeSetEvidence(
  evidence: SharedCellAuthorCompensationReadPort,
  value: unknown,
  candidate: NormalizedCandidate,
  signal: AbortSignal,
): Promise<void> {
  const changes = assertChangeSet(value, candidate);
  const template = await readChangeSetTemplate(evidence, candidate, signal);
  await assertChangeSetTemplate(template, candidate, changes);
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
    "ARN_BOUND_CHANGE_SET_NOT_FOUND",
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
    await assertPresentChangeSetEvidence(
      evidence,
      changeSet,
      candidate,
      signal,
    );
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

async function compileNormalizedCompensationPlan(
  candidate: NormalizedCandidate,
): Promise<Readonly<SharedCellAuthorCompensationCompiledPlan>> {
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
        "GetTemplate(ChangeSet canonical)",
      ],
      authorRevokeIsSeparate: true,
    },
  };
  const compensationPlanSha256 = await sha256Hex(intent);
  const operationSha256 = await sha256Hex({
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
  const phasePlanSha256 = {
    DELETE_CHANGE_SET: await sha256Hex({
      schemaVersion: 1,
      action: "execute_shared_cell_author_compensation_phase",
      operationSha256,
      compensationPlanSha256,
      phase: "DELETE_CHANGE_SET",
      exactTarget: candidate.changeSet.arn,
    }),
    DELETE_STACK: await sha256Hex({
      schemaVersion: 1,
      action: "execute_shared_cell_author_compensation_phase",
      operationSha256,
      compensationPlanSha256,
      phase: "DELETE_STACK",
      exactTarget: candidate.stackId,
      deletionMode: "STANDARD",
    }),
  } satisfies Record<SharedCellAuthorCompensationPhase, string>;
  const compiled = immutableClone(
    {
      schemaVersion: 1 as const,
      operationSha256,
      compensationPlanSha256,
      phasePlanSha256,
      deleteStackClientRequestToken:
        `b5-author-comp-${operationSha256.slice(0, 32)}`,
    },
    "SHARED_CELL_AUTHOR_COMPENSATION_RESULT_INVALID",
  );
  Object.freeze(compiled.phasePlanSha256);
  return compiled;
}

/**
 * Pure compiler for persistence/controllers. It performs strict candidate
 * normalization but no clock, AWS, authority, database, or mutation read.
 */
export async function compileSharedCellAuthorCompensationPlan(
  candidate: SharedCellAuthorCompensationCandidate,
): Promise<Readonly<SharedCellAuthorCompensationCompiledPlan>> {
  return compileNormalizedCompensationPlan(normalizeCandidate(candidate));
}

async function planIntent(candidate: NormalizedCandidate): Promise<{
  hash: string;
  clientToken: string;
  compiled: Readonly<SharedCellAuthorCompensationCompiledPlan>;
}> {
  const compiled = await compileNormalizedCompensationPlan(candidate);
  return {
    hash: compiled.compensationPlanSha256,
    clientToken: compiled.deleteStackClientRequestToken,
    compiled,
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

function deleteChangeSetSummary(
  candidate: NormalizedCandidate,
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
  observedState: Observation,
  mutationPerformed: boolean,
): Readonly<SharedCellAuthorDeleteChangeSetSummary> {
  return immutableClone(
    {
      schemaVersion: 1,
      action: "delete_shared_cell_author_change_set",
      phase: "DELETE_CHANGE_SET",
      observedState,
      operationSha256: plan.operationSha256,
      compensationPlanSha256: plan.compensationPlanSha256,
      phasePlanSha256: plan.phasePlanSha256.DELETE_CHANGE_SET,
      deleteStackClientRequestToken: plan.deleteStackClientRequestToken,
      stackId: candidate.stackId,
      changeSetArn: candidate.changeSet.arn,
      mutationPerformed,
      readyForDeleteStackReview: observedState === "REVIEW_IN_PROGRESS",
      safeToRevokePhaseGrant: true as const,
      safeToAuthorRevoke: observedState === "MISSING",
    },
    "SHARED_CELL_AUTHOR_COMPENSATION_RESULT_INVALID",
  );
}

function deleteStackSummary(
  candidate: NormalizedCandidate,
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
  observedState: Observation,
  mutationPerformed: boolean,
): Readonly<SharedCellAuthorDeleteStackSummary> {
  return immutableClone(
    {
      schemaVersion: 1,
      action: "delete_shared_cell_author_stack",
      phase: "DELETE_STACK",
      observedState,
      operationSha256: plan.operationSha256,
      compensationPlanSha256: plan.compensationPlanSha256,
      phasePlanSha256: plan.phasePlanSha256.DELETE_STACK,
      deleteStackClientRequestToken: plan.deleteStackClientRequestToken,
      stackId: candidate.stackId,
      changeSetArn: candidate.changeSet.arn,
      mutationPerformed,
      safeToRevokePhaseGrant: true as const,
      safeToAuthorRevoke: observedState === "MISSING",
    },
    "SHARED_CELL_AUTHOR_COMPENSATION_RESULT_INVALID",
  );
}

function deleteChangeSetInspectionSummary(
  candidate: NormalizedCandidate,
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
  observedState: Observation,
  changeSetState: "PRESENT" | "MISSING",
): Readonly<SharedCellAuthorDeleteChangeSetInspectionSummary> {
  return immutableClone(
    {
      schemaVersion: 1,
      action: "inspect_shared_cell_author_delete_change_set",
      phase: "DELETE_CHANGE_SET",
      observedState,
      changeSetState,
      operationSha256: plan.operationSha256,
      compensationPlanSha256: plan.compensationPlanSha256,
      phasePlanSha256: plan.phasePlanSha256.DELETE_CHANGE_SET,
      deleteStackClientRequestToken: plan.deleteStackClientRequestToken,
      stackId: candidate.stackId,
      changeSetArn: candidate.changeSet.arn,
      mutationPerformed: false as const,
      readyForPhase:
        observedState === "REVIEW_IN_PROGRESS" && changeSetState === "PRESENT",
      readyForDeleteStackReview:
        observedState === "REVIEW_IN_PROGRESS" && changeSetState === "MISSING",
      safeToAuthorRevoke: observedState === "MISSING",
    },
    "SHARED_CELL_AUTHOR_COMPENSATION_RESULT_INVALID",
  );
}

function deleteStackInspectionSummary(
  candidate: NormalizedCandidate,
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
  observedState: Observation,
): Readonly<SharedCellAuthorDeleteStackInspectionSummary> {
  return immutableClone(
    {
      schemaVersion: 1,
      action: "inspect_shared_cell_author_delete_stack",
      phase: "DELETE_STACK",
      observedState,
      changeSetState: "MISSING" as const,
      operationSha256: plan.operationSha256,
      compensationPlanSha256: plan.compensationPlanSha256,
      phasePlanSha256: plan.phasePlanSha256.DELETE_STACK,
      deleteStackClientRequestToken: plan.deleteStackClientRequestToken,
      stackId: candidate.stackId,
      changeSetArn: candidate.changeSet.arn,
      mutationPerformed: false as const,
      readyForPhase: observedState === "REVIEW_IN_PROGRESS",
      safeToAuthorRevoke: observedState === "MISSING",
    },
    "SHARED_CELL_AUTHOR_COMPENSATION_RESULT_INVALID",
  );
}

function deleteChangeSetRecoverySummary(
  candidate: NormalizedCandidate,
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
  observedState: Observation,
): Readonly<SharedCellAuthorDeleteChangeSetRecoverySummary> {
  return immutableClone(
    {
      schemaVersion: 1,
      action: "recover_shared_cell_author_delete_change_set",
      phase: "DELETE_CHANGE_SET",
      observedState,
      operationSha256: plan.operationSha256,
      compensationPlanSha256: plan.compensationPlanSha256,
      phasePlanSha256: plan.phasePlanSha256.DELETE_CHANGE_SET,
      deleteStackClientRequestToken: plan.deleteStackClientRequestToken,
      stackId: candidate.stackId,
      changeSetArn: candidate.changeSet.arn,
      mutationPerformed: false as const,
      readyForDeleteStackReview: observedState === "REVIEW_IN_PROGRESS",
      safeToRevokePhaseGrant: true as const,
      safeToAuthorRevoke: observedState === "MISSING",
    },
    "SHARED_CELL_AUTHOR_COMPENSATION_RESULT_INVALID",
  );
}

function deleteStackRecoverySummary(
  candidate: NormalizedCandidate,
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
): Readonly<SharedCellAuthorDeleteStackRecoverySummary> {
  return immutableClone(
    {
      schemaVersion: 1,
      action: "recover_shared_cell_author_delete_stack",
      phase: "DELETE_STACK",
      observedState: "MISSING" as const,
      operationSha256: plan.operationSha256,
      compensationPlanSha256: plan.compensationPlanSha256,
      phasePlanSha256: plan.phasePlanSha256.DELETE_STACK,
      deleteStackClientRequestToken: plan.deleteStackClientRequestToken,
      stackId: candidate.stackId,
      changeSetArn: candidate.changeSet.arn,
      mutationPerformed: false as const,
      safeToRevokePhaseGrant: true as const,
      safeToAuthorRevoke: true as const,
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
    await assertPresentChangeSetEvidence(
      evidence,
      observed,
      candidate,
      signal,
    );
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

function assertApprovedPhasePlan(
  plan: Readonly<SharedCellAuthorCompensationCompiledPlan>,
  phase: SharedCellAuthorCompensationPhase,
  approvedCompensationPlanSha256: string,
  approvedPhasePlanSha256: string,
): void {
  if (plan.compensationPlanSha256 !== approvedCompensationPlanSha256) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PLAN_MISMATCH",
      "Fresh compensation intent does not match the approved base plan digest.",
    );
  }
  if (plan.phasePlanSha256[phase] !== approvedPhasePlanSha256) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_PHASE_PLAN_MISMATCH",
      `Fresh ${phase} intent does not match the approved phase plan digest.`,
    );
  }
}

/**
 * Reads the exact placeholder and distinguishes whether the reviewed Change
 * Set still exists. The returned phase digest is evidence for a later,
 * separately granted DeleteChangeSet operation; this function has no mutation
 * capability.
 */
export async function inspectSharedCellAuthorDeleteChangeSet(
  input: BaseSettings,
): Promise<Readonly<SharedCellAuthorDeleteChangeSetInspectionSummary>> {
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
    "DeleteChangeSet inspect",
  );
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const plan = await compileNormalizedCompensationPlan(candidate);
  const observed = await observeCompensationState(
    evidence,
    authority,
    candidate,
    input.signal,
    false,
    true,
  );
  if (observed === "MISSING") {
    return deleteChangeSetInspectionSummary(
      candidate,
      plan,
      "MISSING",
      "MISSING",
    );
  }
  if (observed === "REVIEW_CHANGE_SET_PRESENT") {
    return deleteChangeSetInspectionSummary(
      candidate,
      plan,
      "REVIEW_IN_PROGRESS",
      "PRESENT",
    );
  }
  if (observed === "REVIEW_CHANGE_SET_MISSING") {
    return deleteChangeSetInspectionSummary(
      candidate,
      plan,
      "REVIEW_IN_PROGRESS",
      "MISSING",
    );
  }
  return fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_INSPECTION_BLOCKED",
    "DeleteChangeSet inspection cannot authorize a mutation while Stack deletion is already in progress.",
    true,
  );
}

/**
 * Authorizes review of the DeleteStack phase only after a fresh exact-ARN
 * Change Set missing proof. A present Change Set is never collapsed into a
 * generic REVIEW_IN_PROGRESS result.
 */
export async function inspectSharedCellAuthorDeleteStack(
  input: BaseSettings,
): Promise<Readonly<SharedCellAuthorDeleteStackInspectionSummary>> {
  assertExactInput(
    input,
    ["authority", "candidate", "evidence", "signal"],
    ["now"],
  );
  const candidate = normalizeCandidate(input.candidate);
  assertGrantWindow(
    candidate,
    input.now,
    deleteStackMinimumRemainingMs,
    "DeleteStack inspect",
  );
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const plan = await compileNormalizedCompensationPlan(candidate);
  const observed = await observeCompensationState(
    evidence,
    authority,
    candidate,
    input.signal,
    false,
    true,
  );
  if (observed === "MISSING") {
    return deleteStackInspectionSummary(candidate, plan, "MISSING");
  }
  if (observed === "REVIEW_CHANGE_SET_MISSING") {
    return deleteStackInspectionSummary(
      candidate,
      plan,
      "REVIEW_IN_PROGRESS",
    );
  }
  fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_DELETE_STACK_REQUIRES_CHANGE_SET_MISSING",
    "DeleteStack inspection requires a fresh exact Change Set NotFound proof.",
  );
}

/**
 * Executes only the exact DeleteChangeSet phase. It never owns a DeleteStack
 * capability and stops after ARN-bound Change Set absence is proven.
 */
export async function executeReviewedSharedCellAuthorDeleteChangeSet(
  input: DeleteChangeSetExecuteSettings,
): Promise<Readonly<SharedCellAuthorDeleteChangeSetSummary>> {
  assertExactInput(
    input,
    [
      "approvedCompensationPlanSha256",
      "approvedPhasePlanSha256",
      "authority",
      "candidate",
      "evidence",
      "mutations",
      "signal",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertDigest(input.approvedCompensationPlanSha256);
  assertDigest(input.approvedPhasePlanSha256);
  const candidate = normalizeCandidate(input.candidate);
  assertGrantWindow(
    candidate,
    input.now,
    deleteChangeSetMinimumRemainingMs,
    "DeleteChangeSet",
  );
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const mutations = pinDeleteChangeSetMutations(input.mutations);
  const bounded = readbackSettings(input);
  const plan = await compileNormalizedCompensationPlan(candidate);
  assertApprovedPhasePlan(
    plan,
    "DELETE_CHANGE_SET",
    input.approvedCompensationPlanSha256,
    input.approvedPhasePlanSha256,
  );

  let submitted = false;
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
      return deleteChangeSetSummary(candidate, plan, "MISSING", false);
    }
    if (state === "DELETE_IN_PROGRESS") {
      await waitForStableStackMissing(
        evidence,
        authority,
        candidate,
        input.signal,
        bounded,
      );
      return deleteChangeSetSummary(candidate, plan, "MISSING", false);
    }
    if (state === "REVIEW_CHANGE_SET_MISSING") {
      return deleteChangeSetSummary(
        candidate,
        plan,
        "REVIEW_IN_PROGRESS",
        false,
      );
    }

    // Re-read the complete placeholder/Change Set/template evidence at the
    // last possible point before this phase's sole mutation.
    state = await observeCompensationState(
      evidence,
      authority,
      candidate,
      input.signal,
      true,
      true,
    );
    if (state === "MISSING") {
      return deleteChangeSetSummary(candidate, plan, "MISSING", false);
    }
    if (state === "DELETE_IN_PROGRESS") {
      await waitForStableStackMissing(
        evidence,
        authority,
        candidate,
        input.signal,
        bounded,
      );
      return deleteChangeSetSummary(candidate, plan, "MISSING", false);
    }
    if (state === "REVIEW_CHANGE_SET_MISSING") {
      return deleteChangeSetSummary(
        candidate,
        plan,
        "REVIEW_IN_PROGRESS",
        false,
      );
    }

    await assertMutationCaller(mutations, input.signal);
    await assertAuthorityAbsent(authority, input.signal);
    assertGrantWindow(
      candidate,
      input.now,
      deleteChangeSetMinimumRemainingMs,
      "DeleteChangeSet",
    );
    requireNotAborted(input.signal);
    submitted = true;
    try {
      await mutations.deleteChangeSet({
        request: {
          ChangeSetName: candidate.changeSet.arn,
          StackName: candidate.stackId,
        },
        signal: input.signal,
      });
      requireNotAborted(input.signal);
    } catch {
      if (input.signal.aborted) {
        fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN",
          "DeleteChangeSet may have been submitted before cancellation; use read-only recovery or a freshly inspected resume plan and never replay blindly.",
          true,
        );
      }
      // A lost response is reconciled below. This phase never resubmits.
    }
    await waitForChangeSetMissing(
      evidence,
      authority,
      candidate,
      input.signal,
      bounded,
    );
    return deleteChangeSetSummary(
      candidate,
      plan,
      "REVIEW_IN_PROGRESS",
      true,
    );
  } catch (error) {
    if (input.signal.aborted && submitted) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_POST_SUBMIT_UNCERTAIN",
        "DeleteChangeSet may have been submitted before cancellation; use read-only recovery or a freshly inspected resume plan and never replay blindly.",
        true,
      );
    }
    throw error;
  }
}

/**
 * Executes only the exact DeleteStack phase. A fresh ARN-bound Change Set
 * NotFound proof is mandatory; this port cannot delete a Change Set.
 */
export async function executeReviewedSharedCellAuthorDeleteStack(
  input: DeleteStackExecuteSettings,
): Promise<Readonly<SharedCellAuthorDeleteStackSummary>> {
  assertExactInput(
    input,
    [
      "approvedCompensationPlanSha256",
      "approvedPhasePlanSha256",
      "authority",
      "candidate",
      "evidence",
      "mutations",
      "signal",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertDigest(input.approvedCompensationPlanSha256);
  assertDigest(input.approvedPhasePlanSha256);
  const candidate = normalizeCandidate(input.candidate);
  assertGrantWindow(
    candidate,
    input.now,
    deleteStackMinimumRemainingMs,
    "DeleteStack",
  );
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const mutations = pinDeleteStackMutations(input.mutations);
  const bounded = readbackSettings(input);
  const plan = await compileNormalizedCompensationPlan(candidate);
  assertApprovedPhasePlan(
    plan,
    "DELETE_STACK",
    input.approvedCompensationPlanSha256,
    input.approvedPhasePlanSha256,
  );

  let submitted = false;
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
      return deleteStackSummary(candidate, plan, "MISSING", false);
    }
    if (state === "DELETE_IN_PROGRESS") {
      await waitForStableStackMissing(
        evidence,
        authority,
        candidate,
        input.signal,
        bounded,
      );
      return deleteStackSummary(candidate, plan, "MISSING", false);
    }
    if (state !== "REVIEW_CHANGE_SET_MISSING") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_DELETE_STACK_REQUIRES_CHANGE_SET_MISSING",
        "DeleteStack requires a fresh exact Change Set NotFound proof.",
      );
    }

    // Re-read immediately before this phase's sole mutation. A reappearing
    // Change Set fails closed; this narrow port cannot remove it.
    state = await observeCompensationState(
      evidence,
      authority,
      candidate,
      input.signal,
      true,
      true,
    );
    if (state === "MISSING") {
      return deleteStackSummary(candidate, plan, "MISSING", false);
    }
    if (state === "DELETE_IN_PROGRESS") {
      await waitForStableStackMissing(
        evidence,
        authority,
        candidate,
        input.signal,
        bounded,
      );
      return deleteStackSummary(candidate, plan, "MISSING", false);
    }
    if (state !== "REVIEW_CHANGE_SET_MISSING") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_DELETE_STACK_REQUIRES_CHANGE_SET_MISSING",
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
    submitted = true;
    try {
      await mutations.deleteStack({
        request: {
          StackName: candidate.stackId,
          DeletionMode: "STANDARD",
          ClientRequestToken: plan.deleteStackClientRequestToken,
        },
        signal: input.signal,
      });
      requireNotAborted(input.signal);
    } catch {
      if (input.signal.aborted) {
        fail(
          "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN",
          "DeleteStack may have been submitted before cancellation; use read-only Recover and never replay blindly.",
          true,
        );
      }
      // A lost response is reconciled below. This phase never resubmits.
    }
    await waitForStableStackMissing(
      evidence,
      authority,
      candidate,
      input.signal,
      bounded,
    );
    return deleteStackSummary(candidate, plan, "MISSING", true);
  } catch (error) {
    if (input.signal.aborted && submitted) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_STACK_POST_SUBMIT_UNCERTAIN",
        "DeleteStack may have been submitted before cancellation; use read-only Recover and never replay blindly.",
        true,
      );
    }
    throw error;
  }
}

/**
 * Reconciles a possibly submitted DeleteChangeSet without accepting any
 * mutation capability. Exact Change Set absence while the reviewed placeholder
 * remains is a completed first phase and requires a separately reviewed
 * DeleteStack phase after the temporary grant is revoked.
 */
export async function recoverReviewedSharedCellAuthorDeleteChangeSet(
  input: PhaseRecoverSettings,
): Promise<Readonly<SharedCellAuthorDeleteChangeSetRecoverySummary>> {
  assertExactInput(
    input,
    [
      "approvedCompensationPlanSha256",
      "approvedPhasePlanSha256",
      "authority",
      "candidate",
      "evidence",
      "signal",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertDigest(input.approvedCompensationPlanSha256);
  assertDigest(input.approvedPhasePlanSha256);
  const candidate = normalizeCandidate(input.candidate);
  if (input.now !== undefined) readClock(input.now);
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const bounded = readbackSettings(input);
  const plan = await compileNormalizedCompensationPlan(candidate);
  assertApprovedPhasePlan(
    plan,
    "DELETE_CHANGE_SET",
    input.approvedCompensationPlanSha256,
    input.approvedPhasePlanSha256,
  );
  const observed = await observeCompensationState(
    evidence,
    authority,
    candidate,
    input.signal,
    true,
    true,
  );
  if (observed === "MISSING") {
    return deleteChangeSetRecoverySummary(candidate, plan, "MISSING");
  }
  if (observed === "DELETE_IN_PROGRESS") {
    await waitForStableStackMissing(
      evidence,
      authority,
      candidate,
      input.signal,
      bounded,
    );
    return deleteChangeSetRecoverySummary(candidate, plan, "MISSING");
  }
  if (observed === "REVIEW_CHANGE_SET_MISSING") {
    return deleteChangeSetRecoverySummary(
      candidate,
      plan,
      "REVIEW_IN_PROGRESS",
    );
  }
  fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_CHANGE_SET_RECOVERY_BLOCKED",
    "The exact Change Set is still present. DeleteChangeSet recovery is read-only and will never resubmit it.",
    true,
  );
}

/**
 * Reconciles a possibly submitted DeleteStack without accepting any mutation
 * capability. Only stable full absence is a successful recovery outcome.
 */
export async function recoverReviewedSharedCellAuthorDeleteStack(
  input: PhaseRecoverSettings,
): Promise<Readonly<SharedCellAuthorDeleteStackRecoverySummary>> {
  assertExactInput(
    input,
    [
      "approvedCompensationPlanSha256",
      "approvedPhasePlanSha256",
      "authority",
      "candidate",
      "evidence",
      "signal",
    ],
    ["now", "readbackAttempts", "readbackDelayMs", "wait"],
  );
  assertDigest(input.approvedCompensationPlanSha256);
  assertDigest(input.approvedPhasePlanSha256);
  const candidate = normalizeCandidate(input.candidate);
  if (input.now !== undefined) readClock(input.now);
  const evidence = pinEvidence(input.evidence);
  const authority = pinAuthority(input.authority);
  const bounded = readbackSettings(input);
  const plan = await compileNormalizedCompensationPlan(candidate);
  assertApprovedPhasePlan(
    plan,
    "DELETE_STACK",
    input.approvedCompensationPlanSha256,
    input.approvedPhasePlanSha256,
  );
  const observed = await observeCompensationState(
    evidence,
    authority,
    candidate,
    input.signal,
    true,
    true,
  );
  if (observed === "DELETE_IN_PROGRESS") {
    await waitForStableStackMissing(
      evidence,
      authority,
      candidate,
      input.signal,
      bounded,
    );
    return deleteStackRecoverySummary(candidate, plan);
  }
  if (observed === "MISSING") {
    return deleteStackRecoverySummary(candidate, plan);
  }
  fail(
    "SHARED_CELL_AUTHOR_COMPENSATION_STACK_RECOVERY_BLOCKED",
    "The exact Stack is still present. DeleteStack recovery is read-only and will never resubmit it.",
    true,
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
