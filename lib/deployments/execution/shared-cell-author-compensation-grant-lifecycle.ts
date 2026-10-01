import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID,
  SHARED_CELL_AUTHOR_COMPENSATION_REGION,
  type SharedCellAuthorCompensationPhase,
} from "./shared-cell-author-compensation.ts";
import {
  SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS,
  assertSharedCellAuthorCompensationDigest,
  assertSharedCellAuthorCompensationLockedReceipt,
  assertSharedCellAuthorCompensationPhaseCompletionReceipt,
  assertSharedCellAuthorCompensationPhaseGrantReceipt,
  sharedCellAuthorCompensationReceiptSha256,
  type SharedCellAuthorCompensationLockedReceipt,
  type SharedCellAuthorCompensationPhaseCompletionReceipt,
  type SharedCellAuthorCompensationPhaseGrantReceipt,
  type SharedCellAuthorCompensationWindowExpiredLockedReceipt,
} from "./shared-cell-author-compensation-operation-store.ts";

export const SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_DEFAULT_ENABLED =
  false as const;

export const SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_CALLER_ARN =
  "arn:aws:iam::402010193138:user/techlong-sandbox-dev" as const;
export const SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME =
  "techlong-s3-b5-cell-lifecycle-management" as const;
export const SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID =
  "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d" as const;

const operatorBoundaryName = "TechlongSandboxCellOperatorBoundary";
const operatorRoleName = "TechlongSandboxCellOperatorRole";
const executionBoundaryName =
  "TechlongSandboxCellCloudFormationExecutionBoundary";
const executionRoleName = "TechlongSandboxCellCloudFormationExecutionRole";
const operatorBoundaryArn =
  `arn:aws:iam::${SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID}:policy/${operatorBoundaryName}`;
const operatorRoleArn =
  `arn:aws:iam::${SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID}:role/${operatorRoleName}`;
const executionBoundaryArn =
  `arn:aws:iam::${SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID}:policy/${executionBoundaryName}`;
const executionRoleArn =
  `arn:aws:iam::${SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID}:role/${executionRoleName}`;

const digestPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^v[1-9][0-9]*$/;
const canonicalUtcPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const maximumObservationSpanMs = 30_000;

const phaseGrantShape = Object.freeze({
  DELETE_CHANGE_SET: "AuthorCompensationDeleteChangeSetGrant",
  DELETE_STACK: "AuthorCompensationDeleteStackGrant",
} as const);

export type SharedCellAuthorCompensationGrantRendererShape =
  (typeof phaseGrantShape)[SharedCellAuthorCompensationPhase];
export type SharedCellAuthorCompensationLifecycleRendererShape =
  | SharedCellAuthorCompensationGrantRendererShape
  | "Locked";

const managementResources = Object.freeze([
  Object.freeze({
    logicalId: "CellOperatorBoundary",
    resourceType: "AWS::IAM::ManagedPolicy",
    physicalResourceId: operatorBoundaryArn,
  }),
  Object.freeze({
    logicalId: "CellOperatorRole",
    resourceType: "AWS::IAM::Role",
    physicalResourceId: operatorRoleName,
  }),
  Object.freeze({
    logicalId: "CellCloudFormationExecutionBoundary",
    resourceType: "AWS::IAM::ManagedPolicy",
    physicalResourceId: executionBoundaryArn,
  }),
  Object.freeze({
    logicalId: "CellCloudFormationExecutionRole",
    resourceType: "AWS::IAM::Role",
    physicalResourceId: executionRoleName,
  }),
] as const);

const safetyState = Object.freeze({
  Locked:
    "LOCKED_IAM_MANAGEMENT_ROOT_APPLY_ENABLED_EXECUTION_NOT_APPROVED_NO_PAID_CELL",
  AuthorCompensationDeleteChangeSetGrant:
    "OFFLINE_ONLY_AUTHORCOMPENSATIONDELETECHANGESETGRANT_NOT_APPLY_ENABLED_NO_PAID_CELL_APPROVAL",
  AuthorCompensationDeleteStackGrant:
    "OFFLINE_ONLY_AUTHORCOMPENSATIONDELETESTACKGRANT_NOT_APPLY_ENABLED_NO_PAID_CELL_APPROVAL",
} as const);

export class SharedCellAuthorCompensationGrantLifecycleError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new SharedCellAuthorCompensationGrantLifecycleError(
    code,
    message,
    retryable,
  );
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

