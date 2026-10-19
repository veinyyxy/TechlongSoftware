// Exact candidate SQL on disposable GitHub PostgreSQL only, never Neon/AWS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { CONTROL_SCOPE as S, validatePlan } from '../../lib/deployments/controller-v6/contract.ts';
import { sha256Hex } from '../../lib/deployments/execution/hash.ts';
import { controlPlanFixture, TEST_RELEASE } from '../../tests/fixtures/platform-controller-v6.ts';

assert.equal(process.env.GITHUB_ACTIONS,'true');
const port=Number(process.env.PLATFORM_CONTROL_CI_PORT);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const base={host:'127.0.0.1',port,user:'postgres',password:'controller-ci-only-bootstrap',database:'postgres'};
const ownerName='controller_owner_ci',dbName='controller_v6_ci',password='controller-ci-only-password';
const admin=new pg.Client(base);await admin.connect();
let owner,worker,second,dbCreated=false,ownerCreated=false;const checks=[];
try{
  assert.match((await admin.query('SELECT version() v')).rows[0].v,/PostgreSQL 18\.6/);
  await admin.query(`CREATE ROLE ${ownerName} LOGIN CREATEROLE NOINHERIT NOSUPERUSER NOCREATEDB PASSWORD '${password}'`);ownerCreated=true;
  await admin.query(`CREATE DATABASE ${dbName} OWNER ${ownerName}`);dbCreated=true;
  owner=new pg.Client({...base,database:dbName,user:ownerName,password});await owner.connect();
  await owner.query(`CREATE TABLE public.users(id text PRIMARY KEY,status text,is_platform_admin int);
    CREATE TABLE public.app_instance_deployments(id text PRIMARY KEY,app_instance_id text,mode text,status text);
    CREATE TABLE public.deployment_jobs(id text PRIMARY KEY,deployment_id text,job_type text,status text,attempts int,
      max_attempts int,lease_owner text,available_at bigint,payload text);`);
  const adminId='usr_'+'a'.repeat(24),userId='usr_'+'b'.repeat(24),plan=await controlPlanFixture(),now=Date.now();
  plan.preparedAt=now-1000;plan.expiresAt=now+600000;
  const v=await validatePlan(plan,TEST_RELEASE,now);
  await owner.query('INSERT INTO public.users VALUES($1,$2,$3),($4,$2,0)',[adminId,'active',1,userId]);
  await owner.query('INSERT INTO public.app_instance_deployments VALUES($1,$2,$3,$4)',[S.deploymentId,S.instanceId,'aws_sandbox','ready']);
  await owner.query('INSERT INTO public.deployment_jobs VALUES($1,$2,$3,$4,0,1,NULL,$5,$6)',
    [plan.jobId,S.deploymentId,'reconcile','pending','9007199254740991',JSON.stringify({kind:'express_initialized_request_v4'})]);
  const originalJob=(await owner.query('SELECT * FROM public.deployment_jobs')).rows;
  const ddl=await readFile(new URL('../../ops/platform-controller-v6/install.sql',import.meta.url),'utf8');
  await owner.query(ddl);
  const role=(await admin.query('SELECT rolcanlogin,rolsuper,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=$1',[S.databaseRole])).rows[0];
  assert.deepEqual(role,{rolcanlogin:false,rolsuper:false,rolcreaterole:false,rolinherit:false});checks.push('non-superuser installs exact SQL with a locked NOLOGIN role');
  await assert.rejects(owner.query(ddl),/CONTROL_INSTALL_SLOT_OCCUPIED/);await owner.query('ROLLBACK');checks.push('occupied installation fails; no automatic merge or reset');
  // Activation is ONLY for this temporary CI role, never a production action.
  await owner.query(`ALTER ROLE ${S.databaseRole} LOGIN PASSWORD '${password}'`);
  worker=new pg.Client({...base,database:dbName,user:S.databaseRole,password});await worker.connect();
  second=new pg.Client({...base,database:dbName,user:S.databaseRole,password});await second.connect();
  for(const sql of ['SELECT * FROM public.users','SELECT * FROM deployment_control_v6.plans',
    "SELECT deployment_control_v6.publish_plan('x','x','x','{}')","SELECT deployment_control_v6.attest_evidence('x','x')",
    'DELETE FROM public.deployment_jobs','CREATE TABLE public.escape(id int)'])await assert.rejects(worker.query(sql));
  checks.push('controller cannot read business tables, mutate tables, publish plans or attest proof');
  await owner.query('SELECT deployment_control_v6.publish_plan($1,$2,$3,$4)',[v.planSha256,v.actionSha256,plan.riskSha256,JSON.stringify(plan)]);
  const beginArgs=[v.planSha256,v.actionSha256,plan.riskSha256,adminId],begin='SELECT deployment_control_v6.begin_dispatch($1,$2,$3,$4)';
  await assert.rejects(worker.query(begin,[...beginArgs.slice(0,3),userId]),/CONTROL_ADMIN_REQUIRED/);
  await assert.rejects(worker.query(begin,[v.planSha256,'0'.repeat(64),plan.riskSha256,adminId]),/CONTROL_APPROVAL_EXPIRED_OR_CHANGED/);
  assert.equal((await owner.query('SELECT count(*)::int n FROM deployment_control_v6.approvals')).rows[0].n,0);
  checks.push('wrong admin/action reject atomically without approval or intent');
  const race=await Promise.allSettled([worker.query(begin,beginArgs),second.query(begin,beginArgs)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await owner.query('SELECT count(*)::int n FROM deployment_control_v6.dispatch_attempts')).rows[0].n,1);
  checks.push('real concurrent submissions create exactly one durable intent');
  await worker.query('SELECT deployment_control_v6.assert_live($1)',[v.planSha256]);
  await worker.query('SELECT deployment_control_v6.acknowledge($1,$2)',[v.planSha256,'123']);
  await worker.query('SELECT deployment_control_v6.mark_unknown($1)',[v.planSha256]);
  assert.equal((await worker.query('SELECT deployment_control_v6.load_plan($1) v',[v.planSha256])).rows[0].v.attempt.state,'ACKNOWLEDGED');
  checks.push('unknown handling cannot overwrite an already committed ACK');
  await worker.query('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',[v.planSha256,'123','completed','success']);
  await assert.rejects(worker.query('SELECT deployment_control_v6.observe_run($1,$2,$3,$4)',[v.planSha256,'123','in_progress',null]),/OBSERVATION_CONFLICT/);
  const next=structuredClone(plan);next.mode='RunOnce';next.inputs.mode='RunOnce';next.inputs.manifestSha='2'.repeat(64);
  next.inputs.manifest=JSON.stringify({key:`worker-v5/${S.instanceId}/${plan.jobId}/${next.inputs.manifestSha}/manifest.json`,versionId:'fixture',sha256:'3'.repeat(64)});
  next.predecessor={planSha256:v.planSha256,runId:'123',proofSha256:'4'.repeat(64)};
  const nv=await validatePlan(next,TEST_RELEASE,now);
  await owner.query('SELECT deployment_control_v6.publish_plan($1,$2,$3,$4)',[nv.planSha256,nv.actionSha256,next.riskSha256,JSON.stringify(next)]);
  await assert.rejects(worker.query(begin,[nv.planSha256,nv.actionSha256,next.riskSha256,adminId]),/PREDECESSOR_NOT_ATTESTED/);
  checks.push('GitHub success alone cannot authorize RunOnce; terminal observations cannot regress');
  await owner.query('SELECT deployment_control_v6.attest_evidence($1,$2)',[v.planSha256,'4'.repeat(64)]);
  await worker.query(begin,[nv.planSha256,nv.actionSha256,next.riskSha256,adminId]);
  await worker.query('SELECT deployment_control_v6.mark_unknown($1)',[nv.planSha256]);
  const refreshed=structuredClone(next);refreshed.preparedAt++;refreshed.expiresAt++;
  const rv=await validatePlan(refreshed,TEST_RELEASE,now);
  await owner.query('SELECT deployment_control_v6.publish_plan($1,$2,$3,$4)',[rv.planSha256,rv.actionSha256,refreshed.riskSha256,JSON.stringify(refreshed)]);
  await assert.rejects(worker.query(begin,[rv.planSha256,rv.actionSha256,refreshed.riskSha256,adminId]),/unique constraint/);
  assert.equal((await owner.query('SELECT count(*)::int n FROM deployment_control_v6.approvals WHERE plan_sha=$1',[rv.planSha256])).rows[0].n,0);
  checks.push('refreshed plan cannot bypass permanent job/mode slot; approval rolls back on conflict');
  assert.deepEqual((await owner.query('SELECT * FROM public.deployment_jobs')).rows,originalJob);
  const status=(await worker.query('SELECT deployment_control_v6.status() v')).rows[0].v;
  assert.equal(status.length,3);assert.equal(status.find(r=>r.planSha256===rv.planSha256).state,'SLOT_OCCUPIED');
  assert.equal(await sha256Hex(plan),v.planSha256);checks.push('candidate ledger leaves original business job and immutable plan unchanged');
  console.log(JSON.stringify({outcome:'PASSED_REAL_POSTGRESQL_18',checks,productionDatabaseTouched:false,neonForwardingVerified:false,
    userPrivateKeyRead:false,githubOrAwsCalls:0,cleanup:'disposable CI service only'}));
}finally{
  await second?.end();await worker?.end();await owner?.end();
  if(dbCreated)await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  if(dbCreated)await admin.query(`DROP ROLE IF EXISTS ${S.databaseRole}`);
  if(ownerCreated)await admin.query(`DROP ROLE ${ownerName}`);
  await admin.end();
}
