'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Pure fixed catalog review, no SQL/AWS client. */
const db=require('./aurora-database-contract-v2.cjs');
const SLOT='techlong-d002-express-c4b-isolation-read-v1.permanent-slot.json';
const TARGET=Object.freeze({database:'tenant_a0da1748bc4d5419_db',databaseOid:'16459',role:'tenant_a0da1748bc4d5419_role',roleOid:'16456',
  managementDatabase:'postgres',managementDatabaseOid:'5',managementRoleOid:'16410'});
const BEGIN='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',SEARCH_PATH='SET LOCAL search_path = pg_catalog';
const CONTEXT_SQL=`SELECT current_database() AS database,current_user AS username,session_user AS session_username,
 (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS database_oid,
 (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role_oid,
 current_setting('server_version_num')::integer AS server_version_num,
 current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation,
 (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_tls_active`;
const DATABASES_SQL=`SELECT d.oid::text AS oid,d.datname AS name,d.datdba::text AS owner_oid,
 d.datallowconn AS allow_connections,d.datconnlimit AS connection_limit,d.datistemplate AS is_template,
 has_database_privilege($1::name,d.oid,'CONNECT') AS role_connect,
 has_database_privilege('public'::name,d.oid,'CONNECT') AS public_connect,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee_oid',a.grantee::text,'grantor_oid',a.grantor::text,
 'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.grantor,a.privilege_type)
 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a),'[]'::jsonb) AS acl
 FROM pg_catalog.pg_database d WHERE d.datallowconn OR d.datname=$2 ORDER BY d.oid LIMIT 33`;
