'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Fixed SQL review/execution port; no native client or credentials. */
const db=require('./aurora-database-contract-v2.cjs');
const inv=require('./express-activation-inventory-c4b.cjs');
const RUN_SLOT='techlong-d002-express-c4f-application-install-v1.permanent-slot.json';
const INSPECT_SLOT='techlong-d002-express-c4f-application-inspect-v1.permanent-slot.json';
const CANDIDATE_SHA='bcd5e8ca2baf28063027a982a83c3385ab07b6533a5a70d0a630f4f7c3b878e2';
const CLOSED_DATABASES_SHA='0251a30e18af71c2bd73a3880eadda1d00845fcbaf619c599cac88b5b2323d87';
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ';
const BEGIN_READ=BEGIN+' READ ONLY';
const PRIVILEGES_SQL=`SELECT
 has_database_privilege(current_user,current_database(),'CONNECT') AS database_connect,
 has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
 has_database_privilege(current_user,current_database(),'TEMPORARY') AS database_temp,
 has_schema_privilege(current_user,'public','USAGE') AS schema_usage,
 has_schema_privilege(current_user,'public','CREATE') AS schema_create,
 pg_has_role(current_user,'rds_iam','MEMBER') AS iam_member,
 pg_has_role(current_user,'rds_iam','USAGE') AS iam_inherit,
 pg_has_role(current_user,'rds_iam','SET') AS iam_set,
 (SELECT count(*)::integer FROM unnest($1::text[]) AS n(name)) AS tables,
 (SELECT bool_and(has_table_privilege(current_user,format('public.%I',n.name),p.privilege))
 FROM unnest($1::text[]) AS n(name) CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(privilege)) AS table_dml,
 (SELECT bool_or(has_table_privilege(current_user,format('public.%I',n.name),p.privilege))
 FROM unnest($1::text[]) AS n(name) CROSS JOIN unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN',
 'SELECT WITH GRANT OPTION','INSERT WITH GRANT OPTION','UPDATE WITH GRANT OPTION','DELETE WITH GRANT OPTION']) AS p(privilege)) AS table_extra,
 (SELECT count(*)::integer FROM unnest($2::text[]) AS n(name)) AS sequences,
 (SELECT bool_and(has_sequence_privilege(current_user,format('public.%I',n.name),'USAGE')) FROM unnest($2::text[]) AS n(name)) AS sequence_usage,
 (SELECT bool_or(has_sequence_privilege(current_user,format('public.%I',n.name),p.privilege))
 FROM unnest($2::text[]) AS n(name) CROSS JOIN unnest(ARRAY['SELECT','UPDATE','USAGE WITH GRANT OPTION']) AS p(privilege)) AS sequence_extra`;
