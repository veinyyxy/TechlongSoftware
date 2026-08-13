import {
  compileProvisioningConfiguration,
  type ProvisioningConfiguration,
} from "../../templates/provisioning.ts";
import type {
  TemplateConfiguration,
  TemplateConfigurationSchema,
  TemplateVersionStatus,
} from "../../templates/validation.ts";
import type {
  DeploymentExecutionContext,
  SaaSControlPayloadCompilerPort,
  TenantExternalOperationFence,
} from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const imageDigestPattern = /@(sha256:[a-f0-9]{64})$/;

export class SaaSControlPayloadCompilerDisabledError extends Error {
  readonly code = "SAAS_CONTROL_PAYLOAD_COMPILER_DISABLED";
  readonly retryable = false;

  constructor() {
    super(
      "Template schema and runtime SecretStore compiler are not configured; SaaS provision is blocked.",
    );
  }
}

export class SaaSControlPayloadCompilationError extends Error {
  readonly code = "SAAS_CONTROL_PAYLOAD_REJECTED";
  readonly retryable = false;

  constructor(message: string) {
    super(message);
  }
}

/**
 * This binding is intentionally reloaded independently from the worker
 * context. The compiler compares both immutable template-version IDs and the
 * resolved configuration hash; it never accepts the raw context snapshot as a
 * control request body.
 */
export interface AppInstanceTemplateBinding {
  appInstanceId: string;
  templateVersionId: string;
  resolvedConfiguration: TemplateConfiguration;
}

export interface AppInstanceTemplateBindingSource {
  loadForAppInstance(input: {
    appInstanceId: string;
    signal: AbortSignal;
  }): Promise<AppInstanceTemplateBinding | null>;
}

export interface ImmutableTemplateVersion {
  id: string;
  status: TemplateVersionStatus;
  configurationSchema: TemplateConfigurationSchema;
}

export interface ImmutableTemplateVersionSource {
  loadById(input: {
    templateVersionId: string;
    signal: AbortSignal;
  }): Promise<ImmutableTemplateVersion | null>;
}

/**
 * A lease must source an idempotently stable password at execution time (for
 * example from a provider-backed one-time Secret). `dispose` releases and
 * clears only the in-process lease; it must not rotate or delete the provider
 * value because a lost HTTP response must be retried with the same payload and
 * Idempotency-Key. Provider deletion happens only after the control read-back
 * has been verified by a separately fenced lifecycle step. Implementations
 * must never write the cleartext to logs or databases.
 */
export interface FirstOwnerPasswordLease {
  read(): string;
  dispose(): void;
}

export interface FirstOwnerPasswordSource {
  lease(input: {
    appInstanceId: string;
    templateVersionId: string;
    signal: AbortSignal;
  }): Promise<FirstOwnerPasswordLease>;
}

export interface ImmutableTemplateSaaSControlPayloadCompilerOptions {
  bindings: AppInstanceTemplateBindingSource;
  templateVersions: ImmutableTemplateVersionSource;
  firstOwnerPasswords: FirstOwnerPasswordSource;
}

function assertBinding(
  binding: AppInstanceTemplateBinding | null,
  appInstanceId: string,
): asserts binding is AppInstanceTemplateBinding {
  if (
    !binding ||
    binding.appInstanceId !== appInstanceId ||
    !idPattern.test(binding.templateVersionId)
  ) {
    throw new SaaSControlPayloadCompilationError(
      "Application instance has no valid immutable template-version binding.",
    );
  }
}

function assertTemplateVersion(
  version: ImmutableTemplateVersion | null,
  expectedId: string,
): asserts version is ImmutableTemplateVersion {
  if (
    !version ||
    version.id !== expectedId ||
    (version.status !== "published" && version.status !== "archived") ||
    version.configurationSchema.schemaVersion !== 2 ||
    version.configurationSchema.contract !== "speedfeast-saas-control-v1"
  ) {
    throw new SaaSControlPayloadCompilationError(
      "The bound template version is not an immutable SpeedFeast control contract.",
    );
  }
}

function ensureObjectRoot(
  compiled: ProvisioningConfiguration,
  key: "entitlements" | "default_store" | "first_owner",
): Record<string, unknown> {
  const value = compiled[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (key === "first_owner") {
      throw new SaaSControlPayloadCompilationError(
        "The immutable template must define the first owner configuration.",
      );
    }
    const root: Record<string, unknown> = {};
    compiled[key] = root;
    return root;
  }
  return value as Record<string, unknown>;
}

function immutableImageDigest(context: DeploymentExecutionContext): string {
  const digest = context.deployment.artifactRef.match(imageDigestPattern)?.[1];
  if (!digest) {
    throw new SaaSControlPayloadCompilationError(
      "Deployment artifact is not pinned to an immutable SHA-256 image digest.",
    );
  }
  return digest;
}

