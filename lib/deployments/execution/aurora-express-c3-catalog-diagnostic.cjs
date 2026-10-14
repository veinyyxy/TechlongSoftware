'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local fixed read-only diagnostic, not runtime authority. */
const db = require('./aurora-database-contract-v2.cjs');
const SLOT = 'techlong-d002-express-c3-pg17-catalog-diagnostic-v1.permanent-slot.json';
const ORIGINAL_SHA = '87c5995ea79c8e7218e33bdc76bc5c98618cd2d486b77319b290d3ce5a26599f';
const EXPECTED = Object.freeze({ tenant: '16456', database: '16459', management: '16410', managementDatabase: '5' });
const CONTEXT_SQL = `SELECT current_setting('transaction_read_only') AS read_only,
 current_setting('transaction_isolation') AS isolation, pg_database_size(current_database())::text AS bytes,
 (SELECT count(*)::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind='r') AS user_tables`;
const TRANSACTION = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const fail = code => { throw Error(code); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function prepareReview({ facts, original, codeBindingSha256, historySha256, sql }, now) {
  if (!Number.isFinite(now) || !Number.isFinite(Date.parse(facts.observedAt)) ||
    ![codeBindingSha256, historySha256].every(sha) || original.manifestSha256 !== ORIGINAL_SHA ||
    db.canonicalJson(facts.binding) !== db.canonicalJson(original.expectedBinding) ||
    facts.source?.Account !== '402010193138' || facts.source.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
    facts.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' || facts.plan?.planType !== 'FREE' || facts.plan.planStatus !== 'ACTIVE' ||
    facts.connectPermission?.decision !== 'allowed' || facts.connectPermission.missingContext?.length !== 0 ||
    now - Date.parse(facts.observedAt) < 0 || now - Date.parse(facts.observedAt) > 30000 ||
    Object.keys(sql || {}).sort().join(',') !== 'catalogSqlSha256,contextSqlSha256,ownersSqlSha256,tableNamesSha256' ||
    !Object.values(sql).every(sha) || sql.catalogSqlSha256 !== original.sqlProgram.pg17CatalogSqlSha256 ||
    sql.contextSqlSha256 !== db.digest(CONTEXT_SQL)) fail('EXPRESS_C3_CATALOG_REVIEW_REJECTED');
  const body = { schema: 'techlong/express-c3-pg17-catalog-diagnostic/v1', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 3600000).toISOString(), facts, expectedBinding: original.expectedBinding,
    originalManifestSha256: ORIGINAL_SHA, expectedOids: EXPECTED, codeBindingSha256, historySha256, sql,
    transaction: TRANSACTION, attemptSlot: SLOT,
    limits: { sqlConnections: 2, sqlQueries: 9, metadataCalls: 9, connectTimeoutMs: 30000, sqlDeadlineMs: 120000,
      temporaryCredentialsMinimumRemainingMs: 300000, catalogBytes: 4000000, sqlMutations: 0,
      businessTableQueries: 0, awsResourceWrites: 0, secretValueReads: 0, automaticRetries: 0 },
    risks: [
      'Existing Source is an administrator, not app/runtime or newly scoped database authority.',
      'Two connections can resume the retained cluster and incur ACU/I/O costs; 50 USD/month is a target, not a hard cap.',
      'Separate read-only repeatable-read management and tenant snapshots plus AWS readbacks are not cross-service CAS; privileged concurrent changes can race.',
      'Only catalog metadata is read. Function definitions/defaults/ACLs are processed in memory and hashed, not returned as raw text; provider logs can contain connection/SQL metadata.',
      'The current catalog may be empty after disposal of the failed transaction. It cannot uniquely reconstruct the rejected uncommitted catalog; no DDL is replayed to manufacture evidence.',
      'The original frozen verifier and separate explanatory predicates must agree. No predicate relaxation, automatic ready fingerprint learning or repair is authorized.',
      'The new one-shot slot is permanently consumed before connection. Timeout, lost response or local artifact failure never authorizes retry/reset.',
      'IAM tokens remain in memory; JS/driver erasure is best effort. Existing roles/database, old slots and all historical receipts are preserved.',
      'No schema restore/migration, role/ACL change, guard recreation, Secret, IAM, Neon, ECS, cleanup or runtime activation is authorized.'
    ], sqlMutationAuthorized: false, runtimeEnabled: false, lifecycleCompatible: false, executionAuthorized: false };
  return Object.freeze({ ...structuredClone(body), manifestSha256: db.digest(body) });
}
function assertApproval(review, approvedSha, codeSha, historySha, original, sql, now) {
  const { manifestSha256, ...body } = review;
  if (!sha(approvedSha) || approvedSha !== manifestSha256 || db.digest(body) !== manifestSha256 ||
    review.codeBindingSha256 !== codeSha || review.historySha256 !== historySha || !Number.isFinite(now) ||
    !Number.isFinite(Date.parse(review.preparedAt)) || !Number.isFinite(Date.parse(review.expiresAt)) ||
    now < Date.parse(review.preparedAt) || now >= Date.parse(review.expiresAt)) fail('EXPRESS_C3_CATALOG_FRESH_APPROVAL_REQUIRED');
  const expected = prepareReview({ facts: review.facts, original, codeBindingSha256: codeSha,
    historySha256: historySha, sql }, Date.parse(review.preparedAt));
  if (db.canonicalJson(expected) !== db.canonicalJson(review)) fail('EXPRESS_C3_CATALOG_SCOPE_DRIFT');
}
const list = value => Array.isArray(value);
const every = (value, check) => list(value) && value.every(check);
const same = (a, b) => db.canonicalJson(a) === db.canonicalJson(b);
// Mirror the frozen verifier for explanation only, not admission. Always call
// that verifier separately and fail closed if our combined predicates disagree.
function explain(c, tables) {
  const checks = [], add = (id, accepted) => checks.push({ id, accepted: accepted === true });
  add('one_public_schema', list(c.schemas) && c.schemas.length === 1 && c.schemas[0].name === 'public');
  add('public_schema_owner', c.schemas?.[0]?.owner === 'pg_database_owner');
  add('public_schema_acl', every(c.schemas?.[0]?.acl, a => a.grantor === 'pg_database_owner' &&
    (a.grantee === 'PUBLIC' ? a.privilege === 'USAGE' && !a.grantable :
      a.grantee === 'pg_database_owner' && ['CREATE','USAGE'].includes(a.privilege) && !a.grantable)));
  add('exact_73_tables', list(c.relations) && same(c.relations.filter(r => r.kind === 'r').map(r => r.name).sort(), tables));
  add('relation_schema_owner_kind', every(c.relations, r => r.schema === 'public' && r.owner === 'postgres' && ['r','i','S'].includes(r.kind)));
  add('relation_persistence_rls', every(c.relations, r => r.persistence === 'p' && r.rls === false && r.forceRls === false));
  add('relation_rules_policies', every(c.relations, r => list(r.rules) && r.rules.length === 0 && list(r.policies) && r.policies.length === 0));
  add('relation_acl', every(c.relations, r => every(r.acl, a => a.grantee === 'postgres' && a.grantor === 'postgres' && !a.grantable)));
  add('column_acl_null', every(c.relations, r => every(r.columns, a => a.acl === null)));
  add('function_schema_security_config', every(c.functions, f => f.schema === 'public' && !f.securityDefiner && !f.leakproof && f.config === null));
  add('function_owner', every(c.functions, f => f.extensionOwned || f.owner === 'postgres'));
  add('function_acl', every(c.functions, f => every(f.acl, a => a.grantor === f.owner && ['PUBLIC',f.owner].includes(a.grantee) && a.privilege === 'EXECUTE' && !a.grantable)));
  add('uuid_extension_only', list(c.extensions) && c.extensions.length === 1 && c.extensions[0].name === 'uuid-ossp');
  add('uuid_extension_version_schema_owner', c.extensions?.[0]?.version === '1.1' && c.extensions[0].schema === 'public' && c.extensions[0].owner === 'postgres');
  add('type_schema_owner_acl', every(c.types, t => t.schema === 'public' && t.owner === 'postgres' && t.acl === null));
  add('no_user_collations', list(c.collations) && c.collations.length === 0);
  add('no_event_triggers', list(c.eventTriggers) && c.eventTriggers.length === 0);
  return checks;
}
const safeLabel = value => ['public','postgres','pg_database_owner','PUBLIC','EXTENSION_SCRIPT_OWNER','uuid-ossp'].includes(value)
  ? { value } : { sha256: db.digest(value ?? null) };
