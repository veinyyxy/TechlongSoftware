import type { prepareExpressSingleTenantDeliveryV1 } from './express-single-tenant-delivery-v1.ts';
import { deriveExpressFirstDeploymentV1 } from './express-deployment-scope-v1.ts';
import { canonicalJson, sha256Hex } from './hash.ts';

type Material = Awaited<ReturnType<typeof prepareExpressSingleTenantDeliveryV1>>['material'];
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }

/** Mainline initialization candidate, NOT a new SQL diagnostic or executable
 * approval. Uses the already published app's existing provision endpoint after
 * one narrowly reviewed store INSERT. No image rebuild/permission install.
 * A future reviewed TLS/IAM session root must enforce every prerequisite;
 * neither this compiler nor the current CLI can connect to Aurora or execute.
 */
export async function compileExpressDefaultStoreSeedV1(input: { material: Material; materialSha256: string; subscriptionId: string }) {
  const m = structuredClone(input.material), deployment = await deriveExpressFirstDeploymentV1(input);
  if (m.binding.profile !== 'express_iam' || m.binding.resourceGeneration !== 1 || m.databaseOid !== '16459' || m.roleOid !== '16456' ||
      m.binding.clusterArn !== 'arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001' ||
      m.binding.clusterResourceId !== 'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM' ||
      m.binding.endpoint !== 'techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com' ||
      m.binding.stableIdentity !== 'a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d' ||
      m.binding.tenantDatabase !== 'tenant_a0da1748bc4d5419_db' || m.binding.tenantUsername !== 'tenant_a0da1748bc4d5419_role' ||
      m.scope.appInstanceId !== 'app_e897a4377bce498b9c5ee9e64509dcad' ||
      m.controlPolicy.business.default_store.name !== 'Techlong Sandbox' || m.controlPolicy.business.firstOwnerUsername !== 'techlong_sandbox_admin') {
    throw Error('EXPRESS_DEFAULT_STORE_SEED_SCOPE_REJECTED');
  }
  const hash = await sha256Hex({ purpose: 'techlong/express-first-default-store/v1', stableIdentity: m.binding.stableIdentity, generation: 1 });
  // Custom SHA-256-derived UUIDv8, not claimed to be RFC UUIDv5.
  const hex = hash.slice(0, 12) + '8' + hash.slice(13, 16) + '8' + hash.slice(17, 32);
  const storeId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const store = { storeId, storeCode: 'TECHLONG_SANDBOX', slug: 'first-acceptance', timezone: 'America/Winnipeg', currency: 'CAD',
    status: 'active', isDefault: true };
  const program = {
    schema: 'techlong/express-default-store-seed-candidate/v1', materialSha256: input.materialSha256,
    scope: deployment.scope, stableIdentity: m.binding.stableIdentity, resourceGeneration: 1,
    target: { clusterArn: m.binding.clusterArn, clusterResourceId: m.binding.clusterResourceId, endpoint: m.binding.endpoint,
      database: m.binding.tenantDatabase, databaseOid: m.databaseOid, role: m.binding.tenantUsername, roleOid: m.roleOid,
      managementUser: 'postgres', managementRoleOid: '16410', serverVersionNum: 170009 }, store,
    transaction: { isolation: 'SERIALIZABLE', maxRunConnections: 1, maxIndependentInspectConnections: 1,
      lockTimeoutMs: 5000, statementTimeoutMs: 15000, searchPath: 'pg_catalog', tls: 'verify-full-ATS-roots', automaticRetries: 0,
      tableLock: 'LOCK TABLE public.stores IN SHARE ROW EXCLUSIVE MODE' },
    requiredBeforeInsert: [
      'fresh Source identity/cluster/DB OID/role OID plus verified client and backend TLS IAM session',
      'exact original database/application bootstrap comments and same stable identity/generation; no owner transfer',
      'fresh full catalog/ACL equals approved C4h active state; no user trigger/rewrite rule or unknown stores-column side effect',
      'all baseline business tables empty, exactly one original technical SaaS singleton and eight original entitlements',
      'SaaS singleton has no external instance, provisioned_at, epoch, request hash, result or provision operation',
      'exact stores table empty under lock; no existing default/slug/code/store UUID; conflicts abort, never upsert',
      'fresh Neon ownership and both DDB authority keys absent; source snapshots are not cross-service CAS',
    ],
    // Bind every value; this is the sole proposed application DML statement.
    insert: { text: `INSERT INTO public.stores (store_id,store_code,slug,phone,address,latitude,longitude,timezone,currency,status,is_default,created_at,updated_at)
 VALUES ($1::uuid,$2,$3,NULL,'{}'::jsonb,NULL,NULL,$4,$5,'active',TRUE,transaction_timestamp(),transaction_timestamp())
 RETURNING store_id::text,store_code,slug,timezone,currency,status,is_default`,
      values: [store.storeId, store.storeCode, store.slug, store.timezone, store.currency] },
    expectedReturnedRow: { store_id: store.storeId, store_code: store.storeCode, slug: store.slug, timezone: store.timezone,
      currency: store.currency, status: store.status, is_default: true },
    postcheck: { exactStoreRows: 1, otherBusinessRowsRemainEmpty: true, technicalSeedsUnchanged: true,
      catalogAndAclUnchanged: true, independentReadbackRequired: true },
    followingProvision: { throughExistingAuthenticatedMtlsEndpoint: true, writesNameThemesEntitlementsAndFirstOwner: true,
      firstOwnerUsername: m.controlPolicy.business.firstOwnerUsername, storeName: m.controlPolicy.business.default_store.name,
      initializedReadinessAndEffectiveConfigurationStillRequired: true, platformReadyNotImpliedBySeed: true },
    limits: { applicationDmlStatements: 1, newDatabaseRolesOrGrants: 0, schemaChanges: 0, iamChanges: 0, secretReads: 0,
      authorityWrites: 0, neonWrites: 0, ecsDeployments: 0, baselineRestoreOrMigration: 0 },
    risks: ['The store row is business data and requires separate fresh reviewed approval; this candidate authorizes no SQL connection.',
      'Locks/serializable conflicts may block or abort; privileged concurrent writers and cross-service races remain possible.',
      'COMMIT can succeed with a lost response; inspect independently and never automatically repeat INSERT, delete, roll back committed data or reset an attempt slot.',
      'SQL/IAM tokens pass through provider memory/logging boundaries and Aurora may resume with nonzero ACU/I/O cost; 50 USD/month is not a hard cap.'],
    executionRootAvailable: false, executionAuthorized: false, storeCreated: false, readyVerified: false,
  };
  // Encoding assertion also ensures the candidate remains ordinary non-secret
  // data; it is not a fake boolean-based permission/SQL proof.
  return freeze({ ...program, programSha256: await sha256Hex(canonicalJson(program)) });
}
