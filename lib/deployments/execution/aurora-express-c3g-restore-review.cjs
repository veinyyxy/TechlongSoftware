'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local reviewed V5 admission, not runtime authority. */
const db=require('./aurora-database-contract-v2.cjs');
const legacy=require('./aurora-express-c3-restore-review.cjs');
const CATALOG_POLICY_SHA='5bc73bb1e9f094a67bd4bf06bb8972d88f6cc84449734e21c99c915c79e148f2';
const PREDECESSOR_SHA='a5c79b93a0afdf19849ba02e76feb310743f76adeeae64b5aae7de2efa55c632';
const RUN_SLOT='techlong-d002-express-c3-restore-only-v5.permanent-slot.json';
const INSPECT_SLOT='techlong-d002-express-c3-restore-only-v5-inspect.permanent-slot.json';
const fail=code=>{throw Error(code);};
function assertSqlProgram(program,originalD) {
  const {catalogPolicySha256,...sql}=program||{};
  if(catalogPolicySha256!==CATALOG_POLICY_SHA||db.digest(sql)!==legacy.SQL_PROGRAM_SHA||
    db.canonicalJson(sql)!==db.canonicalJson(originalD.sqlProgram)) fail('EXPRESS_C3G_SQL_POLICY_CHANGED');
  return db.digest(program);
}
function prepareReview({facts,originalD,originalE,sqlProgram,codeBindingSha256,historySha256},now) {
  const sqlProgramSha256=assertSqlProgram(sqlProgram,originalD);
  const old=legacy.prepareReview({facts,originalD,originalE,sqlProgram:originalD.sqlProgram,codeBindingSha256,historySha256},now);
  const {manifestSha256,...body}=old;void manifestSha256;
  const next={...body,schema:'techlong/express-same-database-restore-review/c3g',
    sqlProgram,sqlProgramSha256,legacySqlProgramSha256:legacy.SQL_PROGRAM_SHA,
    predecessorRestoreManifestSha256:PREDECESSOR_SHA,catalogPolicySha256:CATALOG_POLICY_SHA,
    catalogAdmission:{extension:{name:'uuid-ossp',version:'1.1',schema:'public',owner:'rdsadmin'},
      clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',engineVersion:'17.9',otherPredicates:'frozen-v3-unchanged',actualCatalogDigest:true},
    attemptSlot:RUN_SLOT,independentInspectSlot:INSPECT_SLOT,
    capture:{...body.capture,schema:'techlong/express-restore-catalog-report/v2',originalVerifierUnchanged:true,
      activeVerifier:'v5-exact-rdsadmin-extension-owner',originalAndAdmissionResultsSeparate:true},
    risks:body.risks.map(s=>s.replace('unchanged verifier','active V5 verifier').replace('frozen provider','V5 provider')).concat([
      'V5 admission requires exactly uuid-ossp 1.1/public/rdsadmin on the fixed PG17.9 cluster; postgres or unknown extension owners are rejected. Only a private one-field projection reuses all other frozen predicates; actual catalog digests/results are preserved.',
      'The previous C3f restore was rejected before migrations; its independent current empty catalog and exact reports are bound as history, not a rollback guarantee. New slots are a separately approved attempt, never reset/replay of old slots.'
    ])};
  return Object.freeze({...structuredClone(next),manifestSha256:db.digest(next)});
}
function assertApproval(r,approvedSha,codeSha,historySha,originalD,originalE,now) {
  const {manifestSha256,...body}=r;
  if(typeof approvedSha!=='string'||approvedSha!==manifestSha256||db.digest(body)!==manifestSha256||
    r.codeBindingSha256!==codeSha||r.historySha256!==historySha||!Number.isFinite(now)||
    now<Date.parse(r.preparedAt)||now>=Date.parse(r.expiresAt)) fail('EXPRESS_C3G_FRESH_APPROVAL_REQUIRED');
  const expected=prepareReview({facts:r.facts,originalD,originalE,sqlProgram:r.sqlProgram,codeBindingSha256:codeSha,historySha256:historySha},Date.parse(r.preparedAt));
  if(db.canonicalJson(expected)!==db.canonicalJson(r)) fail('EXPRESS_C3G_SCOPE_DRIFT');
}
module.exports={RUN_SLOT,INSPECT_SLOT,CATALOG_POLICY_SHA,PREDECESSOR_SHA,EMPTY_CATALOG_SHA:legacy.EMPTY_CATALOG_SHA,
  DIAGNOSTIC_SHA:legacy.DIAGNOSTIC_SHA,assertSqlProgram,prepareReview,assertApproval};
