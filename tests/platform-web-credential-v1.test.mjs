import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'js-yaml';
import {C,ROLE,SCOPE,hash,canonical,sourceOnlyPolicy,passwordSql,material,parseMaterial,taskSecretReference,assertWebSnapshot,safeCode} from '../ops/platform-web-credential-v1/contract.mjs';
import {QUERIES,SESSION_SQL} from '../ops/platform-web-database-v1/catalog.mjs';
import {LOCK_SQL} from '../ops/platform-web-database-role-v1/contract.mjs';
import {EFFECTIVE_SQL} from '../ops/platform-web-database-role-v1/effective.mjs';
import {PROVIDER_SQL,PROOF_SQL,activate,dedicatedProof} from '../ops/platform-web-credential-v1/database.mjs';
import {installOnce} from '../ops/platform-web-credential-v1/install.mjs';
import {awsEnvironment} from '../ops/platform-web-credential-v1/aws.mjs';
import {B,SOURCES,CI_PATH,RISK,validate,main} from '../ops/platform-web-credential-v1/local.mjs';
const target={host:'ep-ci-only.ca-central-1.aws.neon.tech',port:5432,database:'fixture_db',actor:'fixture_owner',transport:'PostgresTLSVerifyFull'};
const version='abcd1234-1234-4123-8123-123456789abc',arn='arn:aws:secretsmanager:ca-central-1:402010193138:secret:'+C.secretName+'-AbCd12',password='X'.repeat(64);
const base=()=>({identity:{actor:target.actor,session_actor:target.actor,database:target.database,read_only:'on',candidate_role:{oid:C.roleOid,name:ROLE,login:false,inherit:false}},relations:[],schemas:[],routines:[],memberships:[],defaultAcls:[],authTriggers:[]});
const effective=()=>({role_settings:{oid:C.roleOid,connectionLimit:5,config:['search_path=pg_catalog, public, pg_temp']},database_privileges:{CONNECT:true,CREATE:false,TEMPORARY:true},relations:[],schemas:[]});
function client({login=false,commitError=false,failAlter=false}={}){const calls=[];let live=login,readOnly=true;
  return {calls,async query(sql){calls.push(sql);if(sql.startsWith('BEGIN'))readOnly=sql.endsWith('READ ONLY');
    if(sql.startsWith('ALTER ROLE')){if(failAlter)throw {code:'42501',message:'do not print '+password};live=true;}
    if(sql==='COMMIT'&&commitError)throw {code:'08006',message:'ambiguous'};
    if(sql==='COMMIT')return {command:'COMMIT'};
    if(sql===PROVIDER_SQL)return {rows:[{password_encryption:'scram-sha-256',neon_forward_ddl:'on'}]};
    if(sql===EFFECTIVE_SQL)return {rows:[effective()]};
    if(sql===PROOF_SQL)return {rows:[{actor:ROLE,session_actor:ROLE,database:target.database,role_oid:C.roleOid,read_only:'on',search_path:'pg_catalog, public, pg_temp'}]};
    const c=base();c.identity.read_only=readOnly?'on':'off';c.identity.candidate_role.login=live;const q=QUERIES.find(q=>q.sql===sql);
    return q?{rows:[q.name==='identity'?c.identity:{items:c[q.name]}]}:{rows:[]};},async end(){calls.push('END');}};
}
function manifest(){return {schema:'techlong/platform-web-credential-review/v1',sourceCommit:'a'.repeat(40),nonce:'b'.repeat(32),roleOid:C.roleOid,versionId:version,
  issuedAt:'2026-10-22T20:00:00Z',expiresAt:'2026-10-24T20:00:00Z',latestStartAt:'2026-10-24T19:50:00Z',scope:{...SCOPE},baseline:{...B},
  baselineCatalogSha256:'c'.repeat(64),target,targetSha256:hash(canonical(target)),inventory:{source:{Account:C.account,Arn:C.sourceArn,UserId:C.sourceId},secretAbsent:true,policyValidated:true,kms:{arn:'arn:aws:kms:ca-central-1:402010193138:key/1234',id:'1234',keyManager:'AWS'}},
  policy:sourceOnlyPolicy(),sqlTemplateSha256:hash(passwordSql(password)),querySha256:hash(canonical({QUERIES,SESSION_SQL,EFFECTIVE_SQL,PROVIDER_SQL,PROOF_SQL,LOCK_SQL})),
  sourcePins:SOURCES.map(file=>({file,sha256:'d'.repeat(64)})),riskSha256:'d'.repeat(64),ciReceipt:{runId:123,file:'F:/ChatGPT_workshop/techlong-platform-web-credential-ci-123.json',sha256:'e'.repeat(64)}};}