function immutable<T>(value: T): Readonly<T> {
  return Object.freeze(JSON.parse(canonicalJson(value)) as T);
}

function canonicalInstant(value: unknown, label: string): number {
  if (typeof value !== "string" || !canonicalUtcPattern.test(value)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
      `${label} must be a real canonical UTC instant.`,
    );
  }
  return parsed;
}

function assertPhase(
  value: unknown,
): asserts value is SharedCellAuthorCompensationPhase {
  if (value !== "DELETE_CHANGE_SET" && value !== "DELETE_STACK") {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
      "The lifecycle phase is invalid.",
    );
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
      `${label} is invalid.`,
    );
  }
}

export interface SharedCellAuthorCompensationManagementResourceObservation {
  readonly logicalId: string;
  readonly resourceType: "AWS::IAM::ManagedPolicy" | "AWS::IAM::Role";
  readonly physicalResourceId: string;
  readonly resourceStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
}

export interface SharedCellAuthorCompensationManagementPolicyObservation {
  readonly logicalId:
    | "CellOperatorBoundary"
    | "CellCloudFormationExecutionBoundary";
  readonly arn: string;
  readonly name: string;
  readonly defaultVersionId: string;
  readonly versionIds: readonly string[];
  readonly defaultDocumentSha256: string;
  readonly attachmentCount: number;
  readonly permissionsBoundaryUsageCount: 1;
  readonly identityRoleArns: readonly string[];
  readonly boundaryRoleArns: readonly string[];
}

export interface SharedCellAuthorCompensationManagementRoleObservation {
  readonly logicalId: "CellOperatorRole" | "CellCloudFormationExecutionRole";
  readonly arn: string;
  readonly name: string;
  readonly permissionsBoundaryArn: string;
  readonly attachedPolicyArns: readonly string[];
  readonly inlinePolicyNames: readonly string[];
  readonly trustPolicySha256: string;
}

export interface SharedCellAuthorCompensationManagementObservation {
  readonly schemaVersion: 1;
  readonly accountId: typeof SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID;
  readonly region: typeof SHARED_CELL_AUTHOR_COMPENSATION_REGION;
  readonly callerArn: typeof SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_CALLER_ARN;
  readonly rendererShape: SharedCellAuthorCompensationLifecycleRendererShape;
  readonly stack: Readonly<{
    name: typeof SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME;
    id: typeof SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID;
    status: "UPDATE_COMPLETE";
    roleArn: null;
    parentId: null;
    rootId: null;
    terminationProtection: false;
    templateRawSha256: string;
    templateCanonicalSha256: string;
    safetyState: string;
    resources: readonly SharedCellAuthorCompensationManagementResourceObservation[];
  }>;
  readonly policies: readonly SharedCellAuthorCompensationManagementPolicyObservation[];
  readonly roles: readonly SharedCellAuthorCompensationManagementRoleObservation[];
  readonly cellStackState: "MISSING";
  readonly authorityState: "ABSENT";
  readonly observedAt: string;
}

