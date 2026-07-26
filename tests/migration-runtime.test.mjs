import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function readMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return Promise.all(
    files.map((file) => readFile(new URL(file, directory), "utf8")),
  );
}

test("stage 2 migrations preserve membership isolation and add plan-backed customer state", async () => {
  const migrations = await readMigrations();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) {
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }

  const now = Date.now();
  database
    .prepare(
      `INSERT INTO users
       (id, email, name, status, is_platform_admin, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 0, ?, ?)`,
    )
    .run("usr_one", "owner@example.com", "Owner", now, now);
  database
    .prepare(
      `INSERT INTO plans
       (id, name, description, price_amount, currency, billing_interval,
        status, features, limits, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      "pln_basic",
      "Basic",
      "Single restaurant",
      4900,
      "CAD",
      "month",
      JSON.stringify(["Order management"]),
      JSON.stringify({ stores: "1" }),
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO workspaces
       (id, name, owner_id, status, contact_name, contact_email, plan_id,
        created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    )
    .run(
      "wsp_one",
      "Example Workspace",
      "usr_one",
      "Owner",
      "owner@example.com",
      "pln_basic",
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO workspace_members
       (id, workspace_id, user_id, role, joined_at)
       VALUES (?, ?, ?, 'owner', ?)`,
    )
    .run("wsm_one", "wsp_one", "usr_one", now);

  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO workspace_members
         (id, workspace_id, user_id, role, joined_at)
         VALUES (?, ?, ?, 'member', ?)`,
      )
      .run("wsm_duplicate", "wsp_one", "usr_one", now);
  }, /UNIQUE constraint failed/);

  const membership = database
    .prepare(
      `SELECT wm.role, w.name
       FROM workspace_members wm
       INNER JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = ?`,
    )
    .get("usr_one");

  assert.deepEqual(
    { role: membership.role, name: membership.name },
    { role: "owner", name: "Example Workspace" },
  );

  const workspace = database
    .prepare(
      `SELECT plan_id, subscription_status, app_instance_status
       FROM workspaces WHERE id = ?`,
    )
    .get("wsp_one");
  assert.deepEqual(
    {
      planId: workspace.plan_id,
      subscriptionStatus: workspace.subscription_status,
      appInstanceStatus: workspace.app_instance_status,
    },
    {
      planId: "pln_basic",
      subscriptionStatus: "not_configured",
      appInstanceStatus: "not_provisioned",
    },
  );

  database.prepare("DELETE FROM plans WHERE id = ?").run("pln_basic");
  assert.equal(
    database.prepare("SELECT plan_id FROM workspaces WHERE id = ?").get("wsp_one")
      .plan_id,
    null,
  );
  database.close();
});
