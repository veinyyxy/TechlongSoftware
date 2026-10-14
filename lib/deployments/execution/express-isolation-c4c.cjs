'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Fixed reviewed program; no native SQL/AWS client. */
const db=require('./aurora-database-contract-v2.cjs');
const inventory=require('./express-activation-inventory-c4b.cjs');
const RUN_SLOT='techlong-d002-express-c4c-isolation-write-v1.permanent-slot.json';
const INSPECT_SLOT='techlong-d002-express-c4c-isolation-inspect-v1.permanent-slot.json';
const OBSERVATION_FILE_SHA='f78bd55f3bd94d2765be3226147e5a314d801ef5c4508c79b4f10aad3e57d9cb';
const STATEMENTS=Object.freeze(['REVOKE CONNECT ON DATABASE "template1" FROM PUBLIC RESTRICT','REVOKE CONNECT ON DATABASE "postgres" FROM PUBLIC RESTRICT']);
const ACL_PINS=Object.freeze({1:'f0fa157b13a3e30248e4ed654984156d6456f879f0426ed9a407756d17805a9c',
  5:'b0e6160085e0fce2a1d0664cea41238e381b14bb3cff52ee408b69d42c60d647',
  16384:'4cd79a5ac4f4eecb6dbb5973601c05198fcf897534143081f4fe8137242afc54',
  16459:'abf869dbefaf88054198c51dd7efb3f519d46ec6319ae324f8e09a7d23119788'});
