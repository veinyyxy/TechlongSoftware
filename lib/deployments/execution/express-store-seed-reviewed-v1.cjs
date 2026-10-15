'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Fixed SQL program; no credential/network/filesystem client. */
const db = require('./aurora-database-contract-v2.cjs');
const activation = require('./express-application-activation-c4h.cjs');
const BEGIN = 'BEGIN ISOLATION LEVEL SERIALIZABLE';
const SEARCH = 'SET LOCAL search_path = pg_catalog';
const TIMEOUT = "SET LOCAL lock_timeout = '5000ms'";
const LOCK = 'LOCK TABLE public.stores IN SHARE ROW EXCLUSIVE MODE';
const RUN_SLOT = 'techlong-express-c5c-store-seed-run-v1.permanent-slot.json';
const INSPECT_SLOT = 'techlong-express-c5c-store-seed-inspect-v1.permanent-slot.json';
const CATALOG_SHA = 'ad213560c608cc678d838e1789f9e90d33eff77062febe90a4f8881881299bc9';
const ROLE_SHA = '941cfda905da13438878f0f5415a2d9bb56a7be217a8d813daef8fde401055d5';
const ACL_SHA = '9a6a5619d26ca00ec807c83e6dbf3c2f69504b06f93af26eb9b8ce6b86d61c22';
const SEED_SHA = '5e433c2bc8c7844ce7d2c20dd2f08a8386fc9026a7525ebfdde2d6625d2eb4ea';
const GUARDS_SQL = `SELECT
 shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS database_comment,
 shobj_description((SELECT oid FROM pg_roles WHERE rolname=$1),'pg_authid') AS role_comment,
 NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$2) AS bootstrap_guard_absent`;
const SINGLETON_SQL = `SELECT
 (SELECT count(*)=1 AND bool_and(singleton_key AND status='active' AND metadata='{}'::jsonb
   AND external_instance_id IS NULL AND provisioned_at IS NULL
   AND external_operation_epoch IS NULL AND external_operation_intent IS NULL AND external_operation_marker IS NULL
   AND external_operation_hash IS NULL AND external_operation_request_sha256 IS NULL
   AND external_operation_result IS NULL AND external_operation_updated_at IS NULL) FROM public.saas_instances) AS pristine,
 (SELECT jsonb_agg(jsonb_build_object('key',entitlement_key,'value',entitlement_value,'type',value_type,
   'source',source,'license',source_license_id,'revision',revision::text,'updatedBy',updated_by,
   'sameInstance',instance_id=(SELECT instance_id FROM public.saas_instances WHERE singleton_key=TRUE))
   ORDER BY entitlement_key COLLATE "C") FROM public.saas_entitlements) AS entitlements`;
const STORES_SQL = `SELECT store_id::text,store_code,slug,timezone,currency,status,is_default,
 phone IS NULL AND address='{}'::jsonb AND latitude IS NULL AND longitude IS NULL AS empty_contact,
 created_at IS NOT NULL AND created_at=updated_at AS initial_timestamps
 FROM public.stores ORDER BY store_id LIMIT 2`;
