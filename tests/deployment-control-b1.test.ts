import assert from "node:assert/strict";
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
import type { DeploymentExecutionContext } from "../lib/deployments/execution/contracts.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import type {
  TemplateConfiguration,
  TemplateConfigurationSchema,
} from "../lib/templates/validation.ts";

const appInstanceId = "app_tenant_one";
const templateVersionId = "tplver_restaurant_v2";
const imageRevision = `sha256:${"a".repeat(64)}`;
const desiredConfigurationHash = "b".repeat(64);

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
      instance: {
        status: "active",
        external_instance_id: appInstanceId,
      },
    },
  };
  const reconciled = await client.readConfiguration({
    appInstanceId,
    hostname: "tenant-one.sandbox.techlong.cloud",
  });
  assert.equal(reconciled.ready, true);
  assert.equal(reconciled.desiredConfigurationHash, desiredConfigurationHash);
  assert.equal(reconciled.imageRevision, imageRevision);
  assert.equal(requests.at(-1)?.url, "https://tenant-one.sandbox.techlong.cloud:8443/api/saas/control");
  assert.equal(requests.at(-1)?.headers.host, "tenant-one.sandbox.techlong.cloud");

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
      })
    ).ready,
    false,
  );
});

test("provision validates its idempotency receipt and always clears the owner password", async () => {
  const payload = {
    instance: {
      external_instance_id: appInstanceId,
      metadata: { configuration_hash: desiredConfigurationHash },
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
      }),
    /trusted idempotency receipt/,
  );
  assert.equal(Object.hasOwn(payload.first_owner, "password"), false);
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
      transport.send({
        method: "POST",
        url: "https://tenant-one.sandbox.techlong.cloud:8443/api/saas/provision",
        headers: {},
        body: "{}",
      }),
    /body cap/,
  );
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
      () => client.readConfiguration({ appInstanceId, hostname }),
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
