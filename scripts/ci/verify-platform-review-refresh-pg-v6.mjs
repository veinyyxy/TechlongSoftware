// Disposable GitHub PostgreSQL only; no Neon/AWS credentials or fallback.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {refreshFixture,newReviewFixture} from '../../tests/fixtures/platform-review-refresh-v6.mjs';
import {R,LEDGER_SQL,assertRefreshLedger,refreshedPlan} from '../../ops/platform-review-v6/refresh.mjs';
import {ownerQueryV6} from '../../ops/platform-cloud-v6/publisher.mjs';
assert.equal(process.env.GITHUB_ACTIONS,'true');
const port=Number(process.env.PLATFORM_CONTROL_CI_PORT);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const config={host:'127.0.0.1',port,user:'postgres',password:'controller-ci-only-bootstrap',database:'postgres'};
const admin=new pg.Client(config);let client,created=false,installed=false;
await admin.connect();
try{
  assert.match((await admin.query('SELECT version() AS v')).rows[0].v,/PostgreSQL 18\.6/);
  await admin.query('CREATE DATABASE review_refresh_v6_ci');created=true;
  client=new pg.Client({...config,database:'review_refresh_v6_ci'});await client.connect();
  await client.query(`CREATE TABLE public.users(id text PRIMARY KEY,status text,is_platform_admin int);
    CREATE TABLE public.app_instance_deployments(id text PRIMARY KEY,app_instance_id text,mode text,status text);
    CREATE TABLE public.deployment_jobs(id text PRIMARY KEY,deployment_id text,job_type text,status text,attempts int,
      max_attempts int,lease_owner text,available_at bigint,payload text);`);
  const {m}=await refreshFixture(Math.max(Date.now(),1792811111886)),old=m.oldPlan,adminId=m.baseline.adminId;
  await client.query('INSERT INTO public.users VALUES($1,$2,1)',[adminId,'active']);
  await client.query('INSERT INTO public.app_instance_deployments VALUES($1,$2,$3,$4)',[old.plan.deploymentId,old.plan.instanceId,'aws_sandbox','ready']);
  await client.query('INSERT INTO public.deployment_jobs VALUES($1,$2,$3,$4,0,1,NULL,$5,$6)',[R.jobId,old.plan.deploymentId,'reconcile','pending','9007199254740991','{}']);
  await client.query((await readFile(new URL('../../ops/platform-controller-v6/install.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n'));installed=true;
  // Seed the real expired historical plan only in this disposable database.
  await client.query(`INSERT INTO deployment_control_v6.plans(plan_sha,action_sha,risk_sha,job_id,mode,body,expires_at)
    VALUES($1,$2,$3,$4,'Review',$5::jsonb,to_timestamp($6::double precision/1000))`,
  [old.planSha256,old.actionSha256,old.plan.riskSha256,R.jobId,JSON.stringify(old.plan),old.plan.expiresAt]);
  const before=(await client.query('SELECT * FROM public.deployment_jobs')).rows;
  async function ledger(){await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{assert.equal((await client.query("SELECT current_setting('transaction_read_only') AS v")).rows[0].v,'on');
      const r=await client.query(LEDGER_SQL,[R.jobId]);await client.query('COMMIT');return r.rows[0].value;
    }catch(e){await client.query('ROLLBACK');throw e;}}
  await assertRefreshLedger(await ledger(),m,m.createdAt);
  const at=Math.max(Date.now(),m.createdAt),next=await refreshedPlan(newReviewFixture(m,at),m,m.createdAt,at);
  const q=ownerQueryV6('plan',next);await client.query(q);
  await assertRefreshLedger(await ledger(),m,at,next);
  assert.deepEqual((await client.query('SELECT * FROM public.deployment_jobs')).rows,before);
  await assert.rejects(client.query(q),e=>e.code==='23505'); // no duplicate plan overwrite
  await client.query('BEGIN');
  try{await client.query('INSERT INTO deployment_control_v6.approvals(plan_sha,admin_id) VALUES($1,$2)',[old.planSha256,adminId]);
    await assert.rejects(assertRefreshLedger((await client.query(LEDGER_SQL,[R.jobId])).rows[0].value,m,at,next));
    await client.query('ROLLBACK');
  }catch(e){await client.query('ROLLBACK');throw e;}
  await client.query('BEGIN');
  try{for(const p of [old,next])await client.query('INSERT INTO deployment_control_v6.approvals(plan_sha,admin_id) VALUES($1,$2)',[p.planSha256,adminId]);
    await client.query("INSERT INTO deployment_control_v6.dispatch_attempts(plan_sha,job_id,mode,state) VALUES($1,$2,'Review','SUBMISSION_STARTED')",[old.planSha256,R.jobId]);
    await assert.rejects(client.query("INSERT INTO deployment_control_v6.dispatch_attempts(plan_sha,job_id,mode,state) VALUES($1,$2,'Review','SUBMISSION_STARTED')",[next.planSha256,R.jobId]),e=>e.code==='23505');
    await client.query('ROLLBACK');
  }catch(e){await client.query('ROLLBACK');throw e;}
  await assertRefreshLedger(await ledger(),m,at,next);
  console.log(JSON.stringify({outcome:'PASSED_REAL_APPEND_ONLY_REVIEW_REFRESH_POSTGRESQL_18',exactLedgerSqlUsed:true,oldPlanPreserved:true,
    sameJobTwoExactPlans:true,unexpectedApprovalRejected:true,permanentDispatchUniquenessKept:true,productionTouched:false,awsCalls:0}));
}finally{
  await client?.end();if(created)await admin.query('DROP DATABASE review_refresh_v6_ci WITH (FORCE)');
  if(installed)await admin.query('DROP ROLE techlong_deployment_controller_v6');await admin.end();
}