/**
 * Loads an exact immutable template version and compiles its resolved values
 * through the v2 allowlisted output paths. The raw instance snapshot is never
 * copied into the control request.
 */
export class ImmutableTemplateSaaSControlPayloadCompiler
  implements SaaSControlPayloadCompilerPort
{
  private readonly bindings: AppInstanceTemplateBindingSource;
  private readonly templateVersions: ImmutableTemplateVersionSource;
  private readonly firstOwnerPasswords: FirstOwnerPasswordSource;

  constructor(options: ImmutableTemplateSaaSControlPayloadCompilerOptions) {
    this.bindings = options.bindings;
    this.templateVersions = options.templateVersions;
    this.firstOwnerPasswords = options.firstOwnerPasswords;
  }

  async compile(input: {
    context: DeploymentExecutionContext;
    configurationHash: string;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<{
    compiledPayload: Record<string, unknown>;
    configurationHash: string;
  }> {
    input.signal.throwIfAborted();
    if (!/^[a-f0-9]{64}$/.test(input.configurationHash)) {
      throw new SaaSControlPayloadCompilationError(
        "Deployment configuration hash is invalid.",
      );
    }
    const external = input.externalFence;
    if (
      external.intent !== "provision" ||
      external.state !== "active" ||
      external.resourceFence.identity.appInstanceId !==
        input.context.appInstance.id ||
      canonicalJson(input.context.tenantExternalOperation) !==
        canonicalJson(external) ||
      !Number.isSafeInteger(external.epoch) ||
      external.epoch < 1 ||
      !/^[a-f0-9]{64}$/.test(external.operationHash) ||
      external.marker !==
        `tl_epoch_${external.resourceFence.identity.stableIdentityHash.slice(0, 24)}` +
          `_g${external.resourceFence.generation}_e${external.epoch}`
    ) {
      throw new SaaSControlPayloadCompilationError(
        "The control payload is not bound to the current active provision epoch.",
      );
    }
    const binding = await this.bindings.loadForAppInstance({
      appInstanceId: input.context.appInstance.id,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertBinding(binding, input.context.appInstance.id);
    if (binding.templateVersionId !== input.context.appInstance.templateVersionId) {
      throw new SaaSControlPayloadCompilationError(
        "Application instance template binding changed after the deployment context was loaded.",
      );
    }
    const resolvedHash = await sha256Hex(canonicalJson(binding.resolvedConfiguration));
    if (resolvedHash !== input.configurationHash) {
      throw new SaaSControlPayloadCompilationError(
        "Immutable template binding does not match the persisted deployment configuration hash.",
      );
    }
    const version = await this.templateVersions.loadById({
      templateVersionId: binding.templateVersionId,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    assertTemplateVersion(version, binding.templateVersionId);

    const passwordLease = await this.firstOwnerPasswords.lease({
      appInstanceId: input.context.appInstance.id,
      templateVersionId: binding.templateVersionId,
      signal: input.signal,
    });
    try {
      input.signal.throwIfAborted();
      const firstOwnerPassword = passwordLease.read();
      input.signal.throwIfAborted();
      if (firstOwnerPassword.length < 10 || firstOwnerPassword.length > 256) {
        throw new SaaSControlPayloadCompilationError(
          "Runtime first-owner password does not meet the control contract.",
        );
      }
      const result = compileProvisioningConfiguration({
        schema: version.configurationSchema,
        configuration: binding.resolvedConfiguration,
        runtimeSecrets: { firstOwnerPassword },
      });
      input.signal.throwIfAborted();
      if (!result.data) {
        throw new SaaSControlPayloadCompilationError(
          `Immutable template compilation failed for ${Object.keys(result.errors).sort().join(", ") || "unknown fields"}.`,
        );
      }
      const compiled = result.data;
      ensureObjectRoot(compiled, "entitlements");
      ensureObjectRoot(compiled, "default_store");
      ensureObjectRoot(compiled, "first_owner");
      const imageRevision = immutableImageDigest(input.context);
      input.signal.throwIfAborted();
      return {
        configurationHash: input.configurationHash,
        compiledPayload: {
          instance: {
            external_instance_id: input.context.appInstance.id,
            metadata: {
              configuration_hash: input.configurationHash,
              template_version_id: binding.templateVersionId,
              image_revision: imageRevision,
              external_operation_epoch: external.epoch,
              external_operation_intent: external.intent,
              external_operation_marker: external.marker,
              external_operation_hash: external.operationHash,
            },
          },
          entitlements: compiled.entitlements,
          default_store: compiled.default_store,
          first_owner: compiled.first_owner,
        },
      };
    } finally {
      passwordLease.dispose();
    }
  }
}

/** Fail-closed until the immutable sources and one-time SecretStore are wired. */
export class DisabledSaaSControlPayloadCompiler
  implements SaaSControlPayloadCompilerPort
{
  async compile(): Promise<never> {
    throw new SaaSControlPayloadCompilerDisabledError();
  }
}