export interface SharedCellAuthorCompensationManagementReadPort {
  readManagementObservation(input: {
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface SharedCellAuthorCompensationLifecycleContractInput {
  readonly schemaVersion: 1;
  readonly operationSha256: string;
  readonly phase: SharedCellAuthorCompensationPhase;
  readonly windowNumber: number;
  readonly compensationPlanSha256: string;
  readonly phasePlanSha256: string;
  readonly controllerContractSha256: string;
  readonly reviewedAt: string;
  readonly expiresAt: string;
  readonly rendererShape: SharedCellAuthorCompensationLifecycleRendererShape;
  readonly templateRawSha256: string;
  readonly templateCanonicalSha256: string;
  readonly operatorBoundaryDocumentSha256: string;
  readonly executionBoundaryDocumentSha256: string;
  readonly operatorTrustPolicySha256: string;
  readonly executionTrustPolicySha256: string;
}

export interface SharedCellAuthorCompensationLifecycleContract
  extends SharedCellAuthorCompensationLifecycleContractInput {
  readonly lifecycleContractSha256: string;
}

function assertLifecycleContractInput(
  input: SharedCellAuthorCompensationLifecycleContractInput,
): void {
  if (
    !exactKeys(input, [
      "compensationPlanSha256",
      "controllerContractSha256",
      "executionBoundaryDocumentSha256",
      "executionTrustPolicySha256",
      "expiresAt",
      "operationSha256",
      "operatorBoundaryDocumentSha256",
      "operatorTrustPolicySha256",
      "phase",
      "phasePlanSha256",
      "rendererShape",
      "reviewedAt",
      "schemaVersion",
      "templateCanonicalSha256",
      "templateRawSha256",
      "windowNumber",
    ]) ||
    input.schemaVersion !== 1 ||
    !Number.isSafeInteger(input.windowNumber) ||
    input.windowNumber < 1
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
      "The lifecycle contract has missing or unexpected fields.",
    );
  }
  assertPhase(input.phase);
  for (const [value, label] of [
    [input.operationSha256, "operation"],
    [input.compensationPlanSha256, "compensation plan"],
    [input.phasePlanSha256, "phase plan"],
    [input.controllerContractSha256, "controller contract"],
    [input.templateRawSha256, "template raw"],
    [input.templateCanonicalSha256, "template canonical"],
    [input.operatorBoundaryDocumentSha256, "operator boundary"],
    [input.executionBoundaryDocumentSha256, "execution boundary"],
    [input.operatorTrustPolicySha256, "operator trust"],
    [input.executionTrustPolicySha256, "execution trust"],
  ] as const) {
    assertSharedCellAuthorCompensationDigest(value, label);
  }
  const reviewedAt = canonicalInstant(input.reviewedAt, "reviewedAt");
  const expiresAt = canonicalInstant(input.expiresAt, "expiresAt");
  if (expiresAt <= reviewedAt || expiresAt - reviewedAt > 60 * 60_000) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
      "The lifecycle review window is invalid.",
    );
  }
  if (
    input.rendererShape !== "Locked" &&
    input.rendererShape !== phaseGrantShape[input.phase]
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
      "The lifecycle renderer shape is not valid for the phase.",
    );
  }
}

export async function compileSharedCellAuthorCompensationLifecycleContract(
  input: SharedCellAuthorCompensationLifecycleContractInput,
): Promise<Readonly<SharedCellAuthorCompensationLifecycleContract>> {
  assertLifecycleContractInput(input);
  const body = immutable(input);
  return immutable({
    ...body,
    lifecycleContractSha256: await sha256Hex(canonicalJson(body)),
  });
}

function validateResources(value: unknown): void {
  if (!Array.isArray(value) || value.length !== managementResources.length) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
      "The management Stack inventory is incomplete.",
    );
  }
  const normalized = value.map((entry) => {
    const source = record(entry);
    if (
      !exactKeys(source, [
        "logicalId",
        "physicalResourceId",
        "resourceStatus",
        "resourceType",
      ]) ||
      (source.resourceStatus !== "CREATE_COMPLETE" &&
        source.resourceStatus !== "UPDATE_COMPLETE")
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
        "A management Stack resource is invalid.",
      );
    }
    return {
      logicalId: source.logicalId,
      resourceType: source.resourceType,
      physicalResourceId: source.physicalResourceId,
    };
  });
  if (canonicalJson(normalized) !== canonicalJson(managementResources)) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
      "The management Stack resource identities drifted.",
    );
  }
}

