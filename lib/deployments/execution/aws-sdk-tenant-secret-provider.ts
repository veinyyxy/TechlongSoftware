import { canonicalJson, sha256Hex } from "./hash.ts";
import {
  assertTenantRuntimeSecretName,
  createTenantSecretProviderEvidenceHash,
  createTenantSecretProviderReceiptHash,
  tenantRuntimeSecretExactJsonKeys,
  type TenantRuntimeSecretJsonKey,
  type TenantRuntimeSecretOwnershipEvidence,
  type TenantRuntimeSecretProviderApi,
  type TenantRuntimeSecretProviderDeleteReceipt,
  type TenantRuntimeSecretProviderMutationReceipt,
  type TenantRuntimeSecretProviderObservation,
} from "./tenant-aws-one-shot-adapters.ts";
import { TenantDatabaseLifecycleError } from "./tenant-database.ts";

interface AwsSdkClient {
  send(
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
}

type AwsSdkClientConstructor = new (
  configuration: Record<string, unknown>,
) => AwsSdkClient;
type AwsSdkCommandConstructor = new (
  input: Record<string, unknown>,
) => unknown;

type TenantRuntimeSecretMaterial = Record<TenantRuntimeSecretJsonKey, string>;

/**
 * Trusted, in-process generator capability. It is intentionally below the
 * provider port and is never exposed to the Worker, receipts, checkpoints or
 * logs. Implementations must construct the database URL and four independent
 * keys in memory and return no additional fields.
 */
export interface TenantRuntimeSecretMaterialGenerator {
  generate(input: {
    secretName: string;
    ownership: TenantRuntimeSecretOwnershipEvidence;
    signal: AbortSignal;
  }): Promise<TenantRuntimeSecretMaterial>;
}

export interface AwsSdkTenantRuntimeSecretDependencies {
  client: AwsSdkClient;
  stsClient: AwsSdkClient;
  commands: {
    describeSecret: AwsSdkCommandConstructor;
    getSecretValue: AwsSdkCommandConstructor;
    createSecret: AwsSdkCommandConstructor;
    getCallerIdentity: AwsSdkCommandConstructor;
  };
  materialGenerator: TenantRuntimeSecretMaterialGenerator;
}

export interface AwsSdkTenantRuntimeSecretConfig {
  expectedAccountId: string;
  expectedRegion: string;
  expectedWorkerRoleArn: string;
}

const secretArnPattern =
  /^arn:aws:secretsmanager:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):secret:(techlong\/sandbox\/tenant\/[a-z0-9][a-z0-9_-]{2,63}\/runtime\/g[1-9][0-9]*)-([A-Za-z0-9]{6})$/;
const secretNameGenerationPattern = /\/runtime\/g([1-9][0-9]*)$/;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ownershipMarkerPattern = /^tl_owner_([a-f0-9]{32})_g([1-9][0-9]*)$/;
const externalMarkerPattern =
  /^tl_epoch_([a-f0-9]{24})_g([1-9][0-9]*)_e([1-9][0-9]*)$/;
const sandboxProvisionerRoleName = "TechlongSandboxProvisionerRole";
const ownershipTagKeys = [
  "ManagedBy",
  "SecretSchema",
  "ResourceGeneration",
  "OwnershipMarker",
] as const;

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
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
}

function rethrowAbort(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("AWS Secrets Manager operation was aborted."), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
}

function isMissing(error: unknown): boolean {
  const source = errorRecord(error);
  return source.name === "ResourceNotFoundException";
}

function isAlreadyExists(error: unknown): boolean {
  const source = errorRecord(error);
  return source.name === "ResourceExistsException";
}

function providerError(error: unknown, operation: string): Error {
  const source = errorRecord(error);
  const metadata = record(source.$metadata);
  const name = text(source.name) ?? "AWS_SECRETS_MANAGER_ERROR";
  const status = Number(metadata.httpStatusCode ?? 0);
  return Object.assign(new Error(`AWS Secrets Manager ${operation} failed.`), {
    code: name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    retryable:
      Boolean(source.$retryable) ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  });
}

