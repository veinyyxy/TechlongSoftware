import type {
  SaaSControlObservation,
  SaaSControlPort,
  TenantExternalOperationFence,
} from "./contracts.ts";
import { clearFirstOwnerPassword } from "./control-secret-redaction.ts";
import { sha256Hex } from "./hash.ts";

export interface SaaSControlRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface SaaSControlTransport {
  /**
   * Implementations must use the private ALB control listener with verified
   * mTLS. A plain global fetch implementation is intentionally not provided.
   */
  send(request: SaaSControlRequest, input: { signal: AbortSignal }): Promise<{
    status: number;
    body: unknown;
  }>;
}

export interface SaaSControlTokenProvider {
  issue(input: {
    instanceId: string;
    audience: string;
    scope: "speedfeast:control";
    signal: AbortSignal;
  }): Promise<string>;
}

const dnsNamePattern =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const tenantLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function assertActiveControlFence(
  fence: TenantExternalOperationFence,
  appInstanceId: string,
): void {
  const resource = fence?.resourceFence;
  if (
    fence?.schemaVersion !== 1 ||
    fence.intent !== "provision" ||
    fence.state !== "active" ||
    !resource ||
    resource.identity.appInstanceId !== appInstanceId ||
    fence.ownerDeploymentId !== resource.ownerDeploymentId ||
    !Number.isSafeInteger(fence.epoch) ||
    fence.epoch < 1 ||
    !/^[a-f0-9]{64}$/.test(fence.operationHash) ||
    fence.marker !==
      `tl_epoch_${resource.identity.stableIdentityHash.slice(0, 24)}` +
        `_g${resource.generation}_e${fence.epoch}`
  ) {
    throw Object.assign(
      new Error("SaaS control requires one exact active provision epoch."),
      { code: "SAAS_CONTROL_EXTERNAL_EPOCH_INVALID", retryable: false },
    );
  }
}

function externalOperationMatches(
  source: Record<string, unknown>,
  fence: TenantExternalOperationFence,
): boolean {
  return (
    source.external_operation_epoch === fence.epoch &&
    source.external_operation_intent === fence.intent &&
    source.external_operation_marker === fence.marker &&
    source.external_operation_hash === fence.operationHash
  );
}

export function assertSaaSControlBaseDomain(baseDomain: string): string {
  const normalized = baseDomain.trim();
  if (
    baseDomain !== normalized ||
    normalized !== normalized.toLowerCase() ||
    !dnsNamePattern.test(normalized)
  ) {
    throw new Error("SaaS control base domain is invalid.");
  }
  return normalized;
}

export function assertSaaSControlTenantHostname(input: {
  hostname: string;
  baseDomain: string;
}): void {
  const baseDomain = assertSaaSControlBaseDomain(input.baseDomain);
  const hostname = input.hostname.trim();
  const suffix = `.${baseDomain}`;
  const tenantLabel = hostname.endsWith(suffix)
    ? hostname.slice(0, -suffix.length)
    : "";
  if (
    input.hostname !== hostname ||
    hostname !== hostname.toLowerCase() ||
    !dnsNamePattern.test(hostname) ||
    !tenantLabelPattern.test(tenantLabel)
  ) {
    throw new Error("SaaS control hostname is outside the configured tenant domain.");
  }
}

export interface SaaSControlEndpointPolicy {
  /** Exact environment base domain, for example sandbox.techlong.cloud. */
  baseDomain: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function controlSource(value: unknown): {
  envelope: Record<string, unknown>;
  control: Record<string, unknown>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SaaS control response is not an object.");
  }
  const record = value as Record<string, unknown>;
  const source =
    asRecord(record.control) ?? asRecord(record.data) ?? record;
  return { envelope: record, control: source };
}

function parseFields(source: Record<string, unknown>): {
  desiredConfigurationHash: string | null;
  imageRevision: string | null;
} {
  const desiredConfigurationHash =
    typeof source.desired_configuration_hash === "string"
      ? source.desired_configuration_hash
      : null;
  const imageRevision =
    typeof source.image_revision === "string" ? source.image_revision : null;
  if (
    desiredConfigurationHash !== null &&
    !/^[a-f0-9]{64}$/.test(desiredConfigurationHash)
  ) {
    throw new Error("SaaS control desired configuration hash is invalid.");
  }
  if (imageRevision !== null && !/^sha256:[a-f0-9]{64}$/.test(imageRevision)) {
    throw new Error("SaaS control image revision is not an immutable image digest.");
  }
  return { desiredConfigurationHash, imageRevision };
}

