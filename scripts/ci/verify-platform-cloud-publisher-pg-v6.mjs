// Actual bound publisher queries on a disposable GitHub PostgreSQL service.
// This has no Neon URL, AWS client, GitHub App key or production fallback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {platformFixtureV6} from '../../tests/fixtures/platform-cloud-v6.mjs';
import {createTrustedPublisherV6} from '../../ops/platform-cloud-v6/publisher.mjs';
import {CONTROL_SCOPE as S} from '../../lib/deployments/controller-v6/contract.ts';
import {readControlCatalog} from '../../ops/platform-controller-review-v6/catalog.mjs';
import {assertAbsent,assertInstalled,sqlContract} from '../../ops/platform-controller-review-v6/install.mjs';
import {createPublisherDatabaseV6} from '../../ops/platform-publisher-v6/io.mjs';
import {readControlPrivilegesV6,inspectControlPrivilegesV6} from '../../ops/platform-publisher-v6/privileges.mjs';
import {assessLegacyCompatibilityV6} from '../../ops/platform-activation-v6/compatibility.mjs';
import {roleLoginSqlV6,A} from '../../ops/platform-activation-v6/credentials.mjs';
import {sha256Hex} from '../../lib/deployments/execution/hash.ts';
assert.equal(process.env.GITHUB_ACTIONS,'true');
const port=Number(process.env.PLATFORM_CONTROL_CI_PORT);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const base={host:'127.0.0.1',port,user:'postgres',password:'controller-ci-only-bootstrap',database:'postgres'};
const ownerName='cloud_publisher_owner_ci',dbName='cloud_publisher_v6_ci',password='publisher-ci-only-password';
const admin=new pg.Client(base);await admin.connect();let owner,worker,created=false,roleCreated=false;const checks=[];
try {
  assert.match((await admin.query('SELECT version() v')).rows[0].v,/PostgreSQL 18\.6/);
  await admin.query(`CREATE ROLE ${ownerName} LOGIN CREATEROLE NOINHERIT NOSUPERUSER NOCREATEDB PASSWORD '${password}'`);roleCreated=true;
  await admin.query(`CREATE DATABASE ${dbName} OWNER ${ownerName}`);created=true;
  owner=new pg.Client({...base,database:dbName,user:ownerName,password});await owner.connect();
  await owner.query(`CREATE TABLE public.users(id text PRIMARY KEY,status text,is_platform_admin int);
    CREATE TABLE public.app_instance_deployments(id text PRIMARY KEY,app_instance_id text,mode text,status text);
    CREATE TABLE public.deployment_jobs(id text PRIMARY KEY,deployment_id text,job_type text,status text,attempts int,
      max_attempts int,lease_owner text,available_at bigint,payload text);`);
  const f=await platformFixtureV6(),j=f.observed.job,adminId=f.observed.requester.id;
  await owner.query('INSERT INTO public.users VALUES($1,$2,1)',[adminId,'active']);
  await owner.query('INSERT INTO public.app_instance_deployments VALUES($1,$2,$3,$4)',[S.deploymentId,S.instanceId,'aws_sandbox','ready']);
  await owner.query('INSERT INTO public.deployment_jobs VALUES($1,$2,$3,$4,0,1,NULL,$5,$6)',[j.id,S.deploymentId,'reconcile','pending',String(j.available_at),j.payload]);
  const before=(await owner.query('SELECT * FROM public.deployment_jobs')).rows;
  const ddl=(await readFile(new URL('../../ops/platform-controller-v6/install.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
  const pre=await readControlCatalog(owner);assertAbsent(pre);
  const installedBatch=await owner.query(ddl);assert.equal(installedBatch.at(-1).command,'COMMIT');
  const catalogProof=assertInstalled(await readControlCatalog(owner),sqlContract(ddl),pre);
  assert.equal(catalogProof.roleLogin,false);assert.equal(catalogProof.functions,9);assert.equal(catalogProof.emptyTables,3);
  console.log(JSON.stringify({outcome:'PASSED_REAL_CONTROL_INSTALL_CATALOG_POSTGRESQL_18',verified:catalogProof,productionDatabaseTouched:false}));
  const audit=()=>readControlPrivilegesV6(owner).then(c=>inspectControlPrivilegesV6(c,catalogProof.roleOid));
  assert.equal((await audit()).activationPreflightPassed,true);
  await owner.query(`GRANT SELECT(id) ON public.users TO ${S.databaseRole}`); // disposable CI negative assertion only
  assert.ok((await audit()).blockers.includes('relation_or_column_rights'));
  await owner.query(`REVOKE SELECT(id) ON public.users FROM ${S.databaseRole}`);
  await owner.query(`CREATE FUNCTION public.publisher_public_exec_ci() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
  assert.ok((await audit()).blockers.includes('unexpected_executable_functions'));
  await owner.query('REVOKE EXECUTE ON FUNCTION public.publisher_public_exec_ci() FROM PUBLIC');
  assert.equal((await audit()).activationPreflightPassed,true);
  for(let i=0;i<27;i++)await owner.query(`CREATE FUNCTION public.legacy_trigger_ci_${String(i).padStart(2,'0')}() RETURNS trigger
    LANGUAGE plpgsql AS 'BEGIN PERFORM 1 FROM public.users; RETURN NEW; END'`);
  const legacyCatalog=await readControlPrivilegesV6(owner),legacyProposal={schema:'techlong/platform-legacy-invoker-trigger-compatibility-proposal/v6',
    serviceRoleOid:catalogProof.roleOid,expectedFunctionOwnerOid:pre.installer.oid,functionCount:27,
    functions:legacyCatalog.unexpected_executable_functions,functionSnapshotSha256:await sha256Hex(legacyCatalog.unexpected_executable_functions)};
  assert.equal((await assessLegacyCompatibilityV6(legacyCatalog,legacyProposal)).eligibleForReviewedCredentialInstall,true);
  assert.equal((await audit()).activationPreflightPassed,false); // strict default still blocks; no silent allowlist
  const expected={ownerRole:ownerName,ownerOid:pre.installer.oid,database:dbName,roleOid:catalogProof.roleOid,schemaOid:catalogProof.schemaOid};
  const database=budget=>createPublisherDatabaseV6({client:owner,expected,contract:sqlContract(ddl),release:f.release,now:f.now,maxWrites:budget});
  let dbPort=database(1);await dbPort.verify();
  const controllerPassword='A'.repeat(64),productionRoleSql=roleLoginSqlV6(controllerPassword);
  const ciRoleSql=productionRoleSql.replace('oid='+A.roleOid,'oid='+catalogProof.roleOid);
  assert.notEqual(ciRoleSql,productionRoleSql);assert.equal(ciRoleSql.replace('oid='+catalogProof.roleOid,'oid='+A.roleOid),productionRoleSql);
  assert.equal((await owner.query(ciRoleSql)).at(-1).command,'COMMIT'); // only the CI-specific role OID is substituted
  worker=new pg.Client({...base,database:dbName,user:S.databaseRole,password:controllerPassword});await worker.connect();
  assert.equal((await assessLegacyCompatibilityV6(await readControlPrivilegesV6(owner),legacyProposal,{expectedLogin:true})).eligibleForReviewedCredentialInstall,true);
  await assert.rejects(worker.query('SELECT public.legacy_trigger_ci_00()'),/trigger/i);
  await worker.query('CREATE TEMP TABLE invoker_trigger_ci_probe(id text)');
  await worker.query('CREATE TRIGGER invoker_ci BEFORE INSERT ON invoker_trigger_ci_probe FOR EACH ROW EXECUTE FUNCTION public.legacy_trigger_ci_00()');
  await assert.rejects(worker.query("INSERT INTO invoker_trigger_ci_probe VALUES('not-a-business-row')"),/permission denied/);
  console.log(JSON.stringify({outcome:'PASSED_REAL_EXACT_LEGACY_TRIGGER_COMPATIBILITY_POSTGRESQL_18',legacyTriggers:27,strictDefaultStillBlocks:true,
    exactSnapshotCompatibilityPassed:true,rolePasswordSqlOnlyCiOidSubstituted:true,dedicatedRoleAuthenticated:true,invokerCannotReadOwnerBusinessTable:true,
    productionDatabaseTouched:false}));
  f.ports.writeOwner=dbPort.writeOwner;
  f.ports.loadPlan=dbPort.loadPlan;
  const publisher=createTrustedPublisherV6({release:f.release,sourceCommit:f.sourceCommit,frozenSourceCommit:f.frozenSourceCommit,ports:f.ports,now:f.now});
  const v=await publisher.publishReview({jobId:j.id,installationReference:f.installationReference});
  const loaded=await f.ports.loadPlan(v.planSha256);assert.deepEqual(loaded.plan,v.plan);assert.equal(loaded.actionSha256,v.actionSha256);
  checks.push('actual publisher imports reconstructed Review through exact bound owner SQL');
  for(const sql of ["SELECT deployment_control_v6.publish_plan('x','x','x','{}')","SELECT deployment_control_v6.attest_evidence('x','x')"])
    await assert.rejects(worker.query(sql),/permission denied/);
  checks.push('platform service credential cannot publish or attest');
  await worker.query('SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)',[v.planSha256,v.actionSha256,f.release.riskSha256,adminId]);
  await worker.query('SELECT deployment_control_v6.acknowledge($1,$2)',[v.planSha256,'123456789']);
  await worker.query('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',[v.planSha256,'123456789','completed','success']);
  dbPort=database(2);await dbPort.verify();f.ports.writeOwner=dbPort.writeOwner;f.ports.loadPlan=dbPort.loadPlan;
  const ref=await f.resultFor(v.plan,'123456789');
  await assert.rejects(publisher.publishSuccessor(v.planSha256,ref));
  const attested=await publisher.attestResult(v.planSha256,ref);
  assert.equal((await f.ports.loadPlan(v.planSha256)).attempt.proofSha256,attested.proofSha256);
  const next=await publisher.publishSuccessor(v.planSha256,ref);
  await worker.query('SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)',[next.planSha256,next.actionSha256,f.release.riskSha256,adminId]);
  assert.deepEqual((await owner.query('SELECT * FROM public.deployment_jobs')).rows,before);
  checks.push('validated real manifest attestation enables original-window RunOnce intent while business job stays unchanged');
  assert.equal(dbPort.counts().ownerWriteSubmissions,2);
  console.log(JSON.stringify({outcome:'PASSED_REAL_PUBLISHER_IO_PRIVILEGE_PREFLIGHT_POSTGRESQL_18',ownerSqlAdapterUsed:true,
    columnGrantAndPublicFunctionDetected:true,implicitRetries:0,productionDatabaseTouched:false}));
  console.log(JSON.stringify({outcome:'PASSED_REAL_PUBLISHER_POSTGRESQL_18',checks,productionDatabaseTouched:false,githubOrAwsCalls:0,
    realNeonCompatibilityVerified:false,appActorObserved:false,fixtureBusinessTablesOnly:true}));
} finally {
  await worker?.end();await owner?.end();
  if(created)await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  if(created)await admin.query(`DROP ROLE IF EXISTS ${S.databaseRole}`);
  if(roleCreated)await admin.query(`DROP ROLE ${ownerName}`);
  await admin.end();
}
