import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import api from '../lib/deployments/execution/express-application-activation-c4g.cjs';
import core from '../lib/deployments/execution/express-application-activation-c4f.cjs';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import inv from '../lib/deployments/execution/express-activation-inventory-c4b.cjs';
const req=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const {ROLE_DIRECTORY_SQL}=req('./services/saas/aurora_role_directory_v2');
const role={oid:'16456',name:inv.TARGET.role,login:true,inherit:false,superuser:false,create_db:false,create_role:false,
 replication:false,bypass_rls:false,connection_limit:-1,valid_until:null,config:null,settings:false,owns_objects:false,
 iam_role_oid:'16389',parents:[{name:'rds_iam',oid:'16389',grantor:'postgres',admin:false,inherit:false,set:false}],members:[],other_connectable_databases:0};
function fixture(){
 const candidate={tables:Array.from({length:73},(_,n)=>'synthetic_table_'+n),sequences:Array.from({length:7},(_,n)=>'synthetic_seq_'+n),
  statements:Array.from({length:8},(_,n)=>'GRANT synthetic_'+n),target:{role:inv.TARGET.role,database:inv.TARGET.database}};
 const closed=['1','5','16384','16459'].map((oid,n)=>({oid,name:['template1','postgres','rdsadmin',inv.TARGET.database][n],role_connect:false,acl:[]}));
 const vmCore={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../lib/deployments/execution/express-application-activation-c4f.cjs',import.meta.url),'utf8'),
  {module:vmCore,Buffer,structuredClone,require:name=>name.includes('inventory')?inv:{...db,digest:v=>v===candidate?core.CANDIDATE_SHA:v===closed?core.CLOSED_DATABASES_SHA:db.digest(v)}});
 const p=vmCore.exports.compile({candidate,closedDatabases:closed,roleSql:ROLE_DIRECTORY_SQL,catalogSql:'SELECT synthetic_catalog',rowCountSql:'SELECT synthetic_counts'}),vmApi={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../lib/deployments/execution/express-application-activation-c4g.cjs',import.meta.url),'utf8'),
  {module:vmApi,Buffer,require:name=>name.includes('activation-c4f')?vmCore.exports:name.includes('inventory')?inv:db});
 const a=vmApi.exports,now=Date.parse('2026-10-15T00:00:00Z'),facts={observedAt:new Date(now).toISOString(),source:{Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
  binding:{clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',engineVersion:'17.9'},plan:{planType:'FREE',planStatus:'ACTIVE'},
  connectPermission:{decision:'allowed',missingContext:[]},applicationConnectPermission:{decision:'allowed',missingContext:[]}};
 const m=a.prepare({facts,program:p,codeBindingSha256:'a'.repeat(64),iamInventorySha256:'b'.repeat(64),now});
 function run(failure=null){let state='closed';const calls=[],journal=[];
  const client={query:async q=>{const text=typeof q==='string'?q:q.text;calls.push(text);if(text==='COMMIT'&&failure==='COMMIT')throw Error('UNSAFE_PROVIDER_MESSAGE');
   if(text===p.statements.at(-1))state='active';
   if(text===inv.CONTEXT_SQL)return {rowCount:1,rows:[{database:inv.TARGET.database,database_oid:'16459',role_oid:'16410',username:'postgres',session_username:'postgres',server_version_num:170009,read_only:'off',isolation:'repeatable read',backend_tls_active:true}]};
   if(text===p.snapshotPlan[1].text)return {rowCount:1,rows:[{...role,login:state==='active',parents:state==='active'?role.parents:[]}]};
   if(text===inv.DATABASES_SQL)return {rowCount:4,rows:state==='active'?p.activeDatabases:p.closedDatabases};
   if(text===p.snapshotPlan[3].text)return {rowCount:1,rows:[{identity:{schemas:[],relations:[],functions:[]}}]};
   if(text===p.snapshotPlan[4].text)return {rowCount:73,rows:p.tables.map(name=>({name,rows:'0'}))};return {rowCount:0,rows:[]};}};
  const checks={assertCandidate:v=>assert.equal(v,candidate),classifyRole:r=>{if(failure==='ROLE'&&r.rows[0].login)throw Object.assign(Error('AURORA_APP_V6_CANDIDATE_REJECTED'),{code:'AURORA_APP_V6_CANDIDATE_REJECTED'});return {otherConnectableDatabases:0};},
   verifyCatalog:(_r,_c,s)=>{if(failure==='CATALOG'&&s==='active')throw Object.assign(Error('AURORA_APP_V6_CANDIDATE_REJECTED'),{code:'AURORA_APP_V6_CANDIDATE_REJECTED'});return {state:s};},
   verifyRows:()=>{if(failure==='COUNTS'&&state==='active')throw Object.assign(Error('AURORA_V3_ROW_COUNTS_CHANGED'),{code:'AURORA_V3_ROW_COUNTS_CHANGED'});}};
  return {calls,journal,invoke:()=>a.execute({client,program:p,candidate,checks,inspectOnly:false,approval:()=>a.approval(m,m.manifestSha256,'a'.repeat(64),p,now+1),signal:new AbortController().signal,journal:async f=>journal.push(f)})};
 }
 return {a,p,m,now,run};
}
test('new SHA binds independent slots, preserved eight statements, evidence limits; old SHA/JSON program/expired window fail',()=>{
 const h=fixture();assert.notEqual(h.m.slots.run,core.RUN_SLOT);assert.equal(h.m.program.statements.length,8);assert.equal(h.m.frozenC4fSqlAndMinimumPolicyUnchanged,true);
 assert.throws(()=>h.a.approval(h.m,api.PREDECESSOR_SHA,'a'.repeat(64),h.p,h.now));assert.throws(()=>h.a.approval(h.m,h.m.manifestSha256,'a'.repeat(64),structuredClone(h.p),h.now));
 assert.throws(()=>h.a.approval(h.m,h.m.manifestSha256,'a'.repeat(64),h.p,h.now+21600000));
});
test('evidence preserves exact app membership/options but excludes role password/config and every raw provider message',()=>{
 const r={rowCount:1,rows:[{...role,config:['PRIVATE_CONFIG'],password:'PRIVATE_PASSWORD'}]},p={target:{role:role.name},tables:[],sequences:[]};
 const e=api.snapshotEvidence(1,r,p),text=JSON.stringify(e);assert.equal(e.observation.parents[0].grantor,'postgres');assert.equal(e.observation.config_is_null,false);
 assert.equal(text.includes('PRIVATE_'),false);assert.deepEqual(api.errorDetails(Error('PRIVATE_PROVIDER_MESSAGE')),{validationCode:null,validationStage:null});
 assert.equal(api.errorDetails(Error('C4F_PRIVATE_PROVIDER_VALUE')).validationCode,null);
});
test('catalog evidence includes ACL vectors/digest, never function or DDL values; foreign names are hashed, not published',()=>{
 const p={target:{role:role.name},tables:['approved'],sequences:[]},entry={grantee:role.name,grantor:'rds_superuser',privilege:'SELECT',grantable:false};
 const r={rowCount:1,rows:[{identity:{schemas:[{name:'public',acl:[]}],relations:[{name:'approved',kind:'r',acl:[entry],definition:'PRIVATE_DDL'},{name:'PRIVATE_FOREIGN',kind:'r',acl:[entry]}],functions:[{definition:'PRIVATE_FUNCTION'}]}}]};
 const e=api.snapshotEvidence(3,r,p);assert.equal(e.observation.approvedObjects[0].appAcl[0].grantor,'rds_superuser');assert.equal(JSON.stringify(e).includes('PRIVATE_'),false);assert.throws(()=>api.snapshotEvidence(9,r,p));
});
test('frozen role classifier still rejects alternate grantor or inherited/SET/admin access; evidence is not an allow path',()=>{
 const classify=req('./services/saas/aurora-express-application-v6.cjs').classifyApplicationRoleV6;
 for(const change of [{grantor:'rds_superuser'},{admin:true},{inherit:true},{set:true}])assert.throws(()=>classify({rowCount:1,rows:[{...role,parents:[{...role.parents[0],...change}]}]},'active'));
 assert.equal(classify({rowCount:1,rows:[role]},'active').loginVerified,false);
});
test('same 21-query transaction journals ten responses before validators, never adds diagnostic SQL',async()=>{
 const h=fixture(),f=h.run(),r=await f.invoke();assert.equal(r.permissionWrites,8);assert.equal(f.calls.length,21);assert.equal(f.journal.filter(j=>j.kind==='BOUNDED_SNAPSHOT_RESPONSE').length,10);assert.equal(f.calls.includes('ROLLBACK'),false);
});
test('each post-write validator failure is independently labeled, captured before abort; no COMMIT or permission retry',async()=>{
 for(const [failure,stage]of [['ROLE','ROLE_CLASSIFIER'],['CATALOG','CATALOG_PROJECT_AND_PIN'],['COUNTS','SEED_AND_BUSINESS_COUNTS']]){
  const h=fixture(),f=h.run(failure);await assert.rejects(f.invoke(),e=>{assert.equal(h.a.errorDetails(e).validationStage,stage);assert.equal(e.c4fTransactionState.rollbackAcknowledged,true);return true;});
  assert.equal(f.calls.length,21);assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.calls.includes('COMMIT'),false);assert.equal(f.journal.filter(j=>j.kind==='BOUNDED_SNAPSHOT_RESPONSE').length,10);
 }
});
test('lost COMMIT response remains unknown; evidence logging never invokes compensating rollback',async()=>{
 const h=fixture(),f=h.run('COMMIT');await assert.rejects(f.invoke(),e=>e.c4fTransactionState.commitSubmitted&&!e.c4fTransactionState.rollbackAttempted);assert.equal(f.calls.at(-1),'COMMIT');assert.equal(f.calls.includes('ROLLBACK'),false);
});
