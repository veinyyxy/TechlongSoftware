// Disposable GitHub PostgreSQL only; never imports a production connection configuration.
import assert from 'node:assert/strict';
import pg from 'pg';
import {PROFILE,ROLE,readCatalog,assess} from '../../ops/platform-web-database-v1/catalog.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.DATABASE_URL,undefined);
const port=Number(process.env.WEB_DB_CI_PORT);assert(Number.isInteger(port)&&port>1024&&port<65536);
const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'web-catalog-ci-only',database:'postgres',ssl:false});
await c.connect();
try{
  for(const name of PROFILE.selectTables)await c.query(`CREATE TABLE public.${name}(id text PRIMARY KEY)`);
  await c.query(`CREATE TABLE public.user_credentials(user_id text,password_hash text,password_salt text,password_iterations int,
    failed_attempts int,locked_until bigint,updated_at bigint);
    CREATE TABLE public.auth_sessions(id text,user_id text,token_hash text,expires_at bigint,last_seen_at bigint,created_at bigint);
    CREATE SEQUENCE public.web_catalog_sequence_v1;
    CREATE TABLE public.web_catalog_private_fixture_v1(value text);
    INSERT INTO public.web_catalog_private_fixture_v1 VALUES ('PRIVATE_BUSINESS_ROW_MUST_NOT_BE_READ');
    CREATE FUNCTION public.web_catalog_never_call_v1() RETURNS int LANGUAGE plpgsql SECURITY DEFINER
      AS $$ BEGIN RAISE EXCEPTION 'FUNCTION_BODY_MUST_NOT_BE_EXPORTED_OR_EXECUTED'; END $$;
    CREATE FUNCTION public.web_catalog_trigger_v1() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'TRIGGER_MUST_NOT_FIRE'; END $$;
    CREATE TRIGGER web_catalog_trigger_v1 BEFORE INSERT ON public.auth_sessions FOR EACH ROW EXECUTE FUNCTION public.web_catalog_trigger_v1();`);
  const expected={database:'postgres',actor:'postgres'},before=await readCatalog(c,expected),analysis=assess(before);
  assert.equal(before.identity.read_only,'on');assert.equal(before.identity.candidate_role,null);
  assert.equal(analysis.missingTables.length,0);assert.equal(analysis.missingCredentialColumns.length,0);
  assert(analysis.publicDefinerPaths.some(f=>f.name==='web_catalog_never_call_v1'));
  assert(analysis.authUserTriggers.some(t=>t.name==='web_catalog_trigger_v1'));
  assert(!JSON.stringify(before).includes('FUNCTION_BODY_MUST_NOT_BE_EXPORTED_OR_EXECUTED'));
  assert(!JSON.stringify(before).includes('PRIVATE_BUSINESS_ROW_MUST_NOT_BE_READ'));
  assert.deepEqual(before.relations.find(r=>r.name==='web_catalog_sequence_v1').acl.map(a=>a.privilege).sort(),['SELECT','UPDATE','USAGE']);
  await c.query(`CREATE ROLE ${ROLE} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT SELECT(password_hash) ON public.user_credentials TO ${ROLE};
    GRANT SELECT ON public.users TO PUBLIC;`);
  const after=await readCatalog(c,expected),next=assess(after);
  assert.equal(after.identity.candidate_role.login,false);
  assert(after.relations.find(r=>r.name==='user_credentials').columns.find(col=>col.name==='password_hash').acl.length===1);
  assert(next.publicRelationGrants.some(r=>r.name==='users'));
  assert.equal(next.installationAuthorized,false);
  console.log(JSON.stringify({outcome:'CATALOG_SQL_VERIFIED_ON_DISPOSABLE_PG',metadataSelectsPerAudit:7,
    roleAbsentAndPresent:true,publicEscalationPathsVisible:true,noBusinessRowsOrFunctionBodies:true,productionConnections:0,awsCalls:0}));
}finally{await c.end();}
