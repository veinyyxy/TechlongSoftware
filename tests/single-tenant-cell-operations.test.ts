import test from "node:test";
import assert from "node:assert/strict";
import { renderSingleTenantAcceptanceCell } from "../lib/deployments/cloudformation/single-tenant-acceptance-cell.ts";
import { ACCEPTANCE_CELL_SERVICE_ROLE, SingleTenantAcceptanceCellOperations, type AcceptanceCellSdkPort, type AcceptanceCellCreateReceipt } from "../lib/deployments/execution/single-tenant-cell-operations.ts";
import { v3Environment, v3Now } from "./fixtures/cell-stack-v3.ts";
const stackId = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/11111111-2222-3333-4444-555555555555";
const signal = () => new AbortController().signal;
async function fixture() {
  const draft = await renderSingleTenantAcceptanceCell({ environment: v3Environment(), availabilityZones: ["ca-central-1a", "ca-central-1b"],
    certificateArn: "arn:aws:acm:ca-central-1:402010193138:certificate/12345678-1234-1234-1234-123456789012",
    controlTrustStoreArn: "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/fixture/abc123", requestedAt: v3Now });
  let exists = false, foreign = false, status = "CREATE_COMPLETE";
  const calls: Record<string, unknown>[] = [];
  const consumed = new Set<string>(); let captured: AcceptanceCellCreateReceipt | undefined;
  const sdk: AcceptanceCellSdkPort = {
    identity: async () => ({ Account: "402010193138", Arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", UserId: "AIDAV3GNMXTZEO7SHLC2X" }),
    describe: async id => { calls.push({ describe: id }); return exists ? { stackId, status, roleArn: ACCEPTANCE_CELL_SERVICE_ROLE, tags: { ...draft.tags } } : null; },
    template: async () => structuredClone(draft.template),
    resources: async () => (foreign ? [...draft.resourceInventory, { logicalId: "Foreign", type: "AWS::IAM::Role" }] : draft.resourceInventory)
      .map(r => ({ ...r, physicalId: `physical-${r.logicalId}`, status: "CREATE_COMPLETE" })),
    create: async request => { calls.push({ create: request }); exists = true; return stackId; },
    delete: async request => { calls.push({ delete: request }); status = "DELETE_IN_PROGRESS"; },
  };
  const control = {
    beforeCreate: async () => { calls.push({ guard: "create" }); },
    beforeDelete: async () => { calls.push({ guard: "delete" }); },
    consume: async ({ action }: { action: string }) => { if (consumed.has(action)) throw Error("permanent attempt already consumed"); consumed.add(action); },
    captureCreated: async (r: AcceptanceCellCreateReceipt) => { captured = r; },
  };
  return { draft, sdk, control, operations: new SingleTenantAcceptanceCellOperations(sdk, control), calls, consumed,
    captured: () => captured, foreign: () => { foreign = true; }, absent: () => { exists = false; } };
}
test("Cell create captures service-generated UUID; exact owned delete submits STANDARD once", async () => {
  const f = await fixture(), receipt = await f.operations.create({ draft: f.draft, approvedReviewSha256: "a".repeat(64), signal: signal() });
  assert.equal(receipt.stackId, stackId); assert.deepEqual(receipt, f.captured());
  const create = f.calls.find(c => c.create)!.create as Record<string, unknown>;
  assert.equal(create.OnFailure, "ROLLBACK"); assert.equal(create.RoleARN, ACCEPTANCE_CELL_SERVICE_ROLE);
  assert.equal("DisableRollback" in create, false);
  assert.equal((await f.operations.inspect(receipt, signal()))!.resources.length, 25);
  const result = await f.operations.delete({ receipt, approvedReviewSha256: "b".repeat(64), signal: signal() });
  assert.equal(result.outcome, "DELETE_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT");
  const deletion = f.calls.find(c => c.delete)!.delete as Record<string, unknown>;
  assert.equal(deletion.StackName, stackId); assert.equal(deletion.DeletionMode, "STANDARD");
  assert.equal("RetainResources" in deletion, false); assert.equal("ForceDelete" in deletion, false);
  assert.equal((await f.operations.delete({ receipt, approvedReviewSha256: "b".repeat(64), signal: signal() })).outcome, "DELETE_IN_PROGRESS");
  assert.equal(f.calls.filter(c => c.delete).length, 1);
});
test("changed/unrecognized draft and name-only cleanup are rejected without writes", async () => {
  const f = await fixture();
  await assert.rejects(f.operations.create({ draft: structuredClone(f.draft), approvedReviewSha256: "a".repeat(64), signal: signal() }));
  f.draft.tags.CleanupMode = "foreign";
  await assert.rejects(f.operations.create({ draft: f.draft, approvedReviewSha256: "a".repeat(64), signal: signal() }));
  assert.equal(f.consumed.size, 0); assert.equal(f.calls.length, 0);
});
test("extra inventory or a changed UUID blocks deletion before consuming its slot", async () => {
  const f = await fixture(), receipt = await f.operations.create({ draft: f.draft, approvedReviewSha256: "a".repeat(64), signal: signal() });
  f.foreign();
  await assert.rejects(f.operations.delete({ receipt, approvedReviewSha256: "b".repeat(64), signal: signal() }), { code: "ACCEPTANCE_CELL_TEMPLATE_OR_INVENTORY_DRIFT" });
  assert.equal(f.consumed.has("delete"), false);
  await assert.rejects(f.operations.inspect({ ...receipt, stackId: "techlong-sandbox-cell-sandbox-1" }, signal()));
  assert.equal(f.calls.filter(c => c.delete).length, 0);
});
test("uncertain creation consumes one attempt and never auto-replays", async () => {
  const f = await fixture(); f.sdk.create = async () => { throw Error("unknown response"); };
  await assert.rejects(f.operations.create({ draft: f.draft, approvedReviewSha256: "a".repeat(64), signal: signal() }));
  assert.equal(f.consumed.has("create"), true); assert.equal(f.captured(), undefined);
  await assert.rejects(f.operations.create({ draft: f.draft, approvedReviewSha256: "a".repeat(64), signal: signal() }), /already consumed/);
});
test("missing reviewed control or foreign Source fails before Cell mutation", async () => {
  const f = await fixture(); assert.throws(() => new SingleTenantAcceptanceCellOperations(f.sdk, {} as never));
  f.sdk.identity = async () => ({ Account: "402010193138", Arn: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/test", UserId: "foreign" });
  await assert.rejects(f.operations.create({ draft: f.draft, approvedReviewSha256: "a".repeat(64), signal: signal() }), { code: "ACCEPTANCE_CELL_SOURCE_IDENTITY_MISMATCH" });
  assert.equal(f.consumed.size, 0);
});
