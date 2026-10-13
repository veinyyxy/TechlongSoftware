import { hkdfSync } from "node:crypto";
import type { FirstOwnerPasswordSource } from "./control-payload.ts";
import type { FirstOwnerRuntimeBindingSource } from "./single-tenant-control-bindings.ts";
import { assertAcceptanceResourceFence, validateAcceptanceCredentialBinding, type AcceptanceCredentialBinding } from "./single-tenant-private-sources.ts";
import { deriveTenantRuntimeSecretName } from "./tenant-database.ts";
import { canonicalJson } from "./hash.ts";
import { tenantRuntimeSecretExactJsonKeys } from "./tenant-aws-one-shot-adapters.ts";

export interface FirstOwnerSecretReadonlyPort {
  identity(signal: AbortSignal): Promise<{ Account?: string; Arn?: string; UserId?: string }>;
  describe(arn: string, signal: AbortSignal): Promise<Record<string, unknown>>;
  value(arn: string, version: string, signal: AbortSignal): Promise<Record<string, unknown>>;
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function secretTags(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw) || raw.some(t => !t || typeof t.Key !== "string" || typeof t.Value !== "string") ||
    new Set(raw.map(t => t.Key)).size !== raw.length) fail("ACCEPTANCE_FIRST_OWNER_SECRET_METADATA_REJECTED");
  return Object.fromEntries(raw.map(t => [t.Key, t.Value]));
}
const failProvider = (e: unknown, signal: AbortSignal): never => { signal.throwIfAborted();
  if (e instanceof Error && /^ACCEPTANCE_[A-Z0-9_]+$/.test(e.message)) throw e;
  fail("ACCEPTANCE_FIRST_OWNER_PROVIDER_READ_FAILED"); };

/** Read-only Secret capability. One generation, exactly one current version;
 * password is HKDF domain-separated from the already random 256-bit HMAC key.
 * No new Secret field, extra Secret, local password file, rotation or write.
 */
