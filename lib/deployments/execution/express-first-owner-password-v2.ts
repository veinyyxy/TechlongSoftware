import { hkdfSync } from 'node:crypto';
import type { FirstOwnerPasswordSource } from './control-payload.ts';
import type { FirstOwnerRuntimeBindingSource } from './single-tenant-control-bindings.ts';
import type { FirstOwnerSecretReadonlyPort } from './single-tenant-first-owner-password.ts';
import { assertTenantResourceFence, deriveTenantRuntimeSecretName } from './tenant-database.ts';
import { parseDatabaseBindingV2, type DatabaseBindingV2 } from './aurora-database-v2.ts';
import contract from './aurora-database-contract-v2.cjs';
import { canonicalJson, sha256Hex } from './hash.ts';

export interface ExpressFirstOwnerScopeV2 {
  appInstanceId: string; templateVersionId: string; ownerDeploymentId: string;
  workspaceId: string; productId: string; environmentId: string; cellKey: string;
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function tags(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw) || raw.some(t => !t || typeof t.Key !== 'string' || typeof t.Value !== 'string') ||
      new Set(raw.map(t => t.Key)).size !== raw.length) fail('EXPRESS_FIRST_OWNER_METADATA_REJECTED');
  return Object.fromEntries(raw.map(t => [t.Key, t.Value]));
}
/** Explicit four-key v2 source; old Full/five-key source remains untouched.
 * Construction is local validation. Calling lease reads the exact current
 * Secret value and therefore requires separate reviewed execution authority.
 * No password file, fifth key, database URL, rotation or provider write.
 */