function validatePolicies(
  value: unknown,
  contract: SharedCellAuthorCompensationLifecycleContract,
): void {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
      "The management policy evidence is incomplete.",
    );
  }
  const expected = [
    {
      logicalId: "CellOperatorBoundary",
      arn: operatorBoundaryArn,
      name: operatorBoundaryName,
      documentSha256: contract.operatorBoundaryDocumentSha256,
      attachmentCount: 1,
      identityRoleArns: [operatorRoleArn],
      boundaryRoleArns: [operatorRoleArn],
      historicalVersionsAllowed: true,
    },
    {
      logicalId: "CellCloudFormationExecutionBoundary",
      arn: executionBoundaryArn,
      name: executionBoundaryName,
      documentSha256: contract.executionBoundaryDocumentSha256,
      attachmentCount: 0,
      identityRoleArns: [],
      boundaryRoleArns: [executionRoleArn],
      historicalVersionsAllowed: false,
    },
  ] as const;
  value.forEach((entry, index) => {
    const source = record(entry);
    const target = expected[index];
    if (
      !target ||
      !exactKeys(source, [
        "arn",
        "attachmentCount",
        "boundaryRoleArns",
        "defaultDocumentSha256",
        "defaultVersionId",
        "identityRoleArns",
        "logicalId",
        "name",
        "permissionsBoundaryUsageCount",
        "versionIds",
      ])
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
        "A management policy observation is invalid.",
      );
    }
    assertStringArray(source.versionIds, "Managed policy versions");
    assertStringArray(source.identityRoleArns, "Managed policy identity roles");
    assertStringArray(source.boundaryRoleArns, "Managed policy boundary roles");
    const versions = source.versionIds as string[];
    if (
      source.logicalId !== target.logicalId ||
      source.arn !== target.arn ||
      source.name !== target.name ||
      source.defaultDocumentSha256 !== target.documentSha256 ||
      source.attachmentCount !== target.attachmentCount ||
      source.permissionsBoundaryUsageCount !== 1 ||
      !versionPattern.test(String(source.defaultVersionId)) ||
      versions.length < 1 ||
      versions.length > 5 ||
      new Set(versions).size !== versions.length ||
      versions.some((version) => !versionPattern.test(version)) ||
      !versions.includes(String(source.defaultVersionId)) ||
      (!target.historicalVersionsAllowed && versions.length !== 1) ||
      canonicalJson(source.identityRoleArns) !==
        canonicalJson(target.identityRoleArns) ||
      canonicalJson(source.boundaryRoleArns) !==
        canonicalJson(target.boundaryRoleArns)
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
        "A management policy identity or version drifted.",
      );
    }
  });
}

function validateRoles(
  value: unknown,
  contract: SharedCellAuthorCompensationLifecycleContract,
): void {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
      "The management role evidence is incomplete.",
    );
  }
  const expected = [
    {
      logicalId: "CellOperatorRole",
      arn: operatorRoleArn,
      name: operatorRoleName,
      boundaryArn: operatorBoundaryArn,
      attachedPolicyArns: [operatorBoundaryArn],
      trustPolicySha256: contract.operatorTrustPolicySha256,
    },
    {
      logicalId: "CellCloudFormationExecutionRole",
      arn: executionRoleArn,
      name: executionRoleName,
      boundaryArn: executionBoundaryArn,
      attachedPolicyArns: [],
      trustPolicySha256: contract.executionTrustPolicySha256,
    },
  ] as const;
  value.forEach((entry, index) => {
    const source = record(entry);
    const target = expected[index];
    if (
      !target ||
      !exactKeys(source, [
        "arn",
        "attachedPolicyArns",
        "inlinePolicyNames",
        "logicalId",
        "name",
        "permissionsBoundaryArn",
        "trustPolicySha256",
      ])
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
        "A management role observation is invalid.",
      );
    }
    assertStringArray(source.attachedPolicyArns, "Role attached policies");
    assertStringArray(source.inlinePolicyNames, "Role inline policies");
    if (
      source.logicalId !== target.logicalId ||
      source.arn !== target.arn ||
      source.name !== target.name ||
      source.permissionsBoundaryArn !== target.boundaryArn ||
      source.trustPolicySha256 !== target.trustPolicySha256 ||
      canonicalJson(source.attachedPolicyArns) !==
        canonicalJson(target.attachedPolicyArns) ||
      (source.inlinePolicyNames as string[]).length !== 0
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
        "A management role identity, boundary, trust, or policy set drifted.",
      );
    }
  });
}