const ENTITLEMENTS = [
 ['branding.custom_theme.enabled', true, 'boolean'], ['branding.merchant_editable', true, 'boolean'],
 ['buyer.access.heartbeat_seconds', 300, 'integer'], ['buyer.access.lease_seconds', 900, 'integer'],
 ['buyer.accounts.max', null, 'integer_or_null'], ['buyer.concurrent_access.max', null, 'integer_or_null'],
 ['merchant.active_users.max', null, 'integer_or_null'], ['stores.max', null, 'integer_or_null'],
].map(([key, value, type]) => ({ key, value, type, source: 'default', license: null, revision: '1', updatedBy: 'migration', sameInstance: true }));
const programs = new WeakSet(), same = (a, b) => db.canonicalJson(a) === db.canonicalJson(b);
function fail(code) { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function compile({ seed, applicationProgram, bootstrap }) {
  const { programSha256, ...body } = seed || {};
  activation.assertTarget(applicationProgram);
  if (programSha256 !== SEED_SHA || db.digest(body) !== SEED_SHA ||
      applicationProgram.target.database !== seed.target.database || bootstrap.target.tenantDatabase !== seed.target.database ||
      !bootstrap.comments?.database || !bootstrap.comments?.role || !bootstrap.guardName) fail('STORE_SEED_PROGRAM_REJECTED');
  const p = freeze({ schema: 'techlong/express-store-seed-sql/v1', seed: structuredClone(seed),
    tables: [...applicationProgram.tables], target: seed.target, expectedDatabases: structuredClone(applicationProgram.activeDatabases),
    snapshot: [...applicationProgram.snapshotPlan,
      { text: GUARDS_SQL, values: [seed.target.role, bootstrap.guardName] }, { text: SINGLETON_SQL }, { text: STORES_SQL }],
    comments: { database: bootstrap.comments.database, role: bootstrap.comments.role },
    begin: BEGIN, search: SEARCH, timeout: TIMEOUT, lock: LOCK,
    pins: { catalog: CATALOG_SHA, role: ROLE_SHA, databaseAcl: ACL_SHA },
    limits: { runConnections: 1, inspectConnections: 1, runNormalQueries: 22, inspectNormalQueries: 12,
      rollbackMaximum: 1, applicationInsertMaximum: 1, awsWrites: 0, secretValueReads: 0, privateMaterialReads: 0,
      permissionWrites: 0, neonWrites: 0, authorityWrites: 0, automaticRetries: 0 } });
  programs.add(p); return p;
}
function assertProgram(p) { if (!programs.has(p)) fail('STORE_SEED_PRIVATE_PROGRAM_REQUIRED'); return p; }
function prepare({ program, codeBindingSha256, facts, now }) {
  assertProgram(program); assertFacts(facts, now);
  if (!/^[a-f0-9]{64}$/.test(codeBindingSha256)) fail('STORE_SEED_CODE_BINDING_REQUIRED');
  const body = { schema: 'techlong/express-store-seed-review/v1', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 3600000).toISOString(), codeBindingSha256, program, facts,
    slots: { run: RUN_SLOT, inspect: INSPECT_SLOT }, risks: [
      'One parameterized stores INSERT is persistent business data. It is not an upsert, provision, owner/epoch claim, job, TTL start or ready proof. No existing record is updated.',
      'Run uses one Source-signed postgres TLS/IAM connection and a SERIALIZABLE transaction with a stores table lock. Full role/ACL/catalog, 73 actual counts, original bootstrap comments and pristine technical singleton/entitlements are checked before and after. Lock/serialization failures abort, never retry.',
      'PostgreSQL catalogs, business counts, AWS metadata, DDB reads and Neon snapshot are not cross-service CAS. Privileged concurrent changes and changes after commit remain possible. Source postgres is privileged; this does not prove ECS task-role behavior.',
      'COMMIT can succeed while its response or local evidence is lost. After submission no rollback/replay/compensation is attempted. Independent readback is a separate single read-only connection, not an atomic extension of Run; divergence or unavailable credentials require review, not a second INSERT.',
      'Each new Run/Inspect slot is permanently occupied before its SQL connection, including failure. Old slots and records remain. There is no automatic delete, down migration, completion, reset, retry, permission change or cloud deployment.',
      'IAM credentials/tokens stay in process memory; erasure is best effort. AWS/DB/network provider logs may retain connection/query metadata. Two SQL connections can resume Aurora with nonzero ACU/I/O cost; 50 USD/month is a target, not a hard cap.',
      'Review performs local archive compilation and metadata/control-plane reads only. Current Aurora SQL state is not proved until approved Run. Independent Inspect may observe either exact empty state or exact new store, and never promotes that result to initialized ready.',
    ], currentAuroraStateProvedAtReview: false, runtimeEnabled: false, readyVerified: false };
  return freeze({ ...body, manifestSha256: db.digest(body) });
}
function assertFacts(f, now) {
  if (f?.source?.Account !== '402010193138' || f.source.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
      f.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' || f.clusterVerified !== true || f.sourceConnectAllowed !== true ||
      f.controlPlane?.result?.outcome !== 'FIRST_CLAIM_CANDIDATE_AURORA_PROOF_STILL_REQUIRED' ||
      Object.values(f.controlPlane.result.checks || {}).length !== 7 || !Object.values(f.controlPlane.result.checks).every(v => v === true) ||
      f.controlPlane.result.subscriptionId !== 'sub_9253b47df64946a3ae6234ce1294ba26' ||
      !Number.isFinite(Date.parse(f.observedAt)) || now < Date.parse(f.observedAt) || now - Date.parse(f.observedAt) > 30000 ||
      !Number.isFinite(f.controlPlane.result.startedAt) || !Number.isFinite(f.controlPlane.result.completedAt) ||
      f.controlPlane.result.completedAt < f.controlPlane.result.startedAt ||
      now < f.controlPlane.result.completedAt || now - f.controlPlane.result.startedAt > 90000) fail('STORE_SEED_FRESH_FACTS_REQUIRED');
}
function approval(m, sha, code, program, now) {
  const { manifestSha256, ...body } = m || {};
  if (sha !== manifestSha256 || db.digest(body) !== manifestSha256 || code !== m.codeBindingSha256 ||
      !same(m.program, assertProgram(program)) ||
      !Number.isFinite(now) || now < Date.parse(m.preparedAt) || now >= Date.parse(m.expiresAt) ||
      !same(prepare({ ...body, program, now: Date.parse(m.preparedAt) }), m)) fail('STORE_SEED_FRESH_APPROVAL_REQUIRED');
}
function verifyCounts(result, tables, stores) {
  const expected = tables.map(name => ({ name, rows: name === 'saas_instances' ? '1' : name === 'saas_entitlements' ? '8' : name === 'stores' ? String(stores) : '0' }));
  if (result?.rowCount !== 73 || !same(result.rows, expected)) fail('STORE_SEED_ACTUAL_ROW_COUNTS_DIVERGED');
  return db.digest(result.rows);
}
function verifySnapshot(results, p, candidate, checks, inspectOnly, stores) {
  const [context, roles, databases, catalog, counts, guards, singleton, storeRows] = results, c = context?.rows?.[0], t = p.target;
  if (context?.rowCount !== 1 || c.database !== t.database || c.database_oid !== t.databaseOid || c.username !== 'postgres' ||
      c.session_username !== 'postgres' || c.role_oid !== t.managementRoleOid || c.server_version_num !== t.serverVersionNum ||
      c.read_only !== (inspectOnly ? 'on' : 'off') || c.isolation !== 'serializable' || c.backend_tls_active !== true) fail('STORE_SEED_TLS_CONTEXT_REJECTED');
  const role = activation.classifyRole(roles, 'active', checks.classifyRole), cat = checks.verifyCatalog(catalog, candidate, 'active');
  if (role.actualRoleSnapshotSha256 !== ROLE_SHA || cat.actualCatalogSha256 !== CATALOG_SHA ||
      databases?.rowCount !== 4 || !same(databases.rows, p.expectedDatabases) || db.digest(databases.rows) !== ACL_SHA) fail('STORE_SEED_ROLE_CATALOG_ACL_CHANGED');
  if (guards?.rowCount !== 1 || !same(guards.rows, [{ database_comment: p.comments.database, role_comment: p.comments.role, bootstrap_guard_absent: true }]) ||
      singleton?.rowCount !== 1 || !same(singleton.rows, [{ pristine: true, entitlements: ENTITLEMENTS }])) fail('STORE_SEED_GUARD_OR_SINGLETON_CHANGED');
  const rowCountsSha256 = verifyCounts(counts, p.tables, stores);
  const expected = stores ? [{ ...p.seed.expectedReturnedRow, empty_contact: true, initial_timestamps: true }] : [];
  if (storeRows?.rowCount !== stores || !same(storeRows.rows, expected)) fail('STORE_SEED_EXACT_STORE_REJECTED');
  return freeze({ actualCatalogSha256: cat.actualCatalogSha256, actualRoleSha256: role.actualRoleSnapshotSha256,
    databaseAclSha256: db.digest(databases.rows), actualRowCountsSha256: rowCountsSha256, storeRows: stores,
    technicalSeeds: 9, otherBusinessRows: 0, pristineSingleton: true, originalCommentsVerified: true,
    clientTlsVerified: true, backendTlsActive: true });
}
async function execute({ client, program: p, candidate, checks, inspectOnly, approval, signal, journal }) {
  assertProgram(p); checks.assertCandidate(candidate);
  let begun = false, commitSubmitted = false, commitAcknowledged = false, insertSubmitted = false, insertAcknowledged = false;
  const q = async v => { approval(); signal.throwIfAborted(); const r = await client.query(v.values ? v : v.text); signal.throwIfAborted(); return r; };
  const snapshot = async () => { const r = []; for (const v of p.snapshot) r.push(await q(v)); return r; };
  try {
    await q({ text: BEGIN + (inspectOnly ? ' READ ONLY' : '') }); begun = true;
    await q({ text: SEARCH }); await q({ text: TIMEOUT }); if (!inspectOnly) await q({ text: LOCK });
    const first = await snapshot(), stores = inspectOnly ? first[7]?.rowCount : 0;
    if (![0, 1].includes(stores)) fail('STORE_SEED_INSPECT_DIVERGED');
    const before = verifySnapshot(first, p, candidate, checks, inspectOnly, stores);
    let after = before;
    if (!inspectOnly) {
      await journal({ kind: 'SINGLE_INSERT_INTENT', before }); approval(); signal.throwIfAborted(); insertSubmitted = true;
      const r = await q(p.seed.insert); insertAcknowledged = true;
      if (r.rowCount !== 1 || !same(r.rows, [p.seed.expectedReturnedRow])) fail('STORE_SEED_INSERT_RESPONSE_REJECTED');
      after = verifySnapshot(await snapshot(), p, candidate, checks, false, 1);
      await journal({ kind: 'POST_INSERT_ACTUAL_SNAPSHOT_VERIFIED', after });
    }
    await journal({ kind: 'COMMIT_INTENT', insertSubmitted }); approval(); signal.throwIfAborted();
    commitSubmitted = true; await q({ text: 'COMMIT' }); commitAcknowledged = true;
    await journal({ kind: 'COMMIT_ACKNOWLEDGED' });
    return freeze({ schema: 'techlong/express-store-seed-observation/v1', before, after, insertSubmitted, insertAcknowledged,
      commitSubmitted, commitAcknowledged, outcome: inspectOnly ? (stores ? 'STORE_SEED_INDEPENDENTLY_OBSERVED_NOT_READY' : 'EMPTY_STATE_OBSERVED_SEED_NOT_PROVED') :
        'STORE_SEED_COMMITTED_REQUIRES_INDEPENDENT_INSPECT', runtimeEnabled: false, readyVerified: false });
  } catch (e) {
    let rollbackAttempted = false, rollbackAcknowledged = false;
    // An expired approval must not prevent aborting an uncommitted transaction.
    if (begun && !commitSubmitted) { rollbackAttempted = true; try { await client.query('ROLLBACK'); rollbackAcknowledged = true; } catch { /* no reconnect */ } }
    e.storeSeedTransaction = { insertSubmitted, insertAcknowledged, commitSubmitted, commitAcknowledged, rollbackAttempted, rollbackAcknowledged }; throw e;
  }
}
// Session transport uses this ordered allowlist, not a general SQL client.
function querySequence(p, inspectOnly) { assertProgram(p); return [{ text: BEGIN + (inspectOnly ? ' READ ONLY' : '') },
  { text: SEARCH }, { text: TIMEOUT }, ...(inspectOnly ? [] : [{ text: LOCK }]), ...p.snapshot,
  ...(inspectOnly ? [] : [p.seed.insert, ...p.snapshot]), { text: 'COMMIT' }]; }