export async function createExpressFirstOwnerPasswordSourceV2(input: {
  scope: ExpressFirstOwnerScopeV2; binding: DatabaseBindingV2; bindings: FirstOwnerRuntimeBindingSource;
  sdk: FirstOwnerSecretReadonlyPort; expectedSourceUserId: string;
}): Promise<FirstOwnerPasswordSource> {
  const scope = structuredClone(input.scope), b = parseDatabaseBindingV2(input.binding);
  if (Object.keys(scope).sort().join(',') !== 'appInstanceId,cellKey,environmentId,ownerDeploymentId,productId,templateVersionId,workspaceId' ||
      Object.values(scope).some(v => typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v)) ||
      scope.environmentId !== 'env_aws_sandbox_ca_central_1' || scope.cellKey !== 'cell-sandbox-1' ||
      b.profile !== 'express_iam' || !/^AIDA[A-Z0-9]{16,32}$/.test(input.expectedSourceUserId)) fail('EXPRESS_FIRST_OWNER_SCOPE_REJECTED');
  const stable = await sha256Hex({ appInstanceId: scope.appInstanceId, workspaceId: scope.workspaceId,
    productId: scope.productId, environmentId: scope.environmentId, cellKey: scope.cellKey });
  if (stable !== b.stableIdentity) fail('EXPRESS_FIRST_OWNER_SCOPE_REJECTED');
  const sourceUserId = input.expectedSourceUserId;
  return Object.freeze<FirstOwnerPasswordSource>({ async lease(request) {
    request.signal.throwIfAborted();
    if (request.appInstanceId !== scope.appInstanceId || request.templateVersionId !== scope.templateVersionId) fail('EXPRESS_FIRST_OWNER_SCOPE_REJECTED');
    let key: Buffer | undefined, held: Buffer | undefined;
    try {
      const current = await input.bindings.load(request); request.signal.throwIfAborted(); assertTenantResourceFence(current.fence);
      const f = current.fence, i = f.identity, name = deriveTenantRuntimeSecretName(f);
      if (f.ownerDeploymentId !== scope.ownerDeploymentId || f.generation !== b.resourceGeneration || i.stableIdentityHash !== stable ||
          i.appInstanceId !== scope.appInstanceId || i.workspaceId !== scope.workspaceId || i.productId !== scope.productId ||
          i.environmentId !== scope.environmentId || i.cellKey !== scope.cellKey || i.databaseName !== b.tenantDatabase || i.roleName !== b.tenantUsername ||
          current.secretArn !== b.runtimeSecret.arn || b.runtimeSecret.arn.slice(0, -7) !== `arn:aws:secretsmanager:ca-central-1:402010193138:secret:${name}`) fail('EXPRESS_FIRST_OWNER_BINDING_REJECTED');
      const who = await input.sdk.identity(request.signal); request.signal.throwIfAborted();
      if (who.Account !== '402010193138' || who.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' || who.UserId !== sourceUserId) fail('EXPRESS_FIRST_OWNER_CALLER_REJECTED');
      function verify(m: Record<string, unknown>) {
        if (m.ARN !== b.runtimeSecret.arn || m.Name !== name || m.DeletedDate !== undefined || m.RotationEnabled !== undefined && m.RotationEnabled !== false ||
            m.KmsKeyId !== undefined && m.KmsKeyId !== 'alias/aws/secretsmanager' ||
            m.ReplicationStatus !== undefined && (!Array.isArray(m.ReplicationStatus) || m.ReplicationStatus.length !== 0) ||
            canonicalJson(tags(m.Tags)) !== canonicalJson({ ManagedBy: 'techlong-sandbox', SecretSchema: 'techlong-runtime-four-key-v2',
              DatabaseProfile: 'express_iam', ResourceGeneration: String(b.resourceGeneration), StableIdentity: stable }) ||
            canonicalJson(m.VersionIdsToStages) !== canonicalJson({ [b.runtimeSecret.versionId]: ['AWSCURRENT'] })) fail('EXPRESS_FIRST_OWNER_METADATA_REJECTED');
      }
      verify(await input.sdk.describe(b.runtimeSecret.arn, request.signal)); request.signal.throwIfAborted();
      const value = await input.sdk.value(b.runtimeSecret.arn, b.runtimeSecret.versionId, request.signal); request.signal.throwIfAborted();
      if (value.ARN !== b.runtimeSecret.arn || value.Name !== name || value.VersionId !== b.runtimeSecret.versionId ||
          canonicalJson(value.VersionStages) !== canonicalJson(['AWSCURRENT']) || value.SecretBinary !== undefined ||
          typeof value.SecretString !== 'string') fail('EXPRESS_FIRST_OWNER_VALUE_REJECTED');
      const material = contract.parseRuntimeSecretV2(JSON.parse(value.SecretString), b);
      if (!/^[A-Za-z0-9_-]{43}$/.test(material.hmac_secret_key)) fail('EXPRESS_FIRST_OWNER_VALUE_REJECTED');
      key = Buffer.from(material.hmac_secret_key, 'base64url');
      if (key.length !== 32 || key.toString('base64url') !== material.hmac_secret_key) fail('EXPRESS_FIRST_OWNER_VALUE_REJECTED');
      // Same domain separation as Full: same scope/version derives the same
      // retry payload, without exposing/reusing the HMAC key as a password.
      held = Buffer.from(hkdfSync('sha256', key, Buffer.from(stable, 'hex'), Buffer.from(canonicalJson({
        protocol: 'techlong-first-owner-password-v1', appInstanceId: scope.appInstanceId, templateVersionId: scope.templateVersionId,
        generation: b.resourceGeneration, versionId: b.runtimeSecret.versionId,
      })), 32));
      verify(await input.sdk.describe(b.runtimeSecret.arn, request.signal)); request.signal.throwIfAborted();
      const after = await input.bindings.load(request); request.signal.throwIfAborted();
      if (canonicalJson(after) !== canonicalJson(current)) fail('EXPRESS_FIRST_OWNER_BINDING_RACE');
      return Object.freeze({ read() { request.signal.throwIfAborted(); if (!held) fail('EXPRESS_FIRST_OWNER_LEASE_DISPOSED'); return held.toString('base64url'); },
        dispose() { held?.fill(0); held = undefined; } });
    } catch (e) {
      held?.fill(0); held = undefined; request.signal.throwIfAborted();
      if (e instanceof Error && /^EXPRESS_FIRST_OWNER_[A-Z0-9_]+$/.test(e.message)) throw e;
      fail('EXPRESS_FIRST_OWNER_READ_FAILED');
    } finally { key?.fill(0); key = undefined; }
  } });
}

/** Lazy read-only adapter for the explicitly pinned Source user. No credential
 * resolution in assembly; lease is still a separately approved value read. */
export async function createExpressFirstOwnerReadonlySdkV2(): Promise<FirstOwnerSecretReadonlyPort> {
  const [sm, sts, provider] = await Promise.all([import('@aws-sdk/client-secrets-manager'), import('@aws-sdk/client-sts'), import('@aws-sdk/credential-provider-node')]);
  const config = { region: 'ca-central-1', credentials: provider.defaultProvider({ profile: 'techlong-sandbox-user' }), maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
  const secret = new sm.SecretsManagerClient(config), identity = new sts.STSClient(config);
  return Object.freeze<FirstOwnerSecretReadonlyPort>({ identity: signal => identity.send(new sts.GetCallerIdentityCommand({}), { abortSignal: signal }),
    describe: async (arn, signal) => ({ ...await secret.send(new sm.DescribeSecretCommand({ SecretId: arn }), { abortSignal: signal }) }),
    value: async (arn, version, signal) => ({ ...await secret.send(new sm.GetSecretValueCommand({ SecretId: arn, VersionId: version, VersionStage: 'AWSCURRENT' }), { abortSignal: signal }) }) });
}