function validateObservation(
  value: unknown,
  contract: SharedCellAuthorCompensationLifecycleContract,
): Readonly<SharedCellAuthorCompensationManagementObservation> {
  const source = record(value);
  if (
    !exactKeys(source, [
      "accountId",
      "authorityState",
      "callerArn",
      "cellStackState",
      "observedAt",
      "policies",
      "region",
      "rendererShape",
      "roles",
      "schemaVersion",
      "stack",
    ]) ||
    source.schemaVersion !== 1 ||
    source.accountId !== SHARED_CELL_AUTHOR_COMPENSATION_ACCOUNT_ID ||
    source.region !== SHARED_CELL_AUTHOR_COMPENSATION_REGION ||
    source.callerArn !== SHARED_CELL_AUTHOR_COMPENSATION_SOURCE_CALLER_ARN ||
    source.rendererShape !== contract.rendererShape ||
    source.cellStackState !== "MISSING" ||
    source.authorityState !== "ABSENT"
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
      "The management observation identity or safety fence drifted.",
    );
  }
  canonicalInstant(source.observedAt, "observation observedAt");
  const stack = record(source.stack);
  if (
    !exactKeys(stack, [
      "id",
      "name",
      "parentId",
      "resources",
      "roleArn",
      "rootId",
      "safetyState",
      "status",
      "templateCanonicalSha256",
      "templateRawSha256",
      "terminationProtection",
    ]) ||
    stack.name !== SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_NAME ||
    stack.id !== SHARED_CELL_AUTHOR_COMPENSATION_MANAGEMENT_STACK_ID ||
    stack.status !== "UPDATE_COMPLETE" ||
    stack.roleArn !== null ||
    stack.parentId !== null ||
    stack.rootId !== null ||
    stack.terminationProtection !== false ||
    stack.templateRawSha256 !== contract.templateRawSha256 ||
    stack.templateCanonicalSha256 !== contract.templateCanonicalSha256 ||
    stack.safetyState !== safetyState[contract.rendererShape]
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_INVALID",
      "The management Stack or Original template drifted.",
    );
  }
  validateResources(stack.resources);
  validatePolicies(source.policies, contract);
  validateRoles(source.roles, contract);
  return immutable(source) as unknown as Readonly<SharedCellAuthorCompensationManagementObservation>;
}

export interface VerifiedSharedCellAuthorCompensationLifecycleEvidence {
  readonly schemaVersion: 1;
  readonly lifecycleContractSha256: string;
  readonly rendererShape: SharedCellAuthorCompensationLifecycleRendererShape;
  readonly firstObservedAt: string;
  readonly observedAt: string;
  readonly evidenceSha256: string;
}

const verifiedEvidence = new WeakSet<object>();

function withoutObservedAt(
  value: SharedCellAuthorCompensationManagementObservation,
): unknown {
  const clone = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  delete clone.observedAt;
  return clone;
}

function assertVerifiedEvidence(
  evidence: VerifiedSharedCellAuthorCompensationLifecycleEvidence,
  contract: SharedCellAuthorCompensationLifecycleContract,
): void {
  if (
    !verifiedEvidence.has(evidence as object) ||
    !exactKeys(evidence, [
      "evidenceSha256",
      "firstObservedAt",
      "lifecycleContractSha256",
      "observedAt",
      "rendererShape",
      "schemaVersion",
    ]) ||
    evidence.schemaVersion !== 1 ||
    evidence.lifecycleContractSha256 !== contract.lifecycleContractSha256 ||
    evidence.rendererShape !== contract.rendererShape ||
    !digestPattern.test(evidence.evidenceSha256)
  ) {
    fail(
      "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_UNTRUSTED",
      "The management lifecycle evidence was not produced by this verifier.",
    );
  }
}

export class SharedCellAuthorCompensationLifecycleReceiptProducer {
  private readonly readPort: SharedCellAuthorCompensationManagementReadPort;

