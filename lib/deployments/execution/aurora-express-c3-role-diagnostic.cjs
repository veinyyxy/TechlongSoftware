'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local fixed read-only diagnostic, not a runtime authority. */
const db = require('./aurora-database-contract-v2.cjs');
const SLOT = 'techlong-d002-express-c3-role-diagnostic-v1.permanent-slot.json';
const ORIGINAL_SHA = '1df7e2f7da6b3e900f68e5d5814e2f32e1578c19af131270ef6a355112ced440';
const EXPECTED = Object.freeze({ tenant: '16456', guard: '16457', management: '16410', database: '5' });
const fail = code => { throw Error(code); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Only these two names are read. Relationship counts are complete; arrays are
// deterministically bounded. No pg_authid/password, configuration values or data.
const DETAIL_SQL = `SELECT
 jsonb_build_object('readOnly',current_setting('transaction_read_only')='on',
 'isolation',current_setting('transaction_isolation'),
 'tenantDatabaseAbsent',NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=$2::text),
 'creatorInherit',(SELECT rolinherit FROM pg_roles WHERE rolname=current_user),
 'creatorCreateRole',(SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user),
 'selfGrantSetting',current_setting('createrole_self_grant',true)) AS context,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('oid',r.oid::text,'name',r.rolname,
 'memberCount',(SELECT count(*)::integer FROM pg_auth_members WHERE roleid=r.oid),
 'parentCount',(SELECT count(*)::integer FROM pg_auth_members WHERE member=r.oid),
 'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('memberOid',m.member::text,
 'name',pg_get_userbyid(m.member),'grantorOid',m.grantor::text,'grantor',pg_get_userbyid(m.grantor),
 'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) ORDER BY m.member,m.grantor)
 FROM (SELECT * FROM pg_auth_members WHERE roleid=r.oid ORDER BY member,grantor LIMIT 17) m),'[]'::jsonb),
 'parents',COALESCE((SELECT jsonb_agg(jsonb_build_object('roleOid',m.roleid::text,
 'name',pg_get_userbyid(m.roleid),'grantorOid',m.grantor::text,'grantor',pg_get_userbyid(m.grantor),
 'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) ORDER BY m.roleid,m.grantor)
 FROM (SELECT * FROM pg_auth_members WHERE member=r.oid ORDER BY roleid,grantor LIMIT 17) m),'[]'::jsonb)) ORDER BY r.oid)
 FROM pg_roles r WHERE r.rolname=ANY($1::text[])),'[]'::jsonb) AS roles`;
function prepareReview({ facts, original, codeBindingSha256, historySha256, legacySqlSha256 }, now) {
  if (!Number.isFinite(now) || !Number.isFinite(Date.parse(facts.observedAt)) || ![codeBindingSha256, historySha256, legacySqlSha256].every(sha) ||
    original.manifestSha256 !== ORIGINAL_SHA || db.canonicalJson(facts.binding) !== db.canonicalJson(original.expectedBinding) ||
    facts.source?.Account !== '402010193138' || facts.source.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
    facts.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' || facts.plan?.planType !== 'FREE' || facts.plan.planStatus !== 'ACTIVE' ||
    facts.connectPermission?.decision !== 'allowed' || facts.connectPermission.missingContext?.length !== 0 ||
    now - Date.parse(facts.observedAt) < 0 || now - Date.parse(facts.observedAt) > 30000)
    fail('EXPRESS_C3_ROLE_REVIEW_REJECTED');
  const body = { schema: 'techlong/express-c3-role-diagnostic/v1', preparedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 3600000).toISOString(), facts, expectedBinding: original.expectedBinding,
    originalManifestSha256: ORIGINAL_SHA, bootstrapProgramSha256: original.bootstrapProgramSha256,
    candidateInput: original.candidateInput, expectedOids: EXPECTED, codeBindingSha256, historySha256,
    sql: { legacyCatalogSha256: legacySqlSha256, detailSqlSha256: db.digest(DETAIL_SQL),
      transaction: 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' }, attemptSlot: SLOT,
    limits: { sqlConnections: 1, sqlQueries: 5, metadataCalls: 9, connectTimeoutMs: 30000,
      sqlDeadlineMs: 90000, temporaryCredentialsMinimumRemainingMs: 300000,
      sqlMutations: 0, awsResourceWrites: 0, secretValueReads: 0, automaticRetries: 0 },
    risks: [
      'This uses existing Source administrator credentials, not app/runtime or new least-privilege authority.',
      'One connection may resume the retained cluster and incur ACU/I/O costs; 50 USD/month is a target, not a hard cap.',
      'Read-only repeatable-read catalog evidence is a current observation, not proof of the original failure condition or cross-service CAS.',
      'IAM credentials/tokens remain in memory, but JS/driver erasure is best effort and provider logs may contain connection/SQL metadata.',
      'The one-shot diagnostic slot is permanently consumed before connection; timeout, lost response or artifact failure does not authorize retry/reset.',
      'Existing app/guard roles and old slots are preserved. No role change, adoption, database creation, restore, migration or cleanup is authorized.'
    ], sqlMutationAuthorized: false, runtimeEnabled: false, lifecycleCompatible: false, executionAuthorized: false };
  return Object.freeze({ ...structuredClone(body), manifestSha256: db.digest(body) });
}
function assertApproval(review, approvedSha, codeSha, historySha, original, legacySqlSha, now) {
  const { manifestSha256, ...body } = review;
  if (!sha(approvedSha) || approvedSha !== manifestSha256 || db.digest(body) !== manifestSha256 ||
    review.codeBindingSha256 !== codeSha || review.historySha256 !== historySha || !Number.isFinite(now) ||
    !Number.isFinite(Date.parse(review.preparedAt)) || !Number.isFinite(Date.parse(review.expiresAt)) ||
    now < Date.parse(review.preparedAt) || now >= Date.parse(review.expiresAt)) fail('EXPRESS_C3_ROLE_FRESH_APPROVAL_REQUIRED');
  const expected = prepareReview({ facts: review.facts, original, codeBindingSha256: codeSha,
    historySha256: historySha, legacySqlSha256: legacySqlSha }, Date.parse(review.preparedAt));
  if (db.canonicalJson(expected) !== db.canonicalJson(review)) fail('EXPRESS_C3_ROLE_SCOPE_DRIFT');
}
const safeName = name => ['postgres', 'rdsadmin', 'rds_iam', 'rds_superuser'].includes(name) ? { name } : { nameSha256: db.digest(name) };
function safeRelationship(m) {
  if (!m || typeof m.name !== 'string' || typeof m.grantor !== 'string' ||
    ![m.memberOid || m.roleOid, m.grantorOid].every(v => typeof v === 'string' && /^[1-9][0-9]{0,9}$/.test(v)) ||
    ['admin', 'inherit', 'set'].some(k => typeof m[k] !== 'boolean')) fail('EXPRESS_C3_ROLE_CATALOG_REJECTED');
  return { ...safeName(m.name), grantor: safeName(m.grantor), relatedOid: m.memberOid || m.roleOid,
    grantorOid: m.grantorOid, admin: m.admin, inherit: m.inherit, set: m.set };
}
// Mirror each original reserve predicate for explanation only. The original
// frozen verifier is still called separately; no predicate is relaxed here.
function explainRole(role, program, guard) {
  const checks = [], add = (id, accepted) => checks.push({ id, accepted: accepted === true });
  add('present', !!role); if (!role) return checks;
  add('oid', role.oid === EXPECTED[guard ? 'guard' : 'tenant']);
  add('name', role.name === (guard ? program.guardName : program.target.tenantUsername));
  for (const k of ['login', 'inherit', 'superuser', 'createDb', 'createRole', 'replication', 'bypassRls', 'settings']) add(k + '_false', role[k] === false);
  add('owns_false', role.owns === false); add('parents_zero', role.parents === 0);
  add('limit_unbounded', role.limit === -1); add('until_null', role.until === null); add('config_null', role.config === null);
  add('ownership_comment', role.comment === program.comments[guard ? 'guard' : 'role']);
  const members = Array.isArray(role.members) ? role.members : [];
  add('members_one_or_two', Array.isArray(role.members) && members.length >= 1 && members.length <= 2);
  add('members_postgres_only', members.every(m => m.name === 'postgres'));
  add('grantor_postgres_or_rdsadmin', members.every(m => ['postgres', 'rdsadmin'].includes(m.grantor)));
  add('member_options_boolean', members.every(m => ['admin', 'inherit', 'set'].every(k => typeof m[k] === 'boolean')));
  add('some_admin', members.some(m => m.admin === true));
  add('some_inherit_equals_guard', members.some(m => m.inherit === true) === guard);
  add('some_set_equals_guard', members.some(m => m.set === true) === guard);
  return checks;
}
function diagnose({ program, legacy, detail, verifyReserve }) {
  if (!legacy || !detail || !Array.isArray(legacy.roles) || legacy.roles.length > 2 ||
    !Array.isArray(legacy.databases) || legacy.databases.length > 1 || !Array.isArray(detail.roles) || detail.roles.length > 2 ||
    detail.context?.readOnly !== true || detail.context.isolation !== 'repeatable read' ||
    detail.context.tenantDatabaseAbsent !== (legacy.databases.length === 0) ||
    ['creatorInherit', 'creatorCreateRole'].some(k => typeof detail.context[k] !== 'boolean') ||
    db.canonicalJson({ legacy, detail }).length > 131072 || typeof verifyReserve !== 'function') fail('EXPRESS_C3_ROLE_CATALOG_REJECTED');
  for (const role of legacy.roles) {
    if (typeof role.name !== 'string' || typeof role.oid !== 'string' || !/^[1-9][0-9]{0,9}$/.test(role.oid) ||
      ['login', 'inherit', 'superuser', 'createDb', 'createRole', 'replication', 'bypassRls', 'settings', 'owns'].some(k => typeof role[k] !== 'boolean') ||
      !Number.isInteger(role.parents) || role.parents < 0 || !Number.isInteger(role.limit) || role.limit < -1 ||
      !Array.isArray(role.members) || role.members.length > 3) fail('EXPRESS_C3_ROLE_CATALOG_REJECTED');
  }
  const current = { app: legacy.roles.find(r => r.name === program.target.tenantUsername) || null,
    guard: legacy.roles.find(r => r.name === program.guardName) || null, database: legacy.databases[0] || null };
  let validation = { accepted: true, code: null };
  try { verifyReserve(program, current, 'reserve', null); }
  catch (e) { validation = { accepted: false, code: ['AURORA_V3_BOOTSTRAP_ROLE_CHANGED', 'AURORA_V3_BOOTSTRAP_UNEXPECTED_DATABASE'].includes(e.message) ? e.message : 'EXPRESS_C3_ROLE_VERIFIER_FAILED' }; }
  const roles = [false, true].map(guard => {
    const role = guard ? current.guard : current.app, kind = guard ? 'guard' : 'tenant';
    const relations = detail.roles.find(r => r.name === (guard ? program.guardName : program.target.tenantUsername));
    const checks = explainRole(role, program, guard);
    if (role && (!relations || relations.oid !== role.oid || !Number.isInteger(relations.memberCount) || relations.memberCount < 0 ||
      !Number.isInteger(relations.parentCount) || relations.parentCount < 0 || !Array.isArray(relations.members) || relations.members.length > 17 ||
      !Array.isArray(relations.parents) || relations.parents.length > 17 || relations.members.length !== Math.min(17, relations.memberCount) ||
      relations.parents.length !== Math.min(17, relations.parentCount))) fail('EXPRESS_C3_ROLE_CATALOG_REJECTED');
    return { kind, oid: role?.oid || null, checks, rejectedPredicates: checks.filter(c => !c.accepted).map(c => c.id),
      attributes: role ? Object.fromEntries(['login', 'inherit', 'superuser', 'createDb', 'createRole', 'replication', 'bypassRls', 'settings', 'owns', 'parents', 'limit'].map(k => [k, role[k]])) : null,
      configIsNull: role ? role.config === null : null, validUntilIsNull: role ? role.until === null : null,
      ownershipCommentMatches: role ? role.comment === program.comments[guard ? 'guard' : 'role'] : null,
      relationships: relations ? { memberCount: relations.memberCount, parentCount: relations.parentCount,
        truncated: relations.memberCount > 17 || relations.parentCount > 17,
        members: relations.members.map(safeRelationship), parents: relations.parents.map(safeRelationship) } : null };
  });
  const setting = detail.context.selfGrantSetting;
  const safeSetting = typeof setting === 'string' && /^(?:|inherit|set|inherit,\s*set|set,\s*inherit)$/.test(setting) ? { value: setting } : { valueSha256: db.digest(setting ?? null) };
  const targetDrift = roles.some(r => !r.checks.find(c => c.id === 'oid')?.accepted) || current.database !== null;
  return { state: targetDrift ? 'ROLE_TARGET_DRIFT_OBSERVED' : validation.accepted ? 'RESERVE_PREDICATES_MATCH_NOW_NOT_ORIGINAL_CAUSE_PROVED' : 'RESERVE_PREDICATES_REJECTED_NOW_NOT_ORIGINAL_CAUSE_PROVED',
    legacyReserveValidation: validation, roles, tenantDatabaseAbsent: current.database === null,
    catalogSha256: db.digest(legacy), detailSha256: db.digest(detail),
    creator: { inherit: detail.context.creatorInherit, createRole: detail.context.creatorCreateRole, selfGrantSetting: safeSetting },
    originalFailureConditionProved: false, sqlMutationPerformed: false, retryAuthorized: false,
    runtimeEnabled: false, lifecycleCompatible: false };
}
module.exports = { SLOT, ORIGINAL_SHA, EXPECTED, DETAIL_SQL, prepareReview, assertApproval, diagnose };
