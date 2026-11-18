import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { assertRuntimeEnvironment, buildEnvironment } from "../ops/platform-hosting-v1/contract.mjs";
import { checkIngress, ingressPolicy, PUBLIC_ORIGIN } from "../ops/platform-hosting-v1/ingress.mjs";
import { SANDBOX_PURCHASE_WEBHOOK_ROLE, readSandboxPurchaseConfiguration } from "../lib/purchases/sandbox-first-purchase-config.ts";
import { finishSandboxFirstCheckout, sandboxPurchaseOrderId, SANDBOX_PURCHASE_SQL, startSandboxFirstCheckout } from "../lib/purchases/sandbox-first-purchase.ts";
import { randomId } from "../lib/domain/ids.ts";
import { sandboxFirstPurchaseDdl } from "../ops/platform-web-database-role-v1/sandbox-first-purchase-ddl.ts";
import { buildDeploymentClaimStatement } from "../lib/deployments/lease.ts";
import { buildFirstOnboardingJob, FIRST_ONBOARDING_HOLD_AT, SELECT_FIRST_ONBOARDING } from "../lib/deployments/first-onboarding.ts";

const scope = {
  workspaceId: "wsp_" + "a".repeat(24), planId: randomId("pln"),
  releaseId: "release_" + "a".repeat(32),
  imageUri: "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:" + "a".repeat(64),
};
const web = "techlong_platform_web_acceptance_v1", webhook = SANDBOX_PURCHASE_WEBHOOK_ROLE;
const testKey = "sk_test_synthetic_only", signingSecret = "whsec_synthetic_only";
const orderId = await sandboxPurchaseOrderId(scope.workspaceId);
const sessionId = "cs_test_SandboxOne", hostedUrl = "https://checkout.stripe.com/c/pay/" + sessionId + "#synthetic";
const actor = "usr_synthetic_owner", templateId = "tplver_restaurant_standard_v1";
const purchase = { scope, workspaceId: scope.workspaceId, actor, customerEmail: "owner@example.invalid",
  planId: scope.planId, templateId, planName: "Synthetic", planDescription: "", configuration: { storeName: "Synthetic", theme: "classic" },
  amount: 1500, currency: "CAD", testKey };
const cfg = {
  TECHLONG_PLATFORM_INGRESS: "alb-https-v1", TECHLONG_PLATFORM_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
  TECHLONG_SANDBOX_FIRST_PURCHASE: "true", AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID: scope.workspaceId,
  TECHLONG_SANDBOX_FIRST_PURCHASE_PLAN_ID: scope.planId, AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID: scope.releaseId,
  TECHLONG_SANDBOX_FIRST_PURCHASE_IMAGE_URI: scope.imageUri, TECHLONG_SANDBOX_STRIPE_TEST_KEY: testKey,
  TECHLONG_SANDBOX_STRIPE_TEST_WEBHOOK_SECRET: signingSecret,
  DATABASE_URL: "postgresql://web:synthetic@fixed.neon.tech/sandbox?sslmode=verify-full",
  TECHLONG_SANDBOX_FIRST_PURCHASE_WEBHOOK_DB: `postgresql://${webhook}:synthetic@fixed.neon.tech/sandbox?sslmode=verify-full`,
};
function event(object = {}, envelope = {}) {
  return { id: "evt_SandboxOne", type: "checkout.session.completed", livemode: false,
    data: { object: { id: sessionId, livemode: false, mode: "payment", status: "complete", payment_status: "paid",
      payment_intent: "pi_SandboxOne", client_reference_id: orderId, metadata: { subscription_purchase_order_id: orderId },
      amount_total: 1500, currency: "cad", ...object } }, ...envelope };
}
function signed(e) {
  const payload = JSON.stringify(e), time = Math.floor(Date.now() / 1000);
  return { payload, signature: `t=${time},v1=${createHmac("sha256", signingSecret).update(`${time}.${payload}`).digest("hex")}` };
}
function mockStripe(t, overrides = {}) {
  return t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(options.headers.authorization, "Bearer " + testKey);
    assert.equal(options.headers["idempotency-key"], "checkout_" + orderId);
    assert.equal(options.redirect, "error");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("metadata[subscription_purchase_order_id]"), orderId);
    assert.equal(body.get("client_reference_id"), orderId);
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1500");
    return Response.json({ id: sessionId, url: hostedUrl, livemode: false, expires_at: Math.floor(Date.now() / 1000) + 3600, ...overrides });
  });
}

