import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { A, hash, classifyAuditDataRows, verifyCatalog, auditWindow, assertAuditWindow, SUMMARY_SQL, auditProgram } from '../ops/aws-sandbox/scripts/express-initialization-audit-plan-v1.mjs';
const flags = ['instance_matches', 'active', 'provisioned', 'configuration_matches', 'epoch_valid', 'marker_valid', 'hashes_valid',
  'metadata_fence_matches', 'receipt_matches', 'entitlements_present', 'default_store_present', 'store_profile_present', 'owner_present'];
const tables = 'Order,Users,address,addressdeliveryrule,auditlog,cart,cartitem,categories,dining_tables,loyalty_accounts,loyalty_transactions,media_assets,merchant_device_tokens,merchant_notification_deliveries,merchant_notification_dismissals,merchant_notification_outbox,merchant_notification_reads,merchant_order_print_jobs,merchant_permissions,merchant_role_permissions,merchant_user_audit_logs,merchant_user_permission_overrides,merchant_user_stores,merchant_users,notification_deliveries,notification_device_tokens,notification_dismissals,notification_outbox,notification_reads,order_item_reviews,order_reviews,order_reward_redemptions,orderitem,orderitem_options,payment_events,payment_refunds,payments,pointsaccount,pointshistory,product_attributes,product_categories,product_images,product_images_legacy,product_option_group_items,product_option_group_links,product_option_groups,product_suppliers,product_translations,products,reward_items,reward_redemptions,saas_access_leases,saas_audit_logs,saas_entitlements,saas_instances,saas_licenses,saas_provisioning_operations,saas_usage_snapshots,shipment,shipmentorder,store_categories,store_customers,store_product_categories,store_products,stores,suppliers,system_config,system_config_history,user_payment_methods,usercontact,verification_codes,wallet,wallethistory'.split(',');
const one = v => ({ rowCount: 1, rows: [v] });
function fixture() {
  const program = { flags, comments: { database: 'fixed-db-owner', role: 'fixed-role-owner' }, statementsSha256: 'fixed-statement-hash',
    expectedStore: { store_id: 'add89a8c-f43e-81b9-8287-0cb6c5c54f87', is_default: true } };
  const counts = tables.map(name => ({ name, rows: String(name === 'stores' || name === 'saas_instances' ? 1 : name === 'saas_entitlements' ? 8 : 0) }));
  const entitlements = [['branding.custom_theme.enabled', true, 'boolean'], ['branding.merchant_editable', true, 'boolean'],
    ['buyer.access.heartbeat_seconds', 300, 'integer'], ['buyer.access.lease_seconds', 900, 'integer'],
    ['buyer.accounts.max', null, 'integer_or_null'], ['buyer.concurrent_access.max', null, 'integer_or_null'],
    ['merchant.active_users.max', null, 'integer_or_null'], ['stores.max', null, 'integer_or_null']]
    .map(([key, value, type]) => ({ key, value, type, source: 'default', license: null, revision: '1', updatedBy: 'migration', sameInstance: true }));
  const data = [{ rowCount: 73, rows: counts }, one({ database_comment: program.comments.database, role_comment: program.comments.role, bootstrap_guard_absent: true }),
    one({ pristine: true, entitlements }), one({ ...program.expectedStore, empty_contact: true, initial_timestamps: true }),
    one(Object.fromEntries(flags.map(k => [k, ['active', 'entitlements_present', 'default_store_present'].includes(k) ? true : null]))),
    one({ instances: 1, operations: 0, merchant_users: 0, audit_rows: 0, profiles: 0, exact_default_store: true,
      exact_owner: false, exact_profile: false, exact_original_completed_receipt: false, exact_provision_audit: false })];
  return { program, data };
}
function committedFixture() {
  const f = fixture(); f.data[2].rows[0].pristine = false;
  f.data[4] = one(Object.fromEntries(flags.map(k => [k, true])));
  f.data[5] = one({ instances: 1, operations: 1, merchant_users: 1, audit_rows: 2, profiles: 1, exact_default_store: true,
    exact_owner: true, exact_profile: true, exact_original_completed_receipt: true, exact_provision_audit: true }); return f;
}
test('exact pristine observation is classified without granting provision or ready authority', () => {
  const { data, program } = fixture(); assert.equal(hash(data[0].rows), A.pristineCounts);
  const v = classifyAuditDataRows(data, program); assert.equal(v.outcome, 'PRISTINE_UNINITIALIZED_NO_POST_AUTHORITY');
  assert.equal(v.provisionAuthorized, false); assert.equal(v.platformReady, false); assert.equal(v.catalogAndOwnershipVerified, undefined);
});
test('completed exact original receipt is only a candidate, not authenticated API proof', () => {
  const { data, program } = committedFixture(), v = classifyAuditDataRows(data, program);
  assert.equal(v.outcome, 'ORIGINAL_COMMIT_CANDIDATE_CONTROL_VERIFICATION_REQUIRED');
  assert.equal(v.initializedApiVerified, false); assert.equal(v.effectiveConfigurationApiVerified, false); assert.equal(v.provisionAuthorized, false);
});
test('every missing readiness flag or foreign receipt/owner/store prevents a committed classification', () => {
  for (const flag of flags) { const { data, program } = committedFixture(); data[4].rows[0][flag] = null;
    assert.equal(classifyAuditDataRows(data, program).outcome, 'DIVERGED_OR_PARTIAL_NO_RETRY'); }
  for (const flag of ['exact_owner', 'exact_profile', 'exact_default_store', 'exact_original_completed_receipt', 'exact_provision_audit']) {
    const { data, program } = committedFixture(); data[5].rows[0][flag] = false;
    assert.equal(classifyAuditDataRows(data, program).outcome, 'DIVERGED_OR_PARTIAL_NO_RETRY');
  }
});
test('partial writes or altered default entitlements cannot be called pristine', () => {
  for (const mutate of [d => { d[0].rows.find(r => r.name === 'merchant_users').rows = '1'; },
    d => { d[2].rows[0].entitlements[0].value = false; }, d => { d[5].rows[0].operations = 1; },
    d => { d[3].rows[0].initial_timestamps = false; }]) {
    const { data, program } = fixture(); mutate(data); assert.equal(classifyAuditDataRows(data, program).outcome, 'DIVERGED_OR_PARTIAL_NO_RETRY');
  }
});
test('foreign ownership, unexpected result fields and raw strings are rejected rather than persisted', () => {
  const f = fixture(); f.data[1].rows[0].database_comment = 'foreign'; assert.throws(() => classifyAuditDataRows(f.data, f.program), /OWNER_COMMENT_DIVERGED/);
  for (const mutate of [d => { d[4].rows[0].raw_password = 'forbidden'; }, d => { d[5].rows[0].raw_metadata = {}; },
    d => { d[4].rows[0].instance_matches = 'true'; }]) {
    const { data, program } = fixture(); mutate(data); assert.throws(() => classifyAuditDataRows(data, program), /FLAGS_OR_SUMMARY_SHAPE/);
  }
});
test('catalog must be validated before business reads; foreign programs and targets fail', () => {
  assert.throws(() => verifyCatalog([]), /ENVELOPE_ROWS/);
  assert.throws(() => verifyCatalog([one({ database: 'foreign' }), one({}), { rowCount: 4, rows: [] }, one({})]), /CATALOG_OR_IDENTITY_DIVERGED/);
  assert.throws(() => auditProgram({ historical: {}, seed: { target: { endpoint: 'foreign' } }, readiness: {} }), /PROGRAM_SOURCE/);
});
test('admission expires independently and cannot run close to Janitor expiry or change read slot per SHA', () => {
  const start = Date.parse('2026-10-16T05:00:00Z'), p = auditWindow(start, '2026-10-16T12:04:28.726Z');
  assertAuditWindow(p, start + 1); assert.throws(() => assertAuditWindow(p, p.admissionExpiresAt), /APPROVAL_EXPIRED_NO_SQL/);
  const short = auditWindow(start, new Date(start + 5 * 60000).toISOString()); assert.throws(() => assertAuditWindow(short, start), /APPROVAL_EXPIRED_NO_SQL/);
  assert.match(A.slot, /initialization-audit-v1\.permanent-slot\.json$/);
});
test('fixed SELECT summary and runtime have no arbitrary SQL/private loader or mutation entry', async () => {
  assert.match(SUMMARY_SQL, /^SELECT/); assert.doesNotMatch(SUMMARY_SQL, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i);
  for (let n = 1; n <= 11; n++) assert.equal(SUMMARY_SQL.includes('$' + n), true);
  assert.match(SUMMARY_SQL, /store_id=\$8::text::uuid/);
  assert.match(SUMMARY_SQL, /external_operation_epoch'=\(\$3::integer\)::text/);
  const runtime = await readFile(new URL('../ops/aws-sandbox/scripts/express-initialization-audit-runtime-v1.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /hash\(program.statements.slice\(0, 8\)\) === A.snapshotSha256/);
  assert.doesNotMatch(runtime, /new (?:GetSecretValue|CreateStack|UpdateStack|Invoke|PutItem)Command/);
});
