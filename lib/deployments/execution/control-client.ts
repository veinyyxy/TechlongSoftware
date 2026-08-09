import type {
  SaaSControlObservation,
  SaaSControlPort,
} from "./contracts.ts";

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
  send(request: SaaSControlRequest): Promise<{
    status: number;
    body: unknown;
  }>;
}

export interface SaaSControlTokenProvider {
  issue(input: {
    instanceId: string;
    audience: string;
    scope: "speedfeast:control";
  }): Promise<string>;
}

function assertHostname(hostname: string): void {
  if (
    !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+sandbox\.techlong\.cloud$/.test(
      hostname,
    )
  ) {
    throw new Error("SaaS control hostname is outside the sandbox domain.");
  }
}

function parseObservation(value: unknown): SaaSControlObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SaaS control response is not an object.");
  }
  const record = value as Record<string, unknown>;
  const source =
    record.control && typeof record.control === "object" && !Array.isArray(record.control)
      ? (record.control as Record<string, unknown>)
      : record.data && typeof record.data === "object" && !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
      : record;
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
  return {
    ready: record.success === true || source.ready === true,
    desiredConfigurationHash,
    imageRevision,
  };
}

export function assertCompiledProvisioningPayload(input: {
  payload: Record<string, unknown>;
  appInstanceId: string;
}): void {
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
  if (!/^[a-f0-9]{64}$/.test(String((metadata as Record<string, unknown>).configuration_hash ?? ""))) {
    throw new Error("Compiled SaaS provision configuration hash is invalid.");
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

export class MtlsSaaSControlClient implements SaaSControlPort {
  private readonly transport: SaaSControlTransport;
  private readonly tokenProvider: SaaSControlTokenProvider;

  constructor(
    transport: SaaSControlTransport,
    tokenProvider: SaaSControlTokenProvider,
  ) {
    this.transport = transport;
    this.tokenProvider = tokenProvider;
  }

  private async request(input: {
    method: "GET" | "POST";
    appInstanceId: string;
    hostname: string;
    path: string;
    idempotencyKey?: string;
    body?: Record<string, unknown>;
  }): Promise<unknown> {
    assertHostname(input.hostname);
    const audience = `speedfeast-instance:${input.appInstanceId}`;
    const token = await this.tokenProvider.issue({
      instanceId: input.appInstanceId,
      audience,
      scope: "speedfeast:control",
    });
    const response = await this.transport.send({
      method: input.method,
      url: `https://${input.hostname}:8443${input.path}`,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(input.body ? { "content-type": "application/json" } : {}),
        ...(input.idempotencyKey
          ? { "idempotency-key": input.idempotencyKey }
          : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    });
    assertSuccessfulResponse(response.status, response.body);
    return response.body;
  }

  async waitUntilHealthy(input: {
    appInstanceId: string;
    hostname: string;
  }): Promise<SaaSControlObservation> {
    const body = await this.request({
      method: "GET",
      appInstanceId: input.appInstanceId,
      hostname: input.hostname,
      path: "/api/saas/control",
    });
    return parseObservation(body);
  }

  async provision(input: {
    appInstanceId: string;
    hostname: string;
    idempotencyKey: string;
    compiledPayload: Record<string, unknown>;
  }): Promise<{ accepted: true }> {
    assertCompiledProvisioningPayload({
      payload: input.compiledPayload,
      appInstanceId: input.appInstanceId,
    });
    const body = await this.request({
      method: "POST",
      appInstanceId: input.appInstanceId,
      hostname: input.hostname,
      path: "/api/saas/provision",
      idempotencyKey: input.idempotencyKey,
      body: input.compiledPayload,
    });
    void body;
    return { accepted: true };
  }

  async readConfiguration(input: {
    appInstanceId: string;
    hostname: string;
  }): Promise<SaaSControlObservation> {
    const body = await this.request({
      method: "GET",
      appInstanceId: input.appInstanceId,
      hostname: input.hostname,
      path: "/api/saas/control",
    });
    return parseObservation(body);
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
