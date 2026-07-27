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

test("stage 4 migrations preserve workspace isolation and application integrity", async () => {
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
      `INSERT INTO plans
       (id, name, description, price_amount, currency, billing_interval,
        status, features, limits, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      "pln_temp",
      "Temporary",
      "Temporary plan used to verify SET NULL",
      1900,
      "CAD",
      "month",
      JSON.stringify(["Temporary feature"]),
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

  const defaultProduct = database
    .prepare("SELECT id, name, slug, status FROM products WHERE id = ?")
    .get("prd_restaurant_order_system");
  assert.deepEqual(
    {
      id: defaultProduct.id,
      name: defaultProduct.name,
      slug: defaultProduct.slug,
      status: defaultProduct.status,
    },
    {
      id: "prd_restaurant_order_system",
      name: "餐饮订单系统",
      slug: "restaurant-order-system",
      status: "active",
    },
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

  database
    .prepare("UPDATE workspaces SET plan_id = ? WHERE id = ?")
    .run("pln_temp", "wsp_one");
  database.prepare("DELETE FROM plans WHERE id = ?").run("pln_temp");
  assert.equal(
    database.prepare("SELECT plan_id FROM workspaces WHERE id = ?").get("wsp_one")
      .plan_id,
    null,
  );

  database
    .prepare("UPDATE workspaces SET plan_id = ? WHERE id = ?")
    .run("pln_basic", "wsp_one");
  database
    .prepare(
      `INSERT INTO subscriptions
       (id, workspace_id, plan_id, status, current_period_start,
        current_period_end, cancel_at_period_end, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      "sub_one",
      "wsp_one",
      "pln_basic",
      now,
      now + 30 * 24 * 60 * 60 * 1000,
      "usr_one",
      now,
      now,
    );

  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO subscriptions
         (id, workspace_id, plan_id, status, current_period_start,
          current_period_end, cancel_at_period_end, created_by_user_id,
          created_at, updated_at)
         VALUES (?, ?, ?, 'manual_pending', ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        "sub_duplicate",
        "wsp_one",
        "pln_basic",
        now,
        now + 60 * 24 * 60 * 60 * 1000,
        "usr_one",
        now,
        now,
      );
  }, /UNIQUE constraint failed/);

  database
    .prepare(
      `INSERT INTO payment_records
       (id, workspace_id, subscription_id, amount, currency, status, paid_at,
        payment_method, reference, note, recorded_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "pay_one",
      "wsp_one",
      "sub_one",
      4900,
      "CAD",
      now,
      "Bank transfer",
      "BANK-001",
      "Manual payment",
      "usr_one",
      now,
      now,
    );

  const payment = database
    .prepare(
      `SELECT p.amount, p.currency, p.status, s.workspace_id
       FROM payment_records p
       INNER JOIN subscriptions s ON s.id = p.subscription_id
       WHERE p.id = ?`,
    )
    .get("pay_one");
  assert.deepEqual(
    {
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      workspaceId: payment.workspace_id,
    },
    {
      amount: 4900,
      currency: "CAD",
      status: "paid",
      workspaceId: "wsp_one",
    },
  );

  database
    .prepare(
      `INSERT INTO app_instances
       (id, workspace_id, product_id, subscription_id, name, slug, domain,
        access_url, tenant_key, status, provisioned_at, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      "app_one",
      "wsp_one",
      "prd_restaurant_order_system",
      "sub_one",
      "Example Orders",
      "example-orders",
      "orders.example.com",
      "https://orders.example.com/admin",
      "example_workspace",
      now,
      "usr_one",
      now,
      now,
    );

  const application = database
    .prepare(
      `SELECT ai.access_url, ai.status, ai.tenant_key, p.slug AS product_slug,
              s.workspace_id AS subscription_workspace_id
       FROM app_instances ai
       INNER JOIN products p ON p.id = ai.product_id
       INNER JOIN subscriptions s ON s.id = ai.subscription_id
       WHERE ai.id = ?`,
    )
    .get("app_one");
  assert.deepEqual(
    {
      accessUrl: application.access_url,
      status: application.status,
      tenantKey: application.tenant_key,
      productSlug: application.product_slug,
      workspaceId: application.subscription_workspace_id,
    },
    {
      accessUrl: "https://orders.example.com/admin",
      status: "active",
      tenantKey: "example_workspace",
      productSlug: "restaurant-order-system",
      workspaceId: "wsp_one",
    },
  );

  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO app_instances
         (id, workspace_id, product_id, name, slug, access_url, tenant_key,
          status, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(
        "app_duplicate_tenant",
        "wsp_one",
        "prd_restaurant_order_system",
        "Duplicate tenant",
        "duplicate-tenant",
        "https://orders.example.com/duplicate",
        "example_workspace",
        "usr_one",
        now,
        now,
      );
  }, /UNIQUE constraint failed/);

  assert.throws(() => {
    database.prepare("DELETE FROM plans WHERE id = ?").run("pln_basic");
  }, /FOREIGN KEY constraint failed/);

  assert.throws(() => {
    database
      .prepare("DELETE FROM products WHERE id = ?")
      .run("prd_restaurant_order_system");
  }, /FOREIGN KEY constraint failed/);

  database.prepare("DELETE FROM subscriptions WHERE id = ?").run("sub_one");
  assert.equal(
    database
      .prepare("SELECT subscription_id FROM payment_records WHERE id = ?")
      .get("pay_one").subscription_id,
    null,
  );
  assert.equal(
    database
      .prepare("SELECT subscription_id FROM app_instances WHERE id = ?")
      .get("app_one").subscription_id,
    null,
  );
  database.close();
});