test("first purchase accepts generated and legacy plan IDs without accepting malformed IDs", () => {
  const configured = (planId) => readSandboxPurchaseConfiguration({ ...cfg, TECHLONG_SANDBOX_FIRST_PURCHASE_PLAN_ID: planId });
  assert.equal(configured(scope.planId)?.planId, scope.planId);
  assert.equal(configured("plan_first_purchase_test")?.planId, "plan_first_purchase_test");
  assert.ok(sandboxFirstPurchaseDdl(scope).includes(`p_requested_plan IS DISTINCT FROM '${scope.planId}'`));
  for (const planId of ["pln_" + "a".repeat(31), "pln_" + "A".repeat(32), scope.planId + "0", scope.planId + "\n", scope.planId + "'"]) {
    assert.equal(configured(planId), null);
    assert.throws(() => sandboxFirstPurchaseDdl({ ...scope, planId }), /Invalid sandbox first purchase scope/);
  }
});

test("closed hosting rejects live credentials, unbound database and enabled worker; only the exact opted-in callback bypasses browser Origin", () => {
  assert.doesNotThrow(() => assertRuntimeEnvironment(cfg));
  assert.deepEqual(readSandboxPurchaseConfiguration(cfg)?.workspaceId, scope.workspaceId);
  assert.equal(buildEnvironment(cfg).TECHLONG_SANDBOX_STRIPE_TEST_KEY, undefined);
  assert.throws(() => assertRuntimeEnvironment({ ...cfg, TECHLONG_SANDBOX_STRIPE_TEST_KEY: "sk_live_synthetic_secret" }));
  assert.throws(() => assertRuntimeEnvironment({ ...cfg, TECHLONG_SANDBOX_FIRST_PURCHASE: "false" }));
  assert.throws(() => assertRuntimeEnvironment({ ...cfg, DEPLOYMENT_WORKER_ENABLED: "true" }));
  assert.throws(() => assertRuntimeEnvironment({ ...cfg, TECHLONG_SANDBOX_FIRST_PURCHASE_WEBHOOK_DB: cfg.DATABASE_URL }));
  const trusted = ingressPolicy(cfg, { host: "0.0.0.0", port: 3000 });
  const closed = ingressPolicy({ ...cfg, TECHLONG_SANDBOX_FIRST_PURCHASE: "false" }, { host: "0.0.0.0", port: 3000 });
  const request = (url, fields = {}) => {
    const headers = { host: new URL(PUBLIC_ORIGIN).host, "x-forwarded-proto": "https", "x-forwarded-port": "443",
      "stripe-signature": signed(event()).signature, ...fields };
    return { url, method: "POST", headers, rawHeaders: Object.entries(headers).flat() };
  };
  assert.equal(checkIngress(request("/api/stripe/webhook"), trusted), 0);
  assert.equal(checkIngress(request("/api/stripe/webhook"), closed), 403);
  assert.equal(checkIngress(request("/api/stripe/webhook?anything"), trusted), 403);
  assert.equal(checkIngress(request("/api/stripe/webhook", { cookie: "session=some" }), trusted), 403);
  assert.equal(checkIngress(request("/api/stripe/webhook", { origin: "https://other.invalid" }), trusted), 403);
  assert.equal(checkIngress(request("/api/stripe/webhook", { "stripe-signature": "" }), trusted), 403);
  const duplicate = request("/api/stripe/webhook");
  duplicate.rawHeaders.push("Stripe-Signature", signed(event()).signature);
  assert.equal(checkIngress(duplicate, trusted), 400);
  assert.throws(() => sandboxFirstPurchaseDdl({ ...scope, workspaceId: scope.workspaceId + "'" }));
});

test("mis-scoped and live/unsigned callbacks never reach the completion database", async () => {
  const invoke = (signedEvent) => finishSandboxFirstCheckout({ scope, signingSecret, ...signedEvent,
    webhook: async () => assert.fail("must not query") });
  for (const e of [event({}, { livemode: true }), event({ livemode: true }), event({ payment_status: "unpaid" }),
    event({ metadata: { subscription_purchase_order_id: "ord_other" } }), event({ client_reference_id: "ord_other" })]) {
    assert.equal(await invoke(signed(e)), "ignored");
  }
  await assert.rejects(invoke({ ...signed(event()), signature: "bad" }), /signature/);
  assert.equal(await startSandboxFirstCheckout({ ...purchase, workspaceId: "another", web: async () => assert.fail("must not query") }), null);
  assert.equal(await startSandboxFirstCheckout({ ...purchase, planId: randomId("pln"), web: async () => assert.fail("must not query") }), null);
});

