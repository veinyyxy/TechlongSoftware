import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createHandler,
  isEligibleCellStack,
  isOwnedTenantStackForCell,
  parseExpiresAt,
} = require("../ops/aws-sandbox/lambda/cell-janitor.cjs");

const now = Date.UTC(2026, 7, 9, 2);
const stackName = "techlong-sandbox-cell-sandbox-1";

function cellStack(overrides = {}) {
  return {
    StackName: stackName,
    StackStatus: "CREATE_COMPLETE",
    Tags: [
      { Key: "Environment", Value: "aws-sandbox" },
      { Key: "ManagedBy", Value: "techlong-cell-operator" },
      { Key: "CellId", Value: "cell-sandbox-1" },
      { Key: "ExpiresAt", Value: new Date(now - 1).toISOString() },
    ],
    ...overrides,
  };
}

function tenantStack(overrides = {}) {
  return {
    StackName: "techlong-sandbox-tenant-one",
    StackStatus: "CREATE_COMPLETE",
    Tags: [
      { Key: "Environment", Value: "aws-sandbox" },
      { Key: "ManagedBy", Value: "techlong-provisioner" },
      { Key: "CellId", Value: "cell-sandbox-1" },
    ],
    ...overrides,
  };
}

test("Cell Janitor parses only canonical UTC expiry timestamps", () => {
  assert.equal(parseExpiresAt("2026-08-09T02:00:00.000Z"), now);
  assert.equal(parseExpiresAt("2026-08-09T02:00:00Z"), null);
  assert.equal(parseExpiresAt("2026-02-30T02:00:00.000Z"), null);
});

test("Cell Janitor refuses tenant, shared-manager and future stacks", () => {
  assert.equal(
    isEligibleCellStack({ ...cellStack(), StackName: "techlong-sandbox-tenant-one" }, now),
    false,
  );
  assert.equal(
    isEligibleCellStack({
      ...cellStack(),
      Tags: cellStack().Tags.map((tag) =>
        tag.Key === "ManagedBy" ? { ...tag, Value: "techlong-provisioner" } : tag,
      ),
    }, now),
    false,
  );
  assert.equal(
    isEligibleCellStack({
      ...cellStack(),
      Tags: cellStack().Tags.map((tag) =>
        tag.Key === "ExpiresAt"
          ? { ...tag, Value: new Date(now + 60_000).toISOString() }
          : tag,
      ),
    }, now),
    false,
  );
});

test("Cell Janitor targeted cleanup deletes exactly one owned expired Cell", async () => {
  const deleted = [];
  const handler = createHandler(
    {
      listStackNames: async () => {
        throw new Error("targeted cleanup must not scan");
      },
      describeStack: async (name) => {
        assert.equal(name, stackName);
        return cellStack();
      },
      listTenantStacks: async () => [],
      deleteTenantStack: async () => {
        throw new Error("no tenant should be deleted");
      },
      deleteStack: async (name) => deleted.push(name),
    },
    () => now,
  );
  const result = await handler({
    schemaVersion: 1,
    action: "delete_shared_cell_stack",
    stackName,
    cellId: "cell-sandbox-1",
  });
  assert.deepEqual(result, { checked: 1, deleted: [stackName], skipped: [] });
  assert.deepEqual(deleted, [stackName]);
});

test("Cell Janitor drains an exactly owned tenant before deleting its Cell", async () => {
  const deletedTenants = [];
  let deletedCell = false;
  assert.equal(isOwnedTenantStackForCell(tenantStack(), "cell-sandbox-1"), true);
  assert.equal(
    isOwnedTenantStackForCell(
      tenantStack({
        Tags: tenantStack().Tags.map((tag) =>
          tag.Key === "CellId" ? { ...tag, Value: "cell-other" } : tag,
        ),
      }),
      "cell-sandbox-1",
    ),
    false,
  );
  const handler = createHandler(
    {
      listStackNames: async () => [],
      describeStack: async () => cellStack(),
      listTenantStacks: async () => [tenantStack()],
      deleteTenantStack: async (name) => deletedTenants.push(name),
      deleteStack: async () => {
        deletedCell = true;
      },
    },
    () => now,
  );
  await assert.rejects(
    handler({
      schemaVersion: 1,
      action: "delete_shared_cell_stack",
      stackName,
      cellId: "cell-sandbox-1",
    }),
    /tenant cleanup must finish/,
  );
  assert.deepEqual(deletedTenants, ["techlong-sandbox-tenant-one"]);
  assert.equal(deletedCell, false);
});

test("Cell Janitor malformed target performs zero deletes", async () => {
  let calls = 0;
  const handler = createHandler({
    listStackNames: async () => [],
    listTenantStacks: async () => [],
    deleteTenantStack: async () => {
      calls += 1;
    },
    describeStack: async () => {
      calls += 1;
      return cellStack();
    },
    deleteStack: async () => {
      calls += 1;
    },
  });
  await assert.rejects(
    handler({
      action: "delete_shared_cell_stack",
      stackName: "techlong-sandbox-tenant-one",
      cellId: "cell-sandbox-1",
    }),
    /invalid targeted cell cleanup request/,
  );
  assert.equal(calls, 0);
});
