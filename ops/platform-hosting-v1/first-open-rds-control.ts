import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Agent, request as httpsRequest, type RequestOptions } from "node:https";
import { isIPv4, type LookupFunction } from "node:net";
import { checkServerIdentity, rootCertificates, type TLSSocket } from "node:tls";
import { GetSecretValueCommand, SecretsManagerClient, type GetSecretValueCommandOutput } from "@aws-sdk/client-secrets-manager";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { MtlsSaaSControlClient, type SaaSControlTransport } from "../../lib/deployments/execution/control-client.ts";
import { assertPrivateControlUrl } from "../../lib/deployments/execution/control-https-transport.ts";
import { Rs256SaaSControlTokenProvider } from "../../lib/deployments/execution/control-jwt.ts";
import { ImmutableTemplateSaaSControlPayloadCompiler } from "../../lib/deployments/execution/control-payload.ts";
import { clearFirstOwnerPassword } from "../../lib/deployments/execution/control-secret-redaction.ts";
import type { SaaSControlPayloadCompilerPort, SaaSControlPort, TenantExternalOperationFence } from "../../lib/deployments/execution/contracts.ts";
import { deriveExpressFirstOwnerPassword } from "../../lib/deployments/execution/express-first-owner-derive.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { tenantRuntimeSecretExactJsonKeys } from "../../lib/deployments/execution/tenant-aws-one-shot-adapters.ts";
import { deriveTenantRuntimeSecretName } from "../../lib/deployments/execution/tenant-database.ts";
import { validateConfigurationSchema, type TemplateConfiguration } from "../../lib/templates/validation.ts";
import { FIRST_OPEN_TASK_ACCOUNT as account, FIRST_OPEN_TASK_REGION as region, FIRST_OPEN_TASK_ROLE as roleArn,
  type attestFirstOpenTask } from "./first-open-task-identity.ts";

type Task = Pick<Awaited<ReturnType<typeof attestFirstOpenTask>>, "roleArn" | "credentials">;
type SecretPin = { arn: string; versionId: string };
export type FirstOpenRdsControlCredentialPin = SecretPin & {
  subject: string;
  signingPublicKeySha256: string;
  clientCertificateSha256: string;
  clientCaSha256: string;
};
type KeyMaterial = { signingPrivateKeyPem: string; signingPublicKeyPem: string; clientCertificatePem: string; clientPrivateKeyPem: string; clientCaPem: string };
type ReadSecret = (request: GetSecretValueCommand, signal: AbortSignal) => Promise<GetSecretValueCommandOutput>;
type Resolve = (hostname: string) => Promise<readonly { address: string; family: number }[]>;
type Request = (options: RequestOptions, receive: (response: IncomingMessage) => void) => ClientRequest;
const baseDomain = "sandbox.techlong.cloud";
const hostPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sandbox\.techlong\.cloud$/;
const albPattern = /^internal-[a-z0-9-]{2,128}\.ca-central-1\.elb\.amazonaws\.com$/;
const hash = /^[a-f0-9]{64}$/;
const version = /^[A-Za-z0-9-]{32,64}$/;
const secretPrefix = `arn:aws:secretsmanager:${region}:${account}:secret:`;
const keyNames = ["clientCaPem", "clientCertificatePem", "clientPrivateKeyPem", "signingPrivateKeyPem", "signingPublicKeyPem"];
const resolveV4: Resolve = hostname => lookup(hostname, { all: true, family: 4 });
const requestTimeoutMs = 8_000;

function fail(reason: string, retryable = false): never {
  const code = `ECS_FIRST_OPEN_CONTROL_${reason}`;
  throw Object.assign(Error(code), { code, retryable });
}

