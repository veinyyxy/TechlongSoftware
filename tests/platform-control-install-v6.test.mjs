import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalJson} from '../lib/deployments/execution/hash.ts';
import {I,SOURCE_FILES,hash,sqlContract,assertAbsent,assertInstalled,makeManifest,verifyManifest,installOnce} from '../ops/platform-controller-review-v6/install.mjs';
import {ROLE,TABLE_COLUMNS,readControlCatalog,CATALOG_SQL} from '../ops/platform-controller-review-v6/catalog.mjs';
const sql=(await readFile(new URL('../ops/platform-controller-v6/install.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n'),contract=sqlContract(sql);
const now=Date.parse('2026-10-20T13:00:00Z'),source='a'.repeat(40);
const prestate=()=>({actor:'owner_ci',session_actor:'owner_ci',database:'control_ci',server_version_num:'180006',read_only:'on',
  installer:{oid:'12',name:'owner_ci',super:false,createRole:true},installer_database_create:true,
  role:null,schema:null,tables:[],functions:[],memberships:[],rowCounts:{},public_database_create:false,public_schema_create:false,public_business_grants:[],
  business_tables:['app_instance_deployments','deployment_jobs','users'].map((name,i)=>({name,oid:String(100+i),owner:'12'}))});
function installed(){
  const c=prestate();c.role={oid:'800',name:ROLE,login:false,inherit:false,super:false,createRole:false,createDb:false,replication:false,bypassRls:false};
  c.schema={oid:'801',owner:'12',publicGrants:[],serviceUsage:true,serviceCreate:false};
  c.tables=Object.entries(TABLE_COLUMNS).map(([name,columns],i)=>({name,columns,oid:String(900+i),owner:'12',kind:'r',rls:false,forceRls:false,
    publicGrants:[],serviceTableAccess:false,serviceColumnAccess:false,publicColumnAccess:false,userTriggers:0}));c.rowCounts=Object.fromEntries(Object.keys(TABLE_COLUMNS).map(n=>[n,'0']));
  const bodies=new Map([...sql.matchAll(/CREATE FUNCTION deployment_control_v6\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)].map(m=>[m[1],m[2]]));
  c.functions=contract.functions.map((f,i)=>({...f,oid:String(1000+i),owner:'12',types:f.types.replaceAll(',',', '),definer:true,
    config:['search_path=pg_catalog, pg_temp'],body:bodies.get(f.name),publicExecute:false}));return c;
}
function manifest(){return makeManifest({sourceCommit:source,pins:SOURCE_FILES.map(file=>({file,sha256:'b'.repeat(64)})),contract,prestate:prestate(),
  targetFingerprintSha256:'c'.repeat(64),ci:{runId:'123',sourceCommit:source,status:'completed',conclusion:'success',attempt:1,realInstallerCatalogVerified:true},createdAt:now});}
function fixture(){
  const m=manifest(),events=[];let occupied=false,batch=false,failure,clock=now;
  const io={assertSource:async()=>{events.push('source');if(failure==='source')throw Error('drift');},
    readCatalog:async()=>{events.push(batch?'post-read':'pre-read');if(failure==='read')throw Error('network');return batch?installed():prestate();},
    claim:async()=>{assert.equal(occupied,false);occupied=true;events.push('slot');if(failure==='expire')clock=m.expiresAt;},
    installBatch:async()=>{events.push('install');batch=true;if(failure==='install')throw Error('COMMIT ACK unknown');return {commitAcknowledged:failure!=='ack'};},
    record:async name=>{events.push(name);if(failure===name)throw Error('disk');}};
  return {m,events,io,fail:n=>{failure=n;},at:t=>{clock=t;},run:()=>installOnce({manifest:m,approved:m.manifestSha256,io,now:()=>clock})};
}
test('exact existing SQL contract is nine definers, seven service calls, no password/LOGIN activation',()=>{
  assert.equal(contract.functions.length,9);assert.equal(contract.functions.filter(f=>f.serviceExecute).length,7);assert.equal(SOURCE_FILES.length,14);
  assert.equal(contract.sqlSha256,hash(sql));assert.equal(contract.sqlSha256,I.sqlSha256);assert.match(sql,/CREATE ROLE .* NOLOGIN NOINHERIT/);assert.doesNotMatch(sql,/PASSWORD|ALTER ROLE .* LOGIN/);
  assert.throws(()=>sqlContract(sql.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')));
});
test('install prestate rejects occupied namespace/role, unsafe public grants or wrong installer before effects',()=>{
  assertAbsent(prestate());for(const change of [{role:{}},{schema:{}},{tables:[{}]},{memberships:[{}]},{public_database_create:true},
    {public_schema_create:true},{public_business_grants:[{}]},{installer_database_create:false},{read_only:'off'},{session_actor:'other'},{business_tables:[]}])
    assert.throws(()=>assertAbsent({...prestate(),...change}));
});
test('post readback validates body hashes, exact NOLOGIN role, empty tables and grants, allows only creator membership',()=>{
  const c=installed();assert.equal(assertInstalled(c,contract,prestate()).canDispatch,false);
  c.memberships=[{role:ROLE,member:c.actor,admin:true,inherit:false,set:false}];assert.equal(assertInstalled(c,contract,prestate()).memberships.length,1);
  for(const change of [c=>{c.role.login=true;},c=>{c.role.bypassRls=true;},c=>{c.functions[0].body+=' ';},c=>{c.functions[0].publicExecute=true;},
    c=>{c.functions.find(f=>f.name==='publish_plan').serviceExecute=true;},c=>{c.functions[0].config=['search_path=public'];},
    c=>{c.tables[0].serviceTableAccess=true;},c=>{c.tables[0].serviceColumnAccess=true;},c=>{c.schema.serviceCreate=true;},
    c=>{c.tables[0].columns=['other'];},c=>{c.rowCounts.plans='1';},
    c=>{c.memberships=[{role:ROLE,member:'other',admin:true}];},c=>{c.actor='other';},c=>{c.business_tables[0].oid='999';}]){
    const v=installed();change(v);assert.throws(()=>assertInstalled(v,contract,prestate()));}
});
test('seven-day exact manifest binds SQL/target/CI/pins and no credentials, AWS or business mutations',()=>{
  const m=manifest();verifyManifest(m,m.manifestSha256,now);assert.equal(m.expiresAt-now,7*24*3600000);
  assert.equal(m.effects.installBatchSubmissions,1);for(const k of ['passwords','loginActivations','businessWrites','awsCalls','appKeyReads','workflowDispatches','automaticRetries'])assert.equal(m.effects[k],0);
  for(const v of [{...m,slot:'different'},{...m,effects:{...m.effects,loginActivations:1}},{...m,targetFingerprintSha256:'d'.repeat(64)},
    {...m,action:{...m.action,sqlSha256:'d'.repeat(64)}},{...m,extra:true}])assert.throws(()=>verifyManifest(v,m.manifestSha256,now));
  assert.throws(()=>verifyManifest(m,'wrong',now));assert.throws(()=>verifyManifest(m,m.manifestSha256,m.expiresAt));verifyManifest(m,undefined,m.expiresAt+1,true);
});

test('extended window accepts day six, rejects before creation/at expiry, and never silently extends an old approved SHA',()=>{
  const m=manifest();verifyManifest(m,m.manifestSha256,now+6*24*3600000);verifyManifest(m,m.manifestSha256,m.expiresAt-1);
  assert.throws(()=>verifyManifest(m,m.manifestSha256,now-1));assert.throws(()=>verifyManifest(m,m.manifestSha256,m.expiresAt));
  const oldBody={...m,expiresAt:now+48*3600000};delete oldBody.manifestSha256;
  const old={...oldBody,manifestSha256:hash(canonicalJson(oldBody))};
  assert.throws(()=>verifyManifest(old,old.manifestSha256,now));
});

test('day-six install still requires unchanged fresh catalog and source before consuming the same permanent slot',async()=>{
  const f=fixture();f.at(now+6*24*3600000);assert.equal((await f.run()).independentInspectRequired,true);
  for(const drift of ['source','catalog']){
    const q=fixture();q.at(now+6*24*3600000);
    if(drift==='source')q.fail('source');else q.io.readCatalog=async()=>({...prestate(),server_version_num:'180007'});
    await assert.rejects(q.run());assert.equal(q.events.includes('slot'),false);assert.equal(q.events.includes('install'),false);
  }
});
test('bad approval, source/read/collision/catalog drift fail without slot or batch',async()=>{
  const f=fixture();await assert.rejects(installOnce({manifest:f.m,approved:'wrong',io:f.io,now:()=>now}));assert.deepEqual(f.events,[]);
  for(const phase of ['source','read']){const q=fixture();q.fail(phase);await assert.rejects(q.run());assert.equal(q.events.includes('slot'),false);}
  const q=fixture();q.io.readCatalog=async()=>({...prestate(),schema:{}});await assert.rejects(q.run());assert.equal(q.events.includes('slot'),false);
});
test('permanent slot precedes one exact batch, COMMIT ACK then same-process metadata; never a second install',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.outcome,'CONTROL_SCHEMA_INSTALLED_REQUIRES_INDEPENDENT_INSPECT');
  assert.deepEqual(f.events,['source','pre-read','slot','source','install','commit-ack','post-read','installed-catalog']);
  await assert.rejects(f.run());assert.equal(f.events.filter(v=>v==='install').length,1);
});
test('post-slot expiry, unknown batch ACK or evidence failures stop without down/rollback/retry',async()=>{
  for(const phase of ['expire','install','ack','commit-ack','installed-catalog']){
    const f=fixture();f.fail(phase);const r=await f.run();assert.match(r.outcome,/PARTIAL_OR_UNKNOWN/);assert.equal(r.retryAllowed,false);assert.equal(r.runtimeEnabled,false);
    assert.equal(f.events.filter(v=>v==='install').length,phase==='expire'?0:1);await assert.rejects(f.run());}
});
test('catalog reader executes bounded READ ONLY transaction and only exact new-table counts, no business rows',async()=>{
  const queries=[],client={query:async(text)=>{queries.push(text);return {rows:text===CATALOG_SQL?[installed()]:text.startsWith('SELECT count')?[{n:'0'}]:[]};}};
  const c=await readControlCatalog(client);assert.equal(c.rowCounts.plans,'0');assert.equal(queries[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(queries.at(-1),'COMMIT');
  assert.equal(queries.filter(q=>q.startsWith('SELECT count')).length,3);assert.doesNotMatch(queries.join('\n'),/SELECT \* FROM public\.|INSERT INTO|ALTER ROLE/);
});
test('catalog errors clean up read-only transaction without running installation SQL',async()=>{
  const queries=[];await assert.rejects(readControlCatalog({query:async q=>{queries.push(q);if(q===CATALOG_SQL)throw Error('read failed');return {rows:[]};}}));
  assert.equal(queries.at(-1),'ROLLBACK');assert.equal(queries.some(q=>q.includes('CREATE ROLE')),false);
});
test('actual local adapter has one exact SQL submission, explicit verified TLS, no key/Secret/AWS/LOGIN loader',async()=>{
  const code=await readFile(new URL('../ops/platform-controller-review-v6/local.mjs',import.meta.url),'utf8');
  assert.equal((code.match(/db\.client\.query\(sql\)/g)||[]).length,1);assert.match(code,/ssl:\{rejectUnauthorized:true\}/);assert.match(code,/flag:'wx',flush:true/);
  assert.doesNotMatch(code,/\.pem|@aws-sdk|GetSecretValue|PASSWORD|ALTER ROLE|DROP SCHEMA|dispatchOnce/);
  assert.match(code,/\['Inventory','Prepare','Install','Inspect'\]/);assert.match(code,/identityEvidence\(\)/);
  assert.match(code,/displayTimeZone:'America\/Winnipeg'/);assert.match(code,/expiresAtWinnipeg:/);assert.match(code,/validForHours:I.validMs\/3600000/);
});