function diagnose({ result, context, tables, verifyCatalog }) {
  const c = result?.rows?.[0]?.identity;
  if (result?.rowCount !== 1 || !c || Buffer.byteLength(db.canonicalJson(c)) > 4000000 ||
    !['schemas','relations','functions','extensions','types','collations','eventTriggers'].every(k => list(c[k])) ||
    !Array.isArray(tables) || tables.length !== 73 || new Set(tables).size !== 73 ||
    !tables.every(t => typeof t === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(t)) || !same(tables.slice().sort(), tables) ||
    context?.read_only !== 'on' || context.isolation !== 'repeatable read' ||
    !/^[1-9][0-9]{0,15}$/.test(context.bytes || '') || !/^(?:0|[1-9][0-9]{0,7})$/.test(context.user_tables || '') ||
    Number(context.user_tables) !== c.relations.filter(r => r.kind === 'r').length || typeof verifyCatalog !== 'function')
    fail('EXPRESS_C3_CATALOG_OBSERVATION_REJECTED');
  const checks = explain(c, tables);
  let original = { accepted: true, code: null };
  try { verifyCatalog(result, tables); }
  catch (e) {
    original = { accepted: false, code: e.message === 'AURORA_V3_PG17_CATALOG_REJECTED' ? e.message : 'EXPRESS_C3_CATALOG_VERIFIER_FAILED' };
  }
  if (original.code === 'EXPRESS_C3_CATALOG_VERIFIER_FAILED' || original.accepted !== checks.every(p => p.accepted))
    fail('EXPRESS_C3_CATALOG_EXPLAINER_DISAGREES');
  const names = c.relations.filter(r => r.kind === 'r').map(r => r.name);
  const empty = ['relations','functions','extensions','types','collations','eventTriggers'].every(k => c[k].length === 0);
  return { state: empty ? 'CURRENT_TENANT_CATALOG_EMPTY_ORIGINAL_REJECTION_NOT_RECONSTRUCTED' :
    original.accepted ? 'CURRENT_PG17_CATALOG_ACCEPTED_NOT_RUNTIME_VERIFIED' : 'CURRENT_PG17_CATALOG_REJECTED_NOT_ORIGINAL_CAUSE_PROVED',
    originalValidation: original, checks, rejectedPredicates: checks.filter(p => !p.accepted).map(p => p.id),
    catalogSha256: db.digest(c), catalogBytes: Buffer.byteLength(db.canonicalJson(c)), currentUserTables: names.length,
    missingExpectedTables: tables.filter(t => !names.includes(t)).length, extraTables: names.filter(t => !tables.includes(t)).length,
    tenantDatabaseBytes: context.bytes, allUserObjectsEmptyNow: empty,
    inventory: Object.fromEntries(['schemas','relations','functions','extensions','types','collations','eventTriggers'].map(k => [k,c[k].length])),
    // Small safe ownership/ACL summaries; no definitions, defaults, config,
    // comments, function bodies, customer data or unknown names in receipts.
    schemas: c.schemas.slice(0,8).map(s => ({ name: safeLabel(s.name), owner: safeLabel(s.owner),
      acl: list(s.acl) ? s.acl.slice(0,16).map(a => ({ grantor: safeLabel(a.grantor), grantee: safeLabel(a.grantee),
        privilege: ['CREATE','USAGE'].includes(a.privilege) ? a.privilege : 'OTHER', grantable: a.grantable === true })) : null })),
    extensions: c.extensions.slice(0,8).map(e => ({ name: safeLabel(e.name), owner: safeLabel(e.owner),
      versionMatches: e.version === '1.1', schemaMatches: e.schema === 'public' })),
    unexpectedOwners: ['relations','functions','types'].flatMap(k => c[k].filter(v =>
      v.owner !== 'postgres' && !(k === 'functions' && v.extensionOwned)).slice(0,8).map(v =>
      ({ kind: k, objectSha256: db.digest([v.schema,v.name,v.arguments || null]), owner: safeLabel(v.owner) }))),
    originalFailureConditionProved: false, rollbackIndependentlyProved: false, rowCountsRead: false,
    structuralPinInstalled: false, sqlMutationPerformed: false, retryAuthorized: false, runtimeEnabled: false, lifecycleCompatible: false };
}
module.exports = { SLOT, ORIGINAL_SHA, EXPECTED, CONTEXT_SQL, TRANSACTION, prepareReview, assertApproval, diagnose, explain };
