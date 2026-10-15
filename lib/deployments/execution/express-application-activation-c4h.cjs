'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Exact observed grantor calibration; no native SQL/AWS client. */
const previous=require('./express-application-activation-c4g.cjs');
const db=require('./aurora-database-contract-v2.cjs');
const RUN_SLOT='techlong-d002-express-c4h-application-install-v1.permanent-slot.json';
const INSPECT_SLOT='techlong-d002-express-c4h-application-inspect-v1.permanent-slot.json';
const PREDECESSOR_SHA='9a72074b2dd90358bdd9a05a9abdb52609636027e38f68c04fe8d2cbd1eb6270';
const POLICY=Object.freeze({schema:'techlong/express-application-role-grantor-policy/c4h',
 clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',engineVersion:'17.9',database:'tenant_a0da1748bc4d5419_db',databaseOid:'16459',
 role:'tenant_a0da1748bc4d5419_role',roleOid:'16456',iamRole:'rds_iam',iamRoleOid:'16389',grantor:'rdsadmin',
 admin:false,inherit:false,set:false,legacyActiveGrantor:'postgres',otherPredicates:'frozen-v6-unchanged',
 observedEvidenceManifestSha256:PREDECESSOR_SHA});
const POLICY_SHA=db.digest(POLICY),same=(a,b)=>db.canonicalJson(a)===db.canonicalJson(b);
const fail=()=>{throw Object.assign(Error('C4H_EXACT_ROLE_GRANTOR_POLICY_REJECTED'),{code:'C4H_EXACT_ROLE_GRANTOR_POLICY_REJECTED',retryable:false});};
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function assertTarget(p){previous.assertProgram(p);const t=p.target,m=t?.managementTarget;
 if(t?.database!==POLICY.database||t.databaseOid!==POLICY.databaseOid||t.role!==POLICY.role||t.roleOid!==POLICY.roleOid||t.owner!=='postgres'||
 m?.clusterResourceId!==POLICY.clusterResourceId||m.observedEngineVersion!==POLICY.engineVersion)fail();return p;}
function classifyRole(result,state,classifyFrozenV6){const r=result?.rows?.[0];
 if(result?.rowCount!==1||r?.oid!==POLICY.roleOid||r.name!==POLICY.role||r.iam_role_oid!==POLICY.iamRoleOid||
 !['closed','active'].includes(state)||typeof classifyFrozenV6!=='function')fail();
 const parent={name:POLICY.iamRole,oid:POLICY.iamRoleOid,grantor:POLICY.grantor,admin:false,inherit:false,set:false};
 if(!same(r.parents,state==='active'?[parent]:[]))fail();
 // Private one-field proof that every old predicate still holds. Never sent
 // to SQL/journal or used as the actual metadata hash or returned observation.
 const projected={...result,rows:[structuredClone(r)]};if(state==='active')projected.rows[0].parents[0].grantor=POLICY.legacyActiveGrantor;
 const old=classifyFrozenV6(projected,state);
 return freeze({...old,roleGrantorPolicySha256:POLICY_SHA,actualRoleSnapshotSha256:db.digest(r),
  observedMembershipGrantor:state==='active'?POLICY.grantor:null,iamRoleOid:POLICY.iamRoleOid,
  observationUsesActualMetadata:true,loginVerified:false,mutationAuthorized:false,readyVerified:false});
}
function prepare(options){assertTarget(options.program);const old=previous.prepare(options),{manifestSha256:ignored,...body}=old;void ignored;
 const next={...body,schema:'techlong/express-application-review/c4h',slots:{run:RUN_SLOT,inspect:INSPECT_SLOT},
  predecessorConsumedManifestSha256:PREDECESSOR_SHA,roleGrantorCalibrationPolicy:POLICY,roleGrantorCalibrationPolicySha256:POLICY_SHA,
  roleGrantorPredicateChangedOnlyForExactObservedTarget:true,iamRoleOidPinnedToObserved16389:true,
  sqlAndAllOtherRoleCatalogAclCountPredicatesUnchanged:true,
  risks:[...body.risks.filter(r=>!r.startsWith('PostgreSQL can select a grantor')&&!r.startsWith('This is one new independent permanent'))
   .map(r=>r.startsWith('Bounded local evidence')?r.replace('before the unchanged validators','before the exact calibrated role validator and all unchanged other validators'):r),
   'This exact target now requires the observed rds_iam grantor rdsadmin and IAM SQL role OID16389, never arbitrary grantors or legacy postgres fallback. A private one-field projection proves frozen V6 predicates; saved/returned metadata hashes remain actual. No new membership/ADMIN/INHERIT/SET or DML capabilities are added.',
   'C4g directly captured this grantor mismatch and rolled back. This new independent slot pair is not a C4g/C4f reset or retry authorization. Full post-catalog projection/ACL/count validation still must run; prior vector checks do not prove the full post-catalog pin or IAM login/ready. Changed engine role metadata requires a new review, not automatic adaptation.']};
 return freeze({...next,manifestSha256:db.digest(next)});
}
function approval(m,sha,code,p,now){const {manifestSha256,...body}=m||{};assertTarget(p);
 if(sha!==manifestSha256||db.digest(body)!==manifestSha256||m.codeBindingSha256!==code||!same(m.program,p)||
 now<Date.parse(m.preparedAt)||now>=Date.parse(m.expiresAt)||!same(prepare({...body,program:p,now:Date.parse(m.preparedAt)}),m))
 throw Object.assign(Error('C4H_FRESH_APPROVAL_REQUIRED'),{code:'C4H_FRESH_APPROVAL_REQUIRED',retryable:false});}
async function execute(options){assertTarget(options.program);const frozen=options.checks.classifyRole;
 return previous.execute({...options,checks:{...options.checks,classifyRole:(result,state)=>classifyRole(result,state,frozen)}});}
function errorDetails(e){const old=previous.errorDetails(e),allowed=new Set(['C4H_EXACT_ROLE_GRANTOR_POLICY_REJECTED','C4H_FRESH_APPROVAL_REQUIRED']);
 const code=[e?.code,e?.message].find(v=>allowed.has(v));return {...old,validationCode:code||old.validationCode};}
module.exports={...previous,RUN_SLOT,INSPECT_SLOT,PREDECESSOR_SHA,POLICY,POLICY_SHA,assertTarget,classifyRole,prepare,approval,execute,errorDetails};
