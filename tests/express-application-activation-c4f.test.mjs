import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import real from '../lib/deployments/execution/express-application-activation-c4f.cjs';
import db from '../lib/deployments/execution/aurora-database-contract-v2.cjs';
import inv from '../lib/deployments/execution/express-activation-inventory-c4b.cjs';
const req=createRequire('E:/NodejsProject/SpeedFeast_Backend_main/package.json');
const {ROLE_DIRECTORY_SQL}=req('./services/saas/aurora_role_directory_v2');
const {classifyApplicationRoleV6}=req('./services/saas/aurora-express-application-v6.cjs');
// Isolated orchestration fixture, not a production compiler or executable
// authority: only this VM substitutes two predecessor digests. Real compilation
// and original private archive brand are exercised by the local Review CLI.
function harness(){
 const candidate={syntheticCandidate:true,target:{database:inv.TARGET.database,role:inv.TARGET.role},
  tables:Array.from({length:73},(_,n)=>'synthetic_table_'+n),sequences:Array.from({length:7},(_,n)=>'synthetic_sequence_'+n),
  statements:Array.from({length:8},(_,n)=>'GRANT synthetic_'+n)};
 const acl=(oid,name)=>({oid,name,owner_oid:'16410',role_connect:false,public_connect:false,acl:[]});
 const closed=[acl('1','template1'),acl('5','postgres'),acl('16384','rdsadmin'),acl('16459',inv.TARGET.database)];
 const vmModule={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../lib/deployments/execution/express-application-activation-c4f.cjs',import.meta.url),'utf8'),
  {module:vmModule,Buffer,structuredClone,require:name=>name.includes('inventory')?inv:{...db,digest:v=>v===candidate?real.CANDIDATE_SHA:v===closed?real.CLOSED_DATABASES_SHA:db.digest(v)}});
 const api=vmModule.exports,p=api.compile({candidate,closedDatabases:closed,roleSql:ROLE_DIRECTORY_SQL,catalogSql:'SELECT synthetic_catalog',rowCountSql:'SELECT synthetic_counts'});
 const now=Date.parse('2026-10-14T23:40:00Z'),facts={observedAt:new Date(now).toISOString(),source:{Account:'402010193138',Arn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',UserId:'AIDAV3GNMXTZEO7SHLC2X'},
  binding:{clusterResourceId:'cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM',engineVersion:'17.9'},plan:{planType:'FREE',planStatus:'ACTIVE'},
  connectPermission:{decision:'allowed',missingContext:[]},applicationConnectPermission:{decision:'allowed',missingContext:[]}};
 const manifest=api.prepare({facts,program:p,codeBindingSha256:'a'.repeat(64),iamInventorySha256:'b'.repeat(64),now});
 const checks={assertCandidate:v=>assert.equal(v,candidate),classifyRole:classifyApplicationRoleV6,
  verifyCatalog:(_r,_c,state)=>({state,nonApplicationCatalogSha256:'synthetic'}),verifyRows:r=>assert.equal(r.rows[0]?.countsVerified,true)};
 const context=(app=false,ro=false)=>({rowCount:1,rows:[{database:inv.TARGET.database,database_oid:'16459',role_oid:app?'16456':'16410',username:app?inv.TARGET.role:'postgres',session_username:app?inv.TARGET.role:'postgres',server_version_num:170009,read_only:ro?'on':'off',isolation:'repeatable read',backend_tls_active:true}]});
 const role=state=>({rowCount:1,rows:[{oid:'16456',name:inv.TARGET.role,login:state==='active',inherit:false,superuser:false,create_db:false,create_role:false,replication:false,bypass_rls:false,settings:false,owns_objects:false,connection_limit:-1,valid_until:null,config:null,parents:state==='active'?[{name:'rds_iam',oid:'19000',grantor:'postgres',admin:false,inherit:false,set:false}]:[],members:[],iam_role_oid:'19000',other_connectable_databases:0}]});
 const privileges={database_connect:true,database_create:false,database_temp:false,schema_usage:true,schema_create:false,iam_member:true,iam_inherit:false,iam_set:false,tables:73,table_dml:true,table_extra:false,sequences:7,sequence_usage:true,sequence_extra:false};
 function fake({inspect=false,state='closed',failAt=null,app=false,changePrivileges=null}={}){const calls=[],journal=[];
  const client={query:async q=>{const text=typeof q==='string'?q:q.text;calls.push(text);if(text===failAt)throw Error('SYNTHETIC_FAILURE');
   if(text===p.statements.at(-1))state='active';if(text===inv.CONTEXT_SQL)return context(app,inspect||app);
   if(text===p.snapshotPlan[1].text)return role(state);if(text===inv.DATABASES_SQL)return {rowCount:4,rows:structuredClone(state==='active'?p.activeDatabases:p.closedDatabases)};
   if(text===p.snapshotPlan[4].text)return {rowCount:1,rows:[{countsVerified:true}]};
   if(text===api.PRIVILEGES_SQL)return {rowCount:1,rows:[{...privileges,...changePrivileges}]};return {rowCount:1,rows:[]};}};
  const options={client,program:p,candidate,checks,inspectOnly:inspect,approval:()=>api.approval(manifest,manifest.manifestSha256,'a'.repeat(64),p,now+1),signal:new AbortController().signal,journal:async j=>journal.push(j)};
  return {calls,journal,execute:()=>api.execute(options),login:()=>api.login(options)};}
 return {api,p,candidate,manifest,now,checks,context,fake};
}
test('production compiler rejects serialized synthetic/unpinned predecessors; no native client is exported',()=>{
 assert.throws(()=>real.compile({candidate:{},closedDatabases:[],roleSql:ROLE_DIRECTORY_SQL,catalogSql:'SELECT 1',rowCountSql:'SELECT 1'}));
 assert.equal(real.createClient,undefined);assert.equal(real.activate,undefined);
});
test('fresh approval binds code/SQL/risk/window and cannot revive JSON program authority',()=>{
 const h=harness();h.api.approval(h.manifest,h.manifest.manifestSha256,'a'.repeat(64),h.p,h.now+1);
 for(const [sha,code,now] of [['c'.repeat(64),'a'.repeat(64),h.now], [h.manifest.manifestSha256,'c'.repeat(64),h.now], [h.manifest.manifestSha256,'a'.repeat(64),h.now+21600000]])
  assert.throws(()=>h.api.approval(h.manifest,sha,code,h.p,now));
 assert.throws(()=>h.api.assertProgram(structuredClone(h.p)));
 assert.equal(h.manifest.currentSqlStateReverifiedAtReview,false);assert.equal(h.manifest.limits.permissionSqlStatements,8);
});
test('one transaction checks closed then exact active state, submits eight writes and commits once',async()=>{
 const h=harness(),f=h.fake(),r=await f.execute();assert.equal(r.permissionWrites,8);assert.equal(r.commitAcknowledged,true);
 assert.equal(f.calls.length,21);assert.equal(f.calls.filter(q=>q==='COMMIT').length,1);assert.equal(f.calls.includes('ROLLBACK'),false);
 assert.equal(r.readyVerified,false);assert.equal(f.journal.at(-1).kind,'COMMIT_OBSERVED');
});
test('failure before COMMIT aborts transaction, never retries a permission statement',async()=>{
 const h=harness(),f=h.fake({failAt:h.p.statements[3]});await assert.rejects(f.execute(),e=>e.c4fTransactionState.rollbackAcknowledged===true&&e.c4fTransactionState.commitSubmitted===false);
 assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.calls.includes('COMMIT'),false);assert.equal(f.calls.filter(q=>q===h.p.statements[3]).length,1);
});
test('unknown COMMIT response never emits a compensating rollback or reconnect',async()=>{
 const h=harness(),f=h.fake({failAt:'COMMIT'});await assert.rejects(f.execute(),e=>e.c4fTransactionState.commitSubmitted===true&&e.c4fTransactionState.commitAcknowledged===false&&e.c4fTransactionState.rollbackAttempted===false);assert.equal(f.calls.at(-1),'COMMIT');assert.equal(f.calls.includes('ROLLBACK'),false);
});
test('independent readback recognizes exact active/original closed state without any permission replay',async()=>{
 for(const state of ['closed','active']){const h=harness(),f=h.fake({inspect:true,state}),r=await f.execute();
  assert.equal(r.state,state);assert.equal(r.permissionWrites,0);assert.equal(f.calls.length,8);assert.equal(f.calls.some(q=>q.startsWith('GRANT')),false);}
});
test('real app-context/login path verifies read-only TLS context and all exact privilege booleans',async()=>{
 const h=harness(),f=h.fake({app:true}),r=await f.login();assert.equal(f.calls.length,6);assert.equal(r.ecsTaskRoleVerified,false);assert.equal(r.readyVerified,false);
 for(const changePrivileges of [{iam_set:true},{iam_inherit:true},{table_extra:true},{sequence_extra:true},{database_temp:true},{table_dml:false}]){
  const bad=h.fake({app:true,changePrivileges});await assert.rejects(bad.login());assert.equal(bad.calls.at(-1),'ROLLBACK');}
 const ctx=h.context(true,true);ctx.rows[0].session_username='postgres';assert.throws(()=>h.api.context(ctx,true,true));
});