test("a live Checkout response is rejected after one reservation and no attachment", async (t) => {
  const stripe = mockStripe(t, { livemode: true });
  const webPort = async (stmt) => {
    assert.equal(stmt, SANDBOX_PURCHASE_SQL.reserve);
    return { orderId, created: true };
  };
  await assert.rejects(startSandboxFirstCheckout({ ...purchase, web: webPort }));
  assert.equal(stripe.mock.callCount(), 1);
});

const testUrl = process.env.INSTANCE_RELEASE_TEST_DATABASE_URL;
test("disposable PostgreSQL and simulated signed Stripe: one checkout, one atomic held job, no general Web writes", { skip: !testUrl, timeout: 25000 }, async (t) => {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.CI, "true");
  const url = new URL(testUrl);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/instance_release_ci");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "synthetic-ci-only");
  assert.equal(url.search + url.hash, "");
  const connect = (uri) => new pg.Client({ connectionString: String(uri), statement_timeout: 5000 });
  const admin = connect(url);
  url.pathname = "/sandbox_first_purchase_ci";
  const db = connect(url);
  const login = (name) => { const auth = new URL(url); auth.username = name; return connect(auth); };
  const shopper = login(web), callback = login(webhook), callback2 = login(webhook);
  const sql = (db) => async (text, args) => {
    let n = 0;
    return (await db.query(text.replaceAll("?", () => "$"+ ++n), args)).rows[0]?.value ?? null;
  };
  try {
    await admin.connect();
    await admin.query("CREATE DATABASE sandbox_first_purchase_ci");
    await db.connect();
    await db.query(await readFile(new URL("../db/postgres-schema.sql", import.meta.url), "utf8"));
    // The registration regression in the same disposable cluster may have already created the Web role.
    await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${web}')
      THEN CREATE ROLE ${web} LOGIN NOINHERIT PASSWORD 'synthetic-ci-only'; END IF; END $$;
      CREATE ROLE ${webhook} LOGIN NOINHERIT PASSWORD 'synthetic-ci-only';`);
    await db.query(`INSERT INTO public.users(id,email,name,created_at,updated_at) VALUES ($1,'owner@example.invalid','Synthetic',1,1)`, [actor]);
    await db.query("INSERT INTO public.workspaces(id,name,owner_id,created_at,updated_at) VALUES ($1,'Synthetic Workspace',$2,1,1)", [scope.workspaceId,actor]);
    await db.query("INSERT INTO public.workspace_members(id,workspace_id,user_id,role,joined_at) VALUES ('synthetic_owner',$1,$2,'owner',1)", [scope.workspaceId,actor]);
    await db.query(`INSERT INTO public.plans(id,product_id,template_version_id,name,price_amount,currency,billing_interval,created_at,updated_at)
      VALUES ($1,'prd_restaurant_order_system',$2,'Synthetic',1500,'CAD','month',1,1)`, [scope.planId,templateId]);
    await db.query(sandboxFirstPurchaseDdl(scope));
    await Promise.all([shopper.connect(), callback.connect(), callback2.connect()]);
    for (const table of ["payment_records", "subscription_purchase_orders", "subscriptions", "app_instances",
      "workspace_product_entitlements", "app_instance_deployments", "deployment_jobs", "payment_webhook_events"]) {
      const { rows: [acl] } = await db.query(
        "SELECT has_any_column_privilege($1,$2,'INSERT,UPDATE') AS direct_write, has_table_privilege($1,$2,'DELETE,TRUNCATE') AS destructive",
        [web, "public." + table]);
      assert.deepEqual(acl, { direct_write: false, destructive: false }, table);
    }
    const shopperPort = sql(shopper), webhookPort = sql(callback);
    assert.equal(await shopperPort(SANDBOX_PURCHASE_SQL.reserve,
      ["usr_other", scope.workspaceId, scope.planId, scope.releaseId, scope.imageUri, templateId, "{}", 1500, "CAD"]), null);
    assert.equal(await shopperPort(SANDBOX_PURCHASE_SQL.reserve,
      [actor, scope.workspaceId, randomId("pln"), scope.releaseId, scope.imageUri, templateId, "{}", 1500, "CAD"]), null);
    assert.equal(await shopperPort(SANDBOX_PURCHASE_SQL.reserve,
      [actor, scope.workspaceId, scope.planId, "release_wrong", scope.imageUri, templateId, "{}", 1500, "CAD"]), null);
    await assert.rejects(shopper.query("UPDATE public.payment_records SET status='paid'"), { code: "42501" });
    await assert.rejects(shopper.query("SELECT sandbox_first_purchase.webhook_order($1)", [orderId]), { code: "42501" });
    await assert.rejects(shopper.query("SELECT sandbox_first_purchase.complete(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)"), { code: "42501" });
    await assert.rejects(callback.query("UPDATE public.deployment_jobs SET status='running'"), { code: "42501" });
    await assert.rejects(callback.query("SELECT sandbox_first_purchase.read_order($1,$2)", [actor, orderId]), { code: "42501" });
    const stripe = mockStripe(t);
    const create = () => startSandboxFirstCheckout({ ...purchase, web: shopperPort });
    assert.deepEqual(await create(), { purchaseOrderId: orderId, checkoutUrl: hostedUrl, reused: false });
    assert.deepEqual(await create(), { purchaseOrderId: orderId, checkoutUrl: hostedUrl, reused: true });
    assert.equal(stripe.mock.callCount(), 1);
    const deliver = (e, port = webhookPort) => finishSandboxFirstCheckout({ scope, signingSecret, ...signed(e), webhook: port });
    const readOrder = () => shopperPort(SANDBOX_PURCHASE_SQL.read, [actor, orderId]);
    assert.equal((await readOrder()).status, "checkout_pending");
    assert.equal(await deliver(event({ id: "cs_test_Other" })), "ignored");
    await assert.rejects(deliver(event({ amount_total: 1 })));
    await db.query("ALTER TABLE public.deployment_jobs ADD CONSTRAINT forced_failure_ci CHECK (id='deliberately_invalid')");
    await assert.rejects(deliver(event()), { code: "23514", constraint: "forced_failure_ci" });
    assert.equal((await readOrder()).status, "checkout_pending");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.subscriptions")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.app_instances")).rows[0].n, 0);
    await db.query("ALTER TABLE public.deployment_jobs DROP CONSTRAINT forced_failure_ci");
    assert.deepEqual((await Promise.all([deliver(event()), deliver(event(), sql(callback2))])).sort(), ["accepted", "duplicate"]);
    assert.equal(await deliver(event({}, { id: "evt_SandboxTwo" })), "duplicate");
    assert.equal(await create(), null);
    assert.equal((await readOrder()).status, "paid");
    for (const [table, status] of [["subscriptions","active"],["app_instances","pending"],["app_instance_deployments","planned"],
      ["deployment_jobs","pending"],["payment_records","paid"],["subscription_purchase_orders","paid"],["workspace_product_entitlements","pending"]]) {
      assert.deepEqual((await db.query(`SELECT status FROM public.${table}`)).rows, [{ status }], table);
    }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.payment_webhook_events")).rows[0].n, 1);
    const { rows: [job] } = await db.query("SELECT id,payload,available_at,attempts,max_attempts FROM public.deployment_jobs");
    const parsed = JSON.parse(job.payload);
    const built = await buildFirstOnboardingJob(parsed.scope);
    assert.deepEqual(parsed, built.payload);
    assert.equal(job.id, built.jobId);
    assert.equal(Number(job.available_at), FIRST_ONBOARDING_HOLD_AT);
    assert.equal(job.attempts, 0);
    assert.equal(job.max_attempts, 1);
    const { rows: [review] } = await db.query(SELECT_FIRST_ONBOARDING, [job.id]);
    assert.equal(review.scopeStillEligible, true);
    assert.equal(review.instancePendingFirstOpen, true);
    // Even if a due time is visible, ordinary claim must exclude held jobs.
    await db.query("UPDATE public.deployment_jobs SET available_at=0 WHERE id=$1", [job.id]);
    const claim = buildDeploymentClaimStatement({ workerId: "worker:ci", now: Date.now(), leaseDurationMs: 5000,
      leaseToken: "lease_" + "a".repeat(32), jobType: "apply" });
    let n = 0;
    assert.equal((await db.query(claim.sql.replaceAll("?", () => "$"+ ++n), claim.bindings)).rowCount, 0);
  } finally {
    await Promise.allSettled([shopper.end(), callback.end(), callback2.end(), db.end(), admin.end()]);
  }
});
