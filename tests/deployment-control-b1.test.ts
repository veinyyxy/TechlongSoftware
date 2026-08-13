import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import {
  createPublicKey,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import test from "node:test";

import { MtlsSaaSControlClient } from "../lib/deployments/execution/control-client.ts";
import {
  assertPrivateControlUrl,
  NodeMtlsSaaSControlTransport,
} from "../lib/deployments/execution/control-https-transport.ts";
import { Rs256SaaSControlTokenProvider } from "../lib/deployments/execution/control-jwt.ts";
import {
  ImmutableTemplateSaaSControlPayloadCompiler,
  type FirstOwnerPasswordLease,
} from "../lib/deployments/execution/control-payload.ts";
import {
  clearFirstOwnerPassword,
  redactControlSecrets,
} from "../lib/deployments/execution/control-secret-redaction.ts";
import type {
  DeploymentExecutionContext,
  TenantExternalOperationFence,
} from "../lib/deployments/execution/contracts.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import type {
  TemplateConfiguration,
  TemplateConfigurationSchema,
} from "../lib/templates/validation.ts";

const appInstanceId = "app_tenant_one";
const templateVersionId = "tplver_restaurant_v2";
const imageRevision = `sha256:${"a".repeat(64)}`;
const desiredConfigurationHash = "b".repeat(64);
const signal = () => new AbortController().signal;

function controlFence(epoch = 3): TenantExternalOperationFence {
  const stableIdentityHash = "8".repeat(64);
  const resourceFence = {
    schemaVersion: 1 as const,
    identity: {
      schemaVersion: 1 as const,
      appInstanceId,
      workspaceId: "wsp_one",
      productId: "prd_restaurant",
      environmentId: "env_sandbox",
      cellKey: "cell-sandbox-1",
      databaseName: "tenant_one_db",
      roleName: "tenant_one_role",
      secretName: "techlong/sandbox/tenant/tenant_one/runtime",
      stableIdentityHash,
    },
    generation: 1,
    ownerDeploymentId: "dep_tenant_one",
    ownershipMarker: `tl_owner_${stableIdentityHash.slice(0, 32)}_g1`,
  };
  return {
    schemaVersion: 1,
    resourceFence,
    epoch,
    intent: "provision",
    ownerDeploymentId: resourceFence.ownerDeploymentId,
    operationHash: "9".repeat(64),
    marker: `tl_epoch_${stableIdentityHash.slice(0, 24)}_g1_e${epoch}`,
    state: "active",
  };
}

const externalFence = controlFence();

function externalControlFields(
  fence: TenantExternalOperationFence = externalFence,
) {
  return {
    external_operation_epoch: fence.epoch,
    external_operation_intent: fence.intent,
    external_operation_marker: fence.marker,
    external_operation_hash: fence.operationHash,
  };
}

function executionContext(): DeploymentExecutionContext {
  return {
    deployment: {
      artifactRef: `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@${imageRevision}`,
    },
    appInstance: {
      id: appInstanceId,
      templateVersionId,
      configurationSnapshot: { raw_snapshot_must_not_be_forwarded: "sentinel" },
    },
    tenantExternalOperation: externalFence,
  } as unknown as DeploymentExecutionContext;
}

const schema: TemplateConfigurationSchema = {
  schemaVersion: 2,
  contract: "speedfeast-saas-control-v1",
  fields: [
    {
      key: "storeName",
      label: "Store name",
      type: "text",
      source: "customer",
      required: true,
      minLength: 1,
      maxLength: 120,
      outputPath: "/default_store/name",
    },
    {
      key: "ownerUsername",
      label: "Owner username",
      type: "text",
      source: "customer",
      required: true,
      minLength: 3,
      maxLength: 64,
      format: "merchant_username",
      outputPath: "/first_owner/username",
    },
    {
      key: "ownerDisplayName",
      label: "Owner display name",
      type: "text",
      source: "customer",
      required: true,
      minLength: 1,
      maxLength: 80,
      outputPath: "/first_owner/display_name",
    },
  ],
};

const resolvedConfiguration: TemplateConfiguration = {
  storeName: "Tenant One",
  ownerUsername: "owner.one",
  ownerDisplayName: "Tenant Owner",
};

