import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import review from '../lib/deployments/execution/express-activation-inventory-c4b.cjs';
const requireBackend=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const {ROLE_DIRECTORY_SQL}=requireBackend('./services/saas/aurora_role_directory_v2');
const {classifyApplicationRoleV6}=requireBackend('./services/saas/aurora-express-application-v6.cjs');
const plan=review.sqlPlan(ROLE_DIRECTORY_SQL),now=Date.parse('2026-10-14T21:00:00Z');
const input=()=>({facts:{observedAt:new Date(now).toISOString(),source:{Account:'402010193138',
  Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
  binding:{clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',engineVersion:'17.9'},
  plan:{planType:'FREE',planStatus:'ACTIVE'},connectPermission:{decision:'allowed',missingContext:[]}},
  metadataSummary:{effectivePermissionsVerified:false},codeBindingSha256:'a'.repeat(64),
  predecessorSha256:'6a61880217d944c18c797ae1910e63fd8bbd6acbb6e4af27c915b585fa16486d',plan});
const fixture=()=>{
  const r={oid:'16456',name:review.TARGET.role,login:false,inherit:false,superuser:false,create_db:false,create_role:false,
    replication:false,bypass_rls:false,connection_limit:-1,valid_until:null,config:null,settings:false,owns_objects:false,
    iam_role_oid:'19000',parents:[],members:[],other_connectable_databases:1};
  return {contextResult:{rowCount:1,rows:[{database:'postgres',database_oid:'5',username:'postgres',session_username:'postgres',
    role_oid:'16410',server_version_num:170009,read_only:'on',isolation:'repeatable read',backend_tls_active:true}]},
    roleResult:{rowCount:1,rows:[r]},databaseResult:{rowCount:2,rows:[
      {oid:'5',name:'postgres',owner_oid:'16410',allow_connections:true,connection_limit:-1,is_template:false,role_connect:true,public_connect:true,
        acl:[{grantee_oid:'0',grantor_oid:'16410',privilege:'CONNECT',grantable:false}]},
      {oid:'16459',name:review.TARGET.database,owner_oid:'16410',allow_connections:true,connection_limit:-1,is_template:false,
        role_connect:false,public_connect:false,acl:[]}]}};
};
const classify=f=>review.classifyInventory({...f,roleClassification:classifyApplicationRoleV6(f.roleResult,'closed')});
test('C4b has six fixed read-only statements, exact parameters and redacted role config; no tenant/business SQL',()=>{
  assert.equal(plan.length,6);assert.equal(plan[0].text,review.BEGIN);assert.equal(plan[5].text,'COMMIT');
  assert.match(plan[3].text,/ARRAY\['REDACTED'\]/);assert.doesNotMatch(plan[3].text,/r\.rolconfig AS config/);
  assert.deepEqual(plan[4].values,[review.TARGET.role,review.TARGET.database]);
  for(const q of plan)assert.doesNotMatch(q.text,/\b(?:GRANT|REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|public\.)\b/i);
  assert.throws(()=>review.sqlPlan('SELECT 1'));
});
test('C4b approvals bind exact SHA, code, SQL, scope and six-hour window without write/ready authority',()=>{
  const r=review.prepareReview(input(),now);review.assertApproval(r,r.manifestSha256,'a'.repeat(64),plan,now+1);
  for(const [sha,code,p,t]of [['b'.repeat(64),'a'.repeat(64),plan,now],
    [r.manifestSha256,'b'.repeat(64),plan,now],[r.manifestSha256,'a'.repeat(64),plan,now+21600000],
    [r.manifestSha256,'a'.repeat(64),[...plan,{text:'SELECT 1'}],now]])assert.throws(()=>review.assertApproval(r,sha,code,p,t));
  assert.equal(r.limits.sqlMutations,0);assert.equal(r.limits.secretValueReads,0);assert.equal(r.runtimeEnabled,false);
});
test('C4b observes exact PUBLIC CONNECT gaps only; does not authorize their repair or app login',()=>{
  const f=fixture(),before=structuredClone(f),r=classify(f);
  assert.equal(r.state,'ISOLATION_ACTION_REQUIRES_REVIEW');assert.deepEqual(r.publicConnectGapDatabases,[{oid:'5',name:'postgres'}]);
  assert.equal(r.databaseLoginVerified,false);assert.equal(r.schemaReverified,false);assert.equal(r.sqlMutationPerformed,false);assert.deepEqual(f,before);
  f.roleResult.rows[0].other_connectable_databases=0;f.databaseResult.rows[0].role_connect=false;
  assert.equal(classify(f).state,'ISOLATION_OBSERVED_NOT_ACTIVATED');
});
test('C4b foreign OIDs/owners, elevated role, inconsistent counts, excess rows and weak TLS fail closed',()=>{
  for(const mutate of [f=>f.databaseResult.rows[1].oid='16460',f=>f.databaseResult.rows[1].owner_oid='16411',
    f=>f.roleResult.rows[0].login=true,f=>f.roleResult.rows[0].members=[{}],f=>f.roleResult.rows[0].other_connectable_databases=2,
    f=>f.contextResult.rows[0].backend_tls_active=false,f=>f.contextResult.rows[0].read_only='off',
    f=>{f.databaseResult.rows=Array(33).fill(f.databaseResult.rows[0]);f.databaseResult.rowCount=33;},
    f=>f.databaseResult.rows[1].acl=[{grantee_oid:'0',grantor_oid:'1',privilege:'UNKNOWN',grantable:false}]]){
    const f=fixture();mutate(f);assert.throws(()=>classify(f));
  }
});
test('C4b fixed executor dispatches once, commits read-only inventory, and never reconnects after failure',async()=>{
  const f=fixture(),calls=[],client={async query(q){const s=typeof q==='string'?q:q.text;calls.push(s);
    return s===review.CONTEXT_SQL?f.contextResult:s===plan[3].text?f.roleResult:s===review.DATABASES_SQL?f.databaseResult:{rows:[],rowCount:null};}};
  const result=await review.inspectCatalog(client,{plan,signal:new AbortController().signal,classifyRole:classifyApplicationRoleV6,approval:()=>{}});
  assert.equal(result.otherConnectableDatabases,1);assert.deepEqual(calls,plan.map(q=>q.text));
  const failed=[];await assert.rejects(review.inspectCatalog({async query(q){const s=typeof q==='string'?q:q.text;failed.push(s);
    if(s===review.CONTEXT_SQL)throw Error('SYNTHETIC');return {rows:[],rowCount:null};}},
    {plan,signal:new AbortController().signal,classifyRole:classifyApplicationRoleV6,approval:()=>{}}));
  assert.deepEqual(failed,[review.BEGIN,review.SEARCH_PATH,review.CONTEXT_SQL,'ROLLBACK']);
});
