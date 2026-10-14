'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Source-only local review, not runtime authority. */
const db = require('./aurora-database-contract-v2.cjs');
const RUN_SLOT = 'techlong-d002-express-c3-restore-only-v4.permanent-slot.json';
const INSPECT_SLOT = 'techlong-d002-express-c3-restore-only-v4-inspect.permanent-slot.json';
const DIAGNOSTIC_SHA = '872e302703b3e09bcbf9a439b3d6eef818e5643ead4872fee523a81ab7c7e5cf';
const EMPTY_CATALOG_SHA = '56f65c613ba62ada90240b72679ca0323b3e0b8414f85b25f6263d360be5b0d7';
const SQL_PROGRAM_SHA = '55733716d897ee5cdcd80abffb85c277ca148b4d7c3af5a8d199a4f7fd5bbfa4';
const fail = code => { throw Error(code); };
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function prepareReview({ facts, originalD, originalE, sqlProgram, codeBindingSha256, historySha256 }, now) {
  if (!Number.isFinite(now) || !Number.isFinite(Date.parse(facts.observedAt)) ||
    ![codeBindingSha256,historySha256].every(sha) || originalE.manifestSha256 !== DIAGNOSTIC_SHA ||
    originalD.manifestSha256 !== '87c5995ea79c8e7218e33bdc76bc5c98618cd2d486b77319b290d3ce5a26599f' ||
    db.digest(sqlProgram) !== SQL_PROGRAM_SHA || db.canonicalJson(sqlProgram) !== db.canonicalJson(originalD.sqlProgram) ||
    db.canonicalJson(originalD.expectedBinding) !== db.canonicalJson(originalE.expectedBinding) ||
    db.canonicalJson(facts.binding) !== db.canonicalJson(originalD.expectedBinding) ||
    facts.source?.Account !== '402010193138' || facts.source.Arn !== 'arn:aws:iam::402010193138:user/techlong-sandbox-dev' ||
    facts.source.UserId !== 'AIDAV3GNMXTZEO7SHLC2X' || facts.plan?.planType !== 'FREE' || facts.plan.planStatus !== 'ACTIVE' ||
    facts.connectPermission?.decision !== 'allowed' || facts.connectPermission.missingContext?.length !== 0 ||
    now-Date.parse(facts.observedAt)<0 || now-Date.parse(facts.observedAt)>30000) fail('EXPRESS_C3F_REVIEW_REJECTED');
  const body = { schema:'techlong/express-same-database-restore-review/c3f',preparedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+6*3600000).toISOString(),facts,expectedBinding:originalD.expectedBinding,
    continuationInput:originalD.continuationInput,continuationProgramSha256:originalD.continuationProgramSha256,
    rolePolicySha256:originalD.rolePolicySha256,sqlProgram,sqlProgramSha256:SQL_PROGRAM_SHA,
    codeBindingSha256,historySha256,diagnosticManifestSha256:DIAGNOSTIC_SHA,expectedEmptyCatalogSha256:EMPTY_CATALOG_SHA,
    expectedManagementDatabaseOid:'5',expectedManagementRoleOid:'16410',expectedTenantDatabaseOid:'16459',expectedTenantRoleOid:'16456',
    attemptSlot:RUN_SLOT,independentInspectSlot:INSPECT_SLOT,
    limits:{maximumRunSqlConnections:2,maximumIndependentInspectSqlConnections:2,sqlQueriesPerModeMaximum:40,
      directMetadataCallsPerModeMaximum:9,connectTimeoutMs:30000,transportGroupDeadlineMs:120000,
      temporaryCredentialsMinimumRemainingMs:300000,restoreAndMigrateTransactions:1,tables:73,migrationSeedRows:9,
      maximumTenantDatabaseBytes:536870912,newDatabases:0,newRoles:0,newMemberships:0,guardDeletions:0,
      awsResourceWrites:0,iamWrites:0,secretValueReads:0,loginChanges:0,applicationGrants:0,automaticRetries:0},
    capture:{schema:'techlong/express-restore-catalog-report/v1',phases:['empty-before-write','baseline-before-verifier','migrated-before-verifier',
      'independent-final','independent-after-stop'],catalogBytesMaximum:4000000,rawDefinitionsSaved:false,originalVerifierUnchanged:true},
    risks:[
      'Source remains an existing administrator. Fixed query allowlists and this reviewed local root do not create a new service-side least-privilege boundary.',
      'Only exact DB16459/app16456 NOLOGIN/owner16410/guard-absent state is reused. Drift/nonempty state fails closed; there is no database/role recreation or permission repair.',
      'Trusted pinned DDL/functions/triggers and two migrations/nine technical seeds run in one transaction. Failure, COMMIT lost response or postcommit evidence failure can leave uncertain or committed schema.',
      'In-transaction catalog reports are saved before the unchanged verifier, but file/fsync, query, credential or timeout failure can still leave partial evidence. No automatic down/delete/fill/reset/retry.',
      'A cooperative lock, exact empty-catalog check and before/after AWS/OID checks are not cross-service CAS; concurrent privileged administrators can race.',
      'Schema definitions and IAM tokens are processed in memory; JS/driver erasure is best effort. Provider logs may expose connection/SQL metadata; receipts omit raw function bodies/config/credentials.',
      'Connections/restore may resume the retained cluster and incur ACU/storage/I/O costs. 50 USD/month is a target, not a hard cap; resources remain with no automatic cleanup.',
      'A new run slot and independent inspect slot are consumed before connection permanently. Failed inspection cannot be replayed or silently converted to repair.',
      '512 MiB is a tenant gate, not cluster/free-plan capacity proof. PG17 observation does not install a ready structural fingerprint; other database PUBLIC CONNECT remains unchanged.',
      'Success Inspect rereads fixed schema/seeds with the frozen provider; failed Run Inspect reads only exact owner/tenant catalog and context, not business tables or schema repair.',
      'No app LOGIN/rds_iam/grants, Secret, IAM, Neon, merchant account, AWS resource, ECS, runtime or F3c9 activation is authorized.'
    ],runtimeEnabled:false,lifecycleCompatible:false,executionAuthorized:false };
  return Object.freeze({...structuredClone(body),manifestSha256:db.digest(body)});
}
function assertApproval(r,approvedSha,codeSha,historySha,originalD,originalE,now) {
  const {manifestSha256,...body}=r;
  if (!sha(approvedSha) || approvedSha!==manifestSha256 || db.digest(body)!==manifestSha256 || r.codeBindingSha256!==codeSha ||
    r.historySha256!==historySha || !Number.isFinite(now) || !Number.isFinite(Date.parse(r.preparedAt)) ||
    !Number.isFinite(Date.parse(r.expiresAt)) || now<Date.parse(r.preparedAt) || now>=Date.parse(r.expiresAt))
    fail('EXPRESS_C3F_FRESH_APPROVAL_REQUIRED');
  const expected=prepareReview({facts:r.facts,originalD,originalE,sqlProgram:r.sqlProgram,codeBindingSha256:codeSha,historySha256:historySha},Date.parse(r.preparedAt));
  if (db.canonicalJson(expected)!==db.canonicalJson(r)) fail('EXPRESS_C3F_SCOPE_DRIFT');
}
module.exports={RUN_SLOT,INSPECT_SLOT,DIAGNOSTIC_SHA,EMPTY_CATALOG_SHA,SQL_PROGRAM_SHA,prepareReview,assertApproval};
