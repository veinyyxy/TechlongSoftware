import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function readMigrations() {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return (
    await Promise.all(files.map((file) => readFile(new URL(file, directory), "utf8")))
  ).join("\n");
}

test("stage 4 migrations contain workspace-scoped products and application instances", async () => {
  const sql = await readMigrations();

  assert.match(sql, /CREATE TABLE `users`/);
  assert.match(sql, /`is_platform_admin` integer/);
  assert.match(sql, /CREATE TABLE `workspaces`/);
  assert.match(sql, /CREATE TABLE `workspace_members`/);
  assert.match(sql, /workspace_members_workspace_user_unique/);
  assert.match(sql, /CREATE TABLE `plans`/);
  assert.match(sql, /`price_amount` integer NOT NULL/);
  assert.match(sql, /`features` text/);
  assert.match(sql, /`limits` text/);
  assert.match(sql, /ADD `plan_id` text REFERENCES plans\(id\) ON DELETE SET NULL/);
  assert.match(sql, /ADD `subscription_status` text DEFAULT 'not_configured'/);
  assert.match(sql, /ADD `app_instance_status` text DEFAULT 'not_provisioned'/);
  assert.match(sql, /CREATE TABLE `subscriptions`/);
  assert.match(sql, /`workspace_id` text NOT NULL/);
  assert.match(sql, /`plan_id` text NOT NULL/);
  assert.match(sql, /`cancel_at_period_end` integer DEFAULT false NOT NULL/);
  assert.match(sql, /subscriptions_workspace_unique/);
  assert.match(sql, /CREATE TABLE `payment_records`/);
  assert.match(sql, /`amount` integer NOT NULL/);
  assert.match(sql, /`subscription_id` text/);
  assert.match(sql, /ON DELETE set null/);
  assert.match(sql, /CREATE TABLE `products`/);
  assert.match(sql, /`slug` text NOT NULL/);
  assert.match(sql, /restaurant-order-system/);
  assert.match(sql, /CREATE TABLE `app_instances`/);
  assert.match(sql, /`workspace_id` text NOT NULL/);
  assert.match(sql, /`product_id` text NOT NULL/);
  assert.match(sql, /`access_url` text NOT NULL/);
  assert.match(sql, /`tenant_key` text NOT NULL/);
  assert.match(sql, /app_instances_tenant_key_unique/);

  assert.doesNotMatch(sql, /CREATE TABLE `(deployments|webhooks)`/);
});