function identityProviderError(error: unknown): Error {
  const source = errorRecord(error);
  const metadata = record(source.$metadata);
  const name = text(source.name) ?? "AWS_STS_ERROR";
  const status = Number(metadata.httpStatusCode ?? 0);
  return Object.assign(new Error("AWS STS caller identity verification failed."), {
    code: name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    retryable:
      Boolean(source.$retryable) ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      /Throttl|Timeout|Unavailable|Internal|RequestLimit/i.test(name),
  });
}

function fail(code: string, message: string): never {
  throw new TenantDatabaseLifecycleError(code, message, false);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) ===
    canonicalJson([...expected].sort())
  );
}

function assertExactJsonKeys(keys: readonly string[]): void {
  if (
    canonicalJson([...keys].sort()) !==
    canonicalJson([...tenantRuntimeSecretExactJsonKeys].sort())
  ) {
    fail(
      "TENANT_SECRET_SCHEMA_INVALID",
      "Tenant runtime Secret must contain exactly the reviewed five JSON keys.",
    );
  }
}

function assertOwnership(value: TenantRuntimeSecretOwnershipEvidence): void {
  const ownershipMatch = ownershipMarkerPattern.exec(value.ownershipMarker);
  const externalMatch = externalMarkerPattern.exec(value.externalMarker);
  if (
    !exactKeys(value, [
      "resourceGeneration",
      "ownershipMarker",
      "externalEpoch",
      "externalMarker",
      "externalOperationHash",
    ]) ||
    !Number.isSafeInteger(value.resourceGeneration) ||
    value.resourceGeneration < 1 ||
    !ownershipMatch ||
    Number(ownershipMatch[2]) !== value.resourceGeneration ||
    !Number.isSafeInteger(value.externalEpoch) ||
    value.externalEpoch < 1 ||
    !externalMatch ||
    externalMatch[1] !== ownershipMatch[1].slice(0, 24) ||
    Number(externalMatch[2]) !== value.resourceGeneration ||
    Number(externalMatch[3]) !== value.externalEpoch ||
    !digestPattern.test(value.externalOperationHash)
  ) {
    fail(
      "TENANT_SECRET_OWNERSHIP_INVALID",
      "Tenant Secret ownership evidence is invalid.",
    );
  }
}

function assertSecretNameOwnership(
  secretName: string,
  ownership: TenantRuntimeSecretOwnershipEvidence,
): void {
  const generation = Number(secretNameGenerationPattern.exec(secretName)?.[1]);
  if (generation !== ownership.resourceGeneration) {
    fail(
      "TENANT_SECRET_OWNERSHIP_MISMATCH",
      "Tenant Secret physical generation does not match its ownership coordinate.",
    );
  }
}

function expectedTags(
  ownership: TenantRuntimeSecretOwnershipEvidence,
): Record<(typeof ownershipTagKeys)[number], string> {
  return {
    ManagedBy: "techlong-deployment-worker",
    SecretSchema: "techlong-runtime-five-key-v1",
    ResourceGeneration: String(ownership.resourceGeneration),
    OwnershipMarker: ownership.ownershipMarker,
  };
}

function tagsFromResponse(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of records(value)) {
    const key = text(item.Key);
    const tagValue = text(item.Value);
    if (!key || !tagValue || result[key] !== undefined) {
      fail("TENANT_SECRET_TAGS_INVALID", "Tenant Secret tags are incomplete or duplicated.");
    }
    result[key] = tagValue;
  }
  return result;
}

function assertTags(
  value: unknown,
  ownership: TenantRuntimeSecretOwnershipEvidence,
): void {
  const actual = tagsFromResponse(value);
  const expected = expectedTags(ownership);
  if (
    !exactKeys(actual, ownershipTagKeys) ||
    canonicalJson(actual) !== canonicalJson(expected)
  ) {
    fail(
      "TENANT_SECRET_OWNERSHIP_MISMATCH",
      "Tenant Secret tags do not match the exact stable generation owner.",
    );
  }
}

