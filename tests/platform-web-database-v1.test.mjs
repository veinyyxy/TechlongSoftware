import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {QUERIES,SESSION_SQL,PROFILE,readCatalog,assess} from '../ops/platform-web-database-v1/catalog.mjs';
import {SCOPE,SOURCES,hash,parseTarget,environment,validateReview,runAudit,errorCode,main} from '../ops/platform-web-database-v1/local.mjs';
const target={host:'ep-example-pooler.ca-central-1.aws.neon.tech',port:5432,database:'neondb',actor:'neondb_owner',transport:'PostgresTLSVerifyFull'};
const baseCatalog=()=>({identity:{database:'neondb',actor:'neondb_owner',session_actor:'neondb_owner',read_only:'on',candidate_role:null},
  relations:[...PROFILE.selectTables,'user_credentials','auth_sessions'].map((name,i)=>({schema:'public',name,oid:String(i+1),kind:'r',acl:[],
    columns:(name==='user_credentials'?[...new Set([...PROFILE.credentialsSelectColumns,...PROFILE.credentialsUpdateColumns])]:['id']).map(name=>({name,acl:[]}))})),
  schemas:[{name:'public',acl:[{grantee:'0',privilege:'USAGE'}]}],routines:[],memberships:[],defaultAcls:[],authTriggers:[]});
const manifest=()=>({schema:'techlong/platform-web-database-catalog-review/v1',sourceCommit:'a'.repeat(40),nonce:'b'.repeat(32),
  issuedAt:'2026-10-22T15:00:00.000Z',expiresAt:'2026-10-24T15:00:00.000Z',scope:{...SCOPE},profile:{...PROFILE},
  querySha256:hash(JSON.stringify({queries:QUERIES,session:SESSION_SQL})),sourcePins:SOURCES.map(file=>({file,sha256:'c'.repeat(64)})),
  riskSha256:'d'.repeat(64),target,targetSha256:hash(JSON.stringify(target)),
  ciReceipt:{file:'F:/ChatGPT_workshop/techlong-platform-web-db-ci-123.json',sha256:'e'.repeat(64),runId:123}});
