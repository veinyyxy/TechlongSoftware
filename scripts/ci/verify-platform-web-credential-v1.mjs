// Real disposable PostgreSQL + in-memory AWS double. No production config or AWS calls.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readCatalog} from '../../ops/platform-web-database-v1/catalog.mjs';
import {PROFILE,ROLE} from '../../ops/platform-web-database-role-v1/contract.mjs';
import {installTransaction} from '../../ops/platform-web-database-role-v1/install.mjs';
import {C,parseMaterial,sourceOnlyPolicy} from '../../ops/platform-web-credential-v1/contract.mjs';
import {activate} from '../../ops/platform-web-credential-v1/database.mjs';
import {installOnce} from '../../ops/platform-web-credential-v1/install.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.DATABASE_URL,undefined);
const port=Number(process.env.WEB_CREDENTIAL_CI_PORT);assert(Number.isInteger(port)&&port>1024&&port<65536);
const base={host:'127.0.0.1',port,ssl:false,options:'-c neon.forward_ddl=on'},clients=[];
async function connect(config,tracked=true){const c=new pg.Client({...base,...config});await c.connect();if(tracked)clients.push(c);return c;}
try{
  const admin=await connect({user:'postgres',password:'web-credential-ci-only',database:'postgres'});
  await admin.query("CREATE ROLE web_credential_ci_owner LOGIN CREATEROLE NOINHERIT PASSWORD 'owner-ci-only'");
  await admin.query('CREATE DATABASE web_credential_ci OWNER web_credential_ci_owner');
  const ownerCfg={user:'web_credential_ci_owner',password:'owner-ci-only',database:'web_credential_ci'},owner=await connect(ownerCfg);
  for(const n of PROFILE.selectTables)await owner.query(`CREATE TABLE public.${n}(id text)`);
  await owner.query(`CREATE TABLE public.user_credentials(user_id text,password_hash text,password_salt text,password_iterations int,
    failed_attempts int,locked_until bigint,updated_at bigint,password_changed_at bigint);
    CREATE TABLE public.auth_sessions(id text,user_id text,token_hash text,expires_at bigint,last_seen_at bigint,created_at bigint);`);
  const target={host:'ep-disposable-only.ca-central-1.aws.neon.tech',port:5432,database:ownerCfg.database,actor:ownerCfg.user},expected={actor:target.actor,database:target.database},empty=await readCatalog(owner,expected);
  const expiresAt=new Date(Date.now()+300000).toISOString();let roleOid;
  await installTransaction({client:owner,target:expected,baseline:empty,expiresAt,roleIdentity:async oid=>{roleOid=oid;},record:async()=>{}});
  const baseline=await readCatalog(owner,expected),fixed='R'.repeat(64);
  // A separate failure fixture, not production replay. Custom GUC is NOT a Neon hook emulation.
  await assert.rejects(activate({client:owner,target:expected,baseline,password:fixed,expiresAt,record:async name=>{if(name==='activation-post')throw Error('CI_PRECOMMIT_STOP');}}),/CI_PRECOMMIT_STOP/);
  assert.equal((await readCatalog(owner,expected)).identity.candidate_role.login,false);
  const manifest={target,roleOid,nonce:'disposable-ci',versionId:'abcd1234-1234-4123-8123-123456789abc',expiresAt,
    inventory:{source:{Account:C.account,Arn:C.sourceArn,UserId:C.sourceId},kms:{arn:'disposable-ci-only'}}};
  const events=[],records=[],arn='arn:aws:secretsmanager:ca-central-1:402010193138:secret:'+C.secretName+'-CiOnly',counts={reads:0,writes:0,secretValueReads:0};
  let value,protection,ownerCount=0;
  const aws={calls:counts,inventory:async()=>manifest.inventory,source:async()=>{},
    createEmpty:async()=>{counts.writes++;events.push('create');return arn;},protect:async()=>{counts.writes++;events.push('protect');protection=sourceOnlyPolicy();},
    metadata:async()=>{assert(protection);counts.reads++;return {arn,versionId:manifest.versionId};},
    put:async(a,v,m)=>{assert.equal(a,arn);assert.equal(v,manifest.versionId);assert(protection);counts.writes++;events.push('put');value=m;},
    get:async(a,v)=>{assert.equal(a,arn);assert.equal(v,manifest.versionId);assert.equal(counts.secretValueReads++,0);events.push('get');return value;}};
  const result=await installOnce({manifest,sha:'c'.repeat(64),baseline,io:{aws,consume:async()=>events.push('consume'),setSensitive:()=>{},
    record:async(name,v)=>records.push({name,value:v}),owner:async()=>{ownerCount++;return connect(ownerCfg,false);},
    dedicated:async password=>connect({...ownerCfg,user:ROLE,password},false)}});
  assert.equal(result.outcome,'WEB_CREDENTIAL_INDEPENDENTLY_VERIFIED');assert.equal(result.dedicatedProof.roleOid,roleOid);
  assert.deepEqual(events,['consume','create','protect','put','get']);assert.equal(ownerCount,2);assert.equal(counts.writes,3);assert.equal(counts.secretValueReads,1);
  const actualPassword=parseMaterial(value,target),recordText=JSON.stringify(records);assert(!recordText.includes(actualPassword));assert(!recordText.includes('postgresql://'));
  const wrong=new pg.Client({...base,...ownerCfg,user:ROLE,password:'deliberately-wrong-ci-only'});
  try{await assert.rejects(wrong.connect(),e=>e.code==='28P01');}finally{await wrong.end();}
  console.log(JSON.stringify({outcome:'WEB_CREDENTIAL_SQL_VERIFIED_ON_DISPOSABLE_PG',neonCompatibleRawPasswordSql:true,
    atomicRollbackVerified:true,actualPasswordAuthentication:true,wrongPasswordDenied:true,exactIndependentMetadata:true,
    sourceOnlyPolicyBeforeValue:true,fixedVersionReadOnce:true,noSensitiveReceipt:true,awsServiceDoubleOnly:true,
    productionConnections:0,awsCalls:0}));
}finally{for(const c of clients.reverse())await c.end();}
