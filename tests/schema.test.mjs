import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../drizzle/0000_minor_khan.sql", import.meta.url);

test("stage 1 migration contains only account and workspace tables", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /CREATE TABLE `users`/);
  assert.match(sql, /`is_platform_admin` integer/);
  assert.match(sql, /CREATE TABLE `workspaces`/);
  assert.match(sql, /CREATE TABLE `workspace_members`/);
  assert.match(sql, /workspace_members_workspace_user_unique/);

  assert.doesNotMatch(
    sql,
    /CREATE TABLE `(plans|subscriptions|payment_records|app_instances)`/,
  );
});
