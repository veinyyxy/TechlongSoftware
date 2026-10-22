import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {QUERIES} from '../ops/platform-web-database-v1/catalog.mjs';
import {PROFILE,ROLE,TABLES,STATEMENTS,INSTALL_SQL,LOCK_SQL,SETTINGS,SCOPE,hash,canonical,
  assertBaseline,assertFresh,assertInstalled} from '../ops/platform-web-database-role-v1/contract.mjs';
import {EFFECTIVE_SQL,assertEffective} from '../ops/platform-web-database-role-v1/effective.mjs';
import {installTransaction,independentRead} from '../ops/platform-web-database-role-v1/install.mjs';
import {BASELINE,SOURCES,CI_PATH,validate,coordinate,errorCode,main} from '../ops/platform-web-database-role-v1/local.mjs';
const target={host:'ep-ci-only.ca-central-1.aws.neon.tech',port:5432,database:'fixture_db',actor:'fixture_owner',transport:'PostgresTLSVerifyFull'};
const oid='9000',at=Date.parse('2026-10-22T15:00:00Z');
const grant=(privilege)=>({grantee:oid,grantor:'100',privilege,grantable:false});
function catalog(){return {identity:{database:target.database,actor:target.actor,session_actor:target.actor,read_only:'on',server_version_num:'180006',
  actor_role:{oid:'100',createRole:true,super:false},candidate_role:null,database_metadata:{oid:'200',owner:'100',acl:[{grantee:'0',privilege:'CONNECT'},{grantee:'0',privilege:'TEMPORARY'}]}},
  relations:[...TABLES,'auth_invitations'].map((name,i)=>({schema:'public',name,oid:String(300+i),owner:'100',kind:'r',rls:false,forceRls:false,acl:[],
    columns:(name==='user_credentials'?[...new Set([...PROFILE.credentialsSelectColumns,...PROFILE.credentialsUpdateColumns,'password_changed_at'])]:['id']).map(name=>({name,acl:[]}))})),
  schemas:[{name:'public',owner:'100',acl:[{grantee:'0',privilege:'USAGE'}]},{name:'controller',owner:'100',acl:[]}],routines:[],memberships:[],defaultAcls:[],authTriggers:[]};}
function installed(b=catalog()){
  const c=structuredClone(b);c.identity.candidate_role={oid,name:ROLE,login:false,super:false,inherit:false,createRole:false,createDb:false,replication:false,bypassRls:false,connectionLimit:5,hasRoleSettings:true};
  for(const t of c.relations){const allowed=PROFILE.selectTables.includes(t.name)?['SELECT']:t.name==='auth_sessions'?PROFILE.sessionPrivileges:[];
    t.acl.push(...allowed.map(grant));if(t.name==='user_credentials')for(const col of t.columns){
      if(PROFILE.credentialsSelectColumns.includes(col.name))col.acl.push(grant('SELECT'));
      if(PROFILE.credentialsUpdateColumns.includes(col.name))col.acl.push(grant('UPDATE'));}}
  c.schemas[0].acl.push(grant('USAGE'));c.memberships.push({role:ROLE,roleOid:oid,member:target.actor,memberOid:'100',grantor:'100',admin:true,inherit:false,set:false});return c;
}
function effective(c=installed()){
  return {role_settings:{oid,connectionLimit:5,config:['search_path=pg_catalog, public, pg_temp']},database_privileges:{CONNECT:true,CREATE:false,TEMPORARY:true},
    schemas:c.schemas.map(s=>({name:s.name,USAGE:s.name==='public',CREATE:false})),relations:c.relations.map(t=>{
      const allowed=PROFILE.selectTables.includes(t.name)?['SELECT']:t.name==='auth_sessions'?PROFILE.sessionPrivileges:[];
      return {schema:t.schema,name:t.name,kind:t.kind,table:Object.fromEntries(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'].map(p=>[p,allowed.includes(p)])),sequence:null,
        columns:t.columns.map(col=>({name:col.name,...Object.fromEntries(['SELECT','INSERT','UPDATE','REFERENCES'].map(p=>[p,allowed.includes(p)||
          (t.name==='user_credentials'&&((p==='SELECT'&&PROFILE.credentialsSelectColumns.includes(col.name))||(p==='UPDATE'&&PROFILE.credentialsUpdateColumns.includes(col.name))))]))}))};})};
}
function client({failStatement,commitError=false,hasRole=false}={}){
  const calls=[];let written=hasRole,readOnly=false,committed=hasRole;
  return {calls,async query(sql){calls.push(sql);if(sql.includes('BEGIN'))readOnly=sql.endsWith('READ ONLY');
    if(sql===failStatement)throw Error('CI_FAILURE');
    if(sql===STATEMENTS.at(-1))written=true;
    if(sql==='COMMIT'){committed=written;if(commitError)throw Error('ACK_LOST');return {command:'COMMIT'};}
    if(sql==='ROLLBACK'){written=committed;return {command:'ROLLBACK'};}
    const c=written?installed():catalog();c.identity.read_only=readOnly?'on':'off';const q=QUERIES.find(q=>q.sql===sql);
    if(q)return {rows:[q.name==='identity'?c.identity:{items:c[q.name]}]};
    if(sql===EFFECTIVE_SQL)return {rows:[effective(c)]};return {rows:[],command:'OK'};
  },async end(){calls.push('END');}};
}
const options=c=>({client:c,target,baseline:catalog(),expiresAt:'2026-10-24T15:00:00Z',now:()=>at,record:async()=>{},roleIdentity:async()=>{}});
const manifest=()=>({schema:'techlong/platform-web-nologin-review/v1',sourceCommit:'a'.repeat(40),nonce:'b'.repeat(32),
  issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+48*3600000).toISOString(),latestStartAt:new Date(at+48*3600000-300000).toISOString(),
  scope:{...SCOPE},profile:{...PROFILE},statements:[...STATEMENTS],sqlSha256:hash(INSTALL_SQL),querySha256:hash(canonical({QUERIES,EFFECTIVE_SQL,LOCK_SQL,SETTINGS})),
  baseline:{...BASELINE},baselineCatalogSha256:'c'.repeat(64),target,targetSha256:hash(canonical(target)),riskSha256:'d'.repeat(64),
  sourcePins:SOURCES.map(file=>({file,sha256:'e'.repeat(64)})),ciReceipt:{file:'F:/ChatGPT_workshop/techlong-platform-web-role-ci-123.json',runId:123,sha256:'f'.repeat(64)}});