function privateIpv4(address: string) {
  if (!isIPv4(address)) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

async function resolvePrivate(hostname: string, resolve: Resolve) {
  const records = await resolve(hostname).catch(() => fail("PRIVATE_DNS_UNAVAILABLE", true));
  if (!records.length || records.some(row => row.family !== 4 || !privateIpv4(row.address))) fail("PRIVATE_DNS_SCOPE");
  return records;
}

/** The older frozen transport only connects to the public tenant DNS name.
 * This leaf keeps tenant SNI and Host while dialing one checked private ALB IP. */
export function createFirstOpenPrivateControlTransport({ hostname, albDnsName, clientCertificatePem, clientPrivateKeyPem,
  resolve = resolveV4, request = httpsRequest,
}: { hostname: string; albDnsName: string; clientCertificatePem: string; clientPrivateKeyPem: string; resolve?: Resolve; request?: Request }): SaaSControlTransport {
  if (!hostPattern.test(hostname) || !albPattern.test(albDnsName)) fail("ENDPOINT_SCOPE");
  return Object.freeze<SaaSControlTransport>({ async send(input, { signal }) {
    signal.throwIfAborted();
    const url = assertPrivateControlUrl(input.url, baseDomain);
    const path = input.method === "GET" ? "/api/saas/control" : "/api/saas/provision";
    if ((input.method !== "GET" && input.method !== "POST") || url.hostname !== hostname || url.pathname !== path || url.search ||
      (input.method === "POST") !== (typeof input.body === "string")) fail("ENDPOINT_SCOPE");
    const bodyBytes = input.body === undefined ? 0 : Buffer.byteLength(input.body);
    if (bodyBytes > 262_144) fail("REQUEST_SIZE");
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
    const [{ address }] = await resolvePrivate(albDnsName, resolve);
    deadline.throwIfAborted();
    return new Promise((resolve, reject) => {
      const rejectTransport = () => {
        try { signal.throwIfAborted(); fail("TRANSPORT_UNCONFIRMED", true); }
        catch (error) { reject(error); }
      };
      try {
        const req = request({ protocol: "https:", hostname: address, port: 8443, family: 4, path, method: input.method,
          servername: hostname, checkServerIdentity: (_host, cert) => checkServerIdentity(hostname, cert),
          cert: clientCertificatePem, key: clientPrivateKeyPem, ca: rootCertificates.join("\n"), minVersion: "TLSv1.2",
          rejectUnauthorized: true, agent: false, signal: deadline,
          headers: { ...input.headers, host: hostname, ...(input.body && { "content-length": String(bodyBytes) }) },
        }, async response => {
          try {
            const socket = response.socket as TLSSocket;
            if (socket.authorized !== true || socket.remoteAddress !== address) fail("PEER_SCOPE");
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of response) {
              deadline.throwIfAborted();
              const bytes = Buffer.from(chunk);
              size += bytes.byteLength;
              if (size > 1_048_576) fail("RESPONSE_SIZE");
              chunks.push(bytes);
            }
            const body = size ? JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown : {};
            resolve({ status: response.statusCode ?? 0, body });
          } catch {
            response.destroy();
            rejectTransport();
          }
        });
        req.once("error", rejectTransport);
        req.end(input.body);
      } catch { rejectTransport(); }
    });
  } });
}

export function createFirstOpenPrivateSecretReader(identity: Task): ReadSecret {
  const hostname = `secretsmanager.${region}.amazonaws.com`;
  const privateLookup: LookupFunction = (name, options, callback) => {
    if (name !== hostname) return callback(Error("ECS_FIRST_OPEN_CONTROL_SECRET_ENDPOINT"), "");
    void resolvePrivate(hostname, resolveV4).then(rows => {
      if (options.all) callback(null, [...rows]);
      else callback(null, rows[0].address, 4);
    }, (error: Error) => callback(error, ""));
  };
  const secrets = new SecretsManagerClient({ region, credentials: identity.credentials, endpoint: `https://${hostname}`,
    maxAttempts: 1, ignoreConfiguredEndpointUrls: true, requestHandler: new NodeHttpHandler({
      connectionTimeout: 4_000, requestTimeout: requestTimeoutMs, throwOnRequestTimeout: true,
      httpsAgent: new Agent({ lookup: privateLookup, family: 4, keepAlive: false, rejectUnauthorized: true, minVersion: "TLSv1.2" }),
    }) });
  return (command, signal) => secrets.send(command, { abortSignal: signal });
}

function decodeObject(raw: unknown, limit: number, reason: string): Record<string, unknown> {
  if (typeof raw === "string" && Buffer.byteLength(raw) <= limit) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* report only the binding category */ }
  }
  return fail(reason);
}

function exactStrings(value: Record<string, unknown>, names: readonly string[]) {
  return Object.keys(value).length === names.length && names.every(name =>
    typeof value[name] === "string" && value[name].length > 0 && value[name].length <= 12_288);
}

