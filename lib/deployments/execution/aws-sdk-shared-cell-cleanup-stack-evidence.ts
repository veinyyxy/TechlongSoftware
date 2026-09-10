import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  SharedCellCleanupStackEvidencePort,
  type ReadSharedCellCleanupEvidenceInput,
  type VerifiedSharedCellCleanupStackEvidence,
} from "./shared-cell-cleanup-authority-operator.ts";
import {
  sharedCellAuthorityMarker,
  sharedCellProvisionOperationIntent,
  type SharedCellProvisionAuthorityRecord,
} from "./shared-cell-cleanup-authority.ts";

const accountId = "402010193138";
const region = "ca-central-1";
const cellId = "cell-sandbox-1";
const stackName = "techlong-sandbox-cell-sandbox-1";
const cloudFormationRoleArn =
  "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
const cleanupReviewerArn =
  "arn:aws:sts::402010193138:assumed-role/" +
  "TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator";
const profile = "techlong-sandbox-cell-operator";
const mfaDeviceArn =
  "arn:aws:iam::402010193138:mfa/techlong-sandbox-dev";
const maximumEvidenceAgeMs = 30_000;
const maximumPages = 100;
const digestPattern = /^[a-f0-9]{64}$/;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface AwsReadOnlySdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsReadOnlyCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

type AwsReadOnlySdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => AwsReadOnlySdkClient;
type AwsCredentialProvider = () => Promise<Record<string, unknown>>;
type MfaCodeProvider = (mfaSerial: string) => Promise<string>;

export interface AwsSdkSharedCellCleanupStackEvidenceRuntimeInput {
  mfaCodeProvider: MfaCodeProvider;
}

export interface AwsSdkSharedCellCleanupStackEvidenceRuntimeModules {
  sts: Record<string, unknown>;
  cloudFormation: Record<string, unknown>;
  credentialProvider: Record<string, unknown>;
}

export interface AwsSdkSharedCellCleanupStackEvidenceDependencies {
  clients: {
    sts: AwsReadOnlySdkClient;
    cloudFormation: AwsReadOnlySdkClient;
  };
  commands: {
    getCallerIdentity: AwsReadOnlyCommandConstructor;
    describeStacks: AwsReadOnlyCommandConstructor;
    getTemplate: AwsReadOnlyCommandConstructor;
    listStackResources: AwsReadOnlyCommandConstructor;
  };
  now?: () => number;
}

function sdkClientConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsReadOnlySdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsReadOnlySdkClientConstructor;
}

function sdkCommand(
  module: Record<string, unknown>,
  name: string,
): AwsReadOnlyCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") {
    throw new Error(`AWS SDK export ${name} is missing.`);
  }
  return value as AwsReadOnlyCommandConstructor;
}

function checkedMfaCodeProvider(
  input: AwsSdkSharedCellCleanupStackEvidenceRuntimeInput,
): MfaCodeProvider {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    typeof input.mfaCodeProvider !== "function"
  ) {
    throw new Error("Shared Cell cleanup evidence MFA provider input is invalid.");
  }
  const source = input.mfaCodeProvider;
  return async (serial: string) => {
    if (serial !== mfaDeviceArn) {
      throw new Error(
        "Shared Cell cleanup evidence MFA device is outside the allowlist.",
      );
    }
    const code = await source(serial);
    if (!/^[0-9]{6}$/.test(code)) {
      throw new Error("Shared Cell cleanup evidence MFA code is invalid.");
    }
    return code;
  };
}