function createQueryGuard(p, inspectOnly, approval) {
  const sequence = querySequence(p, inspectOnly);
  let index = 0, sqlCalls = 0, insertCalls = 0, rollback = false, commitSent = false, lastSqlIndex = null;
  return Object.freeze({ check(q, extra = []) {
    const text = typeof q === 'string' ? q : q?.text;
    if (extra.length || rollback || commitSent) fail('STORE_SEED_SQL_SCOPE_REJECTED');
    if (text === 'ROLLBACK') { if (q !== 'ROLLBACK' || index === 0) fail('STORE_SEED_ROLLBACK_REJECTED'); rollback = true; }
    else { approval(); const expected = sequence[index];
      if (!expected || (expected.values ? !q || typeof q !== 'object' || !same(q, expected) : q !== expected.text)) fail('STORE_SEED_ORDERED_SQL_REJECTED');
      lastSqlIndex = index++; if (text === p.seed.insert.text && ++insertCalls !== 1) fail('STORE_SEED_INSERT_BUDGET_REJECTED');
      if (text === 'COMMIT') commitSent = true;
    }
    if (++sqlCalls > sequence.length + 1) fail('STORE_SEED_QUERY_BUDGET_REJECTED');
    return { sqlCalls, insertCalls, lastSqlIndex };
  } });
}
module.exports = { RUN_SLOT, INSPECT_SLOT, compile, assertProgram, prepare, assertFacts, approval, verifyCounts, verifySnapshot, execute, querySequence, createQueryGuard };