test("RS256 provider issues a short-lived instance-bound control JWT", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = createPublicKey(privateKey);
  const provider = new Rs256SaaSControlTokenProvider({
    issuer: "https://console.techlong.cloud",
    subject: "deployment-worker",
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    keyId: "control-key-v1",
    lifetimeSeconds: 45,
    now: () => 1_800_000_000_000,
    jti: () => "jti-fixed-0001",
  });
  const token = await provider.issue({
    instanceId: appInstanceId,
    audience: `speedfeast-instance:${appInstanceId}`,
    scope: "speedfeast:control",
    signal: signal(),
  });
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "RS256",
    typ: "JWT",
    kid: "control-key-v1",
  });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
    iss: "https://console.techlong.cloud",
    aud: `speedfeast-instance:${appInstanceId}`,
    sub: "deployment-worker",
    instance_id: appInstanceId,
    scope: "speedfeast:control",
    iat: 1_800_000_000,
    exp: 1_800_000_045,
    jti: "jti-fixed-0001",
  });
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  await assert.rejects(
    () =>
      provider.issue({
        instanceId: appInstanceId,
        audience: "speedfeast-instance:another-instance",
        scope: "speedfeast:control",
        signal: signal(),
      }),
    /audience is not bound/,
  );

  const weakKey = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey;
  assert.throws(
    () =>
      new Rs256SaaSControlTokenProvider({
        issuer: "https://console.techlong.cloud",
        subject: "deployment-worker",
        privateKeyPem: weakKey.export({ format: "pem", type: "pkcs8" }).toString(),
      }),
    /at least 2048 bits/,
  );
});

test("immutable compiler loads the bound version and disposes the owner secret lease", async () => {
  const configurationHash = await sha256Hex(canonicalJson(resolvedConfiguration));
  let disposed = false;
  let leased = 0;
  const lease: FirstOwnerPasswordLease = {
    read: () => "one-time-password-123",
    dispose: () => {
      disposed = true;
    },
  };
  const compiler = new ImmutableTemplateSaaSControlPayloadCompiler({
    bindings: {
      loadForAppInstance: async ({ appInstanceId: requestedId }) => ({
        appInstanceId: requestedId,
        templateVersionId,
        resolvedConfiguration,
      }),
    },
    templateVersions: {
      loadById: async ({ templateVersionId: requestedId }) => ({
        id: requestedId,
        status: "published",
        configurationSchema: schema,
      }),
    },
    firstOwnerPasswords: {
      lease: async () => {
        leased += 1;
        return lease;
      },
    },
  });
  const result = await compiler.compile({
    context: executionContext(),
    configurationHash,
    externalFence,
    signal: signal(),
  });
  assert.equal(disposed, true);
  assert.equal(leased, 1);
  assert.equal(result.configurationHash, configurationHash);
  assert.deepEqual(result.compiledPayload.instance, {
    external_instance_id: appInstanceId,
    metadata: {
      configuration_hash: configurationHash,
      template_version_id: templateVersionId,
      image_revision: imageRevision,
      ...externalControlFields(),
    },
  });
  assert.deepEqual(result.compiledPayload.entitlements, {});
  assert.deepEqual(result.compiledPayload.default_store, { name: "Tenant One" });
  assert.deepEqual(result.compiledPayload.first_owner, {
    username: "owner.one",
    display_name: "Tenant Owner",
    password: "one-time-password-123",
  });
  assert.equal(
    JSON.stringify(result.compiledPayload).includes("raw_snapshot_must_not_be_forwarded"),
    false,
  );
});

test("immutable compiler rejects binding drift before leasing a secret", async () => {
  let leased = false;
  const compiler = new ImmutableTemplateSaaSControlPayloadCompiler({
    bindings: {
      loadForAppInstance: async () => ({
        appInstanceId,
        templateVersionId,
        resolvedConfiguration,
      }),
    },
    templateVersions: {
      loadById: async () => ({
        id: templateVersionId,
        status: "published",
        configurationSchema: schema,
      }),
    },
    firstOwnerPasswords: {
      lease: async () => {
        leased = true;
        throw new Error("must not lease");
      },
    },
  });
  await assert.rejects(
    () =>
      compiler.compile({
        context: executionContext(),
        configurationHash: "c".repeat(64),
        externalFence,
        signal: signal(),
      }),
    /does not match the persisted deployment configuration hash/,
  );
  assert.equal(leased, false);
});

