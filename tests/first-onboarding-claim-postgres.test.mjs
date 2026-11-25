import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { buildFirstOnboardingJob, firstOnboardingClaimBindings } from "../lib/deployments/first-onboarding.ts";
import { FIRST_OPEN_CLAIM_ROLES as roles, sandboxFirstOpenClaimDdl, sandboxFirstOpenClaimPorts } from "../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";
import { sandboxFirstOpenMiddleDdl } from "../ops/aws-sandbox/first-onboarding-middle-ddl.ts";
import { firstOnboardingMiddleRepositorySource } from "./first-onboarding-middle-source.mjs";
import { bindSandboxFirstOpenMiddle, FIRST_OPEN_ARTIFACT, FIRST_OPEN_AUTHORITY_KEY, FIRST_OPEN_MIDDLE_ROLES,
  FIRST_OPEN_MIDDLE_RPC, FIRST_OPEN_MIDDLE_WORKER, FIRST_OPEN_SECRET_BASE_NAME } from "../lib/deployments/execution/first-onboarding-middle.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { COST_CONTROL_SCOPE_V1 } from "../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { awsSandboxTenantStackName } from "../lib/deployments/cloudformation/tenant-stack.ts";

// All fixture writes are confined to one disposable transaction, including DDL.
export async function checkFirstOpenClaimOnDisposablePg(db) {
  const now = Date.now(), sha = "d".repeat(64), writeBefore = now + 900_000;
  const startAt = Math.floor(now / 1000) * 1000 - 1000;
  const window = { startAt, claimBefore: now + 25000, workloadExpiresAt: startAt + 7200000, factsExpireAt: writeBefore,
    cleanupReviewSha256: "1".repeat(64), cleanupPermissionsEvidenceSha256: "2".repeat(64) };
  const configuration = { test: true }, desiredPlan = { mode: "aws_sandbox" }, scope = {
    appInstanceId: s.instanceId, workspaceId: "wsp_beb2aa5868a9d1c10c257348", subscriptionId: s.subscriptionId, environmentId: s.environmentId,
    accountId: s.account, tenantKey: "pending_" + s.instanceId, templateVersionId: "tplver_fixture", planId: "pln_fixture", releaseId: s.releaseId,
    artifactRef: s.imageRepository + "@" + s.imageDigest, planHash: await sha256Hex(desiredPlan), configurationHash: await sha256Hex(configuration),
  };
  const held = await buildFirstOnboardingJob(scope); assert.equal(held.jobId, s.jobId);
  const slug = s.hostname.split(".")[0];
  const select = (sql, p) => db.query(sql, p);
  await db.query("BEGIN; SET LOCAL search_path=pg_catalog;");
  try {
    await db.query(`CREATE TABLE public.workspaces (id text PRIMARY KEY,status text);
      CREATE TABLE public.subscriptions (id text PRIMARY KEY,workspace_id text,product_id text,plan_id text,template_version_id text,
        status text,current_period_start bigint,current_period_end bigint,deployment_profile_key text,instance_configuration text);
      CREATE TABLE public.app_instances (id text PRIMARY KEY,workspace_id text,product_id text,subscription_id text,tenant_key text,
        status text,provisioned_at bigint,provisioning_source text,access_url text,template_version_id text,configuration_snapshot text,slug text);
      CREATE TABLE public.deployment_environments (id text PRIMARY KEY,key text,kind text,status text,apply_enabled int,expected_account_id text,region text,cell_key text,policy text);
      CREATE TABLE public.app_instance_deployments (id text PRIMARY KEY,app_instance_id text,subscription_id text,environment_id text,
        deployment_profile_key text,mode text,driver text,workflow_version text,cell_key text,desired_plan text,plan_hash text,
        configuration_hash text,artifact_ref text,status text,created_at bigint);
      CREATE TABLE public.deployment_jobs (id text PRIMARY KEY,deployment_id text,dedupe_key text,job_type text,status text,payload text,attempts int,max_attempts int,
        available_at bigint,lease_owner text,lease_token text,lease_expires_at bigint,completed_at bigint,updated_at bigint);
      CREATE TABLE public.deployment_tenant_resources (app_instance_id text);
      CREATE TABLE public.deployment_tenant_external_operations (app_instance_id text);
      CREATE SCHEMA IF NOT EXISTS deployment_release;
      CREATE TABLE IF NOT EXISTS deployment_release.releases (id text,product_id text,component text,version text,status text,document jsonb);
      CREATE TABLE IF NOT EXISTS deployment_release.instance_state (instance_id text);
      CREATE ROLE ${roles.definer} NOLOGIN NOINHERIT;
      CREATE ROLE ${roles.reader} LOGIN NOINHERIT;
      CREATE ROLE ${roles.writer} LOGIN NOINHERIT;`);
    await select("INSERT INTO public.workspaces VALUES ($1,'active')", [scope.workspaceId]);
    await select("INSERT INTO public.subscriptions VALUES ($1,$2,$3,$4,$5,'active',$6,$7,'standard-v1',$8)",
      [s.subscriptionId, scope.workspaceId, s.productId, scope.planId, scope.templateVersionId, now - 5000, writeBefore + 50000, JSON.stringify(configuration)]);
    await select("INSERT INTO public.app_instances VALUES ($1,$2,$3,$4,$5,'pending',NULL,'payment_success','',$6,$7,$8)",
      [s.instanceId, scope.workspaceId, s.productId, s.subscriptionId, scope.tenantKey, scope.templateVersionId, JSON.stringify(configuration), slug]);
    await select("INSERT INTO public.deployment_environments VALUES ($1,'aws-sandbox-ca-central-1','aws_sandbox','active',0,$2,'ca-central-1','cell-sandbox-1',$3)",
      [s.environmentId, s.account, '{"ttlSeconds":7200}']);
    const originalCreatedAt = now - 3 * 3600000;
    await select("INSERT INTO public.app_instance_deployments VALUES ($1,$2,$3,$4,'standard-v1','aws_sandbox','aws_ecs_cell','v1','cell-sandbox-1',$5,$6,$7,$8,'planned',$9)",
      [s.deploymentId, s.instanceId, s.subscriptionId, s.environmentId, JSON.stringify(desiredPlan), scope.planHash, scope.configurationHash, scope.artifactRef, originalCreatedAt]);
    await select("INSERT INTO public.deployment_jobs VALUES ($1,$2,$3,'apply','pending',$4,0,1,$5,NULL,NULL,NULL,NULL,$6)",
      [s.jobId, s.deploymentId, held.dedupeKey, JSON.stringify(held.payload), held.availableAt, now]);
    const release = { id: s.releaseId, productId: s.productId, component: "tenant_api", version: "isolated-test",
      image: { repository: s.imageRepository, manifestDigest: s.imageDigest, platformDigest: s.imageDigest } };
    await select("INSERT INTO deployment_release.releases VALUES ($1,$2,'tenant_api',$3,'ecr_verified',$4)", [s.releaseId, s.productId, release.version, release]);
    const options = { approvalSha256: sha, planHash: scope.planHash, configurationHash: scope.configurationHash, writeBefore, window };
    const ddl = sandboxFirstOpenClaimDdl(options);
    await db.query(ddl.replace(/^BEGIN;\n/, "").replace(/\nCOMMIT;$/, ""));
    const asRole = role => ({ async query(sql, p) {
      await db.query("SAVEPOINT rpc_test");
      try {
        await db.query("SET LOCAL ROLE " + role);
        return await select(sql, p);
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT rpc_test").catch(() => {});
        await db.query("RELEASE SAVEPOINT rpc_test").catch(() => {});
      }
    } });
    // Use the same role-bound session, but keep a successful claim pending in
    // the outer transaction, so a second function call really sees attempt 1.
    const write = { async query(sql, p) {
      await db.query("SET LOCAL ROLE " + roles.writer);
      try { return await select(sql, p); }
      finally { await db.query("RESET ROLE"); }
    } };
    const reader = asRole(roles.reader), make = (approved = sha) => sandboxFirstOpenClaimPorts(reader, write, approved);
    await assert.rejects(reader.query("SELECT id FROM public.deployment_jobs", []), { code: "42501" });
    await assert.rejects(reader.query("SELECT * FROM techlong_first_onboarding_claim.claim('x','[]'::jsonb)", []), { code: "42501" });
    await assert.rejects(asRole(roles.writer).query("SELECT techlong_first_onboarding_claim.review()", []), { code: "42501" });
    const row = await make().readHeldJob();
    assert.equal(row.job.id, s.jobId); assert.deepEqual(await make().readFixedRelease(), { ...release, status: "ecr_verified" });
    const b = firstOnboardingClaimBindings({ jobId: held.jobId, payload: held.payload }, row, "first-onboarding:" + s.jobId, "lease_" + "a".repeat(32), writeBefore);
    assert.equal(await make("e".repeat(64)).claimHeldJob(b), null);
    const wrong = [...b]; wrong[10] = "wsp_wrong";
    assert.equal(await make().claimHeldJob(wrong), null);
    await select("UPDATE deployment_release.releases SET status='revoked' WHERE id=$1", [s.releaseId]);
    assert.equal(await make().claimHeldJob(b), null);
    await select("UPDATE deployment_release.releases SET status='ecr_verified' WHERE id=$1", [s.releaseId]);
    await select("UPDATE public.deployment_environments SET policy=$1 WHERE id=$2", ['{"ttlSeconds":3600}', s.environmentId]);
    assert.equal(await make().claimHeldJob(b), null);
    await select("UPDATE public.deployment_environments SET policy=$1 WHERE id=$2", ['{"ttlSeconds":7200}', s.environmentId]);
    // Keep the RPC entry guard open but simulate the eligible row lock taking
    // until after the cutoff. The clock expression immediately after the lock
    // must reject the claim even though the PL/pgSQL entry admitted it.
    await db.query("SAVEPOINT simulate_lock_time");
    const createClaim = ddl.match(/CREATE FUNCTION techlong_first_onboarding_claim\.claim\(p_sha[\s\S]+?END \$claim\$;/)?.[0];
    assert.ok(createClaim);
    const postLockClock = "floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now_ms\n  FROM eligible";
    const delayed = createClaim.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
      .replace(postLockClock, `${window.claimBefore}::bigint AS now_ms\n  FROM eligible`);
    assert.notEqual(delayed, createClaim.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"));
    await db.query(delayed);
    assert.equal(await make().claimHeldJob(b), null);
    await db.query("ROLLBACK TO SAVEPOINT simulate_lock_time; RELEASE SAVEPOINT simulate_lock_time;");
    assert.deepEqual(await make().claimHeldJob(b), { jobId: s.jobId });
    assert.equal(await make().claimHeldJob(b), null);
    assert.deepEqual((await select("SELECT status,attempts FROM public.deployment_jobs WHERE id=$1", [s.jobId])).rows,
      [{ status: "running", attempts: 1 }]);
    assert.equal(Number((await select("SELECT created_at FROM public.app_instance_deployments WHERE id=$1", [s.deploymentId])).rows[0].created_at), originalCreatedAt);
  } finally { await db.query("ROLLBACK"); }
}

const testUrl = process.env.INSTANCE_RELEASE_TEST_DATABASE_URL;
test("isolated PG: single claim via exact grants, no other role/table access", { skip: !testUrl, timeout: 20000 }, async () => {
  const url = new URL(testUrl);
  assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true");
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/instance_release_ci");
  assert.equal(url.username, "postgres"); assert.equal(url.password, "synthetic-ci-only"); assert.equal(url.search + url.hash, "");
  const db = new pg.Client({ connectionString: testUrl, statement_timeout: 5000 });
  await db.connect();
  try { await checkFirstOpenClaimOnDisposablePg(db); } finally { await db.end(); }
});

test("isolated PG: fixed first-open middle RPC and one DynamoDB g1/e1 CAS", { skip: !testUrl, timeout: 20000 }, async () => {
  const url = new URL(testUrl);
  assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true");
  assert.equal(url.protocol, "postgresql:"); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/instance_release_ci");
  assert.equal(url.username, "postgres"); assert.equal(url.password, "synthetic-ci-only"); assert.equal(url.search + url.hash, "");
  const db = new pg.Client({ connectionString: testUrl, statement_timeout: 5000 });
  const roles = FIRST_OPEN_MIDDLE_ROLES, now = Date.now(), writeBefore = now + 900_000, startAt = Math.floor(now / 1000) * 1000 - 1_000;
  const ws = "wsp_beb2aa5868a9d1c10c257348", token = "lease_" + "7".repeat(32), tenantKey = "pending_" + s.instanceId;
  const planText = '{"mode":"aws_sandbox"}', configuration = '{}', planHash = await sha256Hex(JSON.parse(planText));
  const scope = { approvalSha256: "8".repeat(64), planHash, configurationHash: await sha256Hex(JSON.parse(configuration)), writeBefore,
    window: { startAt, claimBefore: now + 25_000, workloadExpiresAt: startAt + 7_200_000, factsExpireAt: writeBefore,
      cleanupReviewSha256: "1".repeat(64), cleanupPermissionsEvidenceSha256: "2".repeat(64) } };
  const fixtureScope = { appInstanceId: s.instanceId, workspaceId: ws, subscriptionId: s.subscriptionId, environmentId: s.environmentId,
    accountId: s.account, tenantKey, templateVersionId: "tplver_fixture", planId: "pln_fixture", releaseId: s.releaseId,
    artifactRef: FIRST_OPEN_ARTIFACT, planHash, configurationHash: scope.configurationHash };
  const held = await buildFirstOnboardingJob(fixtureScope);
  assert.equal(held.jobId, s.jobId);
  const identity = { schemaVersion: 1, appInstanceId: s.instanceId, workspaceId: ws, productId: s.productId,
    environmentId: s.environmentId, cellKey: "cell-sandbox-1", databaseName: s.tenantDatabase,
    roleName: s.tenantRole, secretName: FIRST_OPEN_SECRET_BASE_NAME, stableIdentityHash: s.stableIdentity };
  const lease = { jobId: s.jobId, deploymentId: s.deploymentId, workerId: FIRST_OPEN_MIDDLE_WORKER, leaseToken: token, attempt: 1 };
  const job = { id: s.jobId, deploymentId: s.deploymentId, jobType: "apply", attempt: 1, maxAttempts: 1, leaseToken: token,
    leaseExpiresAt: writeBefore, payload: { ...held.payload, schemaVersion: 1, deploymentId: s.deploymentId, planHash } };
  const fromFile = path => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const ddl = await sandboxFirstOpenMiddleDdl(scope, firstOnboardingMiddleRepositorySource());
  const stripTransaction = text => text.trim().replace(/^BEGIN;\s*/, "").replace(/\s*COMMIT;$/, "");
  await db.connect();
  await db.query("BEGIN");
  const select = (...x) => db.query(...x);
  try {
    await select(stripTransaction(fromFile("../db/postgres-schema.sql")));
    await select(`CREATE ROLE ${roles.runner} LOGIN NOINHERIT; CREATE ROLE ${roles.definer} NOLOGIN NOINHERIT;`);
    await select("INSERT INTO public.users(id,email,name,created_at,updated_at) VALUES ('usr_fixture','fixture@example.invalid','Synthetic',1,1)");
    await select("INSERT INTO public.app_instance_templates(id,product_id,name,created_at,updated_at) VALUES ('tpl_fixture',$1,'Synthetic',1,1)", [s.productId]);
    await select("INSERT INTO public.app_instance_template_versions(id,template_id,version,status,created_at,updated_at) VALUES ('tplver_fixture','tpl_fixture',1,'published',1,1)");
    await select("INSERT INTO public.plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at) VALUES ('pln_fixture',$1,'tplver_fixture','Fixture',1,'USD','month',1,1)", [s.productId]);
    await select("INSERT INTO public.workspaces(id,name,owner_id,created_at,updated_at) VALUES ($1,'Synthetic','usr_fixture',1,1)", [ws]);
    await select("INSERT INTO public.subscriptions(id,workspace_id,product_id,plan_id,template_version_id,status,current_period_start,current_period_end,created_by_user_id,created_at,updated_at) VALUES ($1,$2,$3,'pln_fixture','tplver_fixture','active',$4,$5,'usr_fixture',1,1)", [s.subscriptionId, ws, s.productId, now - 100_000, writeBefore + 50_000]);
    await select("INSERT INTO public.app_instances(id,workspace_id,product_id,subscription_id,template_version_id,status,provisioning_source,name,slug,access_url,tenant_key,created_by_user_id,created_at,updated_at) VALUES ($1,$2,$3,$4,'tplver_fixture','pending','payment_success','Synthetic',$5,'',$6,'usr_fixture',1,1)", [s.instanceId, ws, s.productId, s.subscriptionId, s.hostname.split(".")[0], tenantKey]);
    await select("INSERT INTO public.deployment_environment_bindings(environment_id,worker_role_arn,cloudformation_role_arn,status,created_at,updated_at) VALUES ($1,$2,$3,'active',1,1)", [s.environmentId, s.workerRole, s.cfnRole]);
    await select("INSERT INTO public.app_instance_deployments(id,app_instance_id,subscription_id,environment_id,driver,workflow_version,cell_key,deployment_profile_key,mode,status,desired_plan,plan_hash,configuration_hash,idempotency_key,artifact_ref,created_at,updated_at) VALUES ($1,$2,$3,$4,'aws_ecs_cell','v1','cell-sandbox-1','standard-v1','aws_sandbox','planned',$5,$6,$7,'fixture',$8,1,1)", [s.deploymentId, s.instanceId, s.subscriptionId, s.environmentId, planText, planHash, scope.configurationHash, FIRST_OPEN_ARTIFACT]);
    await select("INSERT INTO public.deployment_jobs(id,deployment_id,job_type,dedupe_key,status,payload,attempts,max_attempts,available_at,created_at,updated_at) VALUES ($1,$2,'apply',$3,'pending',$4,0,1,$5,1,1)", [s.jobId,s.deploymentId,held.dedupeKey,JSON.stringify(held.payload),held.availableAt]);
    await select(stripTransaction(ddl));
    const asRunner = { async query(sql, args) {
      await select("SAVEPOINT middle_rpc");
      try {
        await select("SET LOCAL ROLE " + roles.runner);
        const x = await select(sql, args);
        await select("RESET ROLE; RELEASE SAVEPOINT middle_rpc");
        return x;
      } catch (e) {
        await select("ROLLBACK TO SAVEPOINT middle_rpc; RELEASE SAVEPOINT middle_rpc");
        throw e;
      }
    } };
    let item, reads=0, puts=0, stackReads=0;
    class Get { constructor(input) { this.input=input; } }
    class Put { constructor(input) { this.input=input; } }
    const ports = { scope, sql: asRunner, dynamo: { commands: { get: Get, put: Put }, client: { async send(cmd) {
      const c = cmd.input; assert.equal(c.TableName,COST_CONTROL_SCOPE_V1.tableArn);
      if (cmd instanceof Get) {
        assert.equal(c.Key.authority_key,FIRST_OPEN_AUTHORITY_KEY); assert.equal(c.ConsistentRead,true); reads++;
        return item ? {Item: structuredClone(item)} : {};
      }
      assert.ok(cmd instanceof Put); assert.equal(c.Item.authority_key,FIRST_OPEN_AUTHORITY_KEY);
      assert.equal(c.ConditionExpression,"attribute_not_exists(#authorityKey)"); assert.equal(item,undefined);
      item=structuredClone(c.Item); puts++; return {};
    } } }, cloud: { region: s.region, async describeTenantStack(name) {
      assert.equal(name,awsSandboxTenantStackName(s.instanceId)); stackReads++; return {state:"missing",stackId:null,tags:{}};
    } } };
    const bound = bindSandboxFirstOpenMiddle(ports), repo = bound.repository, signal = new AbortController().signal;
    await assert.rejects(asRunner.query("SELECT * FROM public.deployment_jobs",[]), { code:"42501" });
    await assert.rejects(repo.loadContext(job), /FIRST_OPEN_MIDDLE_LEASE/);
    await bound.verifyMiddleReadyBeforeClaim(signal);
    await bound.verifyAuthorityVacantBeforeClaim(signal);
    assert.equal(puts,0);
    await select("UPDATE public.deployment_jobs SET status='running',attempts=1,lease_owner=$2,lease_token=$3,lease_expires_at=$4 WHERE id=$1", [s.jobId, lease.workerId, token, writeBefore]);
    await assert.rejects(asRunner.query(FIRST_OPEN_MIDDLE_RPC,["5".repeat(64),token,"context",JSON.stringify([s.deploymentId])]), /FIRST_OPEN_MIDDLE_APPROVAL/);
    await assert.rejects(asRunner.query(FIRST_OPEN_MIDDLE_RPC,[scope.approvalSha256,token,"context",JSON.stringify(["dep_foreign"])]), /FIRST_OPEN_MIDDLE_ARGUMENTS/);
    await assert.rejects(asRunner.query(FIRST_OPEN_MIDDLE_RPC,[scope.approvalSha256,token,"complete",'[]']), /FIRST_OPEN_MIDDLE_OPERATION/);
    assert.equal((await repo.loadContext(job)).deployment.status,"planned");
    assert.equal(await repo.heartbeat({...{lease,now,leaseDurationMs:120000},notAfter:writeBefore}),true);
    assert.equal(await repo.transitionDeployment({lease,from:["planned","retry_wait"],to:"queued",currentStep:"queued",now}),true);
    assert.equal(await repo.transitionDeployment({lease,from:["queued"],to:"preflight",currentStep:"preflight",now}),true);
    const capacity = {lease,environmentId:s.environmentId,maxTenants:1,now};
    assert.equal(await repo.reserveEnvironmentCapacity(capacity),true);assert.equal(await repo.reserveEnvironmentCapacity(capacity),true);
    await assert.rejects(repo.reserveEnvironmentCapacity({...capacity,maxTenants:2}), /FIRST_OPEN_MIDDLE_ARGUMENTS/);
    const step=await repo.beginStep({lease,stepKey:"tenant_database_prepare",inputHash:"6".repeat(64),now});
    assert.equal(step.alreadySucceeded,false);
    assert.equal(await repo.finishStep({lease,stepId:step.id,status:"succeeded",output:{verified:true},now}),true);
    const generated=await repo.claimTenantResourceGeneration({lease,identity,now});
    assert.equal(generated.fence.generation,1);
    assert.equal((await repo.claimTenantResourceGeneration({lease,identity,now})).outcome,"reused");
    const ctx=await repo.loadContext(job);
    // One ambiguous provider write must neither activate the SQL epoch nor
    // be resubmitted. Roll back only the disposable test fixture afterwards.
    await select("SAVEPOINT simulated_unknown_authority_ack");
    let unknownPuts=0;
    const unknown = bindSandboxFirstOpenMiddle({ ...ports, dynamo: { ...ports.dynamo, client: { async send(cmd) {
      if (cmd instanceof Put) { unknownPuts++; throw new Error("synthetic unknown PutItem response"); }
      return {};
    } } }, cloud: { ...ports.cloud, async describeTenantStack() { return {state:"missing",stackId:null,tags:{}}; } } });
    await unknown.verifyAuthorityVacantBeforeClaim(signal);
    const request = {lease,context:ctx,resourceFence:generated.fence,intent:"provision",signal};
    await assert.rejects(unknown.provisionEpoch(request));
    assert.equal((await select("SELECT state FROM public.deployment_tenant_external_operations WHERE app_instance_id=$1", [s.instanceId])).rows[0].state,"pending_external");
    assert.equal((await repo.loadContext(job)).tenantExternalOperation,null);
    await assert.rejects(unknown.provisionEpoch(request), /FIRST_OPEN_AUTHORITY_PROVISION/);
    assert.equal(unknownPuts,1);
    await select("ROLLBACK TO SAVEPOINT simulated_unknown_authority_ack; RELEASE SAVEPOINT simulated_unknown_authority_ack");
    const epoch=await bound.provisionEpoch({lease,context:ctx,resourceFence:generated.fence,intent:"provision",signal});
    assert.equal(epoch.state,"active");assert.equal(epoch.epoch,1);
    assert.equal(await repo.assertTenantExternalOperation({lease,externalFence:epoch,requiredState:"active",now}),true);
    assert.equal((await repo.loadContext(job)).tenantExternalOperation.operationHash,epoch.operationHash);
    const record={lease,fence:generated.fence,externalFence:epoch,runtimeSecretRef:`arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-AbCd12`,
      lifecycleStatus:"database_empty",baselineDigest:null,migrationContract:null,evidence:{state:"empty"},now};
    assert.equal(await repo.recordTenantResourceLifecycle(record),true);
    assert.equal(await repo.recordTenantResourceLifecycle({...record,lifecycleStatus:"verified",baselineDigest:FIRST_OPEN_BASELINE_BINDING.objects.archive.sha256,migrationContract:s.schemaVersion}),true);
    assert.deepEqual([reads,puts,stackReads],[3,1,2]);
    await assert.rejects(bound.provisionEpoch({lease,context:ctx,resourceFence:generated.fence,intent:"provision",signal}), /FIRST_OPEN_AUTHORITY_PROVISION/);
    await assert.rejects(bindSandboxFirstOpenMiddle(ports).verifyAuthorityVacantBeforeClaim(signal), /FIRST_OPEN_AUTHORITY_OCCUPIED/);
    await select("UPDATE public.deployment_jobs SET lease_expires_at=1 WHERE id=$1",[s.jobId]);
    await assert.rejects(repo.loadContext(job), /FIRST_OPEN_MIDDLE_LEASE/);
  } finally { await db.query("ROLLBACK"); await db.end(); }
});