function assertSecretArn(
  value: string,
  expected: AwsSdkTenantRuntimeSecretConfig & { secretName: string },
): void {
  const match = secretArnPattern.exec(value);
  if (
    !match ||
    match[1] !== expected.expectedRegion ||
    match[2] !== expected.expectedAccountId ||
    match[3] !== expected.secretName
  ) {
    fail(
      "TENANT_SECRET_REFERENCE_INVALID",
      "Tenant Secret ARN is outside the exact generation, account, or region.",
    );
  }
}

function currentVersion(value: unknown): string {
  const versions = record(value);
  const current = Object.entries(versions).filter(([, stages]) =>
    Array.isArray(stages) && stages.includes("AWSCURRENT"),
  );
  if (current.length !== 1 || !versionPattern.test(current[0][0])) {
    fail(
      "TENANT_SECRET_VERSION_INVALID",
      "Tenant Secret must have exactly one valid AWSCURRENT version.",
    );
  }
  return current[0][0];
}

function parseSecretMaterial(value: unknown): readonly TenantRuntimeSecretJsonKey[] {
  if (typeof value !== "string" || value.length < 5 || value.length > 32_768) {
    fail("TENANT_SECRET_SCHEMA_INVALID", "Tenant runtime Secret value is not valid JSON text.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    fail("TENANT_SECRET_SCHEMA_INVALID", "Tenant runtime Secret value is not valid JSON.");
  }
  const material = record(decoded);
  assertExactJsonKeys(Object.keys(material));
  if (
    Object.values(material).some(
      (item) => typeof item !== "string" || item.length < 1 || item.length > 8_192,
    )
  ) {
    fail(
      "TENANT_SECRET_SCHEMA_INVALID",
      "Tenant runtime Secret contains an empty, non-text, or oversized field.",
    );
  }
  return [...tenantRuntimeSecretExactJsonKeys];
}

function serializeSecretMaterial(material: TenantRuntimeSecretMaterial): string {
  if (!material || typeof material !== "object" || Array.isArray(material)) {
    fail("TENANT_SECRET_GENERATOR_INVALID", "Tenant Secret generator returned an invalid value.");
  }
  assertExactJsonKeys(Object.keys(material));
  if (
    Object.values(material).some(
      (item) => typeof item !== "string" || item.length < 1 || item.length > 8_192,
    )
  ) {
    fail(
      "TENANT_SECRET_GENERATOR_INVALID",
      "Tenant Secret generator returned an empty, non-text, or oversized field.",
    );
  }
  const encoded = JSON.stringify(material);
  if (encoded.length > 32_768) {
    fail("TENANT_SECRET_GENERATOR_INVALID", "Tenant Secret payload exceeds its safety bound.");
  }
  return encoded;
}

async function observationReceipt(input: {
  state: "missing" | "present";
  secretArn: string | null;
  versionRef: string | null;
  jsonKeys: readonly TenantRuntimeSecretJsonKey[];
  ownership: TenantRuntimeSecretOwnershipEvidence;
}): Promise<TenantRuntimeSecretProviderObservation> {
  const withoutHashes = { schemaVersion: 1 as const, ...input };
  const evidenceHash = await createTenantSecretProviderEvidenceHash(withoutHashes);
  const withoutReceiptHash = { ...withoutHashes, evidenceHash };
  return {
    ...withoutReceiptHash,
    receiptHash: await createTenantSecretProviderReceiptHash(withoutReceiptHash),
  };
}

async function mutationReceipt(input: {
  outcome: "created" | "already_exists";
  secretArn: string;
  versionRef: string;
  jsonKeys: readonly TenantRuntimeSecretJsonKey[];
  ownership: TenantRuntimeSecretOwnershipEvidence;
}): Promise<TenantRuntimeSecretProviderMutationReceipt> {
  const withoutHashes = { schemaVersion: 1 as const, ...input };
  const evidenceHash = await createTenantSecretProviderEvidenceHash(withoutHashes);
  const withoutReceiptHash = { ...withoutHashes, evidenceHash };
  return {
    ...withoutReceiptHash,
    receiptHash: await createTenantSecretProviderReceiptHash(withoutReceiptHash),
  };
}

/**
 * AWS Secrets Manager implementation of the SDK-free provider port. Secret
 * material exists only in the generator result, the CreateSecret request and
 * the GetSecretValue validation scope; it is never returned, logged or put in
 * evidence/checkpoints.
 */
export class AwsSdkTenantRuntimeSecretProvider
  implements TenantRuntimeSecretProviderApi
{
  private readonly config: AwsSdkTenantRuntimeSecretConfig;
  private readonly sdk: AwsSdkTenantRuntimeSecretDependencies;

  constructor(
    config: AwsSdkTenantRuntimeSecretConfig,
    sdk: AwsSdkTenantRuntimeSecretDependencies,
  ) {
    if (
      !/^\d{12}$/.test(config.expectedAccountId) ||
      !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(config.expectedRegion) ||
      config.expectedWorkerRoleArn !==
        `arn:aws:iam::${config.expectedAccountId}:role/${sandboxProvisionerRoleName}` ||
      !sdk.stsClient ||
      typeof sdk.stsClient.send !== "function" ||
      typeof sdk.commands.getCallerIdentity !== "function"
    ) {
      fail("TENANT_SECRET_PROVIDER_CONFIG_INVALID", "AWS Secret provider scope is invalid.");
    }
    this.config = { ...config };
    this.sdk = sdk;
  }

  private async assertExactCallerIdentity(signal: AbortSignal): Promise<void> {
    try {
      signal.throwIfAborted();
      const identity = await this.sdk.stsClient.send(
        new this.sdk.commands.getCallerIdentity({}),
        { abortSignal: signal },
      );
      signal.throwIfAborted();
      const accountId = text(identity.Account);
      const callerArn = text(identity.Arn);
      const expectedCallerPattern = new RegExp(
        `^arn:aws:sts::${this.config.expectedAccountId}:assumed-role/` +
          `${sandboxProvisionerRoleName}/[A-Za-z0-9+=,.@_-]{2,64}$`,
      );
      if (
        accountId !== this.config.expectedAccountId ||
        !callerArn ||
        !expectedCallerPattern.test(callerArn)
      ) {
        fail(
          "TENANT_SECRET_CALLER_IDENTITY_MISMATCH",
          "AWS Secret creation requires the exact Sandbox provisioner role and account.",
        );
      }
    } catch (error) {
      rethrowAbort(signal);
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      throw identityProviderError(error);
    }
  }

  private async readPresentSecret(input: {
    secretName: string;
    expectedJsonKeys: readonly TenantRuntimeSecretJsonKey[];
    expectedOwnership: TenantRuntimeSecretOwnershipEvidence;
    signal: AbortSignal;
  }): Promise<{
    secretArn: string;
    versionRef: string;
    jsonKeys: readonly TenantRuntimeSecretJsonKey[];
  }> {
    input.signal.throwIfAborted();
    const described = await this.sdk.client.send(
      new this.sdk.commands.describeSecret({ SecretId: input.secretName }),
      { abortSignal: input.signal },
    );
    input.signal.throwIfAborted();
    const secretArn = text(described.ARN);
    if (!secretArn || text(described.Name) !== input.secretName) {
      fail("TENANT_SECRET_OBSERVATION_INVALID", "AWS returned an incomplete tenant Secret.");
    }
    assertSecretArn(secretArn, { ...this.config, secretName: input.secretName });
    // Secret tags bind only the immutable generation owner. The DynamoDB
    // authority and tenant database marker remain the sole mutable epoch
    // fences, so same-generation reconciles never rewrite Secret tags.
    assertTags(described.Tags, input.expectedOwnership);
    const versionRef = currentVersion(described.VersionIdsToStages);
    const value = await this.sdk.client.send(
      new this.sdk.commands.getSecretValue({
        SecretId: secretArn,
        VersionId: versionRef,
        VersionStage: "AWSCURRENT",
      }),
      { abortSignal: input.signal },
    );
    input.signal.throwIfAborted();
    if (
      text(value.ARN) !== secretArn ||
      text(value.Name) !== input.secretName ||
      text(value.VersionId) !== versionRef ||
      value.SecretBinary !== undefined
    ) {
      fail(
        "TENANT_SECRET_OBSERVATION_INVALID",
        "AWS returned a different tenant Secret or binary secret material.",
      );
    }
    const jsonKeys = parseSecretMaterial(value.SecretString);
    assertExactJsonKeys(input.expectedJsonKeys);
    return { secretArn, versionRef, jsonKeys };
  }

  async inspectSecret(input: {
    secretName: string;
    expectedJsonKeys: readonly TenantRuntimeSecretJsonKey[];
    expectedOwnership: TenantRuntimeSecretOwnershipEvidence;
    signal: AbortSignal;
  }): Promise<TenantRuntimeSecretProviderObservation> {
    assertTenantRuntimeSecretName(input.secretName);
    assertExactJsonKeys(input.expectedJsonKeys);
    assertOwnership(input.expectedOwnership);
    assertSecretNameOwnership(input.secretName, input.expectedOwnership);
    try {
      const observed = await this.readPresentSecret({
        secretName: input.secretName,
        expectedJsonKeys: input.expectedJsonKeys,
        expectedOwnership: input.expectedOwnership,
        signal: input.signal,
      });
      return observationReceipt({
        state: "present",
        secretArn: observed.secretArn,
        versionRef: observed.versionRef,
        jsonKeys: observed.jsonKeys,
        ownership: input.expectedOwnership,
      });
    } catch (error) {
      rethrowAbort(input.signal);
      if (isMissing(error)) {
        return observationReceipt({
          state: "missing",
          secretArn: null,
          versionRef: null,
          jsonKeys: [],
          ownership: input.expectedOwnership,
        });
      }
      if (error instanceof TenantDatabaseLifecycleError) throw error;
      throw providerError(error, "read");
    }
  }

  async ensureGeneratedSecret(input: {
    secretName: string;
    requiredJsonKeys: readonly TenantRuntimeSecretJsonKey[];
    ownership: TenantRuntimeSecretOwnershipEvidence;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantRuntimeSecretProviderMutationReceipt> {
    assertTenantRuntimeSecretName(input.secretName);
    assertExactJsonKeys(input.requiredJsonKeys);
    assertOwnership(input.ownership);
    assertSecretNameOwnership(input.secretName, input.ownership);
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      fail("TENANT_IDEMPOTENCY_KEY_INVALID", "Tenant Secret idempotency key is invalid.");
    }
    const observed = await this.inspectSecret({
      secretName: input.secretName,
      expectedJsonKeys: input.requiredJsonKeys,
      expectedOwnership: input.ownership,
      signal: input.signal,
    });
    if (observed.state === "present") {
      return mutationReceipt({
        outcome: "already_exists",
        secretArn: observed.secretArn as string,
        versionRef: observed.versionRef as string,
        jsonKeys: observed.jsonKeys,
        ownership: input.ownership,
      });
    }

    // CreateSecret accepts only a name, so it cannot bind the target account
    // by ARN. Prove the current STS account and exact allowlisted role before
    // generating material or issuing any write.
    await this.assertExactCallerIdentity(input.signal);

    let createdByThisCall = true;
    try {
      input.signal.throwIfAborted();
      const material = await this.sdk.materialGenerator.generate({
        secretName: input.secretName,
        ownership: input.ownership,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      const secretString = serializeSecretMaterial(material);
      const clientRequestToken = await sha256Hex(input.idempotencyKey);
      const created = await this.sdk.client.send(
        new this.sdk.commands.createSecret({
          Name: input.secretName,
          Description: "Techlong generation-owned tenant runtime secret",
          ClientRequestToken: clientRequestToken,
          SecretString: secretString,
          Tags: Object.entries(expectedTags(input.ownership)).map(
            ([Key, Value]) => ({ Key, Value }),
          ),
        }),
        { abortSignal: input.signal },
      );
      input.signal.throwIfAborted();
      const secretArn = text(created.ARN);
      const versionRef = text(created.VersionId);
      if (
        !secretArn ||
        text(created.Name) !== input.secretName ||
        !versionRef ||
        !versionPattern.test(versionRef)
      ) {
        fail("TENANT_SECRET_RECEIPT_INVALID", "AWS CreateSecret returned incomplete metadata.");
      }
      assertSecretArn(secretArn, { ...this.config, secretName: input.secretName });
    } catch (error) {
      rethrowAbort(input.signal);
      if (!isAlreadyExists(error)) {
        if (error instanceof TenantDatabaseLifecycleError) throw error;
        throw providerError(error, "create");
      }
      createdByThisCall = false;
    }

    // Independent readback proves both the exact tags and the five-key schema,
    // including response-loss and ResourceExists retry paths.
    const after = await this.inspectSecret({
      secretName: input.secretName,
      expectedJsonKeys: input.requiredJsonKeys,
      expectedOwnership: input.ownership,
      signal: input.signal,
    });
    if (after.state !== "present" || !after.secretArn || !after.versionRef) {
      fail(
        "TENANT_SECRET_CREATE_UNVERIFIED",
        "Tenant Secret was not independently observed after CreateSecret.",
      );
    }
    return mutationReceipt({
      outcome: createdByThisCall ? "created" : "already_exists",
      secretArn: after.secretArn,
      versionRef: after.versionRef,
      jsonKeys: after.jsonKeys,
      ownership: input.ownership,
    });
  }

  async deleteSecret(input: {
    secretName: string;
    expectedOwnership: TenantRuntimeSecretOwnershipEvidence;
    idempotencyKey: string;
    signal: AbortSignal;
  }): Promise<TenantRuntimeSecretProviderDeleteReceipt> {
    input.signal.throwIfAborted();
    assertTenantRuntimeSecretName(input.secretName);
    assertOwnership(input.expectedOwnership);
    assertSecretNameOwnership(input.secretName, input.expectedOwnership);
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      fail("TENANT_IDEMPOTENCY_KEY_INVALID", "Tenant Secret idempotency key is invalid.");
    }
    fail(
      "TENANT_SECRET_CLEANUP_PREDECESSOR_UNAVAILABLE",
      "AWS Secret deletion remains disabled until the exact provision predecessor is supplied by the cleanup contract.",
    );
  }
}

function commandConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkCommandConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkCommandConstructor;
}

function clientConstructor(
  module: Record<string, unknown>,
  name: string,
): AwsSdkClientConstructor {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`AWS SDK export ${name} is missing.`);
  return value as AwsSdkClientConstructor;
}

export async function createAwsSdkTenantRuntimeSecretProvider(input: {
  config: AwsSdkTenantRuntimeSecretConfig;
  materialGenerator: TenantRuntimeSecretMaterialGenerator;
}): Promise<AwsSdkTenantRuntimeSecretProvider> {
  const secretsPackageName = "@aws-sdk/client-secrets-manager";
  const stsPackageName = "@aws-sdk/client-sts";
  const [sdkModule, stsModule] = (await Promise.all([
    import(secretsPackageName),
    import(stsPackageName),
  ])) as [Record<string, unknown>, Record<string, unknown>];
  const SecretsManagerClient = clientConstructor(
    sdkModule,
    "SecretsManagerClient",
  );
  const STSClient = clientConstructor(stsModule, "STSClient");
  return new AwsSdkTenantRuntimeSecretProvider(input.config, {
    client: new SecretsManagerClient({ region: input.config.expectedRegion }),
    stsClient: new STSClient({ region: input.config.expectedRegion }),
    materialGenerator: input.materialGenerator,
    commands: {
      describeSecret: commandConstructor(sdkModule, "DescribeSecretCommand"),
      getSecretValue: commandConstructor(sdkModule, "GetSecretValueCommand"),
      createSecret: commandConstructor(sdkModule, "CreateSecretCommand"),
      getCallerIdentity: commandConstructor(stsModule, "GetCallerIdentityCommand"),
    },
  });
}
