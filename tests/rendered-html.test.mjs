import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
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

test("server-renders the stage 1 landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /FOUNDATION &amp; ROLES/);
  assert.match(html, /工作区边界/);
  assert.match(html, /服务端校验工作区或平台权限/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("renders login, registration, and unauthorized pages", async () => {
  const [login, register, unauthorized] = await Promise.all([
    render("/login"),
    render("/register"),
    render("/unauthorized?reason=platform_admin"),
  ]);

  assert.equal(login.status, 200);
  assert.match(await login.text(), /使用 ChatGPT 登录/);
  assert.equal(register.status, 200);
  assert.match(await register.text(), /首次使用 ChatGPT 登录后/);
  assert.equal(unauthorized.status, 200);
  assert.match(await unauthorized.text(), /当前账号不是平台管理员/);
});

test("protected pages redirect anonymous visitors through Sites sign-in", async () => {
  const [dashboard, admin] = await Promise.all([
    render("/dashboard"),
    render("/admin"),
  ]);

  assert.ok(dashboard.status >= 300 && dashboard.status < 400);
  assert.match(
    dashboard.headers.get("location") ?? "",
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

test("keeps secrets out of the committed environment example", async () => {
  const environment = await readFile(new URL(".env.example", templateRoot), "utf8");
  assert.doesNotMatch(environment, /sk-|PRIVATE_KEY|PASSWORD=/);
  assert.match(environment, /PLATFORM_ADMIN_EMAILS=owner@example\.com/);
});
