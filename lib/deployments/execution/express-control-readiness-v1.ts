import { buildTenantReadinessConfigurationV1 } from './tenant-readiness-configuration-v1.ts';
import { parseDatabaseBindingV2, type DatabaseBindingV2 } from './aurora-database-v2.ts';
import type { TenantExternalOperationFence } from './contracts.ts';
import { canonicalJson, sha256Hex } from './hash.ts';

type Theme = { brightness: 'light' | 'dark'; primary: string; secondary: string; surface: string; background: string; error: string };
export interface ExpressBusinessExpectationV1 {
  entitlements: Record<string, number | boolean | null>;
  default_store: { name: string; buyer_theme: Theme; merchant_theme: Theme };
  firstOwnerUsername: string;
}
export interface ExpressControlReadinessPolicyV1 {
  binding: DatabaseBindingV2; databaseOid: string; roleOid: string; appInstanceId: string;
  configurationHash: string; imageRevision: string; business: ExpressBusinessExpectationV1;
}
const entitlementKeys = ['buyer.accounts.max', 'buyer.concurrent_access.max', 'stores.max', 'merchant.active_users.max',
  'branding.custom_theme.enabled', 'branding.merchant_editable', 'buyer.access.lease_seconds', 'buyer.access.heartbeat_seconds'];