const fail=code=>{throw Object.assign(Error(code),{code,retryable:false});};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const same=(a,b)=>db.canonicalJson(a)===db.canonicalJson(b);
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function sqlPlan(roleSql){
  if(typeof roleSql!=='string'||roleSql.split('r.rolconfig AS config').length!==2)fail('C4B_ROLE_SQL_REJECTED');
  const redacted=roleSql.replace('r.rolconfig AS config',"CASE WHEN r.rolconfig IS NULL THEN NULL ELSE ARRAY['REDACTED']::text[] END AS config");
  return freeze([{text:BEGIN},{text:SEARCH_PATH},{text:CONTEXT_SQL},
    {text:redacted,values:[TARGET.role,TARGET.database]},
    {text:DATABASES_SQL,values:[TARGET.role,TARGET.database]},{text:'COMMIT'}]);
}
function prepareReview({facts,metadataSummary,codeBindingSha256,predecessorSha256,plan},now){
  if(!Number.isFinite(now)||![codeBindingSha256,predecessorSha256].every(sha)||
    predecessorSha256!=='6a61880217d944c18c797ae1910e63fd8bbd6acbb6e4af27c915b585fa16486d'||
    facts.source?.Account!=='402010193138'||facts.source.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||
    facts.source.UserId!=='AIDAV3GNMXTZEO7SHLC2X'||facts.binding?.clusterResourceId!=='cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM'||
    facts.binding.engineVersion!=='17.9'||facts.plan?.planType!=='FREE'||facts.plan.planStatus!=='ACTIVE'||
    facts.connectPermission?.decision!=='allowed'||facts.connectPermission.missingContext?.length!==0||
    !Number.isFinite(Date.parse(facts.observedAt))||now-Date.parse(facts.observedAt)<0||now-Date.parse(facts.observedAt)>30000||
    !Array.isArray(plan)||plan.length!==6||plan[0].text!==BEGIN||plan[1].text!==SEARCH_PATH||plan[2].text!==CONTEXT_SQL||
    plan[4].text!==DATABASES_SQL||plan[5].text!=='COMMIT'||metadataSummary?.effectivePermissionsVerified!==false)fail('C4B_REVIEW_REJECTED');
  const body={schema:'techlong/express-activation-isolation-review/c4b',preparedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+6*3600000).toISOString(),facts,metadataSummary,codeBindingSha256,predecessorSha256,
    target:TARGET,sqlPlan:plan,sqlPlanSha256:db.digest(plan),attemptSlot:SLOT,
    limits:{sqlConnections:1,normalSqlQueries:6,maximumSqlQueriesIncludingFailureRollback:7,
      connectTimeoutMs:30000,sessionTimeoutMs:90000,maximumDatabaseRows:32,maximumInventoryBytes:65536,
      minimumCredentialRemainingMs:120000,preflightMetadataCallsMaximum:7,sqlMutations:0,awsWrites:0,secretValueReads:0,automaticRetries:0},
    risks:['A management SQL connection can resume Aurora and incur ACU/I/O cost; 50 USD/month is a target, not a hard cap.',
      'Existing Source is a privileged administrator. Its IAM token remains in memory; driver/JS erasure is best effort and provider logs may expose connection/query metadata.',
      'Only one read-only management transaction reads the exact app role and database CONNECT/ACL metadata. No customer tables, role passwords or raw role configuration values are selected.',
      'AWS facts and the database snapshot are not cross-service CAS; concurrent privileged changes can invalidate conclusions. IAM metadata/simulation is not effective runtime permission or login proof.',
      'The new permanent read slot is consumed before connection; timeout/lost response/local persistence failure do not authorize automatic retry, reset, repair or a second connection.',
      'No LOGIN, GRANT, REVOKE, SET ROLE, authority/Secret/IAM/cloud writes, app login attempt, schema restore, migration or ECS deployment is authorized. Other database access is only reported.'],
    executionScope:'READ_ONLY_CATALOG_ONLY',runtimeEnabled:false,readyVerified:false};
  return freeze({...body,manifestSha256:db.digest(body)});
}
function assertApproval(manifest,approvedSha,codeSha,plan,now){
  const {manifestSha256,...body}=manifest||{};
  if(!sha(approvedSha)||approvedSha!==manifestSha256||db.digest(body)!==manifestSha256||codeSha!==body.codeBindingSha256||
    !same(plan,body.sqlPlan)||now<Date.parse(body.preparedAt)||now>=Date.parse(body.expiresAt)||
    !same(prepareReview({...body,plan:body.sqlPlan},Date.parse(body.preparedAt)),manifest))fail('C4B_FRESH_READ_APPROVAL_REQUIRED');
}
function classifyInventory({contextResult,roleResult,databaseResult,roleClassification}){
  const c=contextResult?.rows?.[0];
  if(contextResult?.rowCount!==1||!c||c.database!==TARGET.managementDatabase||c.database_oid!==TARGET.managementDatabaseOid||
    c.username!=='postgres'||c.session_username!=='postgres'||c.role_oid!==TARGET.managementRoleOid||c.server_version_num!==170009||
    c.read_only!=='on'||c.isolation!=='repeatable read'||c.backend_tls_active!==true||
    roleResult?.rowCount!==1||roleClassification?.roleOid!==TARGET.roleOid||roleClassification.mutationAuthorized!==false||
    !['CLOSED_REQUIRES_ISOLATION_REVIEW','CLOSED_ACCESS_CANDIDATE'].includes(roleClassification.state)||
    databaseResult?.rowCount!==databaseResult?.rows?.length||!Array.isArray(databaseResult?.rows)||databaseResult.rows.length>32||
    Buffer.byteLength(db.canonicalJson(databaseResult.rows))>65536)fail('C4B_INVENTORY_REJECTED');
  const fields=['oid','name','owner_oid','allow_connections','connection_limit','is_template','role_connect','public_connect','acl'].sort();
  const rows=databaseResult.rows;
  for(const r of rows){
    if(!same(Object.keys(r).sort(),fields)||![r.oid,r.owner_oid].every(v=>/^[1-9][0-9]{0,9}$/.test(v))||
      typeof r.name!=='string'||!r.name||Buffer.byteLength(r.name)>63||
      !['allow_connections','is_template','role_connect','public_connect'].every(k=>typeof r[k]==='boolean')||
      !Number.isInteger(r.connection_limit)||r.connection_limit< -2||!Array.isArray(r.acl)||r.acl.length>128||
      r.acl.some(a=>!same(Object.keys(a).sort(),['grantee_oid','grantor_oid','privilege','grantable'].sort())||
        !/^[0-9]{1,10}$/.test(a.grantee_oid)||!/^[1-9][0-9]{0,9}$/.test(a.grantor_oid)||
        !['CREATE','CONNECT','TEMPORARY'].includes(a.privilege)||typeof a.grantable!=='boolean'))fail('C4B_DATABASE_METADATA_REJECTED');
  }
  if(new Set(rows.map(r=>r.oid)).size!==rows.length||new Set(rows.map(r=>r.name)).size!==rows.length)fail('C4B_DATABASE_METADATA_REJECTED');
  const targets=rows.filter(r=>r.name===TARGET.database),t=targets[0];
  if(targets.length!==1||t.oid!==TARGET.databaseOid||t.owner_oid!==TARGET.managementRoleOid||!t.allow_connections||t.is_template)fail('C4B_TARGET_DATABASE_CHANGED');
  const gaps=rows.filter(r=>r.name!==TARGET.database&&r.allow_connections&&r.role_connect);
  if(gaps.length!==roleResult.rows[0].other_connectable_databases||gaps.length!==roleClassification.otherConnectableDatabases)fail('C4B_ISOLATION_COUNT_MISMATCH');
  return freeze({schema:'techlong/express-activation-isolation-observation/c4b',
    state:gaps.length?'ISOLATION_ACTION_REQUIRES_REVIEW':'ISOLATION_OBSERVED_NOT_ACTIVATED',
    role:roleClassification,databases:structuredClone(rows),otherConnectableDatabases:gaps.length,
    publicConnectGapDatabases:gaps.filter(r=>r.public_connect).map(r=>({oid:r.oid,name:r.name})),
    catalogDigest:db.digest({role:roleResult.rows[0],databases:rows}),
    clientTlsVerified:true,backendTlsActive:c.backend_tls_active,sqlMutationPerformed:false,
    schemaReverified:false,databaseLoginVerified:false,runtimeEnabled:false,readyVerified:false});
}
async function inspectCatalog(client,{plan,signal,classifyRole,approval}){
  if(!same(plan,sqlPlan(plan?.[3]?.text?.replace("CASE WHEN r.rolconfig IS NULL THEN NULL ELSE ARRAY['REDACTED']::text[] END AS config",'r.rolconfig AS config'))))fail('C4B_SQL_PLAN_REJECTED');
  let begun=false,results=[];
  try{
    for(const q of plan){approval();signal.throwIfAborted();const r=await client.query(q.values?q:q.text);results.push(r);if(q.text===BEGIN)begun=true;
      if(q.text===DATABASES_SQL)classifyInventory({contextResult:results[2],roleResult:results[3],databaseResult:r,roleClassification:classifyRole(results[3],'closed')});}
    return classifyInventory({contextResult:results[2],roleResult:results[3],databaseResult:results[4],roleClassification:classifyRole(results[3],'closed')});
  }catch(e){if(begun)try{await client.query('ROLLBACK');}catch{/* no reconnect */}throw e;}
}
module.exports={TARGET,SLOT,BEGIN,SEARCH_PATH,CONTEXT_SQL,DATABASES_SQL,sqlPlan,prepareReview,assertApproval,classifyInventory,inspectCatalog};
