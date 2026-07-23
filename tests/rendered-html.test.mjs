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

test("server-renders the SaaS foundation landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /餐饮 SaaS 平台/);
  assert.match(html, /人工开通闭环/);
  assert.match(html, /workspace_id/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders customer and admin route foundations", async () => {
  const [dashboard, admin] = await Promise.all([
    render("/dashboard"),
    render("/admin"),
  ]);

  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /客户控制台/);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /管理概览/);
});

test("keeps secrets out of the public environment example", async () => {
  const environment = await readFile(new URL(".env.example", templateRoot), "utf8");
  assert.doesNotMatch(environment, /SECRET|PASSWORD|PRIVATE_KEY/);
});
