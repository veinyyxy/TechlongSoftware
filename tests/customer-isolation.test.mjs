import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("customer billing and application APIs verify workspace access before returning data", async () => {
  const [billingApi, appsApi] = await Promise.all([
    read("app/api/workspaces/[workspaceId]/billing/route.ts"),
    read("app/api/workspaces/[workspaceId]/apps/route.ts"),
  ]);

  for (const source of [billingApi, appsApi]) {
    assert.match(source, /assertWorkspaceAccess\(account, workspaceId\)/);
    assert.match(source, /WORKSPACE_FORBIDDEN/);
  }
  assert.match(billingApi, /getWorkspaceBillingSummary\(workspaceId\)/);
  assert.match(appsApi, /listWorkspaceAppInstances\(workspaceId\)/);
});

test("customer pages query only the authenticated account workspace", async () => {
  const [dashboard, apps, billing] = await Promise.all([
    read("app/dashboard/page.tsx"),
    read("app/dashboard/apps/page.tsx"),
    read("app/dashboard/billing/page.tsx"),
  ]);

  for (const source of [dashboard, apps, billing]) {
    assert.match(source, /getDashboardAccount\(\)/);
    assert.match(source, /account\.workspace\.id/);
  }
});
