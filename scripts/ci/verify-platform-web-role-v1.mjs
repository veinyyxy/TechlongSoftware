// Fake data on a disposable GitHub service only. Never load production configuration.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readCatalog} from '../../ops/platform-web-database-v1/catalog.mjs';
import {PROFILE,ROLE,assertBaseline,assertFresh} from '../../ops/platform-web-database-role-v1/contract.mjs';
import {installTransaction,independentRead} from '../../ops/platform-web-database-role-v1/install.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.DATABASE_URL,undefined);
const port=Number(process.env.WEB_ROLE_CI_PORT);assert(Number.isInteger(port)&&port>1024&&port<65536);
const base={host:'127.0.0.1',port,ssl:false},adminConfig={...base,user:'postgres',password:'web-role-ci-only',database:'postgres'};
const clients=[];
async function connect(config){const c=new pg.Client(config);await c.connect();clients.push(c);return c;}
try{
  const admin=await connect(adminConfig);
  await admin.query("CREATE ROLE web_role_ci_owner LOGIN CREATEROLE NOINHERIT PASSWORD 'web-owner-ci-only'");
  await admin.query('CREATE DATABASE web_role_ci OWNER web_role_ci_owner');
  const config={...base,database:'web_role_ci',user:'web_role_ci_owner',password:'web-owner-ci-only'},owner=await connect(config);
  for(const name of PROFILE.selectTables)await owner.query(`CREATE TABLE public.${name}(id text PRIMARY KEY)`);
  await owner.query(`CREATE TABLE public.user_credentials(user_id text,password_hash text,password_salt text,password_iterations int,
    failed_attempts int,locked_until bigint,updated_at bigint,password_changed_at bigint);
    CREATE TABLE public.auth_sessions(id text,user_id text,token_hash text,expires_at bigint,last_seen_at bigint,created_at bigint);
    CREATE TABLE public.auth_invitations(id text);
    CREATE SEQUENCE public.web_role_ci_sequence;
    CREATE SCHEMA controller;
    CREATE TABLE controller.authority(id text);
    INSERT INTO public.users VALUES ('fake-ci-user');
    INSERT INTO public.user_credentials VALUES ('fake-ci-user','fake-ci-hash','fake-ci-salt',1,0,NULL,1,1);`);
  const target={actor:'web_role_ci_owner',database:'web_role_ci'},baseline=await readCatalog(owner,target);assertBaseline(baseline);
  const expiresAt=new Date(Date.now()+300000).toISOString();let rollbackObserved=false,roleOid;
  // Deliberate pre-COMMIT failure is one separate disposable test case, never a production retry.
  await assert.rejects(installTransaction({client:owner,target,baseline,expiresAt,roleIdentity:async()=>{},
    record:async name=>{if(name==='before-commit')throw Error('CI_INJECTED_PRECOMMIT_FAILURE');if(name==='rollback')rollbackObserved=true;}}),/CI_INJECTED_PRECOMMIT_FAILURE/);
  assert(rollbackObserved);assertFresh(await readCatalog(owner,target),baseline);
  const result=await installTransaction({client:owner,target,baseline,expiresAt,roleIdentity:async oid=>{roleOid=oid;},record:async()=>{}});
  assert(result.commitAcknowledged);
  const reader=await connect(config),observed=await independentRead({client:reader,target,baseline,roleOid,record:async()=>{}});
  assert.equal(observed.state,'EXACT_NOLOGIN_ROLE_OBSERVED');assert.equal(observed.installed.creatorAdmin,true);
  const user=await connect({...adminConfig,database:'web_role_ci'});
  await user.query(`SET ROLE ${ROLE}`); // CI superuser only, never grant SET or LOGIN to the Web role.
  await user.query('SELECT u.id,c.password_hash,c.password_salt,c.password_iterations,c.failed_attempts,c.locked_until FROM public.users u JOIN public.user_credentials c ON c.user_id=u.id');
  await user.query('UPDATE public.user_credentials SET failed_attempts=1,locked_until=NULL,updated_at=2');
  await user.query("INSERT INTO public.auth_sessions VALUES ('ci-session','fake-ci-user','fake-token-hash',1,1,1)");
  await user.query('SELECT * FROM public.auth_sessions');await user.query('DELETE FROM public.auth_sessions');
  for(const name of PROFILE.selectTables)await user.query(`SELECT * FROM public.${name} LIMIT 0`);
  const forbidden=['SELECT password_changed_at FROM public.user_credentials',"UPDATE public.user_credentials SET password_hash='changed'",
    "UPDATE public.users SET id='changed'","INSERT INTO public.workspaces VALUES ('forbidden')","UPDATE public.deployment_jobs SET id='changed'",
    'SELECT * FROM controller.authority','SELECT * FROM public.auth_invitations','CREATE TABLE public.forbidden_table(id int)','CREATE ROLE forbidden_role'];
  for(const sql of forbidden)await assert.rejects(user.query(sql),e=>e.code==='42501');
  await user.query('CREATE TEMP TABLE inherited_public_temp(id int)');
  console.log(JSON.stringify({outcome:'NOLOGIN_ROLE_SQL_VERIFIED_ON_DISPOSABLE_PG',rollbackVerified:true,exactGrants:true,
    forbiddenOperationsDenied:forbidden.length,creatorAdminOnly:true,publicTemporaryStillEffective:true,
    independentReadback:true,productionConnections:0,awsCalls:0}));
}finally{for(const c of clients.reverse())await c.end();}
