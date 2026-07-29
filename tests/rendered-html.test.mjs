import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      ...init,
      headers: { accept: "text/html", ...(init.headers ?? {}) },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the launch-ready landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /LAUNCH READY/);
  assert.match(html, /客户服务 Dashboard/);
  assert.match(html, /管理员创建企业客户与套餐/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("renders login, registration, and unauthorized pages", async () => {
  const [login, register, unauthorized, suspendedWorkspace] = await Promise.all([
    render("/login"),
    render("/register"),
    render("/unauthorized?reason=platform_admin"),
    render("/unauthorized?reason=workspace_status"),
  ]);

  assert.equal(login.status, 200);
  assert.match(await login.text(), /使用 ChatGPT 登录/);
  assert.equal(register.status, 200);
  assert.match(await register.text(), /首次使用 ChatGPT 登录后/);
  assert.equal(unauthorized.status, 200);
  assert.match(await unauthorized.text(), /当前账号不是平台管理员/);
  assert.equal(suspendedWorkspace.status, 200);
  const suspendedHtml = await suspendedWorkspace.text();
  assert.match(suspendedHtml, /当前企业工作区已暂停或停用/);
  assert.doesNotMatch(suspendedHtml, /返回客户控制台/);
});

test("protected pages redirect anonymous visitors through Sites sign-in", async () => {
  const [dashboard, apps, billing, admin] = await Promise.all([
    render("/dashboard"),
    render("/dashboard/apps"),
    render("/dashboard/billing"),
    render("/admin"),
  ]);

  assert.ok(dashboard.status >= 300 && dashboard.status < 400);
  assert.match(
    dashboard.headers.get("location") ?? "",
    /\/signin-with-chatgpt\?return_to=%2Fdashboard/,
  );

  assert.ok(apps.status >= 300 && apps.status < 400);
  assert.match(
    apps.headers.get("location") ?? "",
    /\/signin-with-chatgpt\?return_to=%2Fdashboard/,
  );

  assert.ok(billing.status >= 300 && billing.status < 400);
  assert.match(
    billing.headers.get("location") ?? "",
    /\/signin-with-chatgpt\?return_to=%2Fdashboard/,
  );

  assert.ok(admin.status >= 300 && admin.status < 400);
  assert.match(
    admin.headers.get("location") ?? "",
    /\/signin-with-chatgpt\?return_to=%2Fadmin/,
  );
});

test("account API rejects anonymous requests", async () => {
  const response = await render("/api/account");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("launch-stage protected APIs reject anonymous requests", async () => {
  const [customers, plans, subscriptions, payments, instances, templates, workspaceBilling, workspaceApps, checkout] =
    await Promise.all([
    render("/api/admin/customers"),
    render("/api/admin/plans"),
    render("/api/admin/subscriptions"),
    render("/api/admin/payments"),
    render("/api/admin/instances"),
    render("/api/admin/templates"),
    render("/api/workspaces/workspace-a/billing"),
    render("/api/workspaces/workspace-a/apps"),
    render("/api/workspaces/workspace-a/checkout", { method: "POST" }),
  ]);

  assert.equal(customers.status, 401);
  assert.equal((await customers.json()).error.code, "UNAUTHORIZED");
  assert.equal(plans.status, 401);
  assert.equal((await plans.json()).error.code, "UNAUTHORIZED");
  assert.equal(subscriptions.status, 401);
  assert.equal((await subscriptions.json()).error.code, "UNAUTHORIZED");
  assert.equal(payments.status, 401);
  assert.equal((await payments.json()).error.code, "UNAUTHORIZED");
  assert.equal(instances.status, 401);
  assert.equal((await instances.json()).error.code, "UNAUTHORIZED");
  assert.equal(templates.status, 401);
  assert.equal((await templates.json()).error.code, "UNAUTHORIZED");
  assert.equal(workspaceBilling.status, 401);
  assert.equal((await workspaceBilling.json()).error.code, "UNAUTHORIZED");
  assert.equal(workspaceApps.status, 401);
  assert.equal((await workspaceApps.json()).error.code, "UNAUTHORIZED");
  assert.equal(checkout.status, 401);
  assert.equal((await checkout.json()).error.code, "UNAUTHORIZED");
});

test("keeps secrets out of the committed environment example", async () => {
  const environment = await readFile(new URL(".env.example", templateRoot), "utf8");
  assert.doesNotMatch(environment, /sk_(live|test)_[A-Za-z0-9]{16,}|PRIVATE_KEY|PASSWORD=/);
  assert.match(environment, /PLATFORM_ADMIN_EMAILS=owner@example\.com/);
  assert.match(environment, /STRIPE_SECRET_KEY=sk_test_replace_me/);
});