test('exact seven disabled-role statements, fixed tables and no password, LOGIN, PUBLIC/default grant or controller change',async()=>{
  assert.equal(STATEMENTS.length,7);assert.equal(TABLES.length,15);assert.equal(SCOPE.metadataSelectsMax,23);assert.equal(SCOPE.awsCalls,0);
  assert.match(STATEMENTS[0],/NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5$/);
  assert.doesNotMatch(INSTALL_SQL,/\bPASSWORD\b|\bLOGIN\b|TO PUBLIC|DEFAULT PRIVILEGES|REVOKE|DROP|controller\./);
  assert.match(SETTINGS.at(-1),/createrole_self_grant=''/);assert.match(LOCK_SQL,/IN ACCESS SHARE MODE$/);
  assert.equal((await readFile(new URL('../ops/platform-web-database-role-v1/no-login.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n'),INSTALL_SQL);
});
test('baseline and exact delta reject drift, extra grants, role membership and LOGIN',()=>{
  const b=catalog();assertBaseline(b);assertFresh(b,b);assertInstalled(installed(),b,oid);
  for(const change of [c=>c.identity.candidate_role.login=true,c=>c.relations[0].acl.push(grant('UPDATE')),
    c=>c.schemas[1].acl.push(grant('USAGE')),c=>c.memberships[0].set=true,c=>c.identity.actor_role.super=true,
    c=>c.routines.push({schema:'public',name:'unreviewed'})]){const c=installed();change(c);assert.throws(()=>assertInstalled(c,b,oid));}
  const c=catalog();c.relations[0].owner='500';assert.throws(()=>assertFresh(c,b));
});
test('effective rights include PUBLIC TEMP but reject column, coverage, schema, config and privilege escalation',()=>{
  assertEffective(effective(),installed(),oid);
  for(const change of [e=>e.database_privileges.CREATE=true,e=>e.role_settings.config.push('other=value'),e=>e.schemas[1].USAGE=true,
    e=>e.relations[0].table.UPDATE=true,e=>e.relations[0].columns.pop(),e=>e.relations[0].name='replacement',
    e=>e.relations.find(t=>t.name==='user_credentials').columns.find(c=>c.name==='password_changed_at').SELECT=true]){
    const e=effective();change(e);assert.throws(()=>assertEffective(e,installed(),oid));}
});
test('write transaction locks, preflights, applies once, records identity before commit and supports independent read-only verification',async()=>{
  const c=client(),events=[],r=await installTransaction({...options(c),record:async name=>events.push(name),roleIdentity:async()=>events.push('role-id')});
  assert(r.commitAcknowledged);assert(c.calls.indexOf(LOCK_SQL)<c.calls.indexOf(QUERIES[0].sql));
  for(const sql of STATEMENTS)assert.equal(c.calls.filter(x=>x===sql).length,1);
  assert(events.indexOf('role-id')<events.indexOf('commit-intent'));assert.equal(c.calls.at(-1),'COMMIT');
  const reader=client({hasRole:true});const v=await independentRead({...options(reader),roleOid:oid});
  assert.equal(v.state,'EXACT_NOLOGIN_ROLE_OBSERVED');assert.equal(reader.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
});
test('SQL failure, expiration and ambiguous COMMIT never replay persistent statements',async()=>{
  for(const opt of [{failStatement:STATEMENTS[2]},{commitError:true}]){const c=client(opt);await assert.rejects(installTransaction(options(c)));
    assert.equal(c.calls.at(-1),'ROLLBACK');for(const sql of STATEMENTS)assert(c.calls.filter(x=>x===sql).length<=1);}
  const c=client();await assert.rejects(installTransaction({...options(c),now:()=>Date.parse('2026-10-25T00:00:00Z')}),/APPROVAL_EXPIRED/);assert.equal(c.calls.length,0);
});
test('coordinator consumes before connection and makes exactly one independent attempt after installer failure without retry',async()=>{
  const events=[],m=manifest();m.expiresAt=new Date(Date.now()+60000).toISOString();
  const reader=client();const r=await coordinate({manifest:m,baseline:{catalog:catalog()},ports:{sha:'a'.repeat(64),
    consume:async()=>events.push('consume'),record:async name=>events.push(name),connect:async kind=>{events.push(kind);if(kind==='installer')throw Error('secret-private-url');return reader;}}});
  assert.deepEqual(events.slice(0,3),['consume','installer','independent-reader']);assert.equal(r.outcome,'INSTALL_REQUIRES_REVIEW_NO_RETRY');
  assert.equal(r.observed.state,'ROLE_ABSENT_BASELINE_RESTORED');assert.equal(reader.calls.at(-1),'END');assert.equal(r.errors[0].code,'ROLE_OPERATION_FAILED');
  await assert.rejects(coordinate({manifest:m,baseline:{catalog:catalog()},ports:{consume:async()=>{throw Error('occupied');},connect:async()=>assert.fail('must not connect')}}));
});
test('approval binds exact raw bytes, SQL, queries, baseline, target and 48h/latest-start margin; invalid CLI never reads',async()=>{
  const m=manifest(),raw=JSON.stringify(m);assert.equal(validate(raw,hash(raw),at).scope.createRoles,1);
  assert.throws(()=>validate(raw,'a'.repeat(64),at));assert.throws(()=>validate(raw,hash(raw),Date.parse(m.latestStartAt)));
  for(const change of [v=>v.scope.loginActivations=1,v=>v.statements.push('GRANT ALL'),v=>v.baseline.receipt.sha256='a'.repeat(64),
    v=>v.sourcePins.pop(),v=>v.target.database='other',v=>v.expiresAt='2026-10-25T15:00:00Z']){
    const v=structuredClone(m);change(v);const s=JSON.stringify(v);assert.throws(()=>validate(s,hash(s),at));}
  await assert.rejects(main(['InstallReviewed','bad','a'.repeat(64)]),/INSTALL_ARGUMENTS/);
  assert.equal(errorCode(Error('postgres://owner:password@private/db')),'ROLE_OPERATION_FAILED');assert.equal(errorCode({code:'42501'}),'42501');
});
test('real PostgreSQL CI is No-AWS, pinned, read-only GitHub permissions and no production credentials or image publishing',async()=>{
  const w=load(await readFile(new URL('../'+CI_PATH,import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read'});
  assert.equal(w.jobs.candidate.environment,undefined);assert.match(w.jobs.candidate.services.postgres.image,/@sha256:/);
  assert(w.jobs.candidate.steps.some(s=>s.name==='Atomic NOLOGIN grant and forbidden-operation checks on PostgreSQL'));
  assert.doesNotMatch(JSON.stringify(w),/secrets\.|id-token|aws-actions|upload-artifact|workflow_dispatch|docker build|InstallReviewed/);
});
