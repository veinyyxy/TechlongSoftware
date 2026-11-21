import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { MtlsSaaSControlClient } from "../../../lib/deployments/execution/control-client.ts";
import { NodeMtlsSaaSControlTransport } from "../../../lib/deployments/execution/control-https-transport.ts";
import { Rs256SaaSControlTokenProvider } from "../../../lib/deployments/execution/control-jwt.ts";
import { clearFirstOwnerPassword } from "../../../lib/deployments/execution/control-secret-redaction.ts";
import { ImmutableTemplateSaaSControlPayloadCompiler, type AppInstanceTemplateBinding,
  type FirstOwnerPasswordSource, type ImmutableTemplateVersion } from "../../../lib/deployments/execution/control-payload.ts";
import { deriveExpressFirstOwnerPassword } from "../../../lib/deployments/execution/express-first-owner-derive.ts";
import { validateExpressBusinessExpectationV1, type ExpressBusinessExpectationV1 } from "../../../lib/deployments/execution/express-control-readiness-v1.ts";
import type { SaaSControlPort, SaaSControlPayloadCompilerPort, TenantExternalOperationFence } from "../../../lib/deployments/execution/contracts.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenExpressDatabaseBinding, type FirstOnboardingExpressPorts } from "../../../lib/deployments/execution/first-onboarding-express.ts";
import { firstOpenVersion } from "../../../lib/deployments/execution/first-onboarding-version.ts";
import type { FirstOnboardingExecutionApproval } from "../../../lib/deployments/execution/worker.ts";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import type { FirstOpenInspectSeed } from "../first-open-inspect-input.ts";
import { sameFirstOpenFence } from "../first-open-express-scope.ts";

