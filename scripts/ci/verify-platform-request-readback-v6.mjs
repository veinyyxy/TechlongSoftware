// Exact new SELECT projection on disposable PostgreSQL only. No production URL.
import assert from 'node:assert/strict';
import pg from 'pg';
import {REQUEST_STATE_SQL_V6} from '../../ops/platform-request-v6/state.mjs';
import {REQUEST_ADMIN_V6} from '../../lib/deployments/reviewed-request-window-v6.ts';
import {INITIALIZED_PLATFORM_SCOPE as S} from '../../lib/deployments/initialized-platform-request-v1.ts';
assert.equal(process.env.GITHUB_ACTIONS,'true');const port=Number(process.env.PLATFORM_CONTROL_CI_PORT);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const base={host:'127.0.0.1',port,user:'postgres',password:'controller-ci-only-bootstrap',database:'postgres'},db='request_readback_v6_ci';
const admin=new pg.Client(base);await admin.connect();let client,created=false;
try{
  await admin.query('CREATE DATABASE '+db);created=true;client=new pg.Client({...base,database:db});await client.connect();
  await client.query(`CREATE TABLE public.users(id text PRIMARY KEY,email text,status text,is_platform_admin int);
    CREATE TABLE public.deployment_jobs(id text PRIMARY KEY,deployment_id text,job_type text,status text,payload text,attempts int,max_attempts int,
      available_at bigint,created_at bigint,updated_at bigint,completed_at bigint,lease_token text,lease_owner text,lease_expires_at bigint);`);
  await client.query('INSERT INTO public.users VALUES($1,$2,$3,1)',[REQUEST_ADMIN_V6,'veinyang@gmail.com','active']);
  await client.query(`INSERT INTO public.deployment_jobs VALUES($1,$2,'reconcile','pending',$3,0,1,9007199254740991,1792529000000,1792529000000,NULL,$4,NULL,NULL)`,
    ['job_'+'a'.repeat(24),S.deploymentId,JSON.stringify({kind:'express_initialized_request_v4',scope:S}),'SYNTHETIC_LEASE_NEVER_RETURN']);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const r=await client.query(REQUEST_STATE_SQL_V6,[S.deploymentId,REQUEST_ADMIN_V6]);
  assert.equal(r.rowCount,1);assert.equal(r.rows[0].jobs.length,1);const j=r.rows[0].jobs[0];
  assert.equal(j.available_at,Number.MAX_SAFE_INTEGER);assert.equal(j.created_at,1792529000000);assert.equal(j.leasePresent,true);
  assert.equal(j.payload.kind,'express_initialized_request_v4');assert.equal(r.rows[0].admin.id,REQUEST_ADMIN_V6);
  assert.doesNotMatch(JSON.stringify(r.rows),/SYNTHETIC_LEASE_NEVER_RETURN|lease_token|lease_owner|lease_expires_at/);
  const empty=await client.query(REQUEST_STATE_SQL_V6,['dep_no_rows',REQUEST_ADMIN_V6]);assert.deepEqual(empty.rows[0].jobs,[]);
  const noAdmin=await client.query(REQUEST_STATE_SQL_V6,[S.deploymentId,'usr_absent']);assert.equal(noAdmin.rows[0].admin,null);
  await client.query('COMMIT');console.log('PASSED_REAL_POSTGRESQL_REQUEST_SAFE_PROJECTION_INT8_JSON_LEASE_REDACTION');
}finally{if(client)await client.end();if(created)await admin.query('DROP DATABASE '+db);await admin.end();}
