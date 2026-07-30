import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessPlatformAdmin,
  canAccessWorkspace,
  canManageWorkspace,
} from "../lib/auth/permissions.ts";

test("isolates ordinary users to their workspace memberships", () => {
  assert.equal(
    canAccessWorkspace({
      isPlatformAdmin: false,
      membershipWorkspaceIds: ["workspace-a"],
      requestedWorkspaceId: "workspace-a",
    }),
    true,
  );
  assert.equal(
    canAccessWorkspace({
      isPlatformAdmin: false,
      membershipWorkspaceIds: ["workspace-a"],
      requestedWorkspaceId: "workspace-b",
    }),
    false,
  );
});

test("allows platform admins to cross workspace boundaries", () => {
  assert.equal(
    canAccessWorkspace({
      isPlatformAdmin: true,
      membershipWorkspaceIds: [],
      requestedWorkspaceId: "workspace-b",
    }),
    true,
  );
});

test("blocks ordinary customers from platform administration", () => {
  assert.equal(canAccessPlatformAdmin(false), false);
  assert.equal(canAccessPlatformAdmin(true), true);
});

test("only workspace owners can manage workspace settings", () => {
  assert.equal(canManageWorkspace("owner"), true);
  assert.equal(canManageWorkspace("member"), false);
});
