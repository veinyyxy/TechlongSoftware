import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { deriveExpressFirstOwnerPassword } from "../lib/deployments/execution/express-first-owner-derive.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { validateConfigurationSchema } from "../lib/templates/validation.ts";
import { createFirstOpenPrivateControlTransport, createFirstOpenRdsControl } from "../ops/platform-hosting-v1/first-open-rds-control.ts";
import { FIRST_OPEN_TASK_ROLE } from "../ops/platform-hosting-v1/first-open-task-identity.ts";

const hostname = "review-tenant.sandbox.techlong.cloud";
const albDnsName = "internal-reviewed-alb.ca-central-1.elb.amazonaws.com";
const signal = () => new AbortController().signal;
const req = { method: "GET", url: `https://${hostname}:8443/api/saas/control`, headers: { host: hostname } };

function transport({ addresses = ["10.31.10.5"], peer = "10.31.10.5", statusCode = 200, failure } = {}) {
  const trace = [];
  const port = createFirstOpenPrivateControlTransport({ hostname, albDnsName,
    clientCertificatePem: "offline-client-certificate", clientPrivateKeyPem: "offline-client-private-key",
    resolve: async name => { trace.push(name); return addresses.map(address => ({ address, family: 4 })); },
    request(options, receive) {
      trace.push(options);
      const client = new EventEmitter();
      client.end = body => {
        trace.push(body);
        queueMicrotask(() => failure ? client.emit("error", failure) : receive(Object.assign(
          Readable.from(['{"sampled":true}']), { statusCode, socket: { remoteAddress: peer, authorized: true } })));
      };
      return client;
    },
  });
  return { port, trace };
}

test("control dials a DNS-checked internal IPv4 address and preserves exact tenant SNI, Host and CA checks", async () => {
  const { port, trace } = transport();
  assert.deepEqual(await port.send(req, { signal: signal() }), { status: 200, body: { sampled: true } });
  const [resolved, options] = trace;
  assert.equal(resolved, albDnsName);
  assert.equal(options.hostname, "10.31.10.5");
  assert.equal(options.servername, hostname);
  assert.equal(options.headers.host, hostname);
  assert.equal(options.port, 8443);
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.checkServerIdentity("irrelevant", { subjectaltname: `DNS:${hostname}` }), undefined);
  assert.equal(options.checkServerIdentity("irrelevant", { subjectaltname: "DNS:other.example" }).code, "ERR_TLS_CERT_ALTNAME_INVALID");
});

test("control rejects other destinations and DNS with any non-private IPv4, and never follows a redirect", async () => {
  const { port, trace } = transport({ addresses: ["10.31.10.5", "192.0.2.42"] });
  await assert.rejects(port.send({ ...req, url: req.url.replace(hostname, "other.sandbox.techlong.cloud") }, { signal: signal() }), /ENDPOINT_SCOPE/);
  await assert.rejects(port.send({ ...req, url: req.url + "?from=public" }, { signal: signal() }), /ENDPOINT_SCOPE/);
  assert.deepEqual(trace, []);
  await assert.rejects(port.send(req, { signal: signal() }), /PRIVATE_DNS_SCOPE/);
  assert.deepEqual(trace, [albDnsName]);
  const foreign = transport({ peer: "10.31.20.5" });
  await assert.rejects(foreign.port.send(req, { signal: signal() }), /TRANSPORT_UNCONFIRMED/);
  const redirect = transport({ statusCode: 302 });
  assert.equal((await redirect.port.send(req, { signal: signal() })).status, 302);
  assert.equal(redirect.trace.length, 3);
});

const now = 1_800_000_000_000;
const appInstanceId = "app_review_tenant";
const workspaceId = "ws_review_workspace";
const productId = "prd_restaurant_order_system";
const templateVersionId = "tplver_" + "d".repeat(32);
const environmentId = "env_aws_sandbox_ca_central_1";
const stableIdentityHash = "e".repeat(64);
const ownerDeploymentId = "dep_review_tenant";
const fence = { schemaVersion: 1, intent: "provision", state: "active", epoch: 1, ownerDeploymentId,
  operationHash: "6".repeat(64), marker: `tl_epoch_${stableIdentityHash.slice(0, 24)}_g1_e1`,
  resourceFence: { schemaVersion: 1, generation: 1, ownerDeploymentId, ownershipMarker: `tl_owner_${stableIdentityHash.slice(0, 32)}_g1`,
    identity: { schemaVersion: 1, appInstanceId, workspaceId, productId, environmentId, cellKey: "cell-sandbox-1",
      databaseName: "tenant_review_db", roleName: "tenant_review_role", secretName: "techlong/sandbox/tenant/review_tenant/runtime", stableIdentityHash } } };
const secretPrefix = "arn:aws:secretsmanager:ca-central-1:402010193138:secret:";
const applicationSecret = { arn: secretPrefix + "techlong/sandbox/tenant/review_tenant/runtime/g1-abcdef", versionId: "4".repeat(32) };
const credentials = { arn: secretPrefix + "techlong/first-open/control-private-abcdef", versionId: "5".repeat(32), subject: "first-open-reviewed",
  signingPublicKeySha256: "2".repeat(64), clientCertificateSha256: "3".repeat(64), clientCaSha256: "4".repeat(64) };
