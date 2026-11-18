import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { buildFirstOnboardingJob, firstOnboardingInsertBindings, INSERT_FIRST_ONBOARDING,
  FIRST_ONBOARDING_HOLD_AT, SELECT_FIRST_ONBOARDING } from '../lib/deployments/first-onboarding.ts';
import { buildDeploymentClaimStatement } from '../lib/deployments/lease.ts';
import { NeonDeploymentExecutionRepository } from '../lib/deployments/execution/neon-repository.ts';
import { sha256Hex } from '../lib/deployments/execution/hash.ts';

// Same disposable CI service as D2. No DATABASE_URL fallback or external DB access.
const testUrl=process.env.INSTANCE_RELEASE_TEST_DATABASE_URL;
test('first-onboarding native PostgreSQL: atomic outbox, stale and historical rejection, and ordinary claim isolation', {skip:!testUrl,timeout:20000}, async()=>{
  const url=new URL(testUrl);
  assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.CI,'true');
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.pathname,'/instance_release_ci');
  assert.equal(url.username,'postgres');
  const db=new pg.Client({connectionString:testUrl,statement_timeout:5000});
  await db.connect();
  try {
    await db.query(`CREATE TEMP TABLE workspaces (id text PRIMARY KEY,status text);
      CREATE TEMP TABLE subscriptions (id text PRIMARY KEY,workspace_id text,product_id text,plan_id text,template_version_id text,
        status text,current_period_start bigint,current_period_end bigint,deployment_profile_key text,instance_configuration text);
      CREATE TEMP TABLE app_instances (id text PRIMARY KEY,workspace_id text,product_id text,subscription_id text,tenant_key text,
        status text,provisioned_at bigint,provisioning_source text,access_url text,template_version_id text,configuration_snapshot text);
      CREATE TEMP TABLE deployment_environments (id text PRIMARY KEY,key text,kind text,status text,apply_enabled integer,expected_account_id text,region text,cell_key text);
      CREATE TEMP TABLE deployment_tenant_resources (app_instance_id text);
      CREATE TEMP TABLE app_instance_deployments (id text PRIMARY KEY,app_instance_id text,subscription_id text,purchase_order_id text,environment_id text,
        driver text,workflow_version text,cell_key text,deployment_profile_key text,mode text,status text,desired_plan text,plan_hash text,
        configuration_hash text,idempotency_key text UNIQUE,artifact_ref text,created_at bigint,updated_at bigint);
      CREATE TEMP TABLE deployment_jobs (id text PRIMARY KEY,deployment_id text NOT NULL REFERENCES app_instance_deployments(id));`);
    await db.query(`ALTER TABLE deployment_jobs ADD COLUMN job_type text,ADD COLUMN dedupe_key text UNIQUE,ADD COLUMN status text,
      ADD COLUMN payload text,ADD COLUMN attempts int,ADD COLUMN max_attempts int,ADD COLUMN available_at bigint,ADD COLUMN lease_owner text,
      ADD COLUMN lease_expires_at bigint,ADD COLUMN lease_token text,ADD COLUMN last_error_code text,ADD COLUMN last_error_message text,
      ADD COLUMN created_at bigint,ADD COLUMN updated_at bigint,ADD COLUMN completed_at bigint;
      CREATE TEMP TABLE deployment_cleanup_schedules (id text,deployment_id text,status text,last_error text,updated_at bigint,completed_at bigint);
      INSERT INTO deployment_environments VALUES ('env_test','aws-sandbox-ca-central-1','aws_sandbox','active',0,'111111111111','ca-central-1','cell-sandbox-1')`);
    const configuration='{"a":1}', desiredPlan='{"mode":"aws_sandbox"}', productId='prd_restaurant_order_system';
    const scope={ appInstanceId:'app_first',workspaceId:'workspace_first',subscriptionId:'sub_first',environmentId:'env_test',planId:'plan_test',
      templateVersionId:'version_test',tenantKey:'tenant_first',planHash:await sha256Hex(JSON.parse(desiredPlan)),configurationHash:await sha256Hex(JSON.parse(configuration)),
      releaseId:'release_'+'a'.repeat(32),accountId:'111111111111',artifactRef:'111111111111.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:'+'a'.repeat(64) };
    const seed=async(i,status='pending',substatus='active')=>{
      const x={...scope,appInstanceId:'app_'+i,workspaceId:'workspace_'+i,subscriptionId:'sub_'+i,tenantKey:'tenant_'+i};
      await db.query('insert into workspaces values ($1,$2)',[x.workspaceId,'active']);
      await db.query(`insert into subscriptions values ($1,$2,$3,$4,$5,$6,1,9007199254740990,'standard-v1',$7)`,
        [x.subscriptionId,x.workspaceId,productId,x.planId,x.templateVersionId,substatus,configuration]);
      await db.query(`insert into app_instances values ($1,$2,$3,$4,$5,$6,NULL,'payment_success','',$7,$8)`,
        [x.appInstanceId,x.workspaceId,productId,x.subscriptionId,x.tenantKey,status,x.templateVersionId,configuration]);
      return x;
    };
    const prepared=async s=>{const job=await buildFirstOnboardingJob(s);assert.ok(job);
      return {job,run:()=>db.query(INSERT_FIRST_ONBOARDING,firstOnboardingInsertBindings(job,{configuration,desiredPlan,purchaseOrderId:null}))};};
    await seed('first');const h=await prepared(scope);
    assert.equal((await h.run()).rows[0].id,h.job.jobId);
    assert.equal((await h.run()).rowCount,0);
    assert.equal((await db.query('select count(*)::int as n from app_instance_deployments')).rows[0].n,1);
    const row=(await db.query(SELECT_FIRST_ONBOARDING,[h.job.jobId])).rows[0];
    assert.ok(row.instancePendingFirstOpen&&row.subscriptionActiveAndCurrent&&row.scopeStillEligible&&row.noOtherDeploymentOrTenantGeneration);
    assert.equal(row.job.availableAt,FIRST_ONBOARDING_HOLD_AT);
    assert.equal(row.job.payload.cloudExecutionAuthorized,false);
    for(const s of [await seed('active','active'),await seed('expired','pending','past_due'),{...scope,subscriptionId:'sub_wrong'}])
      assert.equal((await (await prepared(s)).run()).rowCount,0);
    const old=await seed('old');
    await db.query(`insert into app_instance_deployments(id,app_instance_id,idempotency_key,status) values ('legacy_deployment',$1,'legacy','planned')`,[old.appInstanceId]);
    assert.equal((await (await prepared(old)).run()).rowCount,0);
    await db.query('update subscriptions set status=$1 where id=$2',['paused',scope.subscriptionId]);
    assert.equal((await db.query(SELECT_FIRST_ONBOARDING,[h.job.jobId])).rows[0].subscriptionActiveAndCurrent,false);
    await db.query('update deployment_jobs set available_at=0 where id=$1',[h.job.jobId]);
    const {sql,bindings}=buildDeploymentClaimStatement({workerId:'worker:test',now:1000,leaseDurationMs:5000,leaseToken:'lease_'+'a'.repeat(32),jobType:'apply'});
    let i=0;
    assert.equal((await db.query(sql.replaceAll('?',()=>'$'+ ++i),bindings)).rowCount,0);
    const repository=new NeonDeploymentExecutionRepository(testUrl,undefined,()=>({query:(text,values)=>db.query(text,values)}));
    assert.equal(await repository.claimNext({workerId:'worker:new',now:1000,leaseDurationMs:5000,jobTypes:['apply']}),null);
    assert.equal((await db.query('select attempts from deployment_jobs where id=$1',[h.job.jobId])).rows[0].attempts,0);
  } finally { await db.end(); }
});