const programs=new WeakSet(),same=(a,b)=>db.canonicalJson(a)===db.canonicalJson(b);
const fail=code=>{throw Object.assign(Error(code),{code,retryable:false});};
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function compile({candidate,closedDatabases,roleSql,catalogSql,rowCountSql}){
  if(db.digest(candidate)!==CANDIDATE_SHA||candidate.statements?.length!==8||candidate.tables?.length!==73||candidate.sequences?.length!==7||
    db.digest(closedDatabases)!==CLOSED_DATABASES_SHA||typeof catalogSql!=='string'||typeof rowCountSql!=='string')fail('C4F_COMPILED_PREDECESSOR_REQUIRED');
  const role=inv.sqlPlan(roleSql)[3],database={text:inv.DATABASES_SQL,values:[inv.TARGET.role,inv.TARGET.database]};
  const active=structuredClone(closedDatabases),t=active.find(d=>d.oid===inv.TARGET.databaseOid);
  t.role_connect=true;t.acl.push({grantee_oid:inv.TARGET.roleOid,grantor_oid:inv.TARGET.managementRoleOid,privilege:'CONNECT',grantable:false});
  t.acl.sort((a,b)=>Number(a.grantee_oid)-Number(b.grantee_oid)||Number(a.grantor_oid)-Number(b.grantor_oid)||a.privilege.localeCompare(b.privilege));
  const p=freeze({schema:'techlong/express-application-program/c4f',candidateSha256:CANDIDATE_SHA,target:candidate.target,
    statements:candidate.statements,tables:candidate.tables,sequences:candidate.sequences,closedDatabases,activeDatabases:active,
    snapshotPlan:[{text:inv.CONTEXT_SQL},role,database,{text:catalogSql},{text:rowCountSql}],
    loginPlan:[{text:BEGIN_READ},{text:inv.SEARCH_PATH},{text:inv.CONTEXT_SQL},
      {text:PRIVILEGES_SQL,values:[candidate.tables,candidate.sequences]},{text:rowCountSql},{text:'COMMIT'}],
    executionAuthorized:false,readyVerified:false,runtimeEnabled:false});programs.add(p);return p;
}
function assertProgram(p){if(!programs.has(p))fail('C4F_PRIVATE_PROGRAM_REQUIRED');return p;}
function prepare({facts,codeBindingSha256,program,iamInventorySha256,now}){
  assertProgram(program);
  if(!/^[a-f0-9]{64}$/.test(codeBindingSha256)||!/^[a-f0-9]{64}$/.test(iamInventorySha256)||
    facts.source?.Account!=='402010193138'||facts.source.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||
    facts.source.UserId!=='AIDAV3GNMXTZEO7SHLC2X'||facts.binding?.clusterResourceId!=='cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM'||
    facts.binding.engineVersion!=='17.9'||facts.plan?.planType!=='FREE'||facts.plan.planStatus!=='ACTIVE'||
    facts.connectPermission?.decision!=='allowed'||facts.connectPermission.missingContext?.length||facts.applicationConnectPermission?.decision!=='allowed'||
    facts.applicationConnectPermission.missingContext?.length||!Number.isFinite(Date.parse(facts.observedAt))||
    now<Date.parse(facts.observedAt)||now-Date.parse(facts.observedAt)>30000)fail('C4F_REVIEW_REJECTED');
  const body={schema:'techlong/express-application-review/c4f',preparedAt:new Date(now).toISOString(),expiresAt:new Date(now+6*3600000).toISOString(),
    facts,codeBindingSha256,iamInventorySha256,program,programSha256:db.digest(program),slots:{run:RUN_SLOT,inspect:INSPECT_SLOT},
    limits:{permissionSqlStatements:8,runConnections:1,runNormalQueries:21,runMaximumQueriesWithRollback:22,
      inspectManagementConnections:1,inspectManagementNormalQueries:8,inspectManagementMaximumQueriesWithRollback:9,
      inspectApplicationConnectionsMaximum:1,applicationNormalQueries:6,applicationMaximumQueriesWithRollback:7,
      metadataCallsPerModeMaximum:32,awsWrites:0,secretValueReads:0,privateMaterialReads:0,businessWrites:0,retries:0,
      connectionTimeoutMs:30000,sessionTimeoutMs:90000,minimumInitialCredentialRemainingMs:300000},
    risks:['Eight persistent SQL permission/LOGIN changes run in one transaction. Once committed, existing/future eligible principals can use DML on all 73 exact tables, including tenant technical/authorization tables; this is not row filtering or a read-only application.',
      'No DDL/default privileges/new function grants/sequence UPDATE or other-database access is granted. Existing PUBLIC function privileges remain; minimum grants do not prove absence of all dangerous application behavior.',
      'Three rds_iam options remain ADMIN/INHERIT/SET false. AWS documents role membership, but exact restricted membership compatibility is unproved until the approved real IAM login; never silently broaden membership or use password fallback.',
      'Fresh full closed/active role, four-database ACL, projected exact migrated catalog and nine-seed/zero-business row counts are checked before and after. Repeatable-read and AWS facts are not CAS or protection against concurrent privileged writers.',
      'Run COMMIT and independent Inspect are not atomic. Lost COMMIT response/local persistence failure or post-commit login failure can leave persistent LOGIN/DML enabled; no automatic revoke, down, rollback after submission, completion or retry.',
      'Inspect first reads exact active/original state using a separate management connection, and only on exact active state attempts one app-user TLS IAM login with Source-signed token and read-only context/privilege/count checks. Source is a privileged administrator, not the ECS task role: this is not production task/session/SCP/KMS or complete ready proof.',
      'Source credentials/IAM tokens remain only in memory; erasure is best effort and provider logs may retain connection/query metadata. Authentication can fail without an MFA prompt; no token/password/private values are emitted.',
      'Each install/inspect slot is permanently consumed before connecting. Up to three total SQL connections may resume Aurora and incur ACU/I/O cost; 50 USD/month is a target, not a cap. Failed slots are never reset or retried.',
      'No IAM/Secret/Neon/authority/business/cloud writes, app initialization, ECR/ECS/Cell deployment, AssumeRole or GetSecretValue is authorized. SQL read counts inspect counts only, not customer row values. Old Full and historical slots remain unchanged.'],
    currentSqlStateReverifiedAtReview:false,sourceLoginIsNotEcsRoleProof:true,readyVerified:false,runtimeEnabled:false,executionAuthorized:false};
  return freeze({...body,manifestSha256:db.digest(body)});
}
function approval(m,sha,code,p,now){const {manifestSha256,...body}=m||{};
  if(sha!==manifestSha256||db.digest(body)!==manifestSha256||m.codeBindingSha256!==code||!same(m.program,assertProgram(p))||
    now<Date.parse(m.preparedAt)||now>=Date.parse(m.expiresAt)||!same(prepare({...body,program:p,now:Date.parse(m.preparedAt)}),m))fail('C4F_FRESH_APPROVAL_REQUIRED');}