test("immutable compiler rejects a template-version rebind before leasing a secret", async () => {
  let leased = false;
  const compiler = new ImmutableTemplateSaaSControlPayloadCompiler({
    bindings: {
      loadForAppInstance: async () => ({
        appInstanceId,
        templateVersionId: "tplver_other_v2",
        resolvedConfiguration,
      }),
    },
    templateVersions: {
      loadById: async () => null,
    },
    firstOwnerPasswords: {
      lease: async () => {
        leased = true;
        throw new Error("must not lease");
      },
    },
  });
  const configurationHash = await sha256Hex(canonicalJson(resolvedConfiguration));
  await assert.rejects(
    () =>
      compiler.compile({
        context: executionContext(),
        configurationHash,
        externalFence,
        signal: signal(),
      }),
    /binding changed after the deployment context was loaded/,
  );
  assert.equal(leased, false);
});

test("control readiness requires an active instance-bound reconciliation receipt", async () => {
  let responseBody: Record<string, unknown> = {};
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const client = new MtlsSaaSControlClient(
    {
      send: async (request) => {
        requests.push({ url: request.url, headers: request.headers });
        return { status: 200, body: responseBody };
      },
    },
    { issue: async () => "signed.jwt.value" },
    { baseDomain: "sandbox.techlong.cloud" },
  );
  responseBody = { success: true };
  assert.equal(
    (
      await client.readConfiguration({
        appInstanceId,
        hostname: "tenant-one.sandbox.techlong.cloud",
        externalFence,
        signal: signal(),
      })
    ).ready,
    false,
  );
  responseBody = {
    success: true,
    control: {
      control_api_version: "1.1",
      image_revision: imageRevision,
      desired_configuration_hash: desiredConfigurationHash,
      ...externalControlFields(),
      instance: {
        status: "active",
        external_instance_id: appInstanceId,
      },
    },
  };
  const reconciled = await client.readConfiguration({
    appInstanceId,
    hostname: "tenant-one.sandbox.techlong.cloud",
    externalFence,
    signal: signal(),
  });
  assert.equal(reconciled.ready, true);
  assert.equal(reconciled.desiredConfigurationHash, desiredConfigurationHash);
  assert.equal(reconciled.imageRevision, imageRevision);
  assert.equal(requests.at(-1)?.url, "https://tenant-one.sandbox.techlong.cloud:8443/api/saas/control");
  assert.equal(requests.at(-1)?.headers.host, "tenant-one.sandbox.techlong.cloud");
  assert.equal(
    requests.at(-1)?.headers["x-techlong-external-operation-epoch"],
    String(externalFence.epoch),
  );
  assert.equal(
    requests.at(-1)?.headers["x-techlong-external-operation-marker"],
    externalFence.marker,
  );

  responseBody = {
    success: true,
    control: {
      control_api_version: "1.1",
      image_revision: imageRevision,
      desired_configuration_hash: desiredConfigurationHash,
      ...externalControlFields(controlFence(2)),
      instance: {
        status: "active",
        external_instance_id: appInstanceId,
      },
    },
  };
  assert.equal(
    (
      await client.readConfiguration({
        appInstanceId,
        hostname: "tenant-one.sandbox.techlong.cloud",
        externalFence,
        signal: signal(),
      })
    ).ready,
    false,
  );

  responseBody = {
    ...responseBody,
    control: {
      ...(responseBody.control as Record<string, unknown>),
      instance: { status: "active", external_instance_id: "app_other" },
    },
  };
  assert.equal(
    (
      await client.readConfiguration({
        appInstanceId,
        hostname: "tenant-one.sandbox.techlong.cloud",
        externalFence,
        signal: signal(),
      })
    ).ready,
    false,
  );

  await assert.rejects(
    client.readConfiguration({
      appInstanceId,
      hostname: "tenant-one.sandbox.techlong.cloud",
      externalFence: { ...externalFence, marker: "tl_epoch_invalid" },
      signal: signal(),
    }),
    /exact active provision epoch/,
  );
});

