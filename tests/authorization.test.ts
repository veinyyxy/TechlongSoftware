import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessWorkspace,
  canManageWorkspace,
  isPlatformAdminEmail,
  normalizeEmail,
  parseAdminEmailAllowlist,
} from "../lib/auth/permissions.ts";

test("normalizes and deduplicates platform admin emails", () => {
  assert.equal(normalizeEmail(" Owner@Example.COM "), "owner@example.com");
  assert.deepEqual(
    parseAdminEmailAllowlist(
      "owner@example.com, ADMIN@example.com,owner@example.com",
    ),
    ["owner@example.com", "admin@example.com"],
  );
  assert.equal(
    isPlatformAdminEmail("ADMIN@EXAMPLE.COM", [
      "owner@example.com",
      "admin@example.com",
    ]),
    true,
  );
});

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

test("only workspace owners can manage workspace settings", () => {
  assert.equal(canManageWorkspace("owner"), true);
  assert.equal(canManageWorkspace("member"), false);
});