function context(result,application,readOnly){const c=result?.rows?.[0];
  if(result?.rowCount!==1||c?.database!==inv.TARGET.database||c.database_oid!==inv.TARGET.databaseOid||
    c.username!==(application?inv.TARGET.role:'postgres')||c.session_username!==c.username||c.role_oid!==(application?inv.TARGET.roleOid:inv.TARGET.managementRoleOid)||
    c.server_version_num!==170009||c.read_only!==(readOnly?'on':'off')||c.isolation!=='repeatable read'||c.backend_tls_active!==true)fail('C4F_EXACT_TLS_CONTEXT_REQUIRED');return c;}
function verifySnapshot(results,p,state,readOnly,checks,candidate){
  context(results[0],false,readOnly);const role=checks.classifyRole(results[1],state);
  if(role.otherConnectableDatabases!==0||results[2]?.rowCount!==4||!same(results[2].rows,state==='active'?p.activeDatabases:p.closedDatabases))fail('C4F_EXACT_ISOLATED_ACL_REQUIRED');
  const catalog=checks.verifyCatalog(results[3],candidate,state);checks.verifyRows(results[4],p.tables,true);
  return freeze({state,role,catalog,databaseAclSha256:db.digest(results[2].rows),iamRoleOid:results[1].rows[0].iam_role_oid,
    migrationSeedRows:9,baselineBusinessRows:0,clientTlsVerified:true,backendTlsActive:true,loginVerified:false,readyVerified:false});
}
async function execute({client,program,candidate,checks,inspectOnly,approval,signal,journal}){
  assertProgram(program);checks.assertCandidate(candidate);let begun=false,commitSubmitted=false,commitAcknowledged=false,writes=0;
  const q=async v=>{approval();signal.throwIfAborted();const r=await client.query(v.values?v:v.text);signal.throwIfAborted();return r;};
  const snapshot=async()=>{const results=[];for(const v of program.snapshotPlan)results.push(await q(v));return results;};
  try{
    await q({text:inspectOnly?BEGIN_READ:BEGIN});begun=true;await q({text:inv.SEARCH_PATH});
    const first=await snapshot(),state=inspectOnly?(same(first[2]?.rows,program.activeDatabases)?'active':same(first[2]?.rows,program.closedDatabases)?'closed':fail('C4F_INSPECT_STATE_DIVERGED')):'closed';
    const before=verifySnapshot(first,program,state,inspectOnly,checks,candidate);
    let after=before;
    if(!inspectOnly){await journal({kind:'SQL_PERMISSION_TRANSACTION_INTENT',statements:8,before});
      for(const text of program.statements){await q({text});writes++;}
      after=verifySnapshot(await snapshot(),program,'active',false,checks,candidate);
      if(before.iamRoleOid!==after.iamRoleOid)fail('C4F_IAM_SQL_ROLE_CHANGED');
      await journal({kind:'SQL_PERMISSION_POSTCHECK_OBSERVED',writes,after});}
    await journal({kind:'COMMIT_INTENT',writes});commitSubmitted=true;await q({text:'COMMIT'});commitAcknowledged=true;
    await journal({kind:'COMMIT_OBSERVED',writes});
    return freeze({state:after.state,observation:after,commitSubmitted,commitAcknowledged,permissionWrites:writes,
      outcome:inspectOnly?(state==='active'?'APPLICATION_PERMISSIONS_INDEPENDENTLY_OBSERVED':'ORIGINAL_CLOSED_STATE_OBSERVED_INSTALL_NOT_PROVED'):'APPLICATION_PERMISSIONS_COMMITTED_REQUIRES_INSPECT',
      readyVerified:false,runtimeEnabled:false});
  }catch(e){let rollbackAttempted=false,rollbackAcknowledged=false;
    if(begun&&!commitSubmitted){rollbackAttempted=true;try{await client.query('ROLLBACK');rollbackAcknowledged=true;}catch{/* no reconnect/retry */}}
    // Allowlisted transaction facts only; never copy provider message/detail.
    e.c4fTransactionState={commitSubmitted,commitAcknowledged,permissionResponsesObserved:writes,rollbackAttempted,rollbackAcknowledged};throw e;}
}
async function login({client,program,approval,signal,checks}){
  assertProgram(program);let begun=false,submitted=false;const results=[];
  try{for(const v of program.loginPlan){approval();signal.throwIfAborted();if(v.text==='COMMIT')submitted=true;
      const r=await client.query(v.values?v:v.text);signal.throwIfAborted();results.push(r);if(v.text===BEGIN_READ)begun=true;
      if(v.text===inv.CONTEXT_SQL)context(r,true,true);
      if(v.text===PRIVILEGES_SQL&&(r?.rowCount!==1||!same(r.rows,[{database_connect:true,database_create:false,database_temp:false,
        schema_usage:true,schema_create:false,iam_member:true,iam_inherit:false,iam_set:false,tables:73,table_dml:true,table_extra:false,
        sequences:7,sequence_usage:true,sequence_extra:false}])))fail('C4F_APPLICATION_PRIVILEGES_REJECTED');
      if(v.text===program.snapshotPlan[4].text)checks.verifyRows(r,program.tables,true);
    }
    return freeze({outcome:'SOURCE_SIGNED_APPLICATION_TLS_IAM_LOGIN_VERIFIED_NOT_ECS_OR_READY',applicationRoleOid:inv.TARGET.roleOid,
      applicationDatabaseOid:inv.TARGET.databaseOid,clientTlsVerified:true,backendTlsActive:true,restrictedIamMembershipVerified:true,
      exactDmlAndSequencePrivilegeMetadataVerified:true,businessRows:0,mutationPerformed:false,ecsTaskRoleVerified:false,readyVerified:false});
  }catch(e){if(begun&&!submitted)try{await client.query('ROLLBACK');}catch{/* no reconnect */}throw e;}
}
module.exports={RUN_SLOT,INSPECT_SLOT,CANDIDATE_SHA,CLOSED_DATABASES_SHA,BEGIN,BEGIN_READ,PRIVILEGES_SQL,compile,assertProgram,prepare,approval,context,verifySnapshot,execute,login};