test("provision validates its idempotency receipt and always clears the owner password", async () => {
  const payload = {
    instance: {
      external_instance_id: appInstanceId,
      metadata: {
        configuration_hash: desiredConfigurationHash,
        ...externalControlFields(),
      },
    },
    entitlements: {},
    default_store: { name: "Tenant One" },
    first_owner: {
      username: "owner.one",
      display_name: "Owner",
      password: "one-time-password-123",
    },
  };
  const client = new MtlsSaaSControlClient(
    { send: async () => ({ status: 201, body: { success: true } }) },
    { issue: async () => "signed.jwt.value" },
    { baseDomain: "sandbox.techlong.cloud" },
  );
  await assert.rejects(
    () =>
      client.provision({
        appInstanceId,
        hostname: "tenant-one.sandbox.techlong.cloud",
        idempotencyKey: `dep:${desiredConfigurationHash}`,
        compiledPayload: payload,
        externalFence,
        signal: signal(),
      }),
    /trusted idempotency receipt/,
  );
  assert.equal(Object.hasOwn(payload.first_owner, "password"), false);
});

test("provision binds its payload, short idempotency key and receipt to one epoch", async () => {
  let requestHeaders: Record<string, string> = {};
  const payload = {
    instance: {
      external_instance_id: appInstanceId,
      metadata: {
        configuration_hash: desiredConfigurationHash,
        ...externalControlFields(),
      },
    },
    entitlements: {},
    default_store: { name: "Tenant One" },
    first_owner: { password: "one-time-password-123" },
  };
  const client = new MtlsSaaSControlClient(
    {
      send: async (request) => {
        requestHeaders = request.headers;
        return {
          status: 201,
          body: {
            success: true,
            replayed: false,
            ...externalControlFields(),
          },
        };
      },
    },
    { issue: async () => "signed.jwt.value" },
    { baseDomain: "sandbox.techlong.cloud" },
  );
  assert.deepEqual(
    await client.provision({
      appInstanceId,
      hostname: "tenant-one.sandbox.techlong.cloud",
      idempotencyKey: `dep:${desiredConfigurationHash}`,
      compiledPayload: payload,
      externalFence,
      signal: signal(),
    }),
    { accepted: true },
  );
  assert.match(requestHeaders["idempotency-key"], /^tlctl-[a-f0-9]{32}-e3-[a-f0-9]{16}$/);
  assert.ok(requestHeaders["idempotency-key"].length <= 128);
  assert.equal(
    requestHeaders["x-techlong-external-operation-hash"],
    externalFence.operationHash,
  );
  assert.equal(Object.hasOwn(payload.first_owner, "password"), false);
});

test("an already-aborted control request makes zero token or transport calls", async () => {
  let tokenCalls = 0;
  let transportCalls = 0;
  const client = new MtlsSaaSControlClient(
    {
      send: async () => {
        transportCalls += 1;
        throw new Error("must not send");
      },
    },
    {
      issue: async () => {
        tokenCalls += 1;
        return "must-not-be-issued";
      },
    },
    { baseDomain: "sandbox.techlong.cloud" },
  );
  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await assert.rejects(
    client.readConfiguration({
      appInstanceId,
      hostname: "tenant-one.sandbox.techlong.cloud",
      externalFence,
      signal: controller.signal,
    }),
    /lease lost/,
  );
  assert.equal(tokenCalls, 0);
  assert.equal(transportCalls, 0);
});

test("mTLS transport rejects non-private endpoints and oversized bodies before I/O", async () => {
  assert.throws(
    () =>
      assertPrivateControlUrl(
        "https://tenant-one.sandbox.techlong.cloud/api/saas/control",
        "sandbox.techlong.cloud",
      ),
    /port 8443/,
  );
  assert.equal(
    assertPrivateControlUrl(
      "https://tenant-one.sandbox.techlong.cloud:8443/api/saas/control",
      "sandbox.techlong.cloud",
    ).hostname,
    "tenant-one.sandbox.techlong.cloud",
  );
  const transport = new NodeMtlsSaaSControlTransport({
    baseDomain: "sandbox.techlong.cloud",
    clientCertificatePem: "memory-only-client-certificate",
    clientPrivateKeyPem: "memory-only-client-private-key",
    trustedCaPem: "memory-only-trusted-ca",
    maxRequestBytes: 1,
  });
  await assert.rejects(
    () =>
      transport.send(
        {
          method: "POST",
          url: "https://tenant-one.sandbox.techlong.cloud:8443/api/saas/provision",
          headers: {},
          body: "{}",
        },
        { signal: signal() },
      ),
    /body cap/,
  );
  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await assert.rejects(
    transport.send(
      {
        method: "GET",
        url: "https://tenant-one.sandbox.techlong.cloud:8443/api/saas/control",
        headers: {},
      },
      { signal: controller.signal },
    ),
    /lease lost/,
  );
});