export class AwsSdkSharedCellCleanupStackEvidenceError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function fail(code: string, message: string, retryable = false): never {
  throw new AwsSdkSharedCellCleanupStackEvidenceError(
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

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

function requireNotAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function canonicalUtc(value: unknown, label: string): number {
  if (typeof value !== "string" || !utcPattern.test(value)) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_EVIDENCE_INVALID",
      `${label} must be canonical UTC with milliseconds.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_EVIDENCE_INVALID",
      `${label} is not a real UTC instant.`,
    );
  }
  return parsed;
}

function clockValue(clock: () => number, label: string): number {
  let value: number;
  try {
    value = clock();
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_STACK_CLOCK_INVALID",
      `${label} could not be read.`,
    );
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_CLOCK_INVALID",
      `${label} is not a positive safe integer.`,
    );
  }
  return value;
}

function instant(value: unknown, label: string): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_EVIDENCE_INVALID",
      `${label} is missing or invalid.`,
    );
  }
  return date.toISOString();
}

function uniqueStringMap(
  value: unknown,
  keyName: string,
  valueName: string,
  label: string,
): Record<string, string> {
  const items = records(value);
  if (!Array.isArray(value) || items.length !== value.length) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_EVIDENCE_INVALID",
      `${label} are malformed.`,
    );
  }
  const result: Record<string, string> = {};
  for (const item of items) {
    const key = text(item[keyName]);
    const itemValue = text(item[valueName]);
    if (!key || itemValue === null || Object.hasOwn(result, key)) {
      fail(
        "SHARED_CELL_CLEANUP_STACK_EVIDENCE_INVALID",
        `${label} are missing, duplicated or malformed.`,
      );
    }
    result[key] = itemValue;
  }
  return result;
}

async function snapshotPredecessor(
  value: Readonly<SharedCellProvisionAuthorityRecord>,
): Promise<Readonly<SharedCellProvisionAuthorityRecord>> {
  let snapshot: SharedCellProvisionAuthorityRecord;
  try {
    snapshot = JSON.parse(canonicalJson(value)) as SharedCellProvisionAuthorityRecord;
  } catch {
    return fail(
      "SHARED_CELL_CLEANUP_STACK_PREDECESSOR_INVALID",
      "The provision predecessor is not immutable JSON data.",
    );
  }
  if (
    !exactKeys(snapshot, [
      "accountId",
      "cellExpiresAt",
      "cellId",
      "cloudFormationRoleArn",
      "generation",
      "ownerDeploymentId",
      "provisionEpoch",
      "provisionMarker",
      "provisionOperationHash",
      "recordHash",
      "region",
      "resourceInventorySha256",
      "revision",
      "schemaVersion",
      "stackId",
      "stackName",
      "stackStatus",
      "state",
      "templateCanonicalSha256",
    ]) ||
    snapshot.schemaVersion !== 2 ||
    snapshot.accountId !== accountId ||
    snapshot.region !== region ||
    snapshot.cellId !== cellId ||
    snapshot.stackName !== stackName ||
    snapshot.cloudFormationRoleArn !== cloudFormationRoleArn ||
    !stackIdPattern.test(snapshot.stackId) ||
    !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(snapshot.stackStatus) ||
    snapshot.state !== "provision_verified" ||
    !Number.isSafeInteger(snapshot.generation) ||
    snapshot.generation < 1 ||
    !Number.isSafeInteger(snapshot.provisionEpoch) ||
    snapshot.provisionEpoch < 1 ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    !digestPattern.test(snapshot.templateCanonicalSha256) ||
    !digestPattern.test(snapshot.resourceInventorySha256) ||
    !digestPattern.test(snapshot.provisionOperationHash) ||
    !digestPattern.test(snapshot.recordHash)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_PREDECESSOR_INVALID",
      "The provision predecessor is outside the exact Shared Cell lineage.",
    );
  }
  canonicalUtc(snapshot.cellExpiresAt, "Predecessor cellExpiresAt");
  if (
    snapshot.provisionMarker !==
      sharedCellAuthorityMarker({
        generation: snapshot.generation,
        epoch: snapshot.provisionEpoch,
      }) ||
    snapshot.provisionOperationHash !==
      (await sha256Hex(sharedCellProvisionOperationIntent(snapshot)))
  ) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_PREDECESSOR_INVALID",
      "The provision predecessor operation lineage is invalid.",
    );
  }
  const unsigned = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "recordHash"),
  );
  if (snapshot.recordHash !== (await sha256Hex(unsigned))) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_PREDECESSOR_INVALID",
      "The provision predecessor record hash is invalid.",
    );
  }
  return Object.freeze(snapshot);
}

interface StableStackSnapshot {
  stackId: string;
  stackName: typeof stackName;
  stackStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  roleArn: typeof cloudFormationRoleArn;
  terminationProtection: false;
  creationTime: string;
  lastUpdatedTime: string | null;
  tags: {
    Environment: "aws-sandbox";
    ManagedBy: "techlong-cell-operator";
    CellId: typeof cellId;
    ExpiresAt: string;
  };
}

function oneStack(response: Record<string, unknown>): Record<string, unknown> {
  const stacks = records(response.Stacks);
  if (
    !Array.isArray(response.Stacks) ||
    stacks.length !== response.Stacks.length ||
    stacks.length !== 1
  ) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_EVIDENCE_INVALID",
      "Expected exactly one Shared Cell root Stack.",
    );
  }
  return stacks[0];
}

function normalizeStack(
  value: Record<string, unknown>,
  predecessor: Readonly<SharedCellProvisionAuthorityRecord>,
): StableStackSnapshot {
  const observedStackId = text(value.StackId) ?? "";
  const observedStackName = text(value.StackName) ?? "";
  const observedStatus = text(value.StackStatus);
  const observedRoleArn = text(value.RoleARN) ?? "";
  const tags = uniqueStringMap(value.Tags, "Key", "Value", "Stack tags");
  const expectedTags = {
    Environment: "aws-sandbox",
    ManagedBy: "techlong-cell-operator",
    CellId: cellId,
    ExpiresAt: predecessor.cellExpiresAt,
  } as const;
  if (
    observedStackId !== predecessor.stackId ||
    !stackIdPattern.test(observedStackId) ||
    observedStackName !== stackName ||
    observedStatus !== predecessor.stackStatus ||
    observedRoleArn !== predecessor.cloudFormationRoleArn ||
    value.EnableTerminationProtection !== false ||
    text(value.ParentId) !== null ||
    text(value.RootId) !== null ||
    canonicalJson(tags) !== canonicalJson(expectedTags)
  ) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_DRIFT",
      "The live Shared Cell root Stack, role, status or exact tags drifted from the provision lineage.",
    );
  }
  canonicalUtc(tags.ExpiresAt, "Stack ExpiresAt tag");
  return {
    stackId: observedStackId,
    stackName,
    stackStatus: observedStatus as StableStackSnapshot["stackStatus"],
    roleArn: cloudFormationRoleArn,
    terminationProtection: false,
    creationTime: instant(value.CreationTime, "Stack CreationTime"),
    lastUpdatedTime:
      value.LastUpdatedTime === undefined || value.LastUpdatedTime === null
        ? null
        : instant(value.LastUpdatedTime, "Stack LastUpdatedTime"),
    tags: expectedTags,
  };
}

interface InventoryEntry {
  logicalResourceId: string;
  physicalResourceId: string;
  resourceStatus: "CREATE_COMPLETE" | "UPDATE_COMPLETE";
  resourceType: string;
}

function projectInventory(
  summaries: Record<string, unknown>[],
  template: Record<string, unknown>,
): InventoryEntry[] {
  const resources = record(template.Resources);
  if (summaries.length === 0 || Object.keys(resources).length === 0) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_INVENTORY_INVALID",
      "The original template or live Shared Cell resource inventory is empty.",
    );
  }
  const seen = new Set<string>();
  const projected = summaries.map((summary) => {
    const logicalResourceId = text(summary.LogicalResourceId) ?? "";
    const physicalResourceId = text(summary.PhysicalResourceId) ?? "";
    const resourceStatus = text(summary.ResourceStatus);
    const resourceType = text(summary.ResourceType) ?? "";
    const expectedType = text(record(resources[logicalResourceId]).Type);
    if (
      !logicalResourceId ||
      !physicalResourceId ||
      !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(resourceStatus ?? "") ||
      !resourceType ||
      expectedType !== resourceType ||
      seen.has(logicalResourceId)
    ) {
      fail(
        "SHARED_CELL_CLEANUP_STACK_INVENTORY_INVALID",
        "The Shared Cell inventory is incomplete, duplicated, drifting or non-terminal.",
      );
    }
    seen.add(logicalResourceId);
    return {
      logicalResourceId,
      physicalResourceId,
      resourceStatus: resourceStatus as InventoryEntry["resourceStatus"],
      resourceType,
    };
  });
  if (
    canonicalJson([...seen].sort()) !==
    canonicalJson(Object.keys(resources).sort())
  ) {
    fail(
      "SHARED_CELL_CLEANUP_STACK_INVENTORY_INVALID",
      "The complete live inventory does not exactly cover the original template resources.",
    );
  }
  return projected.sort((left, right) =>
    left.logicalResourceId.localeCompare(right.logicalResourceId),
  );
}

function normalizeProviderError(
  error: unknown,
): AwsSdkSharedCellCleanupStackEvidenceError {
  if (error instanceof AwsSdkSharedCellCleanupStackEvidenceError) return error;
  const value = record(error);
  const metadata = record(value.$metadata);
  const status =
    typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : 0;
  const name = text(value.name) ?? "SHARED_CELL_CLEANUP_STACK_READ_FAILED";
  return new AwsSdkSharedCellCleanupStackEvidenceError(
    name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    "A Shared Cell cleanup Stack evidence read failed.",
    status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  );
}

/**
 * Read-only production adapter for the J5g cleanup-authority reviewer. It is
 * intentionally bound to the separately MFA-gated Cell Operator identity,
 * not the tenant Provisioner and not the mutation-capable Cell Janitor.
 * Constructing the adapter performs no AWS request and does not wire runtime.
 */
export class AwsSdkSharedCellCleanupStackEvidenceAdapter extends SharedCellCleanupStackEvidencePort {
  readonly region: typeof region;
  private readonly sdk: AwsSdkSharedCellCleanupStackEvidenceDependencies;
  private readonly now: () => number;

  constructor(
    selectedRegion: string,
    dependencies: AwsSdkSharedCellCleanupStackEvidenceDependencies,
  ) {
    super();
    if (selectedRegion !== region) {
      fail(
        "SHARED_CELL_CLEANUP_STACK_REGION_INVALID",
        "The cleanup Stack evidence adapter must use ca-central-1.",
      );
    }
    this.region = region;
    this.sdk = dependencies;
    this.now = dependencies.now ?? Date.now;
  }

  async readVerifiedCleanupStackEvidence(
    input: ReadSharedCellCleanupEvidenceInput,
  ): Promise<VerifiedSharedCellCleanupStackEvidence> {
    try {
      requireNotAborted(input.signal);
      const predecessor = await snapshotPredecessor(input.predecessor);
      requireNotAborted(input.signal);
      const startedAt = clockValue(this.now, "Evidence start clock");
      const expiresAt = canonicalUtc(
        predecessor.cellExpiresAt,
        "Predecessor cellExpiresAt",
      );
      if (expiresAt > startedAt) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_CELL_NOT_EXPIRED",
          "Cleanup Stack evidence cannot be collected before the Cell expires.",
        );
      }

      const identity = await this.sdk.clients.sts.send(
        new this.sdk.commands.getCallerIdentity({}),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      if (
        text(identity.Account) !== accountId ||
        text(identity.Arn) !== cleanupReviewerArn
      ) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_CALLER_INVALID",
          "Cleanup Stack evidence requires the exact MFA-gated Cell Operator session.",
        );
      }

      const firstResponse = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.describeStacks({ StackName: stackName }),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      const first = normalizeStack(oneStack(firstResponse), predecessor);

      const templateResponse = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.getTemplate({
          StackName: first.stackId,
          TemplateStage: "Original",
        }),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      let template: unknown = templateResponse.TemplateBody;
      if (typeof template === "string") {
        try {
          template = JSON.parse(template) as unknown;
        } catch {
          fail(
            "SHARED_CELL_CLEANUP_STACK_TEMPLATE_INVALID",
            "The original Shared Cell template is not JSON.",
          );
        }
      }
      if (!template || typeof template !== "object" || Array.isArray(template)) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_TEMPLATE_INVALID",
          "The original Shared Cell template is missing or malformed.",
        );
      }
      const templateSnapshot = template as Record<string, unknown>;
      const templateCanonicalSha256 = await sha256Hex(templateSnapshot);
      requireNotAborted(input.signal);
      if (
        templateCanonicalSha256 !== predecessor.templateCanonicalSha256 ||
        !digestPattern.test(templateCanonicalSha256)
      ) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_TEMPLATE_MISMATCH",
          "The original Shared Cell template hash differs from the provision predecessor.",
        );
      }

      const summaries: Record<string, unknown>[] = [];
      const seenTokens = new Set<string>();
      let nextToken: string | undefined;
      for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
        const request: Record<string, unknown> = { StackName: first.stackId };
        if (nextToken !== undefined) request.NextToken = nextToken;
        const page = await this.sdk.clients.cloudFormation.send(
          new this.sdk.commands.listStackResources(request),
          { abortSignal: input.signal },
        );
        requireNotAborted(input.signal);
        const pageSummaries = records(page.StackResourceSummaries);
        if (
          !Array.isArray(page.StackResourceSummaries) ||
          pageSummaries.length !== page.StackResourceSummaries.length
        ) {
          fail(
            "SHARED_CELL_CLEANUP_STACK_INVENTORY_INVALID",
            "A Shared Cell inventory page is malformed.",
          );
        }
        summaries.push(...pageSummaries);
        if (page.NextToken === undefined) {
          nextToken = undefined;
          break;
        }
        const token = text(page.NextToken);
        if (!token || seenTokens.has(token) || pageNumber === maximumPages - 1) {
          fail(
            "SHARED_CELL_CLEANUP_STACK_PAGINATION_INVALID",
            "Shared Cell inventory pagination is empty, repeated or excessive.",
          );
        }
        seenTokens.add(token);
        nextToken = token;
      }
      if (nextToken !== undefined) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_PAGINATION_INVALID",
          "Shared Cell inventory pagination did not terminate.",
        );
      }
      const inventory = projectInventory(summaries, templateSnapshot);
      const resourceInventorySha256 = await sha256Hex(inventory);
      requireNotAborted(input.signal);
      if (
        resourceInventorySha256 !== predecessor.resourceInventorySha256 ||
        !digestPattern.test(resourceInventorySha256)
      ) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_INVENTORY_MISMATCH",
          "The complete Shared Cell inventory hash differs from the provision predecessor.",
        );
      }

      const finalResponse = await this.sdk.clients.cloudFormation.send(
        new this.sdk.commands.describeStacks({ StackName: first.stackId }),
        { abortSignal: input.signal },
      );
      requireNotAborted(input.signal);
      const final = normalizeStack(oneStack(finalResponse), predecessor);
      if (canonicalJson(first) !== canonicalJson(final)) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_CHANGED",
          "The Shared Cell root Stack changed during evidence collection.",
          true,
        );
      }

      const observedAt = clockValue(this.now, "Evidence completion clock");
      if (
        observedAt < startedAt ||
        observedAt - startedAt > maximumEvidenceAgeMs ||
        observedAt < expiresAt
      ) {
        fail(
          "SHARED_CELL_CLEANUP_STACK_EVIDENCE_STALE",
          "Cleanup Stack evidence is stale, predates expiry or observed a regressing clock.",
        );
      }
      return this.markVerified({
        schemaVersion: 1,
        verified: true,
        observedAt,
        accountId,
        region,
        cellId,
        stackName,
        stackId: final.stackId,
        stackStatus: final.stackStatus,
        cellExpiresAt: predecessor.cellExpiresAt,
        templateCanonicalSha256,
        resourceInventorySha256,
        cloudFormationRoleArn,
      });
    } catch (error) {
      if (input.signal.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : Object.assign(
              new Error("Shared Cell cleanup Stack evidence read was aborted."),
              { name: "AbortError", code: "ABORT_ERR" },
            );
      }
      throw normalizeProviderError(error);
    }
  }
}

/**
 * Trusted-code construction seam for the dormant production collector. The
 * one defaultProvider result is lazy and shared by STS and CloudFormation;
 * constructing this adapter neither resolves credentials nor sends AWS calls.
 * The first evidence read still verifies the resulting exact Cell Operator
 * session through STS before reading CloudFormation.
 *
 * @internal
 */
export function createAwsSdkSharedCellCleanupStackEvidenceAdapterFromModules(
  modules: AwsSdkSharedCellCleanupStackEvidenceRuntimeModules,
  input: AwsSdkSharedCellCleanupStackEvidenceRuntimeInput,
): AwsSdkSharedCellCleanupStackEvidenceAdapter {
  const defaultProvider = modules.credentialProvider.defaultProvider;
  if (typeof defaultProvider !== "function") {
    throw new Error("AWS SDK export defaultProvider is missing.");
  }
  const credentials = (
    defaultProvider as (
      options: Record<string, unknown>,
    ) => AwsCredentialProvider
  )({
    profile,
    mfaCodeProvider: checkedMfaCodeProvider(input),
    clientConfig: {
      region,
      ignoreConfiguredEndpointUrls: true,
    },
  });
  if (typeof credentials !== "function") {
    throw new Error("AWS SDK default credential provider is invalid.");
  }

  const STSClient = sdkClientConstructor(modules.sts, "STSClient");
  const CloudFormationClient = sdkClientConstructor(
    modules.cloudFormation,
    "CloudFormationClient",
  );
  const clientConfiguration = {
    region,
    credentials,
    ignoreConfiguredEndpointUrls: true,
  };
  const sts = new STSClient(clientConfiguration);
  const cloudFormation = new CloudFormationClient(clientConfiguration);

  return new AwsSdkSharedCellCleanupStackEvidenceAdapter(region, {
    clients: { sts, cloudFormation },
    commands: {
      getCallerIdentity: sdkCommand(modules.sts, "GetCallerIdentityCommand"),
      describeStacks: sdkCommand(
        modules.cloudFormation,
        "DescribeStacksCommand",
      ),
      getTemplate: sdkCommand(modules.cloudFormation, "GetTemplateCommand"),
      listStackResources: sdkCommand(
        modules.cloudFormation,
        "ListStackResourcesCommand",
      ),
    },
  });
}

/** Dynamically loads only the installed read-only SDK modules. No AWS request occurs. */
export async function createAwsSdkSharedCellCleanupStackEvidenceAdapter(
  input: AwsSdkSharedCellCleanupStackEvidenceRuntimeInput,
): Promise<AwsSdkSharedCellCleanupStackEvidenceAdapter> {
  const stsPackage = "@aws-sdk/client-sts";
  const cloudFormationPackage = "@aws-sdk/client-cloudformation";
  const credentialProviderPackage = "@aws-sdk/credential-provider-node";
  const [sts, cloudFormation, credentialProvider] = (await Promise.all([
    import(stsPackage),
    import(cloudFormationPackage),
    import(credentialProviderPackage),
  ])) as Record<string, unknown>[];
  return createAwsSdkSharedCellCleanupStackEvidenceAdapterFromModules(
    { sts, cloudFormation, credentialProvider },
    input,
  );
}