const fail = (code: string): never => { throw Error("FIRST_OPEN_CONTROL_" + code); };
type Value = { arn: string; versionId: string; externalFence: TenantExternalOperationFence };
type Observe = NonNullable<FirstOnboardingExpressPorts["onVerifiedControlMaterial"]>;
const hex = /^[a-f0-9]{64}$/;
const exactArn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-`;

export interface FirstOpenControlPrivate {
  signingPrivateKeyPem: string;
  signingPublicKeyPem: string;
  clientCertificatePem: string;
  clientPrivateKeyPem: string;
  clientCaPem: string;
}
export interface FirstOpenControlEvidence {
  subject: string;
  publicKeyArn: string;
  publicKeyVersionId: string;
  clientTrustStoreArn: string;
  publicKeySha256: string;
  clientCertificateSha256: string;
  clientCaSha256: string;
  templateVersionSha256: string;
  businessSha256: string;
}

/** Supply only the key from our own successful CreateSecret ACK. A lease
 * uses the original Express HKDF, then clears the sole retained key buffer. */
export function firstOpenOwnerMemory(input: {
  versionId: string; templateVersionId: string; fence: TenantExternalOperationFence; deadline: number; signal: AbortSignal; now?: () => number;
}) {
  const now = input.now ?? Date.now, fence = structuredClone(input.fence);
  sameFirstOpenFence({ fence: fence.resourceFence, externalFence: fence, signal: input.signal });
  if (!hex.test(input.versionId) || !/^tplver_[a-f0-9]{32}$/.test(input.templateVersionId) ||
    !Number.isSafeInteger(input.deadline)) return fail("OWNER_SCOPE");
  let created: string | undefined, key: Buffer | undefined, leased: Buffer | undefined;
  let verified = false, closed = false;
  const dispose = () => {
    key?.fill(0); leased?.fill(0); key = leased = undefined; closed = true;
    input.signal.removeEventListener("abort", dispose);
  };
  input.signal.addEventListener("abort", dispose, { once: true });
  const check = (r: Value) => {
    input.signal.throwIfAborted();
    if (closed || now() >= input.deadline || r.versionId !== input.versionId ||
      !r.arn.startsWith(exactArn) || !/^[A-Za-z0-9]{6}$/.test(r.arn.slice(exactArn.length)) ||
      canonicalJson(r.externalFence) !== canonicalJson(fence)) return fail("OWNER_BINDING");
  };
  const source: FirstOwnerPasswordSource = Object.freeze({
    async lease(req: Parameters<FirstOwnerPasswordSource["lease"]>[0]) {
      req.signal.throwIfAborted();
      input.signal.throwIfAborted();
      if (closed || !verified || !key || now() >= input.deadline ||
        req.appInstanceId !== s.instanceId || req.templateVersionId !== input.templateVersionId) return fail("OWNER_LEASE");
      try {
        leased = deriveExpressFirstOwnerPassword(key, { stableIdentity: s.stableIdentity, appInstanceId: s.instanceId,
          templateVersionId: req.templateVersionId, generation: 1, versionId: input.versionId });
      } finally { key.fill(0); key = undefined; }
      return Object.freeze({
        read() {
          req.signal.throwIfAborted();
          input.signal.throwIfAborted();
          if (!leased || closed || now() >= input.deadline) return fail("OWNER_LEASE");
          return leased.toString("base64url");
        },
        dispose() { leased?.fill(0); leased = undefined; },
      });
    },
  });
  return {
    rememberOwnerSeed(r: Value & { key: string }) {
      check(r);
      if (created || !/^[A-Za-z0-9_-]{43}$/.test(r.key)) return fail("OWNER_SEED");
      const bytes = Buffer.from(r.key, "base64url");
      if (bytes.length !== 32 || bytes.toString("base64url") !== r.key) { bytes.fill(0); return fail("OWNER_SEED"); }
      created = r.arn; key = bytes;
    },
    verify(r: Value) {
      check(r);
      if (!key || created !== r.arn || verified) return fail("OWNER_BINDING");
      verified = true;
    },
    source, dispose,
  };
}

/** All certificate/key checks are local and performed before claim. The
 * approved hashes must come from the independently sealed current Cell facts. */
export async function checkFirstOpenControlKeys(material: FirstOpenControlPrivate, evidence: FirstOpenControlEvidence, at: number, through: number) {
  try {
    if (Object.keys(material).sort().join(",") !== "clientCaPem,clientCertificatePem,clientPrivateKeyPem,signingPrivateKeyPem,signingPublicKeyPem" ||
      Object.values(material).some(v => typeof v !== "string" || !v || v.length > 12_288) ||
      !hex.test(evidence.publicKeySha256) || !hex.test(evidence.clientCaSha256) || !Number.isSafeInteger(through) || at >= through ||
      await sha256Hex(material.signingPublicKeyPem) !== evidence.publicKeySha256 ||
      await sha256Hex(material.clientCertificatePem) !== evidence.clientCertificateSha256 ||
      await sha256Hex(material.clientCaPem) !== evidence.clientCaSha256) return fail("KEY_BINDING");
    const signer = createPrivateKey(material.signingPrivateKeyPem);
    const target = createPublicKey(material.signingPublicKeyPem);
    const client = new X509Certificate(material.clientCertificatePem), ca = new X509Certificate(material.clientCaPem);
    if (signer.asymmetricKeyType !== "rsa" || signer.asymmetricKeyDetails?.modulusLength !== 3072 ||
      !createPublicKey(signer).export({ type: "spki", format: "der" }).equals(target.export({ type: "spki", format: "der" })) ||
      !ca.ca || !ca.checkIssued(ca) || !ca.verify(ca.publicKey) || client.ca || !client.checkIssued(ca) || !client.verify(ca.publicKey) ||
      !client.checkPrivateKey(createPrivateKey(material.clientPrivateKeyPem)) ||
      canonicalJson(client.keyUsage) !== canonicalJson(["1.3.6.1.5.5.7.3.2"]) ||
      [client, ca].some(c => !(Date.parse(c.validFrom) <= at && Date.parse(c.validTo) > through))) return fail("KEY_BINDING");
  } catch { return fail("KEY_BINDING"); }
}

export async function createFirstOpenRunOnceControl(input: {
  approval: FirstOnboardingExecutionApproval; seed: FirstOpenInspectSeed; versionId: string; signal: AbortSignal;
  keys: FirstOpenControlPrivate; evidence: FirstOpenControlEvidence;
  template: { binding: AppInstanceTemplateBinding; version: ImmutableTemplateVersion; business: ExpressBusinessExpectationV1 };
  now?: () => number;
}) {
  const { approval, seed, signal, evidence, keys, versionId } = input, now = input.now ?? Date.now;
  const taskVersion = firstOpenVersion(approval.taskRelease);
  const { binding, version, business } = structuredClone(input.template);
  const targetScope = seed.review.payload.scope, configuration = targetScope.configurationHash, issuer = seed.binding.tenantStackParameters.ControlIssuer;
  const controlKey = approval.express?.sampling.secrets[0];
  signal.throwIfAborted();
  if (!approval.express || approval.jobId !== s.jobId || approval.hostname !== s.hostname || targetScope.appInstanceId !== s.instanceId ||
    targetScope.deploymentId !== s.deploymentId || seed.review.reviewSha256 !== approval.reviewSha256 ||
    (approval.taskRelease && (targetScope.releaseId !== taskVersion.releaseId || targetScope.artifactRef !== taskVersion.artifactRef ||
      canonicalJson(seed.release) !== canonicalJson(approval.taskRelease))) ||
    evidence.publicKeyArn !== controlKey?.arn || evidence.publicKeyVersionId !== controlKey?.versionId ||
    binding.appInstanceId !== s.instanceId || binding.templateVersionId !== targetScope.templateVersionId || version.id !== binding.templateVersionId ||
    version.status !== "published" || await sha256Hex(version) !== evidence.templateVersionSha256 ||
    await sha256Hex(binding.resolvedConfiguration) !== configuration || await sha256Hex(business) !== evidence.businessSha256) {
    return fail("TEMPLATE_BINDING");
  }
  const businessExpectation = validateExpressBusinessExpectationV1(business);
  await checkFirstOpenControlKeys(keys, evidence, now(), approval.writeBefore);
  const clientTransport = new NodeMtlsSaaSControlTransport({ baseDomain: seed.environment.baseDomain, trustedCaPem: rootCertificates.join("\n"),
    clientCertificatePem: keys.clientCertificatePem, clientPrivateKeyPem: keys.clientPrivateKeyPem, timeoutMs: 15_000 });
  const tokens = new Rs256SaaSControlTokenProvider({ issuer, subject: evidence.subject,
    keyId: `first-open-${evidence.publicKeySha256.slice(0, 24)}`, lifetimeSeconds: 60, privateKeyPem: keys.signingPrivateKeyPem });
  const owner = firstOpenOwnerMemory({ versionId, templateVersionId: version.id, fence: seed.epoch, deadline: approval.writeBefore, signal, now });
  let client: MtlsSaaSControlClient | undefined, used = false;
  const checkTarget = (x: { appInstanceId: string; hostname: string; externalFence: TenantExternalOperationFence; signal: AbortSignal }) => {
    x.signal.throwIfAborted(); signal.throwIfAborted();
    if (!client || now() >= approval.writeBefore || x.appInstanceId !== s.instanceId || x.hostname !== s.hostname ||
      canonicalJson(x.externalFence) !== canonicalJson(seed.epoch)) return fail("TARGET");
    return client;
  };
  const control: SaaSControlPort = Object.freeze({
    waitUntilHealthy: (x: Parameters<SaaSControlPort["waitUntilHealthy"]>[0]) => checkTarget(x).waitUntilHealthy(x),
    readConfiguration: (x: Parameters<SaaSControlPort["readConfiguration"]>[0]) => checkTarget(x).readConfiguration(x),
    async provision(x: Parameters<SaaSControlPort["provision"]>[0]) {
      try {
        const bound = checkTarget(x);
        if (used) return fail("PROVISION_ALREADY_SUBMITTED");
        used = true;
        return await bound.provision(x);
      } finally { clearFirstOwnerPassword(x.compiledPayload); }
    },
  });
  const controlPayloadCompiler: SaaSControlPayloadCompilerPort = new ImmutableTemplateSaaSControlPayloadCompiler({
    bindings: { async loadForAppInstance(x) { x.signal.throwIfAborted(); return x.appInstanceId === s.instanceId ? structuredClone(binding) : null; } },
    templateVersions: { async loadById(x) { x.signal.throwIfAborted(); return x.templateVersionId === version.id ? structuredClone(version) : null; } },
    firstOwnerPasswords: owner.source,
  });
  const onVerifiedControlMaterial: Observe = async x => {
    signal.throwIfAborted();
    if (client || now() >= approval.writeBefore || x.context.deployment.id !== s.deploymentId ||
      x.context.appInstance.id !== s.instanceId || x.context.appInstance.templateVersionId !== version.id ||
      x.context.deployment.configurationHash !== configuration ||
      (approval.taskRelease && x.context.deployment.artifactRef !== taskVersion.artifactRef) ||
      canonicalJson(x.fence) !== canonicalJson(seed.epoch)) return fail("MATERIAL_BINDING");
    const databaseBinding = firstOpenExpressDatabaseBinding(approval.express!, x.runtimeSecret);
    const next = new MtlsSaaSControlClient(clientTransport, tokens, { baseDomain: seed.environment.baseDomain,
      expressReadiness: { binding: databaseBinding, databaseOid: x.identity.databaseOid, roleOid: x.identity.roleOid,
        appInstanceId: s.instanceId, configurationHash: configuration, imageRevision: taskVersion.imageDigest, business: businessExpectation } });
    owner.verify({ ...x.runtimeSecret, externalFence: x.fence });
    client = next;
  };
  return { control, controlPayloadCompiler, onVerifiedControlMaterial, rememberOwnerSeed: owner.rememberOwnerSeed,
    dispose() { client = undefined; owner.dispose(); } };
}
