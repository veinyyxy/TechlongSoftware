import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("health status reports the current released platform phase", async () => {
  const source = await read("app/api/health/route.ts");
  assert.match(source, /platformConfig/);
  assert.match(source, /phase: platformConfig\.phase/);
  assert.doesNotMatch(source, /phase:\s*["']foundation["']/);
});

test("suspended and disabled customers are not sent into a dashboard redirect loop", async () => {
  const source = await read("app/unauthorized/page.tsx");
  assert.match(source, /reason !== "workspace_status"/);
  assert.match(source, /canReturnToDashboard/);
});

test("README documents startup, hosted admin initialization, and launch scope", async () => {
  const readme = await read("README.md");
  assert.match(readme, /PLATFORM_ADMIN_EMAILS/);
  assert.match(readme, /ChatGPT 登录/);
  assert.match(readme, /Stripe、Paddle、真实在线支付/);
});