const fail = (): never => { throw Error('EXPRESS_CONTROL_READINESS_REJECTED'); };
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
};
function keys(v: object, expected: string[]) {
  if (Object.keys(v).sort().join(',') !== [...expected].sort().join(',')) fail();
}
function theme(raw: unknown): Theme {
  const t = record(raw); keys(t, ['brightness', 'primary', 'secondary', 'surface', 'background', 'error']);
  if (typeof t.brightness !== 'string' || !['light', 'dark'].includes(t.brightness) || ['primary', 'secondary', 'surface', 'background', 'error']
    .some(k => typeof t[k] !== 'string' || !/^#[0-9A-F]{6}$/.test(t[k] as string))) fail();
  return t as Theme;
}
export function validateExpressBusinessExpectationV1(raw: ExpressBusinessExpectationV1): ExpressBusinessExpectationV1 {
  const b = structuredClone(raw); keys(record(b), ['entitlements', 'default_store', 'firstOwnerUsername']);
  const e = record(b.entitlements); keys(e, entitlementKeys);
  for (const k of entitlementKeys) {
    const v = e[k];
    if (k.startsWith('branding.')) { if (typeof v !== 'boolean') fail(); }
    else if (k.endsWith('.max') && v === null) continue;
    else if (!Number.isSafeInteger(v) || Number(v) < (['stores.max', 'merchant.active_users.max'].includes(k) ? 1 : 0)) fail();
  }
  if (Number(e['buyer.access.lease_seconds']) < 60 || Number(e['buyer.access.lease_seconds']) > 86400 ||
      Number(e['buyer.access.heartbeat_seconds']) < 30 || Number(e['buyer.access.heartbeat_seconds']) > 3600) fail();
  const s = record(b.default_store); keys(s, ['name', 'buyer_theme', 'merchant_theme']);
  if (typeof s.name !== 'string' || !s.name || s.name !== s.name.trim() || s.name.length > 200 ||
      typeof b.firstOwnerUsername !== 'string' || !/^[A-Za-z0-9_.-]{3,80}$/.test(b.firstOwnerUsername)) fail();
  theme(s.buyer_theme); theme(s.merchant_theme); return b;
}
export function validateExpressControlReadinessPolicyV1(raw: ExpressControlReadinessPolicyV1): ExpressControlReadinessPolicyV1 {
  keys(record(raw), ['binding', 'databaseOid', 'roleOid', 'appInstanceId', 'configurationHash', 'imageRevision', 'business']);
  const p = structuredClone(raw), binding = parseDatabaseBindingV2(p.binding);
  buildTenantReadinessConfigurationV1({ binding, databaseOid: p.databaseOid, roleOid: p.roleOid,
    appInstanceId: p.appInstanceId, configurationHash: p.configurationHash });
  if (binding.profile !== 'express_iam' || typeof p.imageRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(p.imageRevision)) fail();
  return { ...p, binding, business: validateExpressBusinessExpectationV1(p.business) };
}
export function assertExpressControlFenceV1(p: ExpressControlReadinessPolicyV1, app: string, f: TenantExternalOperationFence) {
  const r = f.resourceFence;
  if (app !== p.appInstanceId || r.identity.appInstanceId !== app || r.generation !== p.binding.resourceGeneration ||
      r.identity.stableIdentityHash !== p.binding.stableIdentity || r.identity.databaseName !== p.binding.tenantDatabase ||
      r.identity.roleName !== p.binding.tenantUsername) fail();
}
export function expressReadinessMatchesV1(body: unknown, p: ExpressControlReadinessPolicyV1, complete: boolean): boolean {
  const envelope = record(body), r = record(envelope.readiness);
  const config = buildTenantReadinessConfigurationV1({ binding: p.binding, databaseOid: p.databaseOid, roleOid: p.roleOid,
    appInstanceId: p.appInstanceId, configurationHash: p.configurationHash });
  return envelope.success === true && r.protocol === (complete ? 'techlong/tenant-initialized/v1' : 'techlong/tenant-bootstrap/v1') &&
    r.ready === true && r.initialization_verified === complete && r.external_epoch_claimed === false &&
    r.readiness_mode === 'tenant-v1' && r.database_profile === 'express_iam' && r.app_instance_id === p.appInstanceId &&
    r.database_binding_sha256 === config.databaseBindingSha256 && r.database_oid === p.databaseOid && r.role_oid === p.roleOid &&
    r.desired_configuration_hash === p.configurationHash && r.image_revision === p.imageRevision;
}
export function assertExpressProvisionExpectationV1(payload: Record<string, unknown>, p: ExpressControlReadinessPolicyV1) {
  const metadata = record(record(payload.instance).metadata), owner = record(payload.first_owner);
  if (metadata.configuration_hash !== p.configurationHash || metadata.image_revision !== p.imageRevision || owner.username !== p.business.firstOwnerUsername ||
      canonicalJson(payload.entitlements) !== canonicalJson(p.business.entitlements) ||
      canonicalJson(payload.default_store) !== canonicalJson(p.business.default_store)) fail();
}
export function assertExpressOwnerReceiptV1(body: unknown, p: ExpressControlReadinessPolicyV1) {
  const owner = record(record(record(body).first_owner).merchant_user);
  if (owner.username !== p.business.firstOwnerUsername || owner.active !== true || owner.role !== 'owner') fail();
}
/** desired configuration is a template hash, NOT the effective snapshot hash.
 * Recompute the latter from authenticated readback, and independently compare
 * actual entitlements/name/themes with the reviewed compiled expectation.
 */
export async function expressEffectiveConfigurationMatchesV1(body: unknown, p: ExpressControlReadinessPolicyV1): Promise<boolean> {
  const c = record(record(body).control), i = record(c.instance);
  if (!Array.isArray(c.stores) || c.stores.length !== 1) return false;
  const s = record(c.stores[0]), branding = record(s.branding);
  if (typeof s.store_id !== 'string' || !/^[a-f0-9-]{36}$/.test(s.store_id) || s.is_default !== true || s.status !== 'active' ||
      canonicalJson(c.entitlements) !== canonicalJson(p.business.entitlements) ||
      branding.store_name !== p.business.default_store.name ||
      canonicalJson(branding.buyer_theme) !== canonicalJson(p.business.default_store.buyer_theme) ||
      canonicalJson(branding.merchant_theme) !== canonicalJson(p.business.default_store.merchant_theme)) return false;
  const actual = { instance: { external_instance_id: i.external_instance_id || null, status: i.status || null }, entitlements: c.entitlements,
    stores: [{ store_id: s.store_id, status: s.status, store_name: branding.store_name || s.name || '',
      buyer_theme: branding.buyer_theme || null, merchant_theme: branding.merchant_theme || null }] };
  return c.configuration_hash === await sha256Hex(canonicalJson(actual));
}
