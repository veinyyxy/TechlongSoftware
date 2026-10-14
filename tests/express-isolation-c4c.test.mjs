import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import c4 from '../lib/deployments/execution/express-isolation-c4c.cjs';
import inv from '../lib/deployments/execution/express-activation-inventory-c4b.cjs';
const req=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const {ROLE_DIRECTORY_SQL}=req('./services/saas/aurora_role_directory_v2');
const {classifyApplicationRoleV6}=req('./services/saas/aurora-express-application-v6.cjs');
const plan=inv.sqlPlan(ROLE_DIRECTORY_SQL);
const acl=(grantee,privileges,grantor='16410')=>privileges.map(privilege=>({grantable:false,privilege,grantee_oid:grantee,grantor_oid:grantor}));
function fixture(){
  const make=(oid,name,owner,publicConnect,publicTemp,isTemplate=false)=>({oid,name,owner_oid:owner,allow_connections:true,connection_limit:-1,
    is_template:isTemplate,role_connect:publicConnect,public_connect:publicConnect,
    acl:[...acl('0',publicConnect?['CONNECT',...(publicTemp?['TEMPORARY']:[])]:[],owner),...acl(owner,['CONNECT','CREATE','TEMPORARY'],owner)]});
  return {schema:'techlong/express-activation-isolation-observation/c4b',state:'ISOLATION_ACTION_REQUIRES_REVIEW',
    role:{roleOid:'16456',state:'CLOSED_REQUIRES_ISOLATION_REVIEW'},otherConnectableDatabases:2,clientTlsVerified:true,backendTlsActive:true,
    sqlMutationPerformed:false,catalogDigest:'2959d744c2c4fa8e21dfb2b26f0152978ed55f784d76c39757309a955b7000cc',databases:[
      make('1','template1','16410',true,false,true),make('5','postgres','16410',true,true),make('16384','rdsadmin','10',false,false),
      make('16459',inv.TARGET.database,'16410',false,false)]};
}
function role(count){return {rowCount:1,rows:[{oid:'16456',name:inv.TARGET.role,login:false,inherit:false,superuser:false,create_db:false,
  create_role:false,replication:false,bypass_rls:false,connection_limit:-1,valid_until:null,config:null,settings:false,owns_objects:false,
  iam_role_oid:'19000',parents:[],members:[],other_connectable_databases:count}]};}
function context(readOnly){return {rowCount:1,rows:[{database:'postgres',database_oid:'5',role_oid:'16410',username:'postgres',
  session_username:'postgres',server_version_num:170009,read_only:readOnly?'on':'off',isolation:'repeatable read',backend_tls_active:true}]};}
function fake(p,inspectOnly=false,initial='open',failAt=null){
  const calls=[],journal=[];let state=initial;
  const client={async query(q){const s=typeof q==='string'?q:q.text;calls.push(s);if(s===failAt)throw Error('SYNTHETIC_FAILURE');
    if(s===c4.STATEMENTS[1])state='closed';
    if(s===inv.CONTEXT_SQL)return context(inspectOnly);if(s===plan[3].text)return role(state==='open'?2:0);
    if(s===inv.DATABASES_SQL)return {rowCount:4,rows:structuredClone(p[state])};return {rowCount:null,rows:[]};}};
  return {calls,journal,run:()=>c4.execute({client,program:p,readonlyPlan:plan,inspectOnly,signal:new AbortController().signal,
    approval:()=>{},classifyRole:classifyApplicationRoleV6,journal:async v=>journal.push(v)})};
}
test('C4c changes only two exact PUBLIC CONNECT ACL entries and preserves owner/all other privileges; JSON has no brand',()=>{
  const o=fixture(),before=structuredClone(o),p=c4.compile(o);assert.deepEqual(o,before);
  assert.deepEqual(p.statements,c4.STATEMENTS);assert.equal(p.closed[1].acl.some(a=>a.grantee_oid==='0'&&a.privilege==='TEMPORARY'),true);
  assert.deepEqual(p.closed.slice(2),p.open.slice(2));assert.equal(p.loginChange,false);assert.equal(p.applicationGrantChange,false);
  assert.throws(()=>c4.assertProgram(structuredClone(p)));
  o.databases[0].acl.push(...acl('16456',['CONNECT']));assert.throws(()=>c4.compile(o));
});
test('C4c fresh approval binds exact before/after program, SQL, code and six-hour risk scope',()=>{
  const p=c4.compile(fixture()),now=Date.parse('2026-10-14T22:00:00Z');
  const m=c4.prepareReview({program:p,readonlyPlan:plan,runtimeCandidate:{executionAuthorized:false},codeBindingSha256:'a'.repeat(64),
    facts:{observedAt:new Date(now).toISOString(),source:{Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
      binding:{clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',engineVersion:'17.9'},plan:{planType:'FREE',planStatus:'ACTIVE'},connectPermission:{decision:'allowed',missingContext:[]}}},now);
  c4.assertApproval(m,m.manifestSha256,'a'.repeat(64),p,plan,now+1);
  assert.throws(()=>c4.assertApproval(m,'b'.repeat(64),'a'.repeat(64),p,plan,now));
  assert.throws(()=>c4.assertApproval(m,m.manifestSha256,'a'.repeat(64),p,plan,now+21600000));
  assert.equal(m.limits.sqlPermissionWrites,2);assert.equal(m.limits.loginChanges,0);assert.equal(m.limits.awsWrites,0);
});
test('C4c dispatches exactly ten queries with two fixed writes, verifies closed state and commits without LOGIN/grants',async()=>{
  const p=c4.compile(fixture()),f=fake(p),r=await f.run();
  assert.equal(f.calls.length,10);assert.equal(r.permissionWriteCalls,2);assert.equal(r.commitAcknowledged,true);assert.equal(r.role.otherConnectableDatabases,0);
  assert.deepEqual(f.calls.slice(5,7),c4.STATEMENTS);assert.equal(f.calls.at(-1),'COMMIT');
  assert.equal(f.calls.some(s=>/\b(?:GRANT|ALTER ROLE|CREATE|DROP)\b/.test(s)),false);
});
test('C4c independent read accepts exact closed or unchanged-open state; never writes; pre-commit failure rolls back once',async()=>{
  const p=c4.compile(fixture());for(const state of ['open','closed']){const f=fake(p,true,state),r=await f.run();assert.equal(r.state,state);assert.equal(f.calls.length,6);assert.equal(r.permissionWriteCalls,0);}
  const f=fake(p,false,'open',c4.STATEMENTS[1]);await assert.rejects(f.run());assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.calls.filter(s=>s==='ROLLBACK').length,1);
});
test('C4c lost COMMIT response never triggers rollback/regrant/retry; foreign ACL, writable Inspect and changed role fail',async()=>{
  const p=c4.compile(fixture()),f=fake(p,false,'open','COMMIT');await assert.rejects(f.run());assert.equal(f.calls.length,10);assert.equal(f.calls.includes('ROLLBACK'),false);
  assert.equal(f.journal.at(-1).commitSubmitted,true);assert.equal(f.journal.at(-1).commitAcknowledged,false);
  const d={rowCount:4,rows:structuredClone(p.closed)};d.rows[0].owner_oid='16411';
  assert.throws(()=>c4.checkSnapshot({context:context(true),role:role(0),databases:d},p,'closed',true,classifyApplicationRoleV6));
  assert.throws(()=>c4.checkSnapshot({context:context(false),role:role(0),databases:{rowCount:4,rows:p.closed}},p,'closed',true,classifyApplicationRoleV6));
});