function parseHealthObservation(
  value: unknown,
  appInstanceId: string,
  externalFence: TenantExternalOperationFence,
): SaaSControlObservation {
  const { envelope, control } = controlSource(value);
  const fields = parseFields(control);
  const instance = asRecord(control.instance);
  const apiVersion = control.control_api_version;
  return {
    ready:
      envelope.success === true &&
      typeof apiVersion === "string" &&
      /^1\.[0-9]+$/.test(apiVersion) &&
      instance !== null &&
      instance.external_instance_id === appInstanceId &&
      externalOperationMatches(control, externalFence) &&
      fields.imageRevision !== null,
    ...fields,
  };
}

function parseReconciledObservation(
  value: unknown,
  appInstanceId: string,
  externalFence: TenantExternalOperationFence,
): SaaSControlObservation {
  const { envelope, control } = controlSource(value);
  const fields = parseFields(control);
  const instance = asRecord(control.instance);
  const apiVersion = control.control_api_version;
  return {
    // `success: true` only means the endpoint answered. Readiness requires an
    // authenticated control receipt bound to this instance, active state, a
    // desired hash, and an immutable image digest. The worker then compares
    // both values to its persisted deployment plan before committing ready.
    ready:
      envelope.success === true &&
      typeof apiVersion === "string" &&
      /^1\.[0-9]+$/.test(apiVersion) &&
      instance?.status === "active" &&
      instance.external_instance_id === appInstanceId &&
      externalOperationMatches(control, externalFence) &&
      fields.desiredConfigurationHash !== null &&
      fields.imageRevision !== null,
    ...fields,
  };
}