async function checkCredentials(value: Record<string, unknown>, pin: FirstOpenRdsControlCredentialPin, now: number, through: number) {
  if (!exactStrings(value, keyNames)) fail("CREDENTIAL_MATERIAL");
  const keys = value as KeyMaterial;
  if (await sha256Hex(keys.signingPublicKeyPem) !== pin.signingPublicKeySha256 ||
    await sha256Hex(keys.clientCertificatePem) !== pin.clientCertificateSha256 ||
    await sha256Hex(keys.clientCaPem) !== pin.clientCaSha256) fail("CREDENTIAL_MATERIAL");
  try {
    const signer = createPrivateKey(keys.signingPrivateKeyPem), publicKey = createPublicKey(keys.signingPublicKeyPem);
    const cert = new X509Certificate(keys.clientCertificatePem), ca = new X509Certificate(keys.clientCaPem);
    if (signer.asymmetricKeyType !== "rsa" || signer.asymmetricKeyDetails?.modulusLength !== 3072 ||
      !createPublicKey(signer).export({ type: "spki", format: "der" }).equals(publicKey.export({ type: "spki", format: "der" })) ||
      !ca.ca || !ca.checkIssued(ca) || !ca.verify(ca.publicKey) || cert.ca || !cert.checkIssued(ca) || !cert.verify(ca.publicKey) ||
      !cert.checkPrivateKey(createPrivateKey(keys.clientPrivateKeyPem)) || canonicalJson(cert.keyUsage) !== canonicalJson(["1.3.6.1.5.5.7.3.2"]) ||
      [cert, ca].some(item => !(Date.parse(item.validFrom) <= now && Date.parse(item.validTo) > through))) fail("CREDENTIAL_MATERIAL");
  } catch { fail("CREDENTIAL_MATERIAL"); }
  return keys;
}

