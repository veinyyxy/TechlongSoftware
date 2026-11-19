import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { buildFirstOnboardingJob, firstOnboardingClaimBindings } from "../lib/deployments/first-onboarding.ts";
import { FIRST_OPEN_CLAIM_ROLES as roles, sandboxFirstOpenClaimDdl, sandboxFirstOpenClaimPorts } from "../lib/deployments/execution/first-onboarding-claim-entry.ts";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

// All fixture writes are confined to one disposable transaction, including DDL.
export async function checkFirstOpenClaimOnDisposablePg(db) {
  const now = Date.now(), sha = "d".repeat(64), writeBefore = now + 50000;
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
      CREATE TABLE public.deployment_environments (id text PRIMARY KEY,key text,kind text,status text,apply_enabled int,expected_account_id text,region text,cell_key text);
      CREATE TABLE public.app_instance_deployments (id text PRIMARY KEY,app_instance_id text,subscription_id text,environment_id text,
        deployment_profile_key text,mode text,driver text,workflow_version text,cell_key text,desired_plan text,plan_hash text,
        configuration_hash text,artifact_ref text,status text);
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
    await select("INSERT INTO public.deployment_environments VALUES ($1,'aws-sandbox-ca-central-1','aws_sandbox','active',0,$2,'ca-central-1','cell-sandbox-1')",
      [s.environmentId, s.account]);
    await select("INSERT INTO public.app_instance_deployments VALUES ($1,$2,$3,$4,'standard-v1','aws_sandbox','aws_ecs_cell','v1','cell-sandbox-1',$5,$6,$7,$8,'planned')",
      [s.deploymentId, s.instanceId, s.subscriptionId, s.environmentId, JSON.stringify(desiredPlan), scope.planHash, scope.configurationHash, scope.artifactRef]);
    await select("INSERT INTO public.deployment_jobs VALUES ($1,$2,$3,'apply','pending',$4,0,1,$5,NULL,NULL,NULL,NULL,$6)",
      [s.jobId, s.deploymentId, held.dedupeKey, JSON.stringify(held.payload), held.availableAt, now]);
    const release = { id: s.releaseId, productId: s.productId, component: "tenant_api", version: "isolated-test",
      image: { repository: s.imageRepository, manifestDigest: s.imageDigest, platformDigest: s.imageDigest } };
    await select("INSERT INTO deployment_release.releases VALUES ($1,$2,'tenant_api',$3,'ecr_verified',$4)", [s.releaseId, s.productId, release.version, release]);
    const ddl = sandboxFirstOpenClaimDdl({ approvalSha256: sha, planHash: scope.planHash, configurationHash: scope.configurationHash, writeBefore });
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
    assert.deepEqual(await make().claimHeldJob(b), { jobId: s.jobId });
    assert.equal(await make().claimHeldJob(b), null);
    assert.deepEqual((await select("SELECT status,attempts FROM public.deployment_jobs WHERE id=$1", [s.jobId])).rows,
      [{ status: "running", attempts: 1 }]);
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
