// Actual bound publisher queries on a disposable GitHub PostgreSQL service.
// This has no Neon URL, AWS client, GitHub App key or production fallback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {platformFixtureV6} from '../../tests/fixtures/platform-cloud-v6.mjs';
import {createTrustedPublisherV6} from '../../ops/platform-cloud-v6/publisher.mjs';
import {CONTROL_SCOPE as S} from '../../lib/deployments/controller-v6/contract.ts';
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
  await owner.query(await readFile(new URL('../../ops/platform-controller-v6/install.sql',import.meta.url),'utf8'));
  await owner.query(`ALTER ROLE ${S.databaseRole} LOGIN PASSWORD '${password}'`); // temporary CI only
  worker=new pg.Client({...base,database:dbName,user:S.databaseRole,password});await worker.connect();
  f.ports.writeOwner=q=>owner.query(q.text,q.values);
  f.ports.loadPlan=async sha=>(await worker.query('SELECT deployment_control_v6.load_plan($1) v',[sha])).rows[0].v;
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
  const ref=await f.resultFor(v.plan,'123456789');
  await assert.rejects(publisher.publishSuccessor(v.planSha256,ref));
  const attested=await publisher.attestResult(v.planSha256,ref);
  assert.equal((await f.ports.loadPlan(v.planSha256)).attempt.proofSha256,attested.proofSha256);
  const next=await publisher.publishSuccessor(v.planSha256,ref);
  await worker.query('SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)',[next.planSha256,next.actionSha256,f.release.riskSha256,adminId]);
  assert.deepEqual((await owner.query('SELECT * FROM public.deployment_jobs')).rows,before);
  checks.push('validated real manifest attestation enables original-window RunOnce intent while business job stays unchanged');
  console.log(JSON.stringify({outcome:'PASSED_REAL_PUBLISHER_POSTGRESQL_18',checks,productionDatabaseTouched:false,githubOrAwsCalls:0,
    realNeonCompatibilityVerified:false,appActorObserved:false,fixtureBusinessTablesOnly:true}));
} finally {
  await worker?.end();await owner?.end();
  if(created)await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  if(created)await admin.query(`DROP ROLE IF EXISTS ${S.databaseRole}`);
  if(roleCreated)await admin.query(`DROP ROLE ${ownerName}`);
  await admin.end();
}