test('one raw Neon password/LOGIN statement and three protected Secret writes, never verifier, IAM or deployment',()=>{
  assert.match(passwordSql(password),/^ALTER ROLE "techlong_platform_web_acceptance_v1" WITH LOGIN PASSWORD '[A-Za-z0-9_-]{64}'$/);
  for(const p of ['short',"X'.repeat(64)",'SCRAM-SHA-256$invalid','A'.repeat(65)])assert.throws(()=>passwordSql(p));
  assert.equal(SCOPE.awsWritesMax,3);assert.equal(SCOPE.rolePasswordLoginStatementsMax,1);assert.equal(SCOPE.iamChanges,0);assert.equal(SCOPE.deployments,0);
  const p=sourceOnlyPolicy();assert(p.Statement.every(s=>s.Effect==='Deny'&&s.Condition.ArnNotEquals['aws:PrincipalArn']===C.sourceArn));
  assert(p.Statement[1].Action.includes('secretsmanager:PutResourcePolicy'));assert.equal(p.Statement[0].Action,'secretsmanager:GetSecretValue');
});
test('material replaces owner with fixed role and TLS target; ECS pins JSON key and version, never AWSCURRENT fallback',()=>{
  const m=material(target,password);assert.equal(parseMaterial(m,target),password);assert(!m.databaseUrl.includes(target.actor));
  assert.deepEqual(taskSecretReference(arn,version),{name:'DATABASE_URL',valueFrom:arn+':databaseUrl::'+version});
  for(const change of [v=>v.databaseUrl=v.databaseUrl.replace(ROLE,'other_role'),v=>v.databaseUrl=v.databaseUrl.replace('verify-full','disable'),
    v=>v.databaseUrl+='&options=evil',v=>v.other='field']){const v=structuredClone(m);change(v);assert.throws(()=>parseMaterial(v,target));}
  assert.throws(()=>taskSecretReference(arn,'AWSCURRENT'));
});
test('poststate may change LOGIN only; OID, ACL, inherited rights, config and owner remain pinned',()=>{
  const b=base(),c=base();c.identity.candidate_role.login=true;assertWebSnapshot(c,effective(),b,true);
  for(const change of [v=>v.identity.candidate_role.oid='999',v=>v.identity.candidate_role.inherit=true,v=>v.memberships.push({role:'extra'})]){
    const v=structuredClone(c);change(v);assert.throws(()=>assertWebSnapshot(v,effective(),b,true));}
});
test('activation preflights and locks once; lost COMMIT or SQL error rolls back locally without repeating ALTER',async()=>{
  for(const opts of [{},{commitError:true},{failAlter:true}]){const c=client(opts),records=[];
    const run=activate({client:c,target,baseline:base(),password,expiresAt:'2026-10-24T20:00:00Z',now:()=>Date.parse('2026-10-22T20:00:00Z'),record:async n=>records.push(n)});
    if(opts.commitError||opts.failAlter)await assert.rejects(run);else assert((await run).commitAcknowledged);
    assert.equal(c.calls.filter(s=>s.startsWith('ALTER ROLE')).length,1);assert(c.calls.indexOf(LOCK_SQL)<c.calls.indexOf(passwordSql(password)));
    assert.equal(c.calls.at(-1),opts.commitError||opts.failAlter?'ROLLBACK':'COMMIT');assert(!records.includes(password));
  }
});
test('coordinator protects before generating/putting a value, authenticates fixed version once, and never repairs partial AWS writes',async()=>{
  for(const failed of [null,'protect','put']){const events=[],m=manifest(),db=client(),reader=client({login:!failed}),auth=client({login:true}),records=[];
    const a={calls:{reads:0,writes:0,secretValueReads:0},inventory:async()=>m.inventory,source:async()=>{},
      createEmpty:async()=>{events.push('create');return arn;},protect:async()=>{events.push('protect');if(failed==='protect')throw Error('stop');},
      put:async()=>{events.push('put');if(failed==='put')throw Error('stop');},metadata:async()=>({arn}),get:async()=>{events.push('get');return material(target,password);}};
    let n=0;const result=await installOnce({manifest:m,sha:'a'.repeat(64),baseline:base(),now:()=>Date.parse(m.issuedAt),io:{aws:a,
      consume:async()=>events.push('consume'),owner:async()=>++n===1?db:reader,dedicated:async()=>auth,setSensitive:()=>{},record:async(name,value)=>records.push({name,value})}});
    assert.deepEqual(events.slice(0,3),['consume','create','protect']);assert.equal(n,2);
    assert(events.filter(e=>e==='put').length<=1);assert(events.filter(e=>e==='get').length<=1);
    assert.equal(result.outcome,failed?'CREDENTIAL_REQUIRES_REVIEW_NO_RETRY':'WEB_CREDENTIAL_INDEPENDENTLY_VERIFIED');
    assert.equal(events.includes('get'),!failed);assert(!JSON.stringify(records).includes(password));assert(!JSON.stringify(records).includes('postgresql://'));
  }
});
test('dedicated proof is read-only metadata with exact role OID and does not query business tables',async()=>{
  const c=client({login:true});assert((await dedicatedProof(c,target,C.roleOid)).authenticated);assert(c.calls.includes(PROOF_SQL));
  assert(!c.calls.some(s=>/FROM public\./.test(s)));assert.equal(c.calls[0],SESSION_SQL.begin);
});
test('48h approval binds exact role, policy, all source pins, baseline and raw bytes; invalid args/env fail before service access',async()=>{
  const m=manifest(),raw=JSON.stringify(m),now=Date.parse(m.issuedAt);assert.equal(validate(raw,hash(raw),now).roleOid,C.roleOid);
  for(const change of [v=>v.scope.awsWritesMax=4,v=>v.roleOid='999',v=>v.policy.Statement[0].Effect='Allow',v=>v.versionId='AWSCURRENT',
    v=>v.querySha256='0'.repeat(64),v=>v.sourcePins.pop(),v=>v.expiresAt='2026-10-25T20:00:00Z']){const v=structuredClone(m);change(v);const t=JSON.stringify(v);assert.throws(()=>validate(t,hash(t),now));}
  assert.throws(()=>validate(raw,hash(raw),Date.parse(m.latestStartAt)));assert.throws(()=>validate(raw,'0'.repeat(64),now));
  await assert.rejects(main(['InstallReviewed','bad','a'.repeat(64)]),/CREDENTIAL_INSTALL_ARGUMENTS/);
  awsEnvironment({});for(const env of [{AWS_PROFILE:'other'},{AWS_ENDPOINT_URL:'https://evil'},{AWS_ACCESS_KEY_ID:'secret'}])assert.throws(()=>awsEnvironment(env));
  assert.equal(safeCode({code:'28P01',message:'password='+password}),'28P01');assert.equal(safeCode({message:'postgresql://secret'}),'CREDENTIAL_OPERATION_FAILED');
});
test('No-AWS CI cannot obtain production env/OIDC or dispatch/upload/deploy; template references frozen stage risk',async()=>{
  const w=load(await readFile(new URL('../'+CI_PATH,import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.candidate.environment,undefined);
  assert.match(w.jobs.candidate.services.postgres.image,/@sha256:/);assert(w.jobs.candidate.steps.some(s=>s.name==='Real password authentication and one-shot credential flow on PostgreSQL'));
  assert.doesNotMatch(JSON.stringify(w),/secrets\.|id-token|aws-actions|upload-artifact|workflow_dispatch|InstallReviewed|docker build/);
  assert(SOURCES.includes(RISK));
});