export function assertCompiledProvisioningPayload(input: {
  payload: Record<string, unknown>;
  appInstanceId: string;
  externalFence: TenantExternalOperationFence;
}): void {
  assertActiveControlFence(input.externalFence, input.appInstanceId);
  const keys = Object.keys(input.payload);
  const allowed = new Set(["instance", "entitlements", "default_store", "first_owner"]);
  if (
    keys.some((key) => !allowed.has(key)) ||
    !["instance", "entitlements", "default_store", "first_owner"].every((key) =>
      Object.hasOwn(input.payload, key),
    )
  ) {
    throw new Error("SaaS provision payload must use the compiled v2 control shape.");
  }
  const instance = input.payload.instance;
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    throw new Error("Compiled SaaS provision payload is missing instance metadata.");
  }
  const instanceRecord = instance as Record<string, unknown>;
  if (instanceRecord.external_instance_id !== input.appInstanceId) {
    throw new Error("Compiled SaaS provision instance identity does not match the job.");
  }
  const metadata = instanceRecord.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Compiled SaaS provision metadata is missing.");
  }
  const metadataRecord = metadata as Record<string, unknown>;
  if (!/^[a-f0-9]{64}$/.test(String(metadataRecord.configuration_hash ?? ""))) {
    throw new Error("Compiled SaaS provision configuration hash is invalid.");
  }
  if (!externalOperationMatches(metadataRecord, input.externalFence)) {
    throw Object.assign(
      new Error("Compiled SaaS provision metadata uses a stale external epoch."),
      { code: "SAAS_CONTROL_EXTERNAL_EPOCH_MISMATCH", retryable: false },
    );
  }
  for (const key of ["entitlements", "default_store", "first_owner"] as const) {
    const value = input.payload[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Compiled SaaS provision payload field ${key} is invalid.`);
    }
  }
}

function assertSuccessfulResponse(status: number, body: unknown): void {
  if (status < 200 || status >= 300) {
    const error = new Error(`SaaS control request failed with HTTP ${status}.`);
    Object.assign(error, {
      code: status >= 500 || status === 408 || status === 429
        ? "SAAS_CONTROL_RETRYABLE"
        : "SAAS_CONTROL_REJECTED",
      retryable: status >= 500 || status === 408 || status === 429,
    });
    throw error;
  }
  if (!body || typeof body !== "object") {
    throw new Error("SaaS control response body is invalid.");
  }
}

function assertProvisionReceipt(
  body: unknown,
  externalFence: TenantExternalOperationFence,
): void {
  const receipt = asRecord(body);
  if (
    receipt?.success !== true ||
    typeof receipt.replayed !== "boolean" ||
    !externalOperationMatches(receipt, externalFence)
  ) {
    const error = new Error("SaaS provision response did not contain a trusted idempotency receipt.");
    Object.assign(error, {
      code: "SAAS_CONTROL_INVALID_RECEIPT",
      retryable: false,
    });
    throw error;
  }
}

export class MtlsSaaSControlClient implements SaaSControlPort {
  private readonly transport: SaaSControlTransport;
  private readonly tokenProvider: SaaSControlTokenProvider;
  private readonly baseDomain: string;

  constructor(
    transport: SaaSControlTransport,
    tokenProvider: SaaSControlTokenProvider,
    endpointPolicy: SaaSControlEndpointPolicy,
  ) {
    this.transport = transport;
    this.tokenProvider = tokenProvider;
    this.baseDomain = assertSaaSControlBaseDomain(endpointPolicy.baseDomain);
  }

  private async request(input: {
    method: "GET" | "POST";
    appInstanceId: string;
    hostname: string;
    path: string;
    idempotencyKey?: string;
    body?: Record<string, unknown>;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<unknown> {
    input.signal.throwIfAborted();
    assertActiveControlFence(input.externalFence, input.appInstanceId);
    assertSaaSControlTenantHostname({
      hostname: input.hostname,
      baseDomain: this.baseDomain,
    });
    const audience = `speedfeast-instance:${input.appInstanceId}`;
    const token = await this.tokenProvider.issue({
      instanceId: input.appInstanceId,
      audience,
      scope: "speedfeast:control",
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    const response = await this.transport.send(
      {
        method: input.method,
        url: `https://${input.hostname}:8443${input.path}`,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          host: input.hostname,
          ...(input.body ? { "content-type": "application/json" } : {}),
          ...(input.idempotencyKey
            ? { "idempotency-key": input.idempotencyKey }
            : {}),
          "x-techlong-external-operation-epoch": String(
            input.externalFence.epoch,
          ),
          "x-techlong-external-operation-intent": input.externalFence.intent,
          "x-techlong-external-operation-marker": input.externalFence.marker,
          "x-techlong-external-operation-hash":
            input.externalFence.operationHash,
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      },
      { signal: input.signal },
    );
    assertSuccessfulResponse(response.status, response.body);
    return response.body;
  }

  async waitUntilHealthy(input: {
    appInstanceId: string;
    hostname: string;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<SaaSControlObservation> {
    input.signal.throwIfAborted();
    const body = await this.request({
      method: "GET",
      appInstanceId: input.appInstanceId,
      hostname: input.hostname,
      path: "/api/saas/control",
      externalFence: input.externalFence,
      signal: input.signal,
    });
    return parseHealthObservation(
      body,
      input.appInstanceId,
      input.externalFence,
    );
  }

  async provision(input: {
    appInstanceId: string;
    hostname: string;
    idempotencyKey: string;
    compiledPayload: Record<string, unknown>;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<{ accepted: true }> {
    try {
      input.signal.throwIfAborted();
      assertCompiledProvisioningPayload({
        payload: input.compiledPayload,
        appInstanceId: input.appInstanceId,
        externalFence: input.externalFence,
      });
      const requestHash = await sha256Hex(input.idempotencyKey);
      input.signal.throwIfAborted();
      const fencedIdempotencyKey =
        `tlctl-${requestHash.slice(0, 32)}-e${input.externalFence.epoch}-` +
        input.externalFence.operationHash.slice(0, 16);
      if (
        fencedIdempotencyKey.length < 8 ||
        fencedIdempotencyKey.length > 128 ||
        !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(fencedIdempotencyKey)
      ) {
        throw new Error("SaaS control fenced idempotency key is invalid.");
      }
      const body = await this.request({
        method: "POST",
        appInstanceId: input.appInstanceId,
        hostname: input.hostname,
        path: "/api/saas/provision",
        idempotencyKey: fencedIdempotencyKey,
        body: input.compiledPayload,
        externalFence: input.externalFence,
        signal: input.signal,
      });
      assertProvisionReceipt(body, input.externalFence);
      return { accepted: true };
    } finally {
      // The compiler injects this secret at the last possible boundary. It is
      // removed even when the request or receipt validation fails.
      clearFirstOwnerPassword(input.compiledPayload);
    }
  }

  async readConfiguration(input: {
    appInstanceId: string;
    hostname: string;
    externalFence: TenantExternalOperationFence;
    signal: AbortSignal;
  }): Promise<SaaSControlObservation> {
    input.signal.throwIfAborted();
    const body = await this.request({
      method: "GET",
      appInstanceId: input.appInstanceId,
      hostname: input.hostname,
      path: "/api/saas/control",
      externalFence: input.externalFence,
      signal: input.signal,
    });
    return parseReconciledObservation(
      body,
      input.appInstanceId,
      input.externalFence,
    );
  }
}

export class DisabledSaaSControlClient implements SaaSControlPort {
  private disabled(): never {
    const error = new Error("mTLS SaaS control transport is not configured.");
    Object.assign(error, {
      code: "SAAS_CONTROL_TRANSPORT_DISABLED",
      retryable: false,
    });
    throw error;
  }

  waitUntilHealthy(): Promise<SaaSControlObservation> {
    return Promise.reject(this.disabled());
  }

  provision(): Promise<{ accepted: true }> {
    return Promise.reject(this.disabled());
  }

  readConfiguration(): Promise<SaaSControlObservation> {
    return Promise.reject(this.disabled());
  }
}
