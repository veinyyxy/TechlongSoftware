import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createPublisherDatabaseV6,createPublisherReadsV6,publisherDatabaseConfigV6,openProductionPublisherV6,PUBLISHER_RELEASE_V6,runPublisherOperationV6} from '../ops/platform-publisher-v6/io.mjs';
import {readControlPrivilegesV6,inspectControlPrivilegesV6,PRIVILEGE_SQL_V6} from '../ops/platform-publisher-v6/privileges.mjs';
import {sqlContract} from '../ops/platform-controller-review-v6/install.mjs';
import {CATALOG_SQL} from '../ops/platform-controller-review-v6/catalog.mjs';
import {createTrustedPublisherV6,ownerQueryV6} from '../ops/platform-cloud-v6/publisher.mjs';
import {S} from '../ops/platform-cloud-v6/contract.mjs';
import {EVIDENCE_V5} from '../ops/cloud-worker/cloud-evidence-v5.mjs';
import {platformFixtureV6} from './fixtures/platform-cloud-v6.mjs';
import {canonicalJson,sha256Hex} from '../lib/deployments/execution/hash.ts';
const sql=(await readFile(new URL('../ops/platform-controller-v6/install.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const contract=sqlContract(sql),expected={ownerRole:'owner_ci',ownerOid:'12',database:'publisher_ci',roleOid:'800',schemaOid:'801'};
function catalog(){
  const bodies=new Map([...sql.matchAll(/CREATE FUNCTION deployment_control_v6\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)].map(m=>[m[1],m[2]]));
  return {read_only:'on',actor:expected.ownerRole,session_actor:expected.ownerRole,database:expected.database,installer:{oid:expected.ownerOid},role:{oid:'800',name:S.databaseRole,
    inherit:false,super:false,createRole:false,createDb:false,replication:false,bypassRls:false},schema:{oid:'801',owner:'12'},tables:[],
    functions:contract.functions.map(f=>({...f,body:bodies.get(f.name),owner:'12',definer:true,publicExecute:false,config:['search_path=pg_catalog, pg_temp']}))};
}
async function fixture(maxWrites=1){
  const f=await platformFixtureV6(),queries=[];let fail=false,metadata=catalog();
  const client={query:async(text,values)=>{
    queries.push({text,values});if(fail)throw Error('private database details');
    if(text===CATALOG_SQL)return {rows:[structuredClone(metadata)]};
    if(text.startsWith('SELECT deployment_control_v6.load_plan'))return {rows:[{value:await f.ports.loadPlan(values[0])}]};
    if(text.startsWith('SELECT techlong_cloud_worker_v5.read_state'))return {rows:[{value:f.observed}]};
    if(text.startsWith('SELECT deployment_control_v6.publish_plan')||text.startsWith('SELECT deployment_control_v6.attest_evidence'))await f.ports.writeOwner({text,values});
    return {rows:[]};
  }};
  const db=createPublisherDatabaseV6({client,expected,contract,release:f.release,now:f.now,maxWrites});
  return {...f,queries,db,client,fail:()=>{fail=true;},alter:c=>{metadata=c;}};
}
function reads(f,patch={}){
  const sends=[],http=[];
  const p=createPublisherReadsV6({s3:{send:async q=>{sends.push(q);const o=f.objects.get(q.input.Key),raw=Buffer.from(canonicalJson(o.value));
    return {VersionId:o.versionId,ServerSideEncryption:'AES256',ContentLength:raw.length,Body:Readable.from([raw]),...patch};}},
    fetch:async(url,options)=>{http.push({url,options});return new Response(JSON.stringify(f.rawRun('123456789')));},githubToken:'synthetic-read-token'});
  return {p,sends,http};
}

test('concrete publisher database requires exact owner/OIDs and nine server-side function bodies before any owner SQL',async()=>{
  const f=await fixture();await assert.rejects(f.db.loadPlan('a'.repeat(64)));assert.equal(f.queries.length,0);
  assert.equal((await f.db.verify()).functionBodiesVerified,9);assert.equal(f.queries[0].text,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const mutate of [c=>{c.actor='wrong';},c=>{c.role.oid='999';},c=>{c.functions[0].body+=' ';},c=>{c.functions[0].publicExecute=true;}]){
    const q=await fixture(),c=catalog();mutate(c);q.alter(c);await assert.rejects(q.db.verify());assert.equal(q.writes.length,0);
  }
});
test('actual read adapters plus exact SQL adapter drive Review publication; service approval and dispatch are never called',async()=>{
  const f=await fixture();await f.db.verify();const r=reads(f),publisher=createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,
    frozenSourceCommit:f.frozenSourceCommit,ports:{...r.p,...f.db},now:f.now});
  const v=await publisher.publishReview({jobId:f.observed.job.id,installationReference:f.installationReference});
  assert.equal(v.executionApproved,false);assert.equal(f.db.counts().ownerWriteSubmissions,1);assert.equal(f.writes.length,1);
  assert.equal(r.sends[0].constructor.name,'GetObjectCommand');assert.equal(r.sends[0].input.Bucket,EVIDENCE_V5.bucket);
  assert.equal(r.sends[0].input.ExpectedBucketOwner,EVIDENCE_V5.owner);assert.equal(r.http.length,0);
  assert.ok(f.queries.some(q=>q.text==='SELECT techlong_cloud_worker_v5.read_state($1::text) AS value'));
  await assert.rejects(publisher.publishReview({jobId:f.observed.job.id,installationReference:f.installationReference}));assert.equal(f.writes.length,1);
});
test('exact SQL writer rejects arbitrary SQL and changed digest before submission; ambiguous write halts permanently',async()=>{
  const f=await fixture();await f.db.verify();
  const bad={text:'DELETE FROM public.users',values:[]};await assert.rejects(f.db.writeOwner(bad));
  const {validatePlan}=await import('../lib/deployments/controller-v6/contract.ts');
  const v=await validatePlan(f.basePlan,f.release,f.at),q=ownerQueryV6('plan',v);
  await assert.rejects(f.db.writeOwner({...q,values:['0'.repeat(64),...q.values.slice(1)]}));assert.equal(f.writes.length,0);
  f.fail();await assert.rejects(f.db.writeOwner(q),/REQUIRES_INSPECT_NO_RETRY/);await assert.rejects(f.db.writeOwner(q));
  assert.equal(f.db.counts().ownerWriteSubmissions,1);
});
test('bound S3 reads reject foreign keys, wrong version, oversized body, capabilities and digest mismatch without retry',async()=>{
  for(const fault of ['path','version','length','secret','digest']){
    const f=await platformFixtureV6(),patch=fault==='version'?{VersionId:'other'}:fault==='length'?{ContentLength:1000001}:{};
    if(fault==='secret')f.objects.get(f.installationReference.key).value.password='synthetic-must-not-escape';
    const r=reads(f,patch),ref={...f.installationReference};if(fault==='path')ref.key='../outside';if(fault==='digest')ref.sha256='0'.repeat(64);
    await assert.rejects(r.p.readObject(ref));const before=r.sends.length;await assert.rejects(r.p.readObject(f.installationReference));assert.equal(r.sends.length,before);
  }
});
test('GitHub read port only GETs the exact fixed-repository run and never follows redirects or reads logs',async()=>{
  const f=await platformFixtureV6(),r=reads(f);const v=await r.p.readRun('123456789');assert.equal(v.head_sha,f.sourceCommit);
  assert.equal(r.http[0].url,'https://api.github.com/repos/'+S.repository+'/actions/runs/123456789');
  assert.equal(r.http[0].options.method,'GET');assert.equal(r.http[0].options.redirect,'error');
  await assert.rejects(r.p.readRun('../logs'));assert.equal(r.http.length,1);r.p.dispose();await assert.rejects(r.p.readRun('123456789'));
});
test('explicit Neon URL validation pins the owner and TLS target and ignores no injected endpoint options',async()=>{
  const target={host:'ep-publisher-fixture.ca-central-1.aws.neon.tech',port:5432,database:'publisher_ci',actor:'owner_ci',transport:'PostgresTLSVerifyFull'};
  const bound={...expected,targetFingerprintSha256:await sha256Hex(target)},url='postgresql://owner_ci:fake-only@'+target.host+'/publisher_ci?sslmode=verify-full';
  const c=await publisherDatabaseConfigV6(url,bound);assert.deepEqual(c.ssl,{rejectUnauthorized:true});assert.equal(c.options,'');
  for(const u of [url.replace('owner_ci:','service:'),url.replace('verify-full','disable'),url+'&options=unsafe',url.replace(target.host,'other.neon.tech')])
    await assert.rejects(publisherDatabaseConfigV6(u,bound));
});
test('production publisher remains code-bound UNPUBLISHED even with a fabricated release; owner/key/credentials are not read',async()=>{
  const f=await platformFixtureV6();let reads=0;assert.equal(PUBLISHER_RELEASE_V6.state,'UNPUBLISHED');
  await assert.rejects(openProductionPublisherV6({...f,operation:'ReviewPlan',readOwnerUrl:async()=>{reads++;throw Error('must not read');}}),/NOT_ACTIVATED/);
  assert.equal(reads,0);
});
test('operation mode is checked before any attestation; advance partial failure never retries its committed first write',async()=>{
  const events=[],input={planSha256:'a'.repeat(64),resultReference:{}};
  const publisher={attestResult:async()=>{events.push('attest');return {mode:'Review'};},publishSuccessor:async()=>{events.push('successor');throw Error('unknown second write');}};
  await assert.rejects(runPublisherOperationV6('FinalAttest',input,{publisher,loadPlan:async()=>({plan:{mode:'Review'}})}));assert.deepEqual(events,[]);
  await assert.rejects(runPublisherOperationV6('AttestAndAdvance',input,{publisher,loadPlan:async()=>({plan:{mode:'Review'}})}));assert.deepEqual(events,['attest','successor']);
  await assert.rejects(runPublisherOperationV6('other',input,{publisher}));assert.equal(events.length,2);
});
function safeAudit(){return {read_only:'on',role:{oid:'800',name:S.databaseRole,login:false,super:false,inherit:false,createRole:false,createDb:false,
  replication:false,bypassRls:false,config:null},memberships:[],database_create_or_owner:[],temporary_objects_allowed:true,schema_create_or_owner:[],
  relation_or_column_rights:[],unexpected_executable_functions:[],function_grant_options:[],foreign_server_rights:[]};}
test('LOGIN preflight inspects effective memberships, columns/sequences, PUBLIC/inherited functions and grant options without revocation',()=>{
  assert.equal(inspectControlPrivilegesV6(safeAudit(),'800').activationPreflightPassed,true);
  for(const field of ['memberships','database_create_or_owner','schema_create_or_owner','relation_or_column_rights','unexpected_executable_functions','function_grant_options','foreign_server_rights']){
    const c=safeAudit();c[field]=[{}];assert.equal(inspectControlPrivilegesV6(c,'800').activationPreflightPassed,false);
  }
  const c=safeAudit();c.role.login=true;assert.equal(inspectControlPrivilegesV6(c,'800').activationPreflightPassed,false);
  assert.match(PRIVILEGE_SQL_V6,/has_any_column_privilege/);assert.match(PRIVILEGE_SQL_V6,/has_function_privilege/);
});
test('privilege audit executes one READ ONLY catalog transaction, never DDL or business SELECTs; errors only clean up read transaction',async()=>{
  const calls=[],client={query:async q=>{calls.push(q);return {rows:q===PRIVILEGE_SQL_V6?[safeAudit()]:[]};}};
  await readControlPrivilegesV6(client);assert.equal(calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(calls.at(-1),'COMMIT');
  assert.doesNotMatch(calls.join('\n'),/^\s*(?:ALTER ROLE|REVOKE|GRANT)\b|FROM public\./m);
  const bad=[];await assert.rejects(readControlPrivilegesV6({query:async q=>{bad.push(q);if(q===PRIVILEGE_SQL_V6)throw Error('offline');return {rows:[]};}}));assert.equal(bad.at(-1),'ROLLBACK');
});