export async function createAcceptanceFirstOwnerPasswordSource(input: {
  binding: AcceptanceCredentialBinding; bindings: FirstOwnerRuntimeBindingSource; sdk: FirstOwnerSecretReadonlyPort; expectedProvisionerRoleId: string;
}): Promise<FirstOwnerPasswordSource> {
  const b = await validateAcceptanceCredentialBinding(input.binding);
  if (!/^AROA[A-Z0-9]{16,32}$/.test(input.expectedProvisionerRoleId)) fail("ACCEPTANCE_PROVISIONER_ROLE_ID_REQUIRED");
  return Object.freeze<FirstOwnerPasswordSource>({ async lease(request) {
    request.signal.throwIfAborted(); if (request.appInstanceId !== b.scope.appInstanceId || request.templateVersionId !== b.templateVersionId) fail("ACCEPTANCE_FIRST_OWNER_SCOPE_REJECTED");
    const current = await input.bindings.load(request); request.signal.throwIfAborted(); await assertAcceptanceResourceFence(b, current.fence);
    const name = deriveTenantRuntimeSecretName(current.fence), prefix = `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${name}-`;
    if (!current.secretArn.startsWith(prefix) || !/^[A-Za-z0-9]{6}$/.test(current.secretArn.slice(prefix.length))) fail("ACCEPTANCE_FIRST_OWNER_SECRET_ARN_REJECTED");
    let key: Buffer | undefined, held: Buffer | undefined;
    try {
      const who = await input.sdk.identity(request.signal); request.signal.throwIfAborted();
      if (who.Account !== "402010193138" || !/^arn:aws:sts::402010193138:assumed-role\/TechlongSandboxProvisionerRole\/[A-Za-z0-9+=,.@_-]{2,64}$/.test(who.Arn ?? "") ||
        who.UserId?.split(":")[0] !== input.expectedProvisionerRoleId) fail("ACCEPTANCE_FIRST_OWNER_CALLER_REJECTED");
      const metadata = await input.sdk.describe(current.secretArn, request.signal); request.signal.throwIfAborted();
      const tags = secretTags(metadata.Tags);
      const expected = { ManagedBy: "techlong-deployment-worker", SecretSchema: "techlong-runtime-five-key-v1",
        ResourceGeneration: String(current.fence.generation), OwnershipMarker: current.fence.ownershipMarker };
      const versions = metadata.VersionIdsToStages as Record<string, string[]>;
      if (metadata.ARN !== current.secretArn || metadata.Name !== name || metadata.DeletedDate || metadata.RotationEnabled === true ||
        canonicalJson(tags) !== canonicalJson(expected) ||
        !versions || typeof versions !== "object" || Array.isArray(versions) || Object.keys(versions).length !== 1) fail("ACCEPTANCE_FIRST_OWNER_SECRET_METADATA_REJECTED");
      const version = Object.keys(versions)[0];
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version) || canonicalJson(versions[version]) !== canonicalJson(["AWSCURRENT"])) fail("ACCEPTANCE_FIRST_OWNER_SECRET_VERSION_REJECTED");
      const value = await input.sdk.value(current.secretArn, version, request.signal); request.signal.throwIfAborted();
      if (value.ARN !== current.secretArn || value.Name !== name || value.VersionId !== version || value.SecretBinary !== undefined ||
        typeof value.SecretString !== "string") fail("ACCEPTANCE_FIRST_OWNER_SECRET_RESPONSE_REJECTED");
      const material = JSON.parse(value.SecretString) as Record<string, unknown>;
      if (!material || canonicalJson(Object.keys(material).sort()) !== canonicalJson([...tenantRuntimeSecretExactJsonKeys].sort()) ||
        Object.values(material).some(v => typeof v !== "string" || !v) || typeof material.hmac_secret_key !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(material.hmac_secret_key)) fail("ACCEPTANCE_FIRST_OWNER_SECRET_MATERIAL_REJECTED");
      key = Buffer.from(material.hmac_secret_key, "base64url");
      if (key.length !== 32 || key.toString("base64url") !== material.hmac_secret_key) fail("ACCEPTANCE_FIRST_OWNER_SECRET_MATERIAL_REJECTED");
      // Never log/store the result or the underlying HMAC key. Same app,
      // template, generation and version derive the same retry payload.
      held = Buffer.from(hkdfSync("sha256", key, Buffer.from(current.fence.identity.stableIdentityHash, "hex"),
        Buffer.from(canonicalJson({ protocol: "techlong-first-owner-password-v1", appInstanceId: b.scope.appInstanceId,
          templateVersionId: b.templateVersionId, generation: current.fence.generation, versionId: version })), 32));
      // Reject metadata/version/ownership change raced with the value read.
      const after = await input.sdk.describe(current.secretArn, request.signal); request.signal.throwIfAborted();
      if (canonicalJson([after.ARN, after.Name, secretTags(after.Tags), after.VersionIdsToStages, after.DeletedDate ?? null, after.RotationEnabled ?? false]) !==
        canonicalJson([metadata.ARN, metadata.Name, tags, metadata.VersionIdsToStages, metadata.DeletedDate ?? null, metadata.RotationEnabled ?? false])) fail("ACCEPTANCE_FIRST_OWNER_SECRET_READ_RACE");
      return Object.freeze({ read() { request.signal.throwIfAborted(); if (!held) fail("ACCEPTANCE_FIRST_OWNER_LEASE_DISPOSED"); return held.toString("base64url"); },
        dispose() { held?.fill(0); held = undefined; } });
    } catch (e) { held?.fill(0); held = undefined; return failProvider(e, request.signal); }
    finally { key?.fill(0); key = undefined; }
  } });
}

/** Lazy SDK creation only. No credential resolution or API call in assembly. */
export async function createAcceptanceFirstOwnerSdkPort(): Promise<FirstOwnerSecretReadonlyPort> {
  const [sm, sts, provider] = await Promise.all([import("@aws-sdk/client-secrets-manager"), import("@aws-sdk/client-sts"), import("@aws-sdk/credential-provider-node")]);
  const config = { region: "ca-central-1", credentials: provider.defaultProvider({ profile: "techlong-sandbox-provisioner" }), maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const secret = new sm.SecretsManagerClient(config), identity = new sts.STSClient(config);
  return Object.freeze<FirstOwnerSecretReadonlyPort>({ identity: signal => identity.send(new sts.GetCallerIdentityCommand({}), { abortSignal: signal }),
    describe: async (arn, signal) => ({ ...await secret.send(new sm.DescribeSecretCommand({ SecretId: arn }), { abortSignal: signal }) }),
    value: async (arn, version, signal) => ({ ...await secret.send(new sm.GetSecretValueCommand({ SecretId: arn, VersionId: version, VersionStage: "AWSCURRENT" }), { abortSignal: signal }) }) });
}