  constructor(readPort: SharedCellAuthorCompensationManagementReadPort) {
    if (
      !readPort ||
      typeof readPort !== "object" ||
      typeof readPort.readManagementObservation !== "function"
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
        "The management lifecycle read port is invalid.",
      );
    }
    this.readPort = readPort;
  }

  async reviewTarget(input: {
    contract: SharedCellAuthorCompensationLifecycleContract;
    signal: AbortSignal;
  }): Promise<Readonly<VerifiedSharedCellAuthorCompensationLifecycleEvidence>> {
    if (!exactKeys(input, ["contract", "signal"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
        "The lifecycle review input is invalid.",
      );
    }
    input.signal.throwIfAborted();
    const contractBody = Object.fromEntries(
      Object.entries(input.contract).filter(
        ([key]) => key !== "lifecycleContractSha256",
      ),
    ) as unknown as SharedCellAuthorCompensationLifecycleContractInput;
    assertLifecycleContractInput(contractBody);
    const expectedContractSha256 = await sha256Hex(
      canonicalJson(contractBody),
    );
    if (
      !exactKeys(input.contract, [
        "compensationPlanSha256",
        "controllerContractSha256",
        "executionBoundaryDocumentSha256",
        "executionTrustPolicySha256",
        "expiresAt",
        "lifecycleContractSha256",
        "operationSha256",
        "operatorBoundaryDocumentSha256",
        "operatorTrustPolicySha256",
        "phase",
        "phasePlanSha256",
        "rendererShape",
        "reviewedAt",
        "schemaVersion",
        "templateCanonicalSha256",
        "templateRawSha256",
        "windowNumber",
      ]) ||
      input.contract.lifecycleContractSha256 !== expectedContractSha256
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_CONTRACT_MISMATCH",
        "The lifecycle contract digest is invalid.",
      );
    }
    const first = validateObservation(
      await this.readPort.readManagementObservation({ signal: input.signal }),
      input.contract,
    );
    input.signal.throwIfAborted();
    const second = validateObservation(
      await this.readPort.readManagementObservation({ signal: input.signal }),
      input.contract,
    );
    const firstAt = canonicalInstant(first.observedAt, "first observedAt");
    const secondAt = canonicalInstant(second.observedAt, "second observedAt");
    if (
      secondAt <= firstAt ||
      secondAt - firstAt > maximumObservationSpanMs ||
      canonicalJson(withoutObservedAt(first)) !==
        canonicalJson(withoutObservedAt(second))
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_EVIDENCE_UNSTABLE",
        "Two independent management observations did not prove one stable target.",
        true,
      );
    }
    const body = {
      schemaVersion: 1 as const,
      lifecycleContractSha256: input.contract.lifecycleContractSha256,
      rendererShape: input.contract.rendererShape,
      firstObservedAt: first.observedAt,
      observedAt: second.observedAt,
      observations: [first, second],
    };
    const evidence = immutable({
      schemaVersion: 1 as const,
      lifecycleContractSha256: input.contract.lifecycleContractSha256,
      rendererShape: input.contract.rendererShape,
      firstObservedAt: first.observedAt,
      observedAt: second.observedAt,
      evidenceSha256: await sha256Hex(canonicalJson(body)),
    });
    verifiedEvidence.add(evidence as object);
    return evidence;
  }

  async createPhaseGrantReceipt(input: {
    contract: SharedCellAuthorCompensationLifecycleContract;
    evidence: VerifiedSharedCellAuthorCompensationLifecycleEvidence;
  }): Promise<Readonly<SharedCellAuthorCompensationPhaseGrantReceipt>> {
    if (!exactKeys(input, ["contract", "evidence"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
        "The phase grant receipt input is invalid.",
      );
    }
    if (input.contract.rendererShape !== phaseGrantShape[input.contract.phase]) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_SHAPE_MISMATCH",
        "A phase grant receipt requires the exact phase grant renderer shape.",
      );
    }
    assertVerifiedEvidence(input.evidence, input.contract);
    const observedAt = canonicalInstant(
      input.evidence.observedAt,
      "grant observedAt",
    );
    const reviewedAt = canonicalInstant(input.contract.reviewedAt, "reviewedAt");
    const expiresAt = canonicalInstant(input.contract.expiresAt, "expiresAt");
    if (observedAt < reviewedAt) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_WINDOW_CLOSED",
        "The verified phase grant predates its reviewed window.",
      );
    }
    const disposition =
      expiresAt - observedAt >
      SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[input.contract.phase]
        ? ("PHASE_EXECUTION_ALLOWED" as const)
        : ("REVOKE_ONLY" as const);
    const receipt = immutable({
      schemaVersion: 1 as const,
      action: "shared_cell_author_compensation_phase_grant_verified" as const,
      disposition,
      operationSha256: input.contract.operationSha256,
      phase: input.contract.phase,
      compensationPlanSha256: input.contract.compensationPlanSha256,
      phasePlanSha256: input.contract.phasePlanSha256,
      controllerContractSha256: input.contract.controllerContractSha256,
      grantEvidenceSha256: input.evidence.evidenceSha256,
      observedAt: input.evidence.observedAt,
    });
    assertSharedCellAuthorCompensationPhaseGrantReceipt(receipt);
    return receipt;
  }

  async createPhaseCompletedLockedReceipt(input: {
    contract: SharedCellAuthorCompensationLifecycleContract;
    evidence: VerifiedSharedCellAuthorCompensationLifecycleEvidence;
    completionReceipt: SharedCellAuthorCompensationPhaseCompletionReceipt;
  }): Promise<Readonly<SharedCellAuthorCompensationLockedReceipt>> {
    if (!exactKeys(input, ["completionReceipt", "contract", "evidence"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
        "The completed-phase Locked receipt input is invalid.",
      );
    }
    if (input.contract.rendererShape !== "Locked") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_SHAPE_MISMATCH",
        "A Locked receipt requires the exact Locked renderer shape.",
      );
    }
    assertVerifiedEvidence(input.evidence, input.contract);
    assertSharedCellAuthorCompensationPhaseCompletionReceipt(
      input.completionReceipt,
    );
    if (
      input.completionReceipt.operationSha256 !== input.contract.operationSha256 ||
      input.completionReceipt.phase !== input.contract.phase ||
      input.completionReceipt.compensationPlanSha256 !==
        input.contract.compensationPlanSha256 ||
      input.completionReceipt.phasePlanSha256 !==
        input.contract.phasePlanSha256 ||
      input.completionReceipt.controllerContractSha256 !==
        input.contract.controllerContractSha256 ||
      canonicalInstant(input.evidence.observedAt, "Locked observedAt") <=
        canonicalInstant(input.completionReceipt.observedAt, "completion observedAt")
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_RECEIPT_MISMATCH",
        "The phase completion receipt is not the predecessor of this Locked proof.",
      );
    }
    const receipt = immutable({
      schemaVersion: 1 as const,
      action: "shared_cell_author_compensation_locked_verified" as const,
      operationSha256: input.contract.operationSha256,
      phase: input.contract.phase,
      completionReceiptSha256:
        await sharedCellAuthorCompensationReceiptSha256(input.completionReceipt),
      lockedEvidenceSha256: input.evidence.evidenceSha256,
      observedAt: input.evidence.observedAt,
    });
    assertSharedCellAuthorCompensationLockedReceipt(receipt);
    return receipt;
  }

  async createWindowExpiredLockedReceipt(input: {
    contract: SharedCellAuthorCompensationLifecycleContract;
    evidence: VerifiedSharedCellAuthorCompensationLifecycleEvidence;
    grantReceipt: SharedCellAuthorCompensationPhaseGrantReceipt;
  }): Promise<Readonly<SharedCellAuthorCompensationWindowExpiredLockedReceipt>> {
    if (!exactKeys(input, ["contract", "evidence", "grantReceipt"])) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_INVALID",
        "The expired-window Locked receipt input is invalid.",
      );
    }
    if (input.contract.rendererShape !== "Locked") {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_SHAPE_MISMATCH",
        "An expired-window Locked receipt requires the exact Locked renderer shape.",
      );
    }
    assertVerifiedEvidence(input.evidence, input.contract);
    assertSharedCellAuthorCompensationPhaseGrantReceipt(input.grantReceipt);
    if (
      input.grantReceipt.operationSha256 !== input.contract.operationSha256 ||
      input.grantReceipt.phase !== input.contract.phase ||
      input.grantReceipt.compensationPlanSha256 !==
        input.contract.compensationPlanSha256 ||
      input.grantReceipt.phasePlanSha256 !== input.contract.phasePlanSha256 ||
      input.grantReceipt.controllerContractSha256 !==
        input.contract.controllerContractSha256
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_RECEIPT_MISMATCH",
        "The verified grant receipt is not bound to this expired review window.",
      );
    }
    const observedAt = canonicalInstant(
      input.evidence.observedAt,
      "Locked observedAt",
    );
    const cutoff =
      canonicalInstant(input.contract.expiresAt, "expiresAt") -
      SHARED_CELL_AUTHOR_COMPENSATION_PHASE_MARGIN_MS[input.contract.phase];
    if (
      observedAt <= canonicalInstant(input.grantReceipt.observedAt, "grant observedAt") ||
      observedAt < cutoff
    ) {
      fail(
        "SHARED_CELL_AUTHOR_COMPENSATION_GRANT_LIFECYCLE_WINDOW_OPEN",
        "The ready grant cannot be closed as expired before its phase cutoff.",
      );
    }
    const receipt = immutable({
      schemaVersion: 1 as const,
      action:
        "shared_cell_author_compensation_window_expired_locked_verified" as const,
      operationSha256: input.contract.operationSha256,
      phase: input.contract.phase,
      grantReceiptSha256:
        await sharedCellAuthorCompensationReceiptSha256(input.grantReceipt),
      lockedEvidenceSha256: input.evidence.evidenceSha256,
      observedAt: input.evidence.observedAt,
    });
    return receipt;
  }
}
