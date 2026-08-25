import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createHandler,
  isEligibleCellStack,
  isOwnedTenantStackForCell,
  parseExpiresAt,
  assertRuntimeActionEnabled,
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

test("Cell Janitor empty inventory inspection returns one strict read-only result", async () => {
  const calls = [];
  const handler = createHandler({
    listStackNames: async () => {
      calls.push("list");
      return [];
    },
    listTenantStacks: async () => {
      calls.push("list-tenants");
      return [];
    },
    describeStack: async () => calls.push("describe"),
    deleteTenantStack: async () => calls.push("delete-tenant"),
    deleteStack: async () => calls.push("delete-cell"),
  });
  const result = await handler({
    schemaVersion: 1,
    action: "inspect_empty_shared_cell_inventory",
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    action: "inspect_empty_shared_cell_inventory",
    empty: true,
    checked: 0,
    candidates: [],
    deleted: [],
  });
  assert.deepEqual(calls, ["list"]);
});

test("Cell Janitor empty inventory inspection reports candidates without deleting", async () => {
  const calls = [];
  const handler = createHandler({
    listStackNames: async () => {
      calls.push("list");
      return [
        "techlong-sandbox-cell-z-last",
        "techlong-sandbox-cell-sandbox-1",
      ];
    },
    listTenantStacks: async () => {
      calls.push("list-tenants");
      return [];
    },
    describeStack: async () => calls.push("describe"),
    deleteTenantStack: async () => calls.push("delete-tenant"),
    deleteStack: async () => calls.push("delete-cell"),
  });
  const result = await handler({
    schemaVersion: 1,
    action: "inspect_empty_shared_cell_inventory",
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    action: "inspect_empty_shared_cell_inventory",
    empty: false,
    checked: 2,
    candidates: [
      "techlong-sandbox-cell-sandbox-1",
      "techlong-sandbox-cell-z-last",
    ],
    deleted: [],
  });
  assert.deepEqual(calls, ["list"]);
});

test("Cell Janitor empty inventory inspection rejects invalid schema before inventory access", async () => {
  let calls = 0;
  const handler = createHandler({
    listStackNames: async () => {
      calls += 1;
      return [];
    },
  });
  for (const event of [
    { action: "inspect_empty_shared_cell_inventory" },
    { schemaVersion: "1", action: "inspect_empty_shared_cell_inventory" },
    { schemaVersion: 2, action: "inspect_empty_shared_cell_inventory" },
    {
      schemaVersion: 1,
      action: "inspect_empty_shared_cell_inventory",
      stackName,
    },
  ]) {
    await assert.rejects(
      handler(event),
      /invalid empty Shared Cell inventory request/,
    );
  }
  assert.equal(calls, 0);
});

test("Cell Janitor empty inventory inspection is idempotent and never deletes", async () => {
  let lists = 0;
  let mutations = 0;
  const handler = createHandler({
    listStackNames: async () => {
      lists += 1;
      return [];
    },
    listTenantStacks: async () => {
      mutations += 1;
      return [];
    },
    describeStack: async () => {
      mutations += 1;
    },
    deleteTenantStack: async () => {
      mutations += 1;
    },
    deleteStack: async () => {
      mutations += 1;
    },
  });
  const event = {
    schemaVersion: 1,
    action: "inspect_empty_shared_cell_inventory",
  };
  const first = await handler(event);
  const second = await handler(event);
  assert.deepEqual(second, first);
  assert.equal(lists, 2);
  assert.equal(mutations, 0);
});

test("deployed J4b runtime permits only the read-only empty inventory action", () => {
  const lockedEnvironment = {
    EXPECTED_ACCOUNT_ID: "402010193138",
    EXPECTED_REGION: "ca-central-1",
    EXPECTED_CELL_ID: "cell-sandbox-1",
    AWS_REGION: "ca-central-1",
    CELL_MUTATION_ENABLED: "false",
  };
  assert.doesNotThrow(() =>
    assertRuntimeActionEnabled(
      { schemaVersion: 1, action: "inspect_empty_shared_cell_inventory" },
      lockedEnvironment,
    ),
  );
  assert.throws(
    () =>
      assertRuntimeActionEnabled(
        { schemaVersion: 1, action: "scan_expired_shared_cell_stacks" },
        lockedEnvironment,
      ),
    /mutation actions are disabled/,
  );
  assert.throws(
    () =>
      assertRuntimeActionEnabled(
        { schemaVersion: 1, action: "inspect_empty_shared_cell_inventory" },
        { ...lockedEnvironment, EXPECTED_ACCOUNT_ID: "000000000000" },
      ),
    /invalid Shared Cell Janitor runtime environment/,
  );
});