const programs=new WeakSet(),same=(a,b)=>db.canonicalJson(a)===db.canonicalJson(b);
const fail=code=>{throw Object.assign(Error(code),{code,retryable:false});};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function compile(observation){
  if(observation?.schema!=='techlong/express-activation-isolation-observation/c4b'||observation.state!=='ISOLATION_ACTION_REQUIRES_REVIEW'||
    observation.catalogDigest!=='2959d744c2c4fa8e21dfb2b26f0152978ed55f784d76c39757309a955b7000cc'||
    observation.role?.roleOid!=='16456'||observation.role.state!=='CLOSED_REQUIRES_ISOLATION_REVIEW'||observation.otherConnectableDatabases!==2||
    !observation.clientTlsVerified||!observation.backendTlsActive||observation.sqlMutationPerformed!==false||observation.databases?.length!==4)fail('C4C_PREDECESSOR_REJECTED');
  const open=structuredClone(observation.databases);
  for(const r of open)if(!ACL_PINS[r.oid]||db.digest(r.acl)!==ACL_PINS[r.oid])fail('C4C_PREDECESSOR_ACL_REJECTED');
  if(!same(open.map(r=>({oid:r.oid,name:r.name,owner:r.owner_oid,role:r.role_connect,public:r.public_connect})),[
    {oid:'1',name:'template1',owner:'16410',role:true,public:true},{oid:'5',name:'postgres',owner:'16410',role:true,public:true},
    {oid:'16384',name:'rdsadmin',owner:'10',role:false,public:false},{oid:'16459',name:inventory.TARGET.database,owner:'16410',role:false,public:false}]))fail('C4C_PREDECESSOR_DATABASE_REJECTED');
  const closed=structuredClone(open);
  for(const r of closed.filter(r=>['1','5'].includes(r.oid))){
    const publicConnect=r.acl.filter(a=>a.grantee_oid==='0'&&a.privilege==='CONNECT');
    if(publicConnect.length!==1||publicConnect[0].grantor_oid!=='16410'||publicConnect[0].grantable!==false||
      !r.acl.some(a=>a.grantee_oid==='16410'&&a.privilege==='CONNECT'))fail('C4C_OWNER_CONNECT_REQUIRED');
    r.acl=r.acl.filter(a=>!(a.grantee_oid==='0'&&a.privilege==='CONNECT'));r.role_connect=false;r.public_connect=false;
  }
  const p=freeze({schema:'techlong/express-isolation-program/c4c',target:inventory.TARGET,predecessorObservationFileSha256:OBSERVATION_FILE_SHA,
    statements:STATEMENTS,open,closed,loginChange:false,applicationGrantChange:false,otherAclChange:false,
    affectsAllPublicDependentNewConnections:true,executionAuthorized:false,runtimeEnabled:false});programs.add(p);return p;
}
function assertProgram(p){if(!programs.has(p))fail('C4C_PRIVATE_PROGRAM_REQUIRED');return p;}
function prepareReview({facts,codeBindingSha256,program,readonlyPlan,runtimeCandidate},now){
  assertProgram(program);
  if(!sha(codeBindingSha256)||!Number.isFinite(now)||facts.source?.Account!=='402010193138'||facts.source.Arn!=='arn:aws:iam::402010193138:user/techlong-sandbox-dev'||
    facts.source.UserId!=='AIDAV3GNMXTZEO7SHLC2X'||facts.binding?.clusterResourceId!=='cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM'||facts.binding.engineVersion!=='17.9'||
    facts.plan?.planType!=='FREE'||facts.plan.planStatus!=='ACTIVE'||facts.connectPermission?.decision!=='allowed'||facts.connectPermission.missingContext?.length!==0||
    !Number.isFinite(Date.parse(facts.observedAt))||now-Date.parse(facts.observedAt)<0||now-Date.parse(facts.observedAt)>30000||
    !Array.isArray(readonlyPlan)||readonlyPlan.length!==6||readonlyPlan[4].text!==inventory.DATABASES_SQL||runtimeCandidate?.executionAuthorized!==false)fail('C4C_REVIEW_REJECTED');
  const body={schema:'techlong/express-isolation-review/c4c',preparedAt:new Date(now).toISOString(),expiresAt:new Date(now+6*3600000).toISOString(),
    facts,codeBindingSha256,program,programSha256:db.digest(program),readonlyPlan,readonlyPlanSha256:db.digest(readonlyPlan),runtimeCandidate,
    runSlot:RUN_SLOT,inspectSlot:INSPECT_SLOT,
    limits:{runSqlConnections:1,runNormalQueries:10,runMaximumQueriesWithRollback:11,independentInspectConnections:1,independentInspectQueries:6,independentInspectMaximumQueriesWithRollback:7,
      sqlPermissionWrites:2,awsWrites:0,secretValueReads:0,loginChanges:0,applicationGrants:0,automaticRetries:0,preflightMetadataMaximum:7,
      connectTimeoutMs:30000,sessionTimeoutMs:90000,minimumCredentialRemainingMs:120000},
    risks:['PUBLIC CONNECT revocation affects every existing/future SQL user or tool relying on PUBLIC for new connections to these two databases, not just this app. Consumer/service impact is not fully inventoried.',
      'postgres explicit CONNECT/CREATE/TEMPORARY and other ACLs remain; this is not proof all monitoring/migration/managed-service consumers are unaffected. Existing sessions are not terminated.',
      'Two RESTRICT revocations run in one transaction with exact before/after OID/owner/full-ACL checks. Repeatable-read, AWS facts and ACL writes are not cross-service CAS; concurrent privileged changes can race.',
      'Source is an existing privileged administrator. TLS IAM tokens stay in memory; JS/driver erasure is best effort and provider logs can record SQL/connection metadata.',
      'Two connections including independent Inspect can resume Aurora and incur cost. 50 USD/month is a target, not a cap.',
      'Run/Inspect slots are permanent. Failure, lost COMMIT response or local persistence failure can leave unknown committed state; never automatically retry/reset/regrant/down. Independent approved readback is the next action, not a write retry.',
      'No LOGIN/rds_iam/app grants, customer data, Secret/private-material reads, IAM/cloud resource changes, ECR/ECS or runtime activation. Runtime candidate/name correction is data only.'],
    runtimeEnabled:false,readyVerified:false};return freeze({...body,manifestSha256:db.digest(body)});
}
function assertApproval(m,approved,code,p,plan,now){
  const {manifestSha256,...body}=m||{};
  if(!sha(approved)||approved!==manifestSha256||db.digest(body)!==manifestSha256||m.codeBindingSha256!==code||
    !same(m.program,assertProgram(p))||!same(m.readonlyPlan,plan)||now<Date.parse(m.preparedAt)||now>=Date.parse(m.expiresAt)||
    !same(prepareReview({...body,program:p},Date.parse(m.preparedAt)),m))fail('C4C_FRESH_APPROVAL_REQUIRED');
}
function checkSnapshot({context,role,databases},program,state,readOnly,classifyRole){
  const p=assertProgram(program),c=context?.rows?.[0];
  if(context?.rowCount!==1||c?.database!=='postgres'||c.database_oid!=='5'||c.role_oid!=='16410'||c.username!=='postgres'||c.session_username!=='postgres'||
    c.server_version_num!==170009||c.read_only!==(readOnly?'on':'off')||c.isolation!=='repeatable read'||c.backend_tls_active!==true||
    databases?.rowCount!==4||!same(databases.rows,p[state]))fail('C4C_EXACT_SNAPSHOT_REQUIRED');
  const r=classifyRole(role,'closed'),expected=state==='open'?2:0;
  if(r.otherConnectableDatabases!==expected||r.roleOid!=='16456')fail('C4C_CLOSED_ROLE_REQUIRED');
  return freeze({schema:'techlong/express-isolation-observation/c4c',state,role:r,databases:structuredClone(databases.rows),
    databaseAclDigest:db.digest(databases.rows),clientTlsVerified:true,backendTlsActive:true,loginEnabled:false,
    applicationGrantsInstalled:false,sqlMutationPerformed:!readOnly,runtimeEnabled:false,readyVerified:false});
}
async function execute({client,program,readonlyPlan,inspectOnly,signal,approval,classifyRole,journal}){
  assertProgram(program);let transaction=false,commitSubmitted=false,commitAcknowledged=false,writes=0;
  const q=async query=>{approval();signal.throwIfAborted();const r=await client.query(query.values?query:query.text);signal.throwIfAborted();return r;};
  try{
    await q({text:inspectOnly?inventory.BEGIN:'BEGIN ISOLATION LEVEL REPEATABLE READ'});transaction=true;
    await q(readonlyPlan[1]);const context=await q(readonlyPlan[2]),role=await q(readonlyPlan[3]),databases=await q(readonlyPlan[4]);
    const inspectState=inspectOnly?(same(databases.rows,program.closed)?'closed':same(databases.rows,program.open)?'open':fail('C4C_UNREVIEWED_INSPECT_STATE')):'open';
    let observation=checkSnapshot({context,role,databases},program,inspectState,inspectOnly,classifyRole);
    if(!inspectOnly){
      for(const text of program.statements){await journal({kind:'PERMISSION_WRITE_INTENT',statementSha256:db.digest(text)});writes++;await q({text});await journal({kind:'PERMISSION_WRITE_OBSERVED',statementSha256:db.digest(text)});}
      const afterRole=await q(readonlyPlan[3]),afterDatabases=await q(readonlyPlan[4]);
      observation=checkSnapshot({context,role:afterRole,databases:afterDatabases},program,'closed',false,classifyRole);
      const copy=structuredClone(afterRole.rows[0]);copy.other_connectable_databases=role.rows[0].other_connectable_databases;
      if(!same(copy,role.rows[0]))fail('C4C_ROLE_CHANGED_DURING_WRITE');
    }
    await journal({kind:'COMMIT_INTENT',writes});commitSubmitted=true;await q({text:'COMMIT'});commitAcknowledged=true;transaction=false;
    await journal({kind:'COMMIT_OBSERVED',writes});return freeze({...observation,commitSubmitted,commitAcknowledged,permissionWriteCalls:writes});
  }catch(e){if(transaction&&!commitSubmitted)try{await client.query('ROLLBACK');}catch{/* no retry */}
    await journal({kind:'STOPPED',writes,commitSubmitted,commitAcknowledged});throw e;}
}
module.exports={RUN_SLOT,INSPECT_SLOT,OBSERVATION_FILE_SHA,STATEMENTS,compile,assertProgram,prepareReview,assertApproval,checkSnapshot,execute};