const artifactRef = "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:" + "7".repeat(64);
const schema = { schemaVersion: 2, contract: "speedfeast-saas-control-v1", fields: [
  { key: "storeName", label: "Store name", type: "text", source: "customer", required: true,
    minLength: 1, maxLength: 120, outputPath: "/default_store/name" },
  { key: "ownerUsername", label: "Owner username", type: "text", source: "customer", required: true,
    minLength: 3, maxLength: 64, format: "merchant_username", outputPath: "/first_owner/username" },
  { key: "ownerDisplayName", label: "Owner display name", type: "text", source: "customer", required: true,
    minLength: 1, maxLength: 80, outputPath: "/first_owner/display_name" },
] };
const configuration = { storeName: "Synth Store", ownerUsername: "owner.one", ownerDisplayName: "Synth Owner" };
const configurationHash = await sha256Hex(configuration);
const configurationSchemaSha256 = await sha256Hex(validateConfigurationSchema(schema).data);
const context = { appInstance: { id: appInstanceId, workspaceId, productId, templateVersionId }, tenantExternalOperation: fence,
  deployment: { id: ownerDeploymentId, appInstanceId, environmentId, artifactRef, configurationHash } };
const target = { hostname, appInstanceId, externalFence: fence, signal: signal() };
const hmac = Buffer.alloc(32, 65);

function fixture({ active = true, wrongVersion = false, changedSchema = false } = {}) {
  const trace = [];
  const readDb = { prepare(sql) { return { bind(...values) { return { async all() {
    trace.push(values);
    if (sql.includes("public.app_instances")) return { results: [{ id: appInstanceId, template_version_id: templateVersionId,
      configuration_snapshot: JSON.stringify(configuration) }] };
    assert.match(sql, /public\.app_instance_template_versions/);
    return { results: [{ id: templateVersionId, status: "published",
      configuration_schema: JSON.stringify(changedSchema ? { ...schema, fields: schema.fields.slice(0, 2) } : schema) }] };
  } }; } }; } };
  const ports = createFirstOpenRdsControl({ identity: { roleArn: FIRST_OPEN_TASK_ROLE, credentials() { assert.fail("offline credentials"); } },
    fence, hostname, albDnsName, templateVersionId, configurationHash, configurationSchemaSha256, artifactRef,
    writeBefore: now + 10_000, readDb, credentials, applicationSecret, now: () => now,
    async assertActive(requestFence) { trace.push("active"); assert.deepEqual(requestFence, fence); if (!active) throw Error("fixture lease not active"); },
  }, { async readSecret(command) {
    trace.push(command.input);
    return { ARN: command.input.SecretId, VersionId: wrongVersion ? "f".repeat(32) : command.input.VersionId,
      SecretString: command.input.SecretId === applicationSecret.arn ? JSON.stringify({ database_url: "offline", hmac_secret_key: hmac.toString("base64url"),
        jwt_secret_key: "offline", stripe_secret_key: "offline", stripe_webhook_secret: "offline" }) : "{}" };
  }, transport() { assert.fail("offline control connection must not be attempted"); } });
  const compile = () => ports.controlPayloadCompiler.compile({ context, configurationHash, externalFence: fence, signal: signal() });
  return { ...ports, compile, trace };
}

test("owner payload uses readonly exact template and app Secret version only after the active fence", async () => {
  const { controlClient, compile, trace } = fixture();
  assert.deepEqual(trace, []);
  const { compiledPayload } = await compile();
  assert.deepEqual(trace.slice(0, 4), ["active", [appInstanceId, workspaceId, productId, templateVersionId], [templateVersionId], "active"]);
  assert.deepEqual(trace[4], { SecretId: applicationSecret.arn, VersionId: applicationSecret.versionId });
  const expected = deriveExpressFirstOwnerPassword(hmac, { stableIdentity: stableIdentityHash, appInstanceId, templateVersionId,
    generation: 1, versionId: applicationSecret.versionId }).toString("base64url");
  assert.equal(compiledPayload.first_owner.password, expected);
  const post = { ...target, compiledPayload, idempotencyKey: `${ownerDeploymentId}:${configurationHash}` };
  await assert.rejects(controlClient.provision(post), /CREDENTIAL_MATERIAL/);
  assert.equal("password" in compiledPayload.first_owner, false);
  await assert.rejects(controlClient.provision(post), /PROVISION_SCOPE/);
  assert.equal(trace.filter(event => event?.SecretId === credentials.arn).length, 1);
  assert.deepEqual(trace.at(-1), { SecretId: credentials.arn, VersionId: credentials.versionId });
});

test("control rejects a missing active lease, mismatched immutable config and a different provider Secret version", async () => {
  const inactive = fixture({ active: false });
  await assert.rejects(inactive.controlClient.waitUntilHealthy(target), /lease not active/);
  await assert.rejects(inactive.compile(), /lease not active/);
  assert.deepEqual(inactive.trace, ["active", "active"]);
  const wrongSchema = fixture({ changedSchema: true });
  await assert.rejects(wrongSchema.compile(), /TEMPLATE_BINDING/);
  assert.equal(wrongSchema.trace.some(event => event?.SecretId), false);
  const wrongSecret = fixture({ wrongVersion: true });
  await assert.rejects(wrongSecret.compile(), /SECRET_BINDING/);
  const wrongTarget = fixture();
  await assert.rejects(wrongTarget.controlClient.waitUntilHealthy({ ...target, appInstanceId: "app_other" }), /ENDPOINT_SCOPE/);
  assert.deepEqual(wrongTarget.trace, []);
});