test("mTLS transport destroys an in-flight request with the same abort reason", async () => {
  const original = Object.getOwnPropertyDescriptor(https, "request");
  const request = new EventEmitter() as EventEmitter & {
    setTimeout: () => void;
    write: () => void;
    end: () => void;
    destroy: (error?: Error) => void;
  };
  let destroyedWith: Error | undefined;
  request.setTimeout = () => undefined;
  request.write = () => undefined;
  request.end = () => undefined;
  request.destroy = (error) => {
    destroyedWith = error;
  };
  Object.defineProperty(https, "request", {
    configurable: true,
    value: () => request,
  });
  try {
    const transport = new NodeMtlsSaaSControlTransport({
      baseDomain: "sandbox.techlong.cloud",
      clientCertificatePem: "memory-only-client-certificate",
      clientPrivateKeyPem: "memory-only-client-private-key",
      trustedCaPem: "memory-only-trusted-ca",
    });
    const controller = new AbortController();
    const pending = transport.send(
      {
        method: "GET",
        url: "https://tenant-one.sandbox.techlong.cloud:8443/api/saas/control",
        headers: {},
      },
      { signal: controller.signal },
    );
    const reason = new Error("lease lost during TLS request");
    controller.abort(reason);
    await assert.rejects(pending, /lease lost during TLS request/);
    assert.equal(destroyedWith, reason);
  } finally {
    if (original) Object.defineProperty(https, "request", original);
  }
});

test("control endpoint policy supports an exact production base domain without widening it", async () => {
  const requests: string[] = [];
  const client = new MtlsSaaSControlClient(
    {
      send: async (request) => {
        requests.push(request.url);
        return {
          status: 200,
          body: {
            success: true,
            control: {
              control_api_version: "1.1",
              image_revision: imageRevision,
              desired_configuration_hash: desiredConfigurationHash,
              ...externalControlFields(),
              instance: {
                status: "active",
                external_instance_id: appInstanceId,
              },
            },
          },
        };
      },
    },
    { issue: async () => "signed.jwt.value" },
    { baseDomain: "apps.techlong.cloud" },
  );
  assert.equal(
    (
      await client.readConfiguration({
        appInstanceId,
        hostname: "tenant-one.apps.techlong.cloud",
        externalFence,
        signal: signal(),
      })
    ).ready,
    true,
  );
  assert.equal(
    requests[0],
    "https://tenant-one.apps.techlong.cloud:8443/api/saas/control",
  );
  for (const hostname of [
    "apps.techlong.cloud",
    "nested.tenant-one.apps.techlong.cloud",
    "tenant-one.apps.techlong.cloud.attacker.example",
    "tenant-one.sandbox.techlong.cloud",
    " tenant-one.apps.techlong.cloud",
  ]) {
    await assert.rejects(
      () =>
        client.readConfiguration({
          appInstanceId,
          hostname,
          externalFence,
          signal: signal(),
        }),
      /outside the configured tenant domain/,
    );
  }
  assert.equal(
    assertPrivateControlUrl(
      "https://tenant-one.apps.techlong.cloud:8443/api/saas/control",
      "apps.techlong.cloud",
    ).hostname,
    "tenant-one.apps.techlong.cloud",
  );
  assert.throws(
    () =>
      assertPrivateControlUrl(
        "https://tenant-one.apps.techlong.cloud.attacker.example:8443/api/saas/control",
        "apps.techlong.cloud",
      ),
    /configured tenant domain/,
  );
});

test("secret redaction is recursive and first-owner clearing is narrow", () => {
  const payload = {
    first_owner: { username: "owner", password: "cleartext" },
    nested: { apiToken: "token-value", visible: "safe" },
  };
  assert.deepEqual(redactControlSecrets(payload), {
    first_owner: { username: "owner", password: "[REDACTED]" },
    nested: { apiToken: "[REDACTED]", visible: "safe" },
  });
  clearFirstOwnerPassword(payload);
  assert.deepEqual(payload.first_owner, { username: "owner" });
});
