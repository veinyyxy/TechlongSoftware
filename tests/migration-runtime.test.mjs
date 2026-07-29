import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function readMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return Promise.all(files.map(async (file) => ({
    file,
    sql: await readFile(new URL(file, directory), "utf8"),
  })));
}

function applyMigration(database, migration, transactional = false) {
  const sql = migration.sql.replaceAll("--> statement-breakpoint", "");
  database.exec(transactional ? `BEGIN;\n${sql}\nCOMMIT;` : sql);
}

test("multi-product migration backfills existing subscriptions without losing history links", async () => {
  const migrations = await readMigrations();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const previousMigrations = migrations.filter(({ file }) => file < "0007_");
  const productSubscriptionMigrations = migrations.filter(
    ({ file }) => file >= "0007_",
  );
  assert.equal(productSubscriptionMigrations.length, 4);
  for (const migration of previousMigrations) applyMigration(database, migration);

  const now = Date.now();
  database
    .prepare(
      `INSERT INTO users
       (id, email, name, status, is_platform_admin, created_at, updated_at)
       VALUES ('usr_upgrade', 'upgrade@example.com', 'Upgrade Owner', 'active', 0, ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO plans
       (id, name, description, price_amount, currency, billing_interval,
        status, features, limits, created_at, updated_at)
       VALUES ('pln_upgrade', 'Upgrade Plan', '', 4900, 'CAD', 'month',
        'active', '[]', '{}', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO workspaces
       (id, name, owner_id, status, plan_id, created_at, updated_at)
       VALUES ('wsp_upgrade', 'Upgrade Workspace', 'usr_upgrade', 'active',
        'pln_upgrade', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO subscriptions
       (id, workspace_id, plan_id, status, current_period_start,
        current_period_end, cancel_at_period_end, created_by_user_id,
        created_at, updated_at)
       VALUES ('sub_upgrade', 'wsp_upgrade', 'pln_upgrade', 'active', ?, ?, 0,
        'usr_upgrade', ?, ?)`,
    )
    .run(now, now + 1_000_000, now, now);
  database
    .prepare(
      `INSERT INTO payment_records
       (id, workspace_id, subscription_id, amount, currency, status,
       payment_method, recorded_by_user_id, created_at, updated_at)
       VALUES ('pay_upgrade', 'wsp_upgrade', 'sub_upgrade', 4900, 'CAD',
        'pending', 'Migration test', 'usr_upgrade', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO payment_records
       (id, workspace_id, subscription_id, amount, currency, status,
        payment_method, recorded_by_user_id, created_at, updated_at)
       VALUES ('pay_upgrade_new', 'wsp_upgrade', 'sub_upgrade', 4900, 'CAD',
        'pending', 'Migration test', 'usr_upgrade', ?, ?)`,
    )
    .run(now + 1, now + 1);
  database
    .prepare(
      `INSERT INTO app_instances
       (id, workspace_id, product_id, subscription_id, name, slug, access_url,
        tenant_key, status, created_by_user_id, created_at, updated_at)
       VALUES ('app_upgrade', 'wsp_upgrade', 'prd_restaurant_order_system',
        'sub_upgrade', 'Upgrade App', 'upgrade-app', 'https://example.com',
        'upgrade_app', 'active', 'usr_upgrade', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO payment_checkout_sessions
       (id, workspace_id, plan_id, payment_record_id, initiated_by_user_id,
        provider, checkout_url, status, created_at, updated_at)
       VALUES ('chk_upgrade_new', 'wsp_upgrade', 'pln_upgrade',
        'pay_upgrade_new', 'usr_upgrade', 'stripe',
        'https://checkout.stripe.com/test-new', 'creating', ?, ?)`,
    )
    .run(now + 1, now + 1);

  database
    .prepare(
      `INSERT INTO payment_checkout_sessions
       (id, workspace_id, plan_id, payment_record_id, initiated_by_user_id,
        provider, provider_session_id, checkout_url, status, created_at, updated_at)
       VALUES ('chk_upgrade', 'wsp_upgrade', 'pln_upgrade', 'pay_upgrade',
        'usr_upgrade', 'stripe', 'cs_upgrade', 'https://checkout.stripe.com/test',
        'open', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO payment_webhook_events
       (id, provider, provider_event_id, event_type, checkout_session_id,
        payload_hash, processing_status, received_at)
       VALUES ('evt_upgrade', 'stripe', 'evt_upgrade_provider',
        'checkout.session.completed', 'chk_upgrade', 'hash', 'pending', ?)`,
    )
    .run(now);

  for (const migration of productSubscriptionMigrations) {
    applyMigration(database, migration, true);
  }

  const upgraded = database
    .prepare(
      `SELECT product_id FROM subscriptions WHERE id = 'sub_upgrade'`,
    )
    .get();
  assert.equal(upgraded.product_id, "prd_restaurant_order_system");
  assert.equal(
    database
      .prepare("SELECT product_id FROM plans WHERE id = 'pln_upgrade'")
      .get().product_id,
    "prd_restaurant_order_system",
  );
  assert.deepEqual(
    {
      planTemplateVersionId: database
        .prepare("SELECT template_version_id FROM plans WHERE id = 'pln_upgrade'")
        .get().template_version_id,
      subscriptionTemplateVersionId: database
        .prepare(
          "SELECT template_version_id FROM subscriptions WHERE id = 'sub_upgrade'",
        )
        .get().template_version_id,
    },
    {
      planTemplateVersionId: "tplver_restaurant_standard_v1",
      subscriptionTemplateVersionId: "tplver_restaurant_standard_v1",
    },
  );
  assert.equal(
    database
      .prepare("SELECT subscription_id FROM payment_records WHERE id = 'pay_upgrade'")
      .get().subscription_id,
    "sub_upgrade",
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT id, subscription_id, status
         FROM payment_checkout_sessions
         WHERE id IN ('chk_upgrade', 'chk_upgrade_new')
         ORDER BY id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        id: "chk_upgrade",
        subscription_id: "sub_upgrade",
        status: "open",
      },
      {
        id: "chk_upgrade_new",
        subscription_id: "sub_upgrade",
        status: "expired",
      },
    ],
  );
  assert.equal(
    database
      .prepare("SELECT status FROM payment_records WHERE id = 'pay_upgrade_new'")
      .get().status,
    "canceled",
  );
  assert.equal(
    database
      .prepare(
        "SELECT subscription_id FROM payment_checkout_sessions WHERE id = 'chk_upgrade'",
      )
      .get().subscription_id,
    "sub_upgrade",
  );
  assert.equal(
    database
      .prepare(
        "SELECT checkout_session_id FROM payment_webhook_events WHERE id = 'evt_upgrade'",
      )
      .get().checkout_session_id,
    "chk_upgrade",
  );
  assert.equal(
    database
      .prepare("SELECT subscription_id FROM app_instances WHERE id = 'app_upgrade'")
      .get().subscription_id,
    "sub_upgrade",
  );

  const indexes = database
    .prepare("PRAGMA index_list('subscriptions')")
    .all()
    .map((row) => row.name);
  assert.equal(indexes.includes("subscriptions_workspace_unique"), false);
  assert.equal(
    indexes.includes("subscriptions_workspace_product_current_unique"),
    true,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'trigger'
           AND name LIKE 'subscriptions_product_required_%'`,
      )
      .get().count,
    2,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'trigger'
           AND name LIKE 'plans_product_required_%'`,
      )
      .get().count,
    2,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'trigger'
           AND name LIKE 'subscriptions_plan_product_match_%'`,
      )
      .get().count,
    2,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'trigger'
           AND name LIKE 'payment_checkout_sessions_subscription_required_%'`,
      )
      .get().count,
    2,
  );
  assert.equal(
    database
      .prepare("PRAGMA foreign_key_list('subscriptions')")
      .all()
      .find((foreignKey) => foreignKey.from === "product_id")?.on_delete,
    "RESTRICT",
  );
  assert.equal(
    database
      .prepare("PRAGMA foreign_key_list('plans')")
      .all()
      .find((foreignKey) => foreignKey.from === "product_id")?.on_delete,
    "RESTRICT",
  );
  assert.equal(
    database
      .prepare("PRAGMA foreign_key_list('payment_checkout_sessions')")
      .all()
      .find((foreignKey) => foreignKey.from === "subscription_id")?.on_delete,
    "CASCADE",
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO subscriptions
         (id, workspace_id, product_id, plan_id, status, current_period_start,
          current_period_end, cancel_at_period_end, created_by_user_id,
          created_at, updated_at)
         VALUES ('sub_null_product', 'wsp_upgrade', NULL, 'pln_upgrade',
          'canceled', ?, ?, 0, 'usr_upgrade', ?, ?)`,
      )
      .run(now, now + 1_000_000, now, now),
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO plans
         (id, product_id, name, description, price_amount, currency,
          billing_interval, status, features, limits, created_at, updated_at)
         VALUES ('pln_null_product', NULL, 'Invalid', '', 1000, 'CAD',
          'month', 'active', '[]', '{}', ?, ?)`,
      )
      .run(now, now),
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO payment_checkout_sessions
         (id, workspace_id, subscription_id, plan_id, payment_record_id,
          initiated_by_user_id, provider, status, created_at, updated_at)
         VALUES ('chk_upgrade_duplicate', 'wsp_upgrade', 'sub_upgrade',
          'pln_upgrade', 'pay_upgrade', 'usr_upgrade', 'stripe', 'creating',
          ?, ?)`,
      )
      .run(now, now),
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO payment_checkout_sessions
         (id, workspace_id, subscription_id, plan_id, payment_record_id,
          initiated_by_user_id, provider, status, created_at, updated_at)
         VALUES ('chk_null_subscription', 'wsp_upgrade', NULL, 'pln_upgrade',
          'pay_upgrade', 'usr_upgrade', 'stripe', 'failed', ?, ?)`,
      )
      .run(now, now),
  );
  assert.equal(
    database.prepare("PRAGMA foreign_keys").get().foreign_keys,
    1,
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("launch data flow preserves workspace isolation and application integrity", async () => {
  const migrations = await readMigrations();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) {
    applyMigration(database, migration, true);
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
       (id, product_id, template_version_id, name, description, price_amount, currency,
        billing_interval, status, features, limits, created_at, updated_at)
       VALUES (?, ?, 'tplver_restaurant_standard_v1', ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      "pln_basic",
      "prd_restaurant_order_system",
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
       (id, product_id, template_version_id, name, description, price_amount, currency,
        billing_interval, status, features, limits, created_at, updated_at)
       VALUES (?, ?, 'tplver_restaurant_standard_v1', ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      "pln_temp",
      "prd_restaurant_order_system",
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
  database
    .prepare(
      `INSERT INTO products
       (id, name, slug, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      "prd_inventory",
      "库存管理系统",
      "inventory-system",
      "Second product for subscription isolation",
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO app_instance_templates
       (id, product_id, name, description, status, created_at, updated_at)
       VALUES ('tpl_inventory_standard', 'prd_inventory', '库存系统标准模板',
        '', 'active', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO app_instance_template_versions
       (id, template_id, version, configuration_schema, default_configuration,
        deployment_driver, deployment_workflow_version, status, created_at, updated_at)
       VALUES ('tplver_inventory_standard_v1', 'tpl_inventory_standard', 1,
        '{"fields":[]}', '{}', 'manual', 'v1', 'published', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO plans
       (id, product_id, template_version_id, name, description, price_amount, currency,
        billing_interval, status, features, limits, created_at, updated_at)
       VALUES (?, ?, 'tplver_inventory_standard_v1', ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      "pln_inventory_basic",
      "prd_inventory",
      "Basic",
      "Inventory starter plan",
      2900,
      "CAD",
      "month",
      JSON.stringify(["Inventory management"]),
      JSON.stringify({ locations: "1" }),
      now,
      now,
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
       (id, workspace_id, product_id, plan_id, template_version_id,
        instance_configuration, status, current_period_start,
        current_period_end, cancel_at_period_end, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1',
        '{"storeName":"Example Workspace","theme":"classic","visitorLimit":100}',
        'active', ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      "sub_one",
      "wsp_one",
      "prd_restaurant_order_system",
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
         (id, workspace_id, product_id, plan_id, template_version_id,
          instance_configuration, status, current_period_start,
          current_period_end, cancel_at_period_end, created_by_user_id,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1',
          '{"storeName":"Example Workspace","theme":"classic","visitorLimit":100}',
          'manual_pending', ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        "sub_duplicate",
        "wsp_one",
        "prd_restaurant_order_system",
        "pln_basic",
        now,
        now + 60 * 24 * 60 * 60 * 1000,
        "usr_one",
        now,
        now,
      );
  }, /UNIQUE constraint failed/);

  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO subscriptions
         (id, workspace_id, product_id, plan_id, template_version_id,
          instance_configuration, status, current_period_start,
          current_period_end, cancel_at_period_end, created_by_user_id,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1', '{}',
          'active', ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        "sub_inventory_wrong_plan",
        "wsp_one",
        "prd_inventory",
        "pln_basic",
        now,
        now + 30 * 24 * 60 * 60 * 1000,
        "usr_one",
        now,
        now,
      ),
  );
  database
    .prepare(
      `INSERT INTO subscriptions
       (id, workspace_id, product_id, plan_id, template_version_id,
        instance_configuration, status, current_period_start,
        current_period_end, cancel_at_period_end, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tplver_inventory_standard_v1', '{}',
        'active', ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      "sub_inventory",
      "wsp_one",
      "prd_inventory",
      "pln_inventory_basic",
      now,
      now + 30 * 24 * 60 * 60 * 1000,
      "usr_one",
      now,
      now,
    );
  assert.throws(() =>
    database
      .prepare("UPDATE plans SET product_id = ? WHERE id = ?")
      .run("prd_inventory", "pln_basic"),
  );

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

  assert.equal(
    database
      .prepare("SELECT provider FROM payment_records WHERE id = ?")
      .get("pay_one").provider,
    "manual",
  );

  database
    .prepare(
      `INSERT INTO payment_checkout_sessions
       (id, workspace_id, subscription_id, plan_id, payment_record_id,
        initiated_by_user_id, provider, provider_session_id, checkout_url,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'stripe', ?, ?, 'open', ?, ?)`,
    )
    .run(
      "chk_one",
      "wsp_one",
      "sub_one",
      "pln_basic",
      "pay_one",
      "usr_one",
      "cs_test_one",
      "https://checkout.stripe.com/c/pay/cs_test_one",
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO payment_webhook_events
       (id, provider, provider_event_id, event_type, checkout_session_id,
        payload_hash, processing_status, received_at)
       VALUES (?, 'stripe', ?, ?, ?, ?, 'processed', ?)`,
    )
    .run(
      "evt_one",
      "evt_test_one",
      "checkout.session.completed",
      "chk_one",
      "sha256:test",
      now,
    );
  assert.throws(() => {
    database
      .prepare(
        `INSERT INTO payment_webhook_events
         (id, provider, provider_event_id, event_type, payload_hash, processing_status, received_at)
         VALUES (?, 'stripe', ?, ?, ?, 'pending', ?)`,
      )
      .run("evt_duplicate", "evt_test_one", "checkout.session.completed", "sha256:duplicate", now);
  }, /UNIQUE constraint failed/);

  database
    .prepare(
      `INSERT INTO app_instances
       (id, workspace_id, product_id, subscription_id, template_version_id,
        configuration_snapshot, name, slug, domain,
        access_url, tenant_key, status, provisioned_at, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1',
        '{"storeName":"Example Workspace","theme":"classic","visitorLimit":100}',
        ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
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
      `SELECT ai.access_url, ai.seller_apk_url, ai.status, ai.tenant_key,
              p.slug AS product_slug,
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
      sellerApkUrl: application.seller_apk_url,
      status: application.status,
      tenantKey: application.tenant_key,
      productSlug: application.product_slug,
      workspaceId: application.subscription_workspace_id,
    },
    {
      accessUrl: "https://orders.example.com/admin",
      sellerApkUrl: "",
      status: "active",
      tenantKey: "example_workspace",
      productSlug: "restaurant-order-system",
      workspaceId: "wsp_one",
    },
  );

  assert.equal(
    database.prepare("SELECT provisioning_source FROM app_instances WHERE id = ?")
      .get("app_one").provisioning_source,
    "manual",
  );

  database
    .prepare(
      `INSERT INTO workspaces
       (id, name, owner_id, status, plan_id, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run("wsp_two", "Automatic Workspace", "usr_one", "pln_basic", now, now);
  database
    .prepare(
      `INSERT INTO subscriptions
       (id, workspace_id, product_id, plan_id, template_version_id,
        instance_configuration, status, current_period_start,
        current_period_end, cancel_at_period_end, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1',
        '{"storeName":"Automatic Workspace","theme":"classic","visitorLimit":100}',
        'active', ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      "sub_two",
      "wsp_two",
      "prd_restaurant_order_system",
      "pln_basic",
      now,
      now + 30 * 24 * 60 * 60 * 1000,
      "usr_one",
      now,
      now,
    );
  database
    .prepare(
      `INSERT INTO app_instances
       (id, workspace_id, product_id, subscription_id, template_version_id,
        configuration_snapshot, name, slug, domain,
        access_url, tenant_key, provisioning_source, status, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1',
        '{"storeName":"Automatic Workspace","theme":"classic","visitorLimit":100}',
        ?, ?, NULL, '', ?, 'payment_success', 'pending', ?, ?, ?)`,
    )
    .run(
      "app_auto_pending",
      "wsp_two",
      "prd_restaurant_order_system",
      "sub_two",
      "Automatic Workspace - 餐饮订单系统",
      "pending-app-auto",
      "pending_app_auto",
      "usr_one",
      now,
      now,
    );
  const autoPendingInstance = database
    .prepare(
      `SELECT subscription_id, provisioning_source, status, access_url, seller_apk_url
       FROM app_instances WHERE id = ?`,
    )
    .get("app_auto_pending");
  assert.deepEqual(
    { ...autoPendingInstance },
    {
      subscription_id: "sub_two",
      provisioning_source: "payment_success",
      status: "pending",
      access_url: "",
      seller_apk_url: "",
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
        "example_second",
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

  database
    .prepare("UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?")
    .run(now + 1, "sub_one");
  database
    .prepare(
      `INSERT INTO subscriptions
       (id, workspace_id, product_id, plan_id, template_version_id,
        instance_configuration, status, current_period_start,
        current_period_end, cancel_at_period_end, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1',
        '{"storeName":"Example Workspace","theme":"warm","visitorLimit":100}',
        'manual_pending', ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      "sub_restaurant_renewed",
      "wsp_one",
      "prd_restaurant_order_system",
      "pln_basic",
      now + 2,
      now + 60 * 24 * 60 * 60 * 1000,
      "usr_one",
      now + 2,
      now + 2,
    );

  assert.throws(() => {
    database
      .prepare("UPDATE subscriptions SET status = 'active' WHERE id = ?")
      .run("sub_one");
  }, /UNIQUE constraint failed/);
  database
    .prepare(
      "UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?",
    )
    .run(now + 3, "sub_restaurant_renewed");
  database
    .prepare(
      `INSERT INTO subscriptions
       (id, workspace_id, product_id, plan_id, template_version_id,
        instance_configuration, status, current_period_start,
        current_period_end, cancel_at_period_end, created_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'tplver_restaurant_standard_v1',
        '{"storeName":"Example Workspace","theme":"minimal","visitorLimit":100}',
        'active', ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      "sub_restaurant_third",
      "wsp_one",
      "prd_restaurant_order_system",
      "pln_basic",
      now + 4,
      now + 90 * 24 * 60 * 60 * 1000,
      "usr_one",
      now + 4,
      now + 4,
    );
  assert.throws(() => {
    database
      .prepare("UPDATE subscriptions SET status = 'active' WHERE id = ?")
      .run("sub_restaurant_renewed");
  }, /UNIQUE constraint failed/);
  assert.deepEqual(
    database
      .prepare(
        `SELECT id, status FROM subscriptions
         WHERE workspace_id = ? AND product_id = ?
         ORDER BY created_at`,
      )
      .all("wsp_one", "prd_restaurant_order_system")
      .map((row) => ({ ...row })),
    [
      { id: "sub_one", status: "canceled" },
      { id: "sub_restaurant_renewed", status: "canceled" },
      { id: "sub_restaurant_third", status: "active" },
    ],
  );
  assert.equal(
    database
      .prepare("SELECT subscription_id FROM payment_records WHERE id = ?")
      .get("pay_one").subscription_id,
    "sub_one",
  );
  assert.equal(
    database
      .prepare("SELECT subscription_id FROM app_instances WHERE id = ?")
      .get("app_one").subscription_id,
    "sub_one",
  );
  database.close();
});
