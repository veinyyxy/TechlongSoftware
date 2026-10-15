import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import api from '../lib/deployments/execution/express-application-activation-c4h.cjs';
import core from '../lib/deployments/execution/express-application-activation-c4f.cjs';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import inv from '../lib/deployments/execution/express-activation-inventory-c4b.cjs';
const req=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const {ROLE_DIRECTORY_SQL}=req('./services/saas/aurora_role_directory_v2');
const {classifyApplicationRoleV6:classify}=req('./services/saas/aurora-express-application-v6.cjs');
const role={oid:'16456',name:inv.TARGET.role,login:true,inherit:false,superuser:false,create_db:false,create_role:false,
 replication:false,bypass_rls:false,connection_limit:-1,valid_until:null,config:null,settings:false,owns_objects:false,
 iam_role_oid:'16389',parents:[{name:'rds_iam',oid:'16389',grantor:'rdsadmin',admin:false,inherit:false,set:false}],members:[],other_connectable_databases:0};
const result=r=>({rowCount:1,rows:[r]});
// Synthetic orchestration only: substitute two hashes inside an isolated VM.
// Production archive/private-brand and every historical pin are checked by Review.
function fixture(targetChange={}){
 const candidate={tables:Array.from({length:73},(_,n)=>'synthetic_table_'+n),sequences:Array.from({length:7},(_,n)=>'synthetic_seq_'+n),
  statements:Array.from({length:8},(_,n)=>'GRANT synthetic_'+n),target:{database:api.POLICY.database,databaseOid:'16459',role:api.POLICY.role,roleOid:'16456',owner:'postgres',
   managementTarget:{clusterResourceId:api.POLICY.clusterResourceId,observedEngineVersion:'17.9'},...targetChange}};
 const closed=['1','5','16384','16459'].map((oid,n)=>({oid,name:['template1','postgres','rdsadmin',inv.TARGET.database][n],role_connect:false,acl:[]}));
 const vmCore={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../lib/deployments/execution/express-application-activation-c4f.cjs',import.meta.url),'utf8'),
  {module:vmCore,Buffer,structuredClone,require:name=>name.includes('inventory')?inv:{...db,digest:v=>v===candidate?core.CANDIDATE_SHA:v===closed?core.CLOSED_DATABASES_SHA:db.digest(v)}});
 const p=vmCore.exports.compile({candidate,closedDatabases:closed,roleSql:ROLE_DIRECTORY_SQL,catalogSql:'SELECT synthetic_catalog',rowCountSql:'SELECT synthetic_counts'});
 const vmG={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../lib/deployments/execution/express-application-activation-c4g.cjs',import.meta.url),'utf8'),
  {module:vmG,Buffer,require:name=>name.includes('activation-c4f')?vmCore.exports:db});
 const vmH={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../lib/deployments/execution/express-application-activation-c4h.cjs',import.meta.url),'utf8'),
  {module:vmH,structuredClone,require:name=>name.includes('activation-c4g')?vmG.exports:db});
 const a=vmH.exports,now=Date.parse('2026-10-15T00:30:00Z'),facts={observedAt:new Date(now).toISOString(),
  source:{Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
  binding:{clusterResourceId:api.POLICY.clusterResourceId,engineVersion:'17.9'},plan:{planType:'FREE',planStatus:'ACTIVE'},
  connectPermission:{decision:'allowed',missingContext:[]},applicationConnectPermission:{decision:'allowed',missingContext:[]}};
 const options={facts,program:p,codeBindingSha256:'a'.repeat(64),iamInventorySha256:'b'.repeat(64),now};
 const m=a.prepare(options);
 function run(failure=null){let state='closed';const calls=[],journal=[];
  const client={query:async q=>{const text=typeof q==='string'?q:q.text;calls.push(text);if(text==='COMMIT'&&failure==='COMMIT')throw Error('PRIVATE_PROVIDER_MESSAGE');
   if(text===p.statements.at(-1))state='active';
   if(text===inv.CONTEXT_SQL)return result({database:inv.TARGET.database,database_oid:'16459',role_oid:'16410',username:'postgres',session_username:'postgres',server_version_num:170009,read_only:'off',isolation:'repeatable read',backend_tls_active:true});
   if(text===p.snapshotPlan[1].text)return result({...role,login:state==='active',parents:state==='active'?role.parents:[]});
   if(text===inv.DATABASES_SQL)return {rowCount:4,rows:state==='active'?p.activeDatabases:p.closedDatabases};
   if(text===p.snapshotPlan[3].text)return result({identity:{schemas:[],relations:[],functions:[]}});
   if(text===p.snapshotPlan[4].text)return {rowCount:73,rows:p.tables.map(name=>({name,rows:'0'}))};return {rowCount:0,rows:[]};}};
  const checks={assertCandidate:v=>assert.equal(v,candidate),classifyRole:classify,
   verifyCatalog:(_r,_c,s)=>{if(failure==='CATALOG'&&s==='active')throw Object.assign(Error('AURORA_APP_V6_CANDIDATE_REJECTED'),{code:'AURORA_APP_V6_CANDIDATE_REJECTED'});return {state:s};},
   verifyRows:()=>{if(failure==='COUNTS'&&state==='active')throw Object.assign(Error('AURORA_V3_ROW_COUNTS_CHANGED'),{code:'AURORA_V3_ROW_COUNTS_CHANGED'});}};
  return {calls,journal,invoke:()=>a.execute({client,program:p,candidate,checks,inspectOnly:false,approval:()=>a.approval(m,m.manifestSha256,'a'.repeat(64),p,now+1),signal:new AbortController().signal,journal:async f=>journal.push(f)})};
 }
 return {a,p,m,now,options,run};
}
test('exact rdsadmin calibration works with native pg parser functions, never changes actual evidence or input',()=>{
 const r=result(structuredClone(role));r._parsers=[()=>{}];const before=db.digest(r.rows[0]);assert.throws(()=>classify(r,'active'));
 const observed=api.classifyRole(r,'active',classify);assert.equal(observed.actualRoleSnapshotSha256,before);assert.equal(db.digest(r.rows[0]),before);
 assert.equal(observed.observedMembershipGrantor,'rdsadmin');assert.equal(observed.roleGrantorPolicySha256,db.digest(api.POLICY));
 assert.equal(observed.readyVerified,false);assert.equal(observed.loginVerified,false);assert.equal(observed.mutationAuthorized,false);
});
test('grantor allowlist is exactly rdsadmin, no postgres fallback; IAM OID/options/duplicate membership remain pinned',()=>{
 for(const change of [{grantor:'postgres'},{grantor:'rds_superuser'},{grantor:'foreign'},{oid:'19000'},{admin:true},{inherit:true},{set:true}])
  assert.throws(()=>api.classifyRole(result({...role,parents:[{...role.parents[0],...change}]}),'active',classify));
 assert.throws(()=>api.classifyRole(result({...role,parents:[...role.parents,...role.parents]}),'active',classify));
 assert.throws(()=>api.classifyRole(result({...role,iam_role_oid:'19000'}),'active',classify));
});
test('all frozen role identity/elevation/config/ownership/member/isolation predicates still reject',()=>{
 for(const change of [{oid:'999'},{name:'foreign'},{login:false},{inherit:true},{superuser:true},{create_db:true},{create_role:true},{replication:true},
  {bypass_rls:true},{connection_limit:2},{valid_until:'2099'},{config:['PRIVATE_CONFIG']},{settings:true},{owns_objects:true},{members:[role.parents[0]]},
  {other_connectable_databases:1},{unreviewed:true}])assert.throws(()=>api.classifyRole(result({...role,...change}),'active',classify));
});
test('closed state remains NOLOGIN/empty parents and observed IAM OID, never active compatibility proof',()=>{
 const closed={...role,login:false,parents:[]},o=api.classifyRole(result(closed),'closed',classify);
 assert.equal(o.observedMembershipGrantor,null);assert.equal(o.state,'CLOSED_ACCESS_CANDIDATE');assert.equal(o.loginVerified,false);
 for(const change of [{login:true},{parents:role.parents},{iam_role_oid:null}])assert.throws(()=>api.classifyRole(result({...closed,...change}),'closed',classify));
});
test('new SHA binds policy/new slots/eight unchanged statements; old SHA, altered policy, JSON brand and expired window reject',()=>{
 const h=fixture();h.a.approval(h.m,h.m.manifestSha256,'a'.repeat(64),h.p,h.now+1);
 assert.equal(h.m.program.statements,h.p.statements);assert.equal(h.m.program.statements.length,8);assert.equal(h.m.roleGrantorCalibrationPolicySha256,api.POLICY_SHA);
 assert.notEqual(h.m.slots.run,core.RUN_SLOT);assert.equal(h.m.sqlAndAllOtherRoleCatalogAclCountPredicatesUnchanged,true);
 for(const sha of [api.PREDECESSOR_SHA,'0c32f6f0885938065735b1945586e082eff3e2272e50f02c321d93b7feb943cc'])assert.throws(()=>h.a.approval(h.m,sha,'a'.repeat(64),h.p,h.now));
 assert.throws(()=>h.a.approval(h.m,h.m.manifestSha256,'a'.repeat(64),structuredClone(h.p),h.now));
 assert.throws(()=>h.a.approval(h.m,h.m.manifestSha256,'a'.repeat(64),h.p,h.now+21600000));
 const altered={...h.m,roleGrantorCalibrationPolicy:{...h.m.roleGrantorCalibrationPolicy,grantor:'postgres'}};delete altered.manifestSha256;
 altered.manifestSha256=db.digest(altered);assert.throws(()=>h.a.approval(altered,altered.manifestSha256,'a'.repeat(64),h.p,h.now));
});
test('even branded program for another target/engine cannot use this calibration',()=>{
 for(const change of [{databaseOid:'999'},{owner:'rdsadmin'},{managementTarget:{clusterResourceId:api.POLICY.clusterResourceId,observedEngineVersion:'18.0'}},
  {managementTarget:{clusterResourceId:'cluster-other',observedEngineVersion:'17.9'}}])assert.throws(()=>fixture(change));
});
test('same 21-query/eight-write transaction reaches unchanged post validators, evidence keeps actual rdsadmin',async()=>{
 const h=fixture(),f=h.run(),r=await f.invoke();assert.equal(r.permissionWrites,8);assert.equal(f.calls.length,21);assert.equal(r.commitAcknowledged,true);
 const frames=f.journal.filter(j=>j.kind==='BOUNDED_SNAPSHOT_RESPONSE');assert.equal(frames.length,10);
 assert.equal(frames.filter(j=>j.snapshotIndex===1).at(-1)?.observation?.parents?.[0]?.grantor??frames.find(j=>j.observation?.parents?.[0])?.observation.parents[0].grantor,'rdsadmin');
 assert.equal(r.observation.role.observedMembershipGrantor,'rdsadmin');assert.equal(f.calls.includes('ROLLBACK'),false);
});
test('full catalog or count rejection still rolls back once before COMMIT; COMMIT uncertainty never compensates',async()=>{
 for(const [failure,stage]of [['CATALOG','CATALOG_PROJECT_AND_PIN'],['COUNTS','SEED_AND_BUSINESS_COUNTS']]){
  const h=fixture(),f=h.run(failure);await assert.rejects(f.invoke(),e=>h.a.errorDetails(e).validationStage===stage&&e.c4fTransactionState.rollbackAcknowledged);
  assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.calls.includes('COMMIT'),false);assert.equal(f.calls.length,21);
 }
 const h=fixture(),f=h.run('COMMIT');await assert.rejects(f.invoke(),e=>e.c4fTransactionState.commitSubmitted&&!e.c4fTransactionState.rollbackAttempted);
 assert.equal(f.calls.at(-1),'COMMIT');assert.equal(f.calls.includes('ROLLBACK'),false);
 assert.equal(api.errorDetails(Error('PRIVATE_PROVIDER_MESSAGE')).validationCode,null);
});
