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

test("stage 2 migrations contain account, workspace, and plan structures", async () => {
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

  assert.doesNotMatch(
    sql,
    /CREATE TABLE `(subscriptions|payment_records|app_instances)`/,
  );
});