function fixture({fail,wrongReadOnly=false,oversize=false}={}){
  const calls=[],catalog=baseCatalog();if(wrongReadOnly)catalog.identity.read_only='off';
  return {calls,async query(sql){calls.push(sql);if(sql===fail)throw Error('fixture-failure');
    const q=QUERIES.find(q=>q.sql===sql);if(!q)return {rows:[]};
    return q.name==='identity'?{rows:[catalog.identity]}:{rows:[{items:oversize?Array.from({length:1001},()=>({})):catalog[q.name]}]};},async end(){calls.push('END');}};
}
test('catalog is exactly seven pinned metadata SELECTs, never business rows, passwords, function bodies or a grant',()=>{
  assert.equal(QUERIES.length,7);assert.equal(new Set(QUERIES.map(q=>q.name)).size,7);
  for(const {sql} of QUERIES){assert.match(sql,/^(SELECT|WITH) /);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL|DO)\b|rolpassword|pg_authid|prosrc|pg_get_functiondef|FROM public\./i);}
  assert.equal(PROFILE.installed,false);assert.equal(PROFILE.rowIsolation,false);
  assert.equal(SCOPE.sqlDataWrites,0);assert.equal(SCOPE.sqlDdl,0);assert.equal(SCOPE.awsCalls,0);assert.equal(SCOPE.businessRows,0);
  assert.match(QUERIES.find(q=>q.name==='relations').sql,/c\.relkind='S' THEN 's' ELSE 'r'/);
});
test('one read-only repeatable-read transaction, fixed safe search path, all catalog queries, then COMMIT',async()=>{
  const c=fixture();const v=await readCatalog(c,target);assert.equal(v.identity.read_only,'on');
  assert.deepEqual(c.calls,[SESSION_SQL.begin,...SESSION_SQL.settings,...QUERIES.map(q=>q.sql),SESSION_SQL.commit]);
  assert.equal(assess(v).missingTables.length,0);assert.equal(assess(v).missingCredentialColumns.length,0);
  assert.equal(assess(v).installationAuthorized,false);
});
test('wrong identity, read-write transaction, oversized catalog and SQL failure roll back without another connection or query retry',async()=>{
  for(const option of [{wrongReadOnly:true},{oversize:true},{fail:QUERIES[2].sql}]){
    const c=fixture(option);await assert.rejects(readCatalog(c,target));assert.equal(c.calls.at(-1),SESSION_SQL.rollback);
    assert(c.calls.filter(x=>x===QUERIES[2].sql).length<=1);assert(!c.calls.includes(SESSION_SQL.commit));
  }
  const c=fixture();await assert.rejects(readCatalog(c,{...target,actor:'someone_else'}),/DATABASE_IDENTITY/);
});
test('assessment surfaces existing role, PUBLIC definer/table paths and auth triggers without executing or declaring them safe',()=>{
  const c=baseCatalog();c.identity.candidate_role={name:PROFILE.role,login:true};
  c.routines.push({schema:'public',name:'sensitive_definer',oid:'999',argumentTypes:'text',definer:true,acl:[{grantee:'0',privilege:'EXECUTE'}]});
  c.relations[0].columns[0].acl.push({grantee:'0',privilege:'UPDATE'});c.authTriggers.push({table:'auth_sessions',name:'audit',internal:false});
  const r=assess(c);assert.equal(r.candidateRole.login,true);assert.equal(r.publicDefinerPaths.length,1);assert.equal(r.publicRelationGrants.length,1);
  assert.equal(r.authUserTriggers.length,1);assert.equal(r.installationAuthorized,false);assert.equal(r.passwordRead,false);
});
test('TLS target uses explicit host/user/password fields, refuses TLS disablement, options and off-target servers; public identity excludes password',()=>{
  const url='postgresql://neondb_owner:fixture-only-secret@'+target.host+'/neondb?sslmode=require&channel_binding=require';
  const v=parseTarget(url);assert.deepEqual(v.target,target);assert.equal(v.config.ssl.rejectUnauthorized,true);
  assert.equal(v.config.ssl.servername,target.host);assert.equal(v.config.connectionString,undefined);assert.equal(v.config.options,'');
  assert(!JSON.stringify(v.target).includes('fixture-only-secret'));
  for(const raw of [url.replace('sslmode=require','sslmode=disable'),url+'&options=-csearch_path=evil',url.replace(target.host,'attacker.example'),
    url+'&sslmode=require',url.replace('/neondb?','/neondb/other?'),url.replace(':fixture-only-secret@','@')])assert.throws(()=>parseTarget(raw));
});
test('approval binds original JSON bytes, exact metadata-only scope, source pins and 48h; malformed or expired review never connects',async()=>{
  const m=manifest(),text=JSON.stringify(m),now=Date.parse(m.issuedAt);assert.equal(validateReview(text,hash(text),now).scope.connections,1);
  assert.throws(()=>validateReview(text,'0'.repeat(64),now));assert.throws(()=>validateReview(text,hash(text),Date.parse(m.expiresAt)));
  for(const change of [v=>v.scope.sqlDdl=1,v=>v.scope.connections=2,v=>v.profile.selectTables=[],v=>v.querySha256='a'.repeat(64),
    v=>v.sourcePins.pop(),v=>v.expiresAt='2026-10-25T15:00:00.000Z']){const v=structuredClone(m);change(v);const raw=JSON.stringify(v);assert.throws(()=>validateReview(raw,hash(raw),now));}
  await assert.rejects(main(['ReadReviewed','not-a-file']),/ARGS/);
  await assert.rejects(main(['ReadReviewed','not-a-file','a'.repeat(64)]),/READ_ARGUMENTS/);
});
test('one permanent local consume before connection; all failure paths close, no write/SQL/connection retry',async()=>{
  for(const failed of ['consume','connect','query',null]){
    const calls=[],c=fixture(failed==='query'?{fail:QUERIES[1].sql}:{}),m=manifest();
    const ports={async consume(){calls.push('consume');if(failed==='consume')throw Error('stop');},
      async connect(){calls.push('connect');if(failed==='connect')throw Error('stop');return c;},async save(v){calls.push('save');assert.equal(v.outcome,'READ_ONLY_CATALOG_CAPTURED_NOT_INSTALLED');}};
    if(failed)await assert.rejects(runAudit({manifest:m,sha:'a'.repeat(64),ports}));else await runAudit({manifest:m,sha:'a'.repeat(64),ports});
    assert.equal(calls[0],'consume');assert(calls.filter(x=>x==='connect').length<=1);
    assert.equal(c.calls.includes('END'),failed===null||failed==='query');
  }
});
test('no inherited credential/PG/Git/Node injection and no credential/error string disclosure',()=>{
  environment({});for(const env of [{PGHOST:'evil'},{DATABASE_URL:'secret'},{NODE_EXTRA_CA_CERTS:'evil'},{GIT_CONFIG_COUNT:'1'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}])assert.throws(()=>environment(env));
  assert.equal(errorCode(new Error('postgres://owner:password@host/db')),'CATALOG_OPERATION_FAILED');
  assert.equal(errorCode({code:'28P01',message:'password=do-not-print'}),'28P01');
});
test('No-AWS candidate tests SQL on disposable PostgreSQL, no production env, authority, image build or upload',async()=>{
  const w=load(await readFile(new URL('../.github/workflows/platform-web-database-candidate.yml',import.meta.url),'utf8'));
  assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.candidate.environment,undefined);
  assert.equal(w.jobs.candidate.permissions,undefined);assert(w.jobs.candidate.services.postgres.image.includes('@sha256:'));
  assert(w.jobs.candidate.steps.some(s=>s.name==='Exact catalog SQL on disposable PostgreSQL'));
  const text=JSON.stringify(w);assert.doesNotMatch(text,/secrets\.|id-token|aws-actions|upload-artifact|docker build|ReadReviewed/);
  const local=await readFile(new URL('../ops/platform-web-database-v1/local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(local,/@aws-sdk|credential.*fill|GetSecretValue|INSERT INTO|CREATE ROLE|UPDATE public/);
});
