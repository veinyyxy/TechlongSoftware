import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as config from "../lib/purchases/sandbox-first-purchase-config.ts";
import { sandboxPurchaseOrderId } from "../lib/purchases/sandbox-first-purchase.ts";

const require = createRequire(import.meta.url);
const code = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pageJs = code("../app/dashboard/billing/page.tsx");
const runtimeJs = code("../lib/purchases/sandbox-first-purchase-runtime.ts");
const link = ({ children, ...props }) => createElement("a", props, children);
const prohibited = () => assert.fail("Sandbox billing must not call a generic checkout, write, or reconciliation path");
function load(js, imports) {
  const mod = { exports: {} };
  const resolve = name => name === "react/jsx-runtime" ? require(name) : Object.hasOwn(imports, name) ? imports[name] : assert.fail("Unbound test import: "+name);
  new Function("require","exports","module",js)(resolve,mod.exports,mod);
  return mod.exports;
}
const workspaceId = "wsp_"+"a".repeat(24);
const orderId = await sandboxPurchaseOrderId(workspaceId);
const sessionUrl = "https://checkout.stripe.com/sandbox/checkout/cs_test_ExistingBilling#synthetic";
const owner = "usr_billing_owner_fixture";
const env = {
  TECHLONG_SANDBOX_FIRST_PURCHASE: "true",
  AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID: workspaceId,
  TECHLONG_SANDBOX_FIRST_PURCHASE_PLAN_ID: "pln_"+"a".repeat(32),
  AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID: "release_"+"a".repeat(32),
  TECHLONG_SANDBOX_FIRST_PURCHASE_IMAGE_URI: "402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:"+"a".repeat(64),
  TECHLONG_PLATFORM_INGRESS: "alb-https-v1",
  TECHLONG_PLATFORM_PUBLIC_ORIGIN: config.SANDBOX_PURCHASE_ORIGIN,
  TECHLONG_SANDBOX_STRIPE_TEST_KEY: "sk_test_synthetic_only",
  TECHLONG_SANDBOX_STRIPE_TEST_WEBHOOK_SECRET: "whsec_synthetic_only",
  DATABASE_URL: "postgresql://web:synthetic@fixed.neon.tech/sandbox?sslmode=verify-full",
  TECHLONG_SANDBOX_FIRST_PURCHASE_WEBHOOK_DB: `postgresql://${config.SANDBOX_PURCHASE_WEBHOOK_ROLE}:synthetic@fixed.neon.tech/sandbox?sslmode=verify-full`,
};

// Render the actual page and its checkout read adapter, substituting only
// authentication and the external dependencies. The SQL callback can be a
// real query against a disposable database with the restricted Web role.
export async function renderBillingFixture({
  actor = owner, workspace = workspaceId, role = "owner", admin = false, loggedIn = true, sandbox = true,
  query = prohibited, ordinary = {},
} = {}) {
  const purchases = load(runtimeJs, {
    "cloudflare:workers": { env: { ...env, TECHLONG_SANDBOX_FIRST_PURCHASE: sandbox ? "true" : "false" } },
    "@neondatabase/serverless": { neon: prohibited },
    "@/db": { getDatabase: () => ({ prepare: statement => ({ bind: (...values) => ({ first: async () => {
      assert.equal(statement,"SELECT sandbox_first_purchase.read_billing_order(?, ?) AS value");
      assert.equal(values.length,2);
      return {value:await query(statement.replace("?", "$1").replace("?", "$2"),values)};
    } }) }) }) },
    "@/lib/admin/management": { getPlan: prohibited },
    "@/lib/templates/validation": { resolveTemplateConfiguration: prohibited },
    "./sandbox-first-purchase-config": config,
    "./sandbox-first-purchase": {
      authenticateSharedStripeWebhook: prohibited, finishVerifiedSandboxFirstCheckout: prohibited,
      sandboxPurchaseOrderId, startSandboxFirstCheckout: prohibited,
    },
  });
  const page = load(pageJs, {
    "next/link": link,
    "@/components/billing/CancelAtPeriodEndButton": { CancelAtPeriodEndButton: prohibited },
    "@/components/billing/CheckoutSubscriptionButton": { CheckoutSubscriptionButton: prohibited },
    "@/components/billing/PendingPurchaseOrderActions": { PendingPurchaseOrderActions: prohibited },
    "@/lib/admin/management": { getPlan: prohibited },
    "@/lib/admin/presentation": { formatMoney: (a,c) => a+" "+c },
    "@/lib/auth/account": { getDashboardAccount: async () => {
      if (!loggedIn) throw Error("FIXTURE_AUTH_REQUIRED");
      return { user: { id: actor, isPlatformAdmin: admin }, workspace: { id: workspace }, membership: { role } };
    } },
    "@/lib/billing/management": { getWorkspaceBillingSummary: ordinary.summary ?? prohibited },
    "@/lib/billing/presentation": {},
    "@/lib/customer-dashboard/presentation": {},
    "@/lib/payments/stripe": { hasStripePaymentConfiguration: () => false },
    "@/lib/purchases/management": { listPurchaseOrders: ordinary.list ?? prohibited, reconcileWorkspaceExpiredSubscriptions: ordinary.reconcile ?? prohibited },
    "@/lib/purchases/sandbox-first-purchase-runtime": purchases,
  });
  return renderToStaticMarkup(await page.default());
}

