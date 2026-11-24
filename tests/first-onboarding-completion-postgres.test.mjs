import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { buildFirstOnboardingJob } from "../lib/deployments/first-onboarding.ts";
import { COMPLETE_FIRST_ONBOARDING, READ_FIRST_ONBOARDING_COMPLETION } from "../lib/deployments/execution/first-onboarding-completion.ts";
import { FIRST_ONBOARDING_COMPLETE_ENTRY, firstOnboardingCompletionDdl, readFirstOnboardingCompletion } from "../lib/deployments/execution/first-onboarding-completion-entry.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { PostgresReleaseRepository } from "../lib/deployments/releases/repository.ts";

// Runs after the D2 integration test in the same disposable service. D2 schema
// and roles are real; only the public control-plane rows are a minimal fixture.
const testUrl = process.env.INSTANCE_RELEASE_TEST_DATABASE_URL;
test("native PostgreSQL: first-open writes all four records or none and D2 can read revision 0", { skip: !testUrl }, async () => {
  const url = new URL(testUrl);
  assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/instance_release_ci"); assert.equal(url.username, "postgres");
  const connect = () => new pg.Client({ connectionString: testUrl, statement_timeout: 5000 });
  const db = connect(), reader = connect();
  const separate = [];
  await db.connect(); await reader.connect();
  try {
    await db.query(`CREATE TABLE public.workspaces (id text PRIMARY KEY,status text);
      CREATE TABLE public.subscriptions (id text PRIMARY KEY,workspace_id text,product_id text,plan_id text,template_version_id text,
        status text,current_period_start bigint,current_period_end bigint,deployment_profile_key text,instance_configuration text);
      CREATE TABLE public.app_instances (id text PRIMARY KEY,workspace_id text,product_id text,subscription_id text,tenant_key text,
        status text,provisioned_at bigint,provisioning_source text,access_url text,template_version_id text,configuration_snapshot text,
        slug text,suspended_at bigint,updated_at bigint);
      CREATE TABLE public.deployment_environments (id text PRIMARY KEY,key text,kind text,status text,apply_enabled integer,expected_account_id text,region text,cell_key text);
      CREATE TABLE public.app_instance_deployments (id text PRIMARY KEY,app_instance_id text,subscription_id text,environment_id text,
        driver text,workflow_version text,cell_key text,deployment_profile_key text,mode text,status text,desired_plan text,plan_hash text,
        configuration_hash text,artifact_ref text,current_step text,ready_at bigint,updated_at bigint,control_payload_hash text,outputs text);
      CREATE TABLE public.deployment_jobs (id text PRIMARY KEY,deployment_id text,job_type text,dedupe_key text,status text,payload text,
        attempts int,max_attempts int,available_at bigint,lease_owner text,lease_expires_at bigint,lease_token text,completed_at bigint,updated_at bigint);
      CREATE TABLE public.deployment_tenant_resources (app_instance_id text PRIMARY KEY,owner_deployment_id text,generation int,
        lifecycle_status text,ownership_marker text,baseline_digest text,external_operation_epoch int);
      CREATE TABLE public.deployment_tenant_external_operations (app_instance_id text,generation int,epoch int,owner_deployment_id text,
        created_by_job_id text,created_by_attempt int,intent text,operation_hash text,marker text,state text,
        PRIMARY KEY (app_instance_id,generation,epoch));
      CREATE TABLE public.deployment_step_runs (id text PRIMARY KEY,job_id text,deployment_id text,attempt int,step_key text,
        status text,input_hash text,output text,finished_at bigint);
      INSERT INTO public.deployment_environments VALUES ('env_test','aws-sandbox-ca-central-1','aws_sandbox','active',0,'402010193138','ca-central-1','cell-sandbox-1');`);
    const t = Date.now(), hash = char => char.repeat(64), productId = "prd_restaurant_order_system";
    const catalog = { id: "release_" + "e".repeat(32), productId, component: "tenant_api", version: "first-onboarding-ci",
      status: "ecr_verified", image: { repository: "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast",
        manifestDigest: "sha256:" + hash("a"), platformDigest: "sha256:" + hash("b") } };
    await db.query("INSERT INTO deployment_release.releases VALUES ($1,$2,'tenant_api',$3,'ecr_verified',$4)",
      [catalog.id, productId, catalog.version, catalog]);
    async function seed(slug) {
      const configuration = { synthetic: true }, desiredPlan = { mode: "aws_sandbox" };
      const scope = { appInstanceId: "app_" + slug, workspaceId: "workspace_" + slug, subscriptionId: "sub_" + slug,
        environmentId: "env_test", planId: "plan_test", templateVersionId: "version_test", tenantKey: "tenant_" + slug, accountId: "402010193138",
        planHash: await sha256Hex(desiredPlan), configurationHash: await sha256Hex(configuration), releaseId: catalog.id,
        artifactRef: catalog.image.repository + "@" + catalog.image.manifestDigest };
      const h = await buildFirstOnboardingJob(scope);
      const stackId = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-" + slug + "/11111111-2222-3333-4444-555555555555";
      const binding = { instanceId: scope.appInstanceId, initialized: true, status: "active", stackId, stateRevision: 0,
        currentRelease: { id: catalog.id, manifestDigest: catalog.image.manifestDigest, platformDigest: catalog.image.platformDigest } };
      const bindingText = canonicalJson(binding), bindingSha256 = await sha256Hex(bindingText);
      const receipt = { jobId: h.jobId, hostname: slug + ".sandbox.techlong.cloud", approvalSha256: hash("c"),
        initialBindingSha256: bindingSha256, runtime: { stackId, persistentUploadsReady: true }, outcome: "TECHNICALLY_VERIFIED" };
      const token = "lease_" + "d".repeat(32), fence = { ownershipMarker: "owned", marker: "epoch", operationHash: hash("4") };
      const req = { jobId: h.jobId, jobPayload: h.payload, configuration, desiredPlan, catalog, receipt, inspectionInputHash: hash("5"),
        writeBefore: t + 60000, baselineDigest: hash("6"), fence };
      await db.query("INSERT INTO public.workspaces VALUES ($1,'active')", [scope.workspaceId]);
      await db.query("INSERT INTO public.subscriptions VALUES ($1,$2,$3,$4,$5,'active',$6,$7,'standard-v1',$8)",
        [scope.subscriptionId, scope.workspaceId, productId, scope.planId, scope.templateVersionId, t-50, t+120000, JSON.stringify(configuration)]);
      await db.query("INSERT INTO public.app_instances VALUES ($1,$2,$3,$4,$5,'pending',NULL,'payment_success','',$6,$7,$8,NULL,$9)",
        [scope.appInstanceId, scope.workspaceId, productId, scope.subscriptionId, scope.tenantKey, scope.templateVersionId, JSON.stringify(configuration), slug, t]);
      await db.query(`INSERT INTO public.app_instance_deployments VALUES ($1,$2,$3,'env_test','aws_ecs_cell','v1','cell-sandbox-1',
        'standard-v1','aws_sandbox','verifying',$4,$5,$6,$7,'control_verify',NULL,$8,NULL,$9)`,
        [h.deploymentId, scope.appInstanceId, scope.subscriptionId, JSON.stringify(desiredPlan), scope.planHash, scope.configurationHash,
          scope.artifactRef, t, JSON.stringify({ stackId, stackOperation: "create" })]);
      await db.query("INSERT INTO public.deployment_jobs VALUES ($1,$2,'apply',$3,'running',$4,1,1,$5,$6,$7,$8,NULL,$9)",
        [h.jobId, h.deploymentId, h.dedupeKey, canonicalJson(h.payload), h.availableAt, "first-onboarding:" + h.jobId, t+60000, token, t]);
      await db.query("INSERT INTO public.deployment_tenant_resources VALUES ($1,$2,1,'verified',$3,$4,1)",
        [scope.appInstanceId,h.deploymentId,fence.ownershipMarker,req.baselineDigest]);
      await db.query("INSERT INTO public.deployment_tenant_external_operations VALUES ($1,1,1,$2,$3,1,'provision',$4,$5,'active')",
        [scope.appInstanceId,h.deploymentId,h.jobId,fence.operationHash,fence.marker]);
      await db.query("INSERT INTO public.deployment_step_runs VALUES ($1,$2,$3,1,'first_onboarding_independent_inspection','succeeded',$4,$5,$6)",
        ["step_"+slug,h.jobId,h.deploymentId,req.inspectionInputHash,canonicalJson(receipt),t]);
      const attempt = (request = req, body = bindingText, lease = token, dbClient = db) =>
        dbClient.query(COMPLETE_FIRST_ONBOARDING,[canonicalJson(request),body,lease]);
      const read = () => reader.query(READ_FIRST_ONBOARDING_COMPLETION,[h.jobId,h.deploymentId,scope.appInstanceId,bindingSha256]);
      const state = async () => (await reader.query(`SELECT a.status AS instance,d.status AS deployment,j.status AS job,
        a.access_url,s.revision FROM public.app_instances a JOIN public.app_instance_deployments d ON d.app_instance_id=a.id
        JOIN public.deployment_jobs j ON j.deployment_id=d.id LEFT JOIN deployment_release.instance_state s ON s.instance_id=a.id WHERE a.id=$1`,
        [scope.appInstanceId])).rows[0];
      return { h, req, binding, bindingText, scope, attempt, read, state };
    }
    const f=await seed("first"), pending={instance:"pending",deployment:"verifying",job:"running",access_url:"",revision:null};
    assert.equal((await f.attempt({...f.req,writeBefore:t-1})).rowCount,0);
    assert.equal((await f.attempt({...f.req,receipt:{...f.req.receipt,hostname:"other.sandbox.techlong.cloud"}})).rowCount,0);
    assert.equal((await f.attempt(f.req,"{}",undefined)).rowCount,0);
    assert.equal((await f.attempt(f.req,f.bindingText,"lease_"+"0".repeat(32))).rowCount,0);
    for (const [change, restore, params] of [
      ["UPDATE public.subscriptions SET status='paused' WHERE id=$1","UPDATE public.subscriptions SET status='active' WHERE id=$1",[f.scope.subscriptionId]],
      ["UPDATE public.deployment_jobs SET lease_expires_at=0 WHERE id=$1","UPDATE public.deployment_jobs SET lease_expires_at=$2 WHERE id=$1",[f.h.jobId,t+60000]],
      ["UPDATE deployment_release.releases SET status='revoked' WHERE id=$1","UPDATE deployment_release.releases SET status='ecr_verified' WHERE id=$1",[catalog.id]],
    ]) {
      await db.query(change,params.slice(0,1));
      assert.equal((await f.attempt()).rowCount,0);
      assert.deepEqual(await f.state(),pending);
      await db.query(restore,params);
    }
    const commits=await Promise.all([f.attempt(),f.attempt(f.req,f.bindingText,undefined,reader)]);
    assert.deepEqual(commits.map(q=>q.rowCount).sort(),[0,1]);
    assert.deepEqual(await f.state(),{instance:"active",deployment:"ready",job:"succeeded",access_url:"https://first.sandbox.techlong.cloud",revision:"0"});
    assert.equal((await f.read()).rowCount,1);
    const repo=new PostgresReleaseRepository({query:(sql,params)=>reader.query(sql,params)});
    const context=await repo.context(f.scope.appInstanceId);
    assert.equal(context.activeRequestId,null); assert.equal(context.binding.stateRevision,0);
    assert.deepEqual(context.binding.currentRelease,f.binding.currentRelease);

    const conflict=await seed("conflict");
    await db.query("INSERT INTO deployment_release.instance_state (instance_id,binding,current_release_id,revision) VALUES ($1,$2,$3,8)",
      [conflict.scope.appInstanceId,conflict.binding,catalog.id]);
    assert.equal((await conflict.attempt()).rowCount,0);
    assert.deepEqual(await conflict.state(),{...pending,revision:"8"}); assert.equal((await conflict.read()).rowCount,0);

    const failed=await seed("rollback");
    await db.query(`CREATE FUNCTION public.ci_suppress_job_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$;
      CREATE TRIGGER ci_suppress_job_update BEFORE UPDATE ON public.deployment_jobs FOR EACH ROW
      WHEN (OLD.deployment_id = '${failed.h.deploymentId}') EXECUTE FUNCTION public.ci_suppress_job_update()`);
    await assert.rejects(failed.attempt(),{code:"22012"});
    assert.deepEqual(await failed.state(),pending); assert.equal((await failed.read()).rowCount,0);

    const scopedSlug="7".repeat(24), scoped=await seed(scopedSlug), foreign=await seed("foreign");
    const buyerOrigin=`https://app-${scopedSlug}.sandbox.techlong.cloud`;
    const roles={definer:"first_onboarding_ci_definer",writer:"first_onboarding_ci_writer",reader:"first_onboarding_ci_reader"};
    await db.query(`CREATE ROLE ${roles.definer} NOLOGIN NOINHERIT;
      CREATE ROLE ${roles.writer} LOGIN NOINHERIT PASSWORD 'synthetic-ci-only';
      CREATE ROLE ${roles.reader} LOGIN NOINHERIT PASSWORD 'synthetic-ci-only';`);
    await db.query(firstOnboardingCompletionDdl({jobId:scoped.h.jobId,deploymentId:scoped.h.deploymentId,
      instanceId:scoped.scope.appInstanceId,approvalSha256:scoped.req.receipt.approvalSha256,writeBefore:scoped.req.writeBefore,buyerOrigin},roles));
    const login=async name=>{
      const u=new URL(testUrl); u.username=name;
      const c=new pg.Client({connectionString:u.toString(),statement_timeout:5000}); separate.push(c); await c.connect(); return c;
    };
    const limited=await login(roles.writer), audit=await login(roles.reader);
    const token="lease_"+"d".repeat(32);
    const submit=(c,f,req=f.req)=>c.query(FIRST_ONBOARDING_COMPLETE_ENTRY,[canonicalJson(req),f.bindingText,token]);
    await assert.rejects(limited.query("SELECT * FROM public.deployment_jobs"),{code:"42501"});
    await assert.rejects(limited.query("UPDATE public.app_instances SET status='active'"),{code:"42501"});
    await assert.rejects(limited.query("SET ROLE "+roles.definer),{code:"42501"});
    await assert.rejects(submit(audit,scoped),{code:"42501"});
    await assert.rejects(readFirstOnboardingCompletion(limited,scoped.req.receipt.initialBindingSha256),{code:"42501"});
    assert.equal((await submit(limited,foreign)).rowCount,0);
    assert.deepEqual(await foreign.state(),pending);
    await db.query("UPDATE public.deployment_jobs SET lease_expires_at=0 WHERE id=$1",[scoped.h.jobId]);
    assert.equal((await submit(limited,scoped)).rowCount,0);
    await db.query("UPDATE public.deployment_jobs SET lease_expires_at=$2 WHERE id=$1",[scoped.h.jobId,t+60000]);
    await db.query("UPDATE public.deployment_step_runs SET status='failed' WHERE job_id=$1",[scoped.h.jobId]);
    assert.equal((await submit(limited,scoped)).rowCount,0);
    assert.deepEqual(await scoped.state(),pending);
    await db.query("UPDATE public.deployment_step_runs SET status='succeeded' WHERE job_id=$1",[scoped.h.jobId]);
    assert.equal((await submit(limited,scoped,{...scoped.req,writeBefore:scoped.req.writeBefore+1000})).rowCount,0);
    assert.equal((await submit(limited,scoped)).rowCount,1);
    assert.equal((await submit(limited,scoped)).rowCount,0);
    assert.deepEqual(await scoped.state(),{instance:"active",deployment:"ready",job:"succeeded",access_url:buyerOrigin,revision:"0"});
    const { rows: [output] }=await reader.query("SELECT outputs::jsonb AS data FROM public.app_instance_deployments WHERE id=$1",[scoped.h.deploymentId]);
    assert.equal(output.data.buyerOrigin,buyerOrigin);
    assert.equal(output.data.tenantHostname,scoped.req.receipt.hostname);
    assert.equal((await readFirstOnboardingCompletion(audit,scoped.req.receipt.initialBindingSha256)).rowCount,1);
    await db.query("UPDATE public.app_instances SET access_url=$1 WHERE id=$2",[`https://${scoped.req.receipt.hostname}`,scoped.scope.appInstanceId]);
    assert.equal((await readFirstOnboardingCompletion(audit,scoped.req.receipt.initialBindingSha256)).rowCount,0);
    assert.equal((await readFirstOnboardingCompletion(audit,foreign.req.receipt.initialBindingSha256)).rowCount,0);
  } finally { await Promise.all([db.end(),reader.end(),...separate.map(c=>c.end())]); }
});
