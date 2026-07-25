import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("stage 1 migration applies and enforces one membership per user/workspace", async () => {
  const migration = await readFile(
    new URL("../drizzle/0000_minor_khan.sql", import.meta.url),
    "utf8",
  );
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));

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
      `INSERT INTO workspaces
       (id, name, owner_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .run("wsp_one", "Example Workspace", "usr_one", now, now);
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
  database.close();
});
