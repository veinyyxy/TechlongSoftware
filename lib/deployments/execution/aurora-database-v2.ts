import contract from './aurora-database-contract-v2.cjs';

export type DatabaseProfile = 'express_iam' | 'full_password';
export interface DatabaseIntentV2 {
  readonly schema: 'techlong/database-intent/v2'; readonly profile: DatabaseProfile;
  readonly region: 'ca-central-1'; readonly tenantIsolation: 'database-and-role';
}
interface BindingBase {
  readonly schema: 'techlong/database-binding/v2'; readonly clusterArn: string;
  readonly clusterResourceId: string; readonly endpoint: string; readonly port: 5432;
  readonly observedEngineVersion: string; readonly tenantDatabase: string; readonly tenantUsername: string;
  readonly managementDatabase: string; readonly managementUsername: string;
  readonly stableIdentity: string; readonly resourceGeneration: number;
  readonly runtimeSecret: Readonly<{ arn: string; versionId: string }>;
}
export type DatabaseBindingV2 = BindingBase & (
  { readonly profile: 'express_iam'; readonly tlsTrust: 'ats-roots/v1'; readonly access: Readonly<{
    authentication: 'iam'; internetAccessGatewayEnabled: true; applicationRoleArn: string; lifecycleRoleArn: string;
  }> } |
  { readonly profile: 'full_password'; readonly tlsTrust: 'rds-ca/v1'; readonly access: Readonly<{
    authentication: 'password'; internetAccessGatewayEnabled: false; managementSecretArn: string;
  }> }
);

/** Wire validation only. It does not certify AWS readback, IAM, SQL or ready. */
export const parseDatabaseIntentV2 = (raw: unknown): DatabaseIntentV2 => contract.parseDatabaseIntentV2(raw);
export const parseDatabaseBindingV2 = (raw: unknown): DatabaseBindingV2 => contract.parseDatabaseBindingV2(raw);
export const databaseBindingDigestV2 = (raw: unknown): string => contract.databaseBindingDigestV2(raw);
export const encodeDatabaseBindingV2 = (raw: unknown): string => contract.encodeDatabaseBindingV2(raw);
export const decodeDatabaseBindingV2 = (raw: string, digest: string): DatabaseBindingV2 => contract.decodeDatabaseBindingV2(raw, digest);
export const databaseUserArnV2 = (raw: unknown, purpose: 'application' | 'management'): string => contract.databaseUserArnV2(raw, purpose);

export function dispatchDatabaseProfileV2<T>(raw: unknown, providers: {
  express_iam: (binding: Extract<DatabaseBindingV2, { profile: 'express_iam' }>) => T;
  full_password: (binding: Extract<DatabaseBindingV2, { profile: 'full_password' }>) => T;
}): T {
  const binding = parseDatabaseBindingV2(raw);
  // No exception interception/fallback to another database or profile.
  return binding.profile === 'express_iam' ? providers.express_iam(binding) : providers.full_password(binding);
}

/** Pure candidate, NOT an executable approval or an SDK operation. Exact IAM,
 * account-plan eligibility, defaults/capacity and cleanup need fresh review. */
export function buildExpressCreateCandidateV2(rawIntent: unknown, scope: {
  clusterIdentifier: string; stableIdentity: string; resourceGeneration: number;
}) {
  const intent = parseDatabaseIntentV2(rawIntent);
  if (intent.profile !== 'express_iam' || Object.keys(scope).sort().join(',') !==
    'clusterIdentifier,resourceGeneration,stableIdentity' ||
    !/^techlong-sandbox-[a-z0-9][a-z0-9-]{0,44}[a-z0-9]$/.test(scope.clusterIdentifier) ||
    !/^[a-f0-9]{64}$/.test(scope.stableIdentity) || !Number.isSafeInteger(scope.resourceGeneration) || scope.resourceGeneration < 1)
    throw Object.assign(new Error('DATABASE_V2_CREATE_CANDIDATE_INVALID'), { code: 'DATABASE_V2_CREATE_CANDIDATE_INVALID' });
  const request = Object.freeze({ DBClusterIdentifier: scope.clusterIdentifier, Engine: 'aurora-postgresql',
    WithExpressConfiguration: true,
    Tags: Object.freeze([
      Object.freeze({ Key: 'ManagedBy', Value: 'techlong-sandbox' }),
      Object.freeze({ Key: 'DatabaseProfile', Value: 'express_iam' }),
      Object.freeze({ Key: 'StableIdentity', Value: scope.stableIdentity }),
      Object.freeze({ Key: 'ResourceGeneration', Value: String(scope.resourceGeneration) }),
    ]) });
  return Object.freeze({ schema: 'techlong/express-create-candidate/v2', request,
    requestSha256: contract.digest(request), maxDirectCreateCalls: 1,
    writerCreation: 'service-managed-no-second-create', executionAuthorized: false, runtimeEnabled: false });
}

/** ECS data only, never register/run/update. Long-lived private keys use a
 * fixed Secret version; a DB IAM token is never a task environment/Secret. */
export function buildDatabaseTaskConfigurationV2(raw: unknown) {
  const binding = parseDatabaseBindingV2(raw), bindingSha256 = databaseBindingDigestV2(binding);
  const environment: Record<string, string> = { PG_DATABASE_PROFILE: binding.profile,
    AWS_REGION: 'ca-central-1', PGSSLMODE: 'verify-full', PGSSL_REJECT_UNAUTHORIZED: 'true' };
  if (binding.profile === 'express_iam') {
    Object.assign(environment, { PG_DATABASE_BINDING_V2: encodeDatabaseBindingV2(binding),
      PG_DATABASE_BINDING_SHA256: bindingSha256, PGSSLROOTCERT: '', PGPOOL_MAX: '3' });
  } else environment.PGSSLROOTCERT = '/usr/local/share/ca-certificates/aws-rds-global-bundle.pem';
  const secretNames: Record<string, string> = { hmac_secret_key: 'HMAC_SECRET_KEY', jwt_secret_key: 'JWT_SECRET_KEY',
    stripe_secret_key: 'STRIPE_SECRET_KEY', stripe_webhook_secret: 'STRIPE_WEBHOOK_SECRET' };
  if (binding.profile === 'full_password') secretNames.database_url = 'DATABASE_URL';
  const secrets = Object.entries(secretNames).map(([key, name]) => Object.freeze({ name,
    valueFrom: `${binding.runtimeSecret.arn}:${key}::${binding.runtimeSecret.versionId}` }));
  return Object.freeze({ profile: binding.profile, bindingSha256,
    environment: Object.freeze(Object.entries(environment).map(([name, value]) => Object.freeze({ name, value }))),
    secrets: Object.freeze(secrets), executionAuthorized: false });
}