export function createFirstOpenRdsControl(input: {
  identity: Task;
  fence: TenantExternalOperationFence;
  hostname: string;
  albDnsName: string;
  templateVersionId: string;
  configurationHash: string;
  configurationSchemaSha256: string;
  artifactRef: string;
  writeBefore: number;
  readDb: ApplicationDatabase;
  assertActive(fence: TenantExternalOperationFence, signal: AbortSignal): Promise<void>;
  credentials: FirstOpenRdsControlCredentialPin;
  applicationSecret: SecretPin;
  now?: () => number;
}, { readSecret: readSecretOverride, transport = createFirstOpenPrivateControlTransport }:
  { readSecret?: ReadSecret; transport?: typeof createFirstOpenPrivateControlTransport } = {}): {
  controlClient: SaaSControlPort;
  controlPayloadCompiler: SaaSControlPayloadCompilerPort;
} {
  const fence = structuredClone(input.fence), pin = { ...input.credentials }, appSecret = { ...input.applicationSecret };
  const { identity, hostname, albDnsName, templateVersionId, configurationHash, artifactRef,
    configurationSchemaSha256, readDb, writeBefore, assertActive, now = Date.now } = input;
  const { resourceFence, ownerDeploymentId } = fence;
  const { appInstanceId, workspaceId, productId, environmentId, stableIdentityHash, cellKey } = resourceFence.identity;
  const appArnPrefix = secretPrefix + deriveTenantRuntimeSecretName(resourceFence) + "-";
  if (identity.roleArn !== roleArn || typeof identity.credentials !== "function" || !hostPattern.test(hostname) || !albPattern.test(albDnsName) ||
    !/^tplver_(?:restaurant_standard_v1|[a-f0-9]{32})$/.test(templateVersionId) || !hash.test(configurationHash) || !hash.test(configurationSchemaSha256) ||
    !/^402010193138\.dkr\.ecr\.ca-central-1\.amazonaws\.com\/techlong-sandbox-speedfeast@sha256:[a-f0-9]{64}$/.test(artifactRef) ||
    !Number.isSafeInteger(writeBefore) || writeBefore <= now() || writeBefore > now() + 3_600_000 ||
    fence.schemaVersion !== 1 || fence.state !== "active" || fence.intent !== "provision" || fence.epoch !== 1 ||
    resourceFence.generation !== 1 || fence.ownerDeploymentId !== resourceFence.ownerDeploymentId ||
    fence.provisionPredecessor !== undefined || environmentId !== "env_aws_sandbox_ca_central_1" || cellKey !== "cell-sandbox-1" ||
    !hash.test(fence.operationHash) ||
    fence.marker !== `tl_epoch_${stableIdentityHash.slice(0, 24)}_g1_e1` ||
    !appSecret.arn.startsWith(appArnPrefix) || !/^[A-Za-z0-9]{6}$/.test(appSecret.arn.slice(appArnPrefix.length)) ||
    !pin.arn.startsWith(secretPrefix) || !/^[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(pin.arn.slice(secretPrefix.length)) ||
    pin.arn === appSecret.arn || !version.test(pin.versionId) || !version.test(appSecret.versionId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,255}$/.test(pin.subject) ||
    ![pin.signingPublicKeySha256, pin.clientCertificateSha256, pin.clientCaSha256].every(value => hash.test(value))) fail("SCOPE");

  const readSecret = readSecretOverride ?? createFirstOpenPrivateSecretReader(identity);
  const checkWindow = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (now() >= writeBefore) fail("WINDOW");
  };
  const boundedSignal = (signal: AbortSignal) => {
    checkWindow(signal);
    return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, writeBefore - now()))]);
  };
  const checkFence = async (candidate: TenantExternalOperationFence, signal: AbortSignal) => {
    checkWindow(signal);
    if (canonicalJson(candidate) !== canonicalJson(fence)) fail("FENCE");
    await assertActive(fence, signal);
    checkWindow(signal);
  };
  const loadSecret = async (secret: SecretPin, signal: AbortSignal) => {
    checkWindow(signal);
    let reply: GetSecretValueCommandOutput;
    try {
      reply = await readSecret(new GetSecretValueCommand({ SecretId: secret.arn, VersionId: secret.versionId }), signal);
    } catch {
      signal.throwIfAborted();
      return fail("SECRET_READ");
    }
    checkWindow(signal);
    if (reply.ARN !== secret.arn || reply.VersionId !== secret.versionId || reply.SecretBinary !== undefined) fail("SECRET_BINDING");
    return decodeObject(reply.SecretString, 65_536, "SECRET_MATERIAL");
  };

  const compiler = new ImmutableTemplateSaaSControlPayloadCompiler({
    bindings: { async loadForAppInstance(request) {
      if (request.appInstanceId !== appInstanceId) fail("TEMPLATE_SCOPE");
      const rows = await readDb.prepare(`SELECT id, template_version_id, configuration_snapshot FROM public.app_instances
        WHERE id = $1 AND workspace_id = $2 AND product_id = $3 AND template_version_id = $4`)
        .bind(appInstanceId, workspaceId, productId, templateVersionId).all<{ id: string; template_version_id: string; configuration_snapshot: string }>();
      checkWindow(request.signal);
      const row = rows.results[0];
      if (rows.results.length !== 1 || row.id !== appInstanceId || row.template_version_id !== templateVersionId) fail("TEMPLATE_SCOPE");
      const resolved = decodeObject(row.configuration_snapshot, 65_536, "TEMPLATE_BINDING");
      if (Object.values(resolved).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value)) ||
        await sha256Hex(resolved) !== configurationHash) fail("TEMPLATE_BINDING");
      return { appInstanceId, templateVersionId, resolvedConfiguration: resolved as TemplateConfiguration };
    } },
    templateVersions: { async loadById(request) {
      if (request.templateVersionId !== templateVersionId) fail("TEMPLATE_SCOPE");
      const rows = await readDb.prepare(`SELECT id, status, configuration_schema FROM public.app_instance_template_versions WHERE id = $1`)
        .bind(templateVersionId).all<{ id: string; status: "published" | "archived"; configuration_schema: string }>();
      checkWindow(request.signal);
      const row = rows.results[0];
      if (rows.results.length !== 1 || row.id !== templateVersionId || !["published", "archived"].includes(row.status)) fail("TEMPLATE_BINDING");
      const schema = validateConfigurationSchema(decodeObject(row.configuration_schema, 65_536, "TEMPLATE_BINDING")).data;
      if (!schema || await sha256Hex(schema) !== configurationSchemaSha256) fail("TEMPLATE_BINDING");
      return { id: row.id, status: row.status, configurationSchema: schema };
    } },
    firstOwnerPasswords: { async lease(request) {
      if (request.appInstanceId !== appInstanceId || request.templateVersionId !== templateVersionId) fail("OWNER_SCOPE");
      await checkFence(fence, request.signal);
      const material = await loadSecret(appSecret, request.signal);
      if (!exactStrings(material, tenantRuntimeSecretExactJsonKeys) || !/^[A-Za-z0-9_-]{43}$/.test(material.hmac_secret_key as string)) fail("OWNER_MATERIAL");
      const key = Buffer.from(material.hmac_secret_key as string, "base64url");
      let password: Buffer | undefined;
      try {
        if (key.length !== 32 || key.toString("base64url") !== material.hmac_secret_key) fail("OWNER_MATERIAL");
        await checkFence(fence, request.signal);
        password = deriveExpressFirstOwnerPassword(key, { stableIdentity: stableIdentityHash, appInstanceId,
          templateVersionId, generation: resourceFence.generation, versionId: appSecret.versionId });
      } finally { key.fill(0); }
      return { read() {
        checkWindow(request.signal);
        if (!password) return fail("OWNER_LEASE");
        return password.toString("base64url");
      }, dispose() { password?.fill(0); password = undefined; } };
    } },
  });

  let opened: Promise<MtlsSaaSControlClient> | undefined;
  async function access(request: { appInstanceId: string; hostname: string; externalFence: TenantExternalOperationFence; signal: AbortSignal }) {
    if (request.appInstanceId !== appInstanceId || request.hostname !== hostname) fail("ENDPOINT_SCOPE");
    await checkFence(request.externalFence, request.signal);
    opened ??= (async () => {
      const keys = await checkCredentials(await loadSecret(pin, request.signal), pin, now(), writeBefore);
      checkWindow(request.signal);
      return new MtlsSaaSControlClient(transport({ hostname, albDnsName, clientCertificatePem: keys.clientCertificatePem,
        clientPrivateKeyPem: keys.clientPrivateKeyPem }), new Rs256SaaSControlTokenProvider({ issuer: "https://techlong.cloud",
        subject: pin.subject, keyId: `first-open-${pin.signingPublicKeySha256.slice(0, 24)}`, lifetimeSeconds: 60,
        privateKeyPem: keys.signingPrivateKeyPem, now }), { baseDomain });
    })();
    const client = await opened;
    checkWindow(request.signal);
    return client;
  }

  let compiledOnce = false, posted = false;
  const expectedPayloads = new WeakSet<Record<string, unknown>>();
  const controlClient = Object.freeze<SaaSControlPort>({
    async waitUntilHealthy(request) {
      const bounded = { ...request, signal: boundedSignal(request.signal) };
      return (await access(bounded)).waitUntilHealthy(bounded);
    },
    async readConfiguration(request) {
      const bounded = { ...request, signal: boundedSignal(request.signal) };
      return (await access(bounded)).readConfiguration(bounded);
    },
    async provision(request) {
      try {
        if (posted || !expectedPayloads.delete(request.compiledPayload) ||
          request.idempotencyKey !== `${ownerDeploymentId}:${configurationHash}`) fail("PROVISION_SCOPE");
        posted = true;
        const bounded = { ...request, signal: boundedSignal(request.signal) };
        return await (await access(bounded)).provision(bounded);
      } finally { clearFirstOwnerPassword(request.compiledPayload); }
    },
  });
  const controlPayloadCompiler = Object.freeze<SaaSControlPayloadCompilerPort>({ async compile(request) {
    const { appInstance, deployment } = request.context;
    if (compiledOnce || appInstance.id !== appInstanceId || appInstance.workspaceId !== workspaceId || appInstance.productId !== productId ||
      appInstance.templateVersionId !== templateVersionId || deployment.id !== ownerDeploymentId || deployment.environmentId !== environmentId ||
      deployment.appInstanceId !== appInstanceId || deployment.artifactRef !== artifactRef ||
      deployment.configurationHash !== configurationHash || request.configurationHash !== configurationHash) fail("TEMPLATE_SCOPE");
    const bounded = { ...request, signal: boundedSignal(request.signal) };
    await checkFence(bounded.externalFence, bounded.signal);
    if (compiledOnce) fail("TEMPLATE_SCOPE");
    compiledOnce = true;
    const result = await compiler.compile(bounded);
    expectedPayloads.add(result.compiledPayload);
    return result;
  } });
  return { controlClient, controlPayloadCompiler };
}