test("signed-in Sandbox owner opens billing via one narrow read and can only follow the existing Checkout",async()=>{
  const calls=[];
  const row={orderId,amount:1500,currency:"CAD",status:"checkout_pending",checkoutUrl:sessionUrl};
  const html=await renderBillingFixture({query:(statement,args)=>{calls.push([statement,args]);return row;}});
  assert.match(html,/订阅与账单/);
  assert.match(html,/继续 Stripe 付款/);
  assert.ok(html.includes(`href="${sessionUrl}"`));
  assert.doesNotMatch(html,/取消订单|选择套餐|<form/);
  assert.deepEqual(calls,[["SELECT sandbox_first_purchase.read_billing_order($1, $2) AS value",[owner,orderId]]]);
  for (const inadmissible of [
    {...row,checkoutUrl:"https://checkout.stripe.com.invalid/cs_test_ExistingBilling"}, {...row,status:"paid"},
    {...row,checkoutUrl:null}, {...row,orderId:"ord_other"}, null,
  ]) {
    const refused=await renderBillingFixture({query:()=>inadmissible});
    assert.doesNotMatch(refused,/继续 Stripe 付款|href="https:\/\/checkout/);
  }
});

test("billing blocks anonymous, non-owners, admins and other workspaces before issuing the narrow SQL",async()=>{
  await assert.rejects(renderBillingFixture({loggedIn:false}),/FIXTURE_AUTH_REQUIRED/);
  for (const fixture of [{role:"member"},{admin:true},{workspace:"wsp_"+"b".repeat(24)}]) {
    const html=await renderBillingFixture(fixture);
    assert.match(html,/订阅与账单/);
    assert.doesNotMatch(html,/继续 Stripe 付款|href="https:\/\/checkout/);
  }
  const html=await renderBillingFixture({actor:"usr_claimed_owner",query:(_s,args)=>{
    assert.deepEqual(args,["usr_claimed_owner",orderId]);return null;
  }});
  assert.doesNotMatch(html,/继续 Stripe 付款|href="https:\/\/checkout/);
});

test("non-Sandbox billing keeps the original reconciliation and order paths",async()=>{
  const observed=[];
  await renderBillingFixture({sandbox:false,ordinary:{
    reconcile:id=>{assert.equal(id,workspaceId);observed.push("reconcile");},
    list:filter=>{assert.deepEqual(filter,{workspaceId});observed.push("list");return [];},
    summary:id=>{assert.equal(id,workspaceId);observed.push("summary");return { currentSubscriptions:[],historicalSubscriptions:[],payments:[] };},
  }});
  assert.deepEqual(observed,["reconcile","summary","list"]);
});
