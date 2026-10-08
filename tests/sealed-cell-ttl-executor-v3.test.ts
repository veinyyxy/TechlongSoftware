import assert from "node:assert/strict";
import test from "node:test";
import { sha256Hex, canonicalJson } from "../lib/deployments/execution/hash.ts";
import { now, sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";
import { SealedCellAuthorityOwnershipEvidenceAdapterV3, compileSealedCellCleanupAuthorityCandidateV3 } from "../lib/deployments/execution/sealed-cell-cleanup-evidence-v3.ts";
import { authorizeSealedCellAuthorityRecordV3, decodeSealedCellAuthorityRecordV3, validateSealedOwnershipStateV3 } from "../lib/deployments/execution/sealed-cell-cleanup-authority-v3.ts";
import { createPreparedSealedCellTtlExecutorV3, validateSealedCellDeleteIntentV3, type SealedCellCleanupJournalV3,
  type SealedCellDeleteIntentV3, type SealedCellDeleteReceiptV3 } from "../lib/deployments/execution/prepared-sealed-cell-ttl-executor-v3.ts";
import { AwsSdkSealedCellCleanupJournalV3, AwsSdkSealedCellAuthorityReaderV3, AwsSdkSealedCellAuthorityInstallerV3,
  createAwsSdkPreparedSealedCellTtlExecutorV3 } from "../lib/deployments/execution/aws-sdk-sealed-cell-cleanup-v3.ts";
import { handler } from "../ops/aws-sandbox/lambda/cell-ttl-executor-v3.ts";
import { validateDedicatedCellCleanupIntentV2 } from "../lib/deployments/execution/prepared-cell-ttl-janitor.ts";
import type { SealedCellStackReadPortV3 } from "../lib/deployments/execution/shared-cell-cleanup-deletion.ts";

const signal = () => new AbortController().signal;
const template = { AWSTemplateFormatVersion: "2010-09-09", Resources: { CellLogGroup: { Type: "AWS::Logs::LogGroup" } } };
const inventory = [{ logicalResourceId: "CellLogGroup", physicalResourceId: "/aws/techlong/cell-sandbox-1", resourceStatus: "CREATE_COMPLETE", resourceType: "AWS::Logs::LogGroup" }];
async function fixture() {
  const f = await sealedEvidenceFixture({}, { templateCanonicalSha256: await sha256Hex(template), resourceInventorySha256: await sha256Hex(inventory) });
  const certificateSha256 = await sha256Hex(f.cert);
  const proof = await new SealedCellAuthorityOwnershipEvidenceAdapterV3(f.source, { now: () => now }).readFreshZeroOwnershipEvidence({ predecessor: f.predecessor, signal: signal() });
  const candidate = await compileSealedCellCleanupAuthorityCandidateV3({ predecessor: f.predecessor, stack: f.stack, ownership: proof, cleanupEpoch: 2, expiresAt: now + 60_000, now });
  const record = await authorizeSealedCellAuthorityRecordV3({ candidate, approvedCandidateSha256: candidate.recordSha256, certificateSha256, now });
  const state = { missing: false, deletes: 0, claims: 0, puts: 0, caller: "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellTtlExecutorRole/sealed-test",
    names: [] as string[], lostDelete: false, lostClaim: false, lostReceipt: false, keepPresent: false, failStatus: "", templateDrift: false,
    intent: null as SealedCellDeleteIntentV3 | null, receipt: null as SealedCellDeleteReceiptV3 | null };
  const stack: SealedCellStackReadPortV3 = { region: "ca-central-1",
    async getCallerIdentity() { return { accountId: "402010193138", arn: state.caller }; },
    async listStackNamesPage() { return { nextToken: null, stackNames: [...state.names, ...(state.missing ? [] : [f.predecessor.stackName])] }; },
    async describeCellStack() { return state.missing ? { state: "missing", proof: "NAME_BOUND_VALIDATION_ERROR", stackName: f.predecessor.stackName } :
      { state: "present", stack: { stackName: f.predecessor.stackName, stackId: f.predecessor.stackId, stackStatus: state.failStatus || "CREATE_COMPLETE",
        roleArn: f.predecessor.cloudFormationRoleArn, terminationProtection: false, parentId: null, rootId: null,
        tags: { Environment: "aws-sandbox", ManagedBy: "techlong-cell-operator", CellId: "cell-sandbox-1", ExpiresAt: f.predecessor.cellExpiresAt } } }; },
    async getOriginalTemplate() { return state.templateDrift ? { ...template, Description: "drift" } : template; },
    async listStackResourcesPage() { return { nextToken: null, resources: inventory }; },
  };
  const journal: SealedCellCleanupJournalV3 = {
    async readStrong() { return { intent: state.intent, receipt: state.receipt }; },
    async claimIntent({ intent }) { state.claims++; if (state.intent) return false; state.intent = intent;
      if (state.lostClaim) throw new Error("lost"); return true; },
    async publishReceipt({ receipt }) { state.puts++; if (!state.receipt) state.receipt = receipt; if (state.lostReceipt) throw new Error("lost"); },
  };
  const dependencies = { source: f.source, certificateSha256, stack, authority: { readStrong: async () => record }, journal,
    deleter: { async deleteStack({ request }: { request: Record<string, unknown> }) {
      state.deletes++; assert.equal(request.StackName, f.predecessor.stackId); assert.equal(request.RoleARN, f.predecessor.cloudFormationRoleArn);
      assert.equal(request.DeletionMode, "STANDARD"); assert.match(String(request.ClientRequestToken), /^cell-delete-[a-f0-9]{64}$/);
      assert.equal("RetainResources" in request, false);
      if (!state.keepPresent) state.missing = true; if (state.lostDelete) throw new Error("lost"); return { operation: "delete_submitted" };
    } }, now: () => now, readbackAttempts: 1, readbackDelayMs: 0 };
  const root = createPreparedSealedCellTtlExecutorV3(dependencies);
  const event = async () => ({ schemaVersion: 3, action: "execute_reviewed_sealed_cell_ttl_cleanup", approvedDeletionPlanSha256: (await root.inspect(signal())).planSha256 });
  return { ...f, candidate, record, certificateSha256, state, root, event, dependencies };
}

test("durable v3 roundtrip binds full certificate and witness; copied candidate and old records cannot be promoted", async () => {
  const f = await fixture(); assert.deepEqual(await decodeSealedCellAuthorityRecordV3(structuredClone(f.record), f.certificateSha256), f.record);
  await assert.rejects(authorizeSealedCellAuthorityRecordV3({ candidate: structuredClone(f.candidate), approvedCandidateSha256: f.candidate.recordSha256, certificateSha256: f.certificateSha256, now }));
  await assert.rejects(decodeSealedCellAuthorityRecordV3({ ...f.record, schemaVersion: 2 }, f.certificateSha256));
  await assert.rejects(decodeSealedCellAuthorityRecordV3({ ...f.record, certificateSha256: "0".repeat(64) }, f.certificateSha256));
  const bad = structuredClone(f.record.candidate.ownershipState); bad.rawOwnershipWitness.nonterminalDeploymentIds = [];
  await assert.rejects(validateSealedOwnershipStateV3(bad, f.certificateSha256));
});

test("one permanent CAS winner invokes one exact STANDARD DeleteStack, verifies independently, and replays historical receipt", async () => {
  const f = await fixture(), e = await f.event(); const result = await f.root.run(e, signal());
  assert.equal(result.receipt.outcome, "DELETED"); assert.equal(f.state.deletes, 1); assert.equal(f.state.claims, 1);
  assert.equal(result.receipt.intent.plan.ownershipState.sealedCertificates[0].approved_registration_sha256, f.cert.approved_registration_sha256);
  assert.equal(result.cloudRuntimeInstalled, false);
  const replay = await f.root.run(e, signal()); assert.equal(replay.historicalReceiptReplay, true); assert.equal(f.state.deletes, 1);
  await assert.rejects(validateDedicatedCellCleanupIntentV2(result.receipt.intent, e.approvedDeletionPlanSha256));
});

test("lost DeleteStack/receipt responses are recovered without either write being retried", async () => {
  const f = await fixture(), e = await f.event(); f.state.lostDelete = true; f.state.lostReceipt = true;
  const result = await f.root.run(e, signal()); assert.equal(result.receipt.outcome, "RECOVERED");
  assert.equal(f.state.deletes, 1); assert.equal(f.state.puts, 1); await f.root.run(e, signal()); assert.equal(f.state.deletes, 1);
});

test("lost slot response never delegates deletion; restart is recovery-only even if no delete happened", async () => {
  const f = await fixture(), e = await f.event(); f.state.lostClaim = true;
  await assert.rejects(f.root.run(e, signal())); assert.equal(f.state.deletes, 0);
  await assert.rejects(createPreparedSealedCellTtlExecutorV3(f.dependencies).run(e, signal())); assert.equal(f.state.deletes, 0); assert.equal(f.state.claims, 1);
  f.state.missing = true; const result = await f.root.run(e, signal()); assert.equal(result.receipt.mutationAttempted, false);
});

test("failed/unfinished deletion is not resubmitted on restart", async () => {
  const f = await fixture(), e = await f.event(); f.state.keepPresent = true;
  await assert.rejects(f.root.run(e, signal())); assert.equal(f.state.deletes, 1);
  f.state.failStatus = "DELETE_FAILED"; await assert.rejects(f.root.run(e, signal())); assert.equal(f.state.deletes, 1);
});

test("wrong role, dependent stack, template drift, nonzero source and wrong approval all stop before deletion", async () => {
  for (const mutation of [(f: Awaited<ReturnType<typeof fixture>>) => { f.state.caller = "arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellJanitorExecutionRole/old-test"; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state.names = ["techlong-sandbox-tenant-unapproved"]; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state.templateDrift = true; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.results[5].rows = [{ id: "live_capacity" }]; }]) {
    const f = await fixture(), e = await f.event(); mutation(f); await assert.rejects(f.root.run(e, signal())); assert.equal(f.state.deletes, 0);
  }
  const f = await fixture(); await assert.rejects(f.root.run({ ...(await f.event()), approvedDeletionPlanSha256: "0".repeat(64) }, signal())); assert.equal(f.state.claims, 0);
});

test("slow slot and raw-witness drift are rechecked before the actuator", async () => {
  const f = await fixture(), e = await f.event(); let time = now;
  const root = createPreparedSealedCellTtlExecutorV3({ ...f.dependencies, now: () => time,
    journal: { ...f.dependencies.journal, async claimIntent(input) { const result = await f.dependencies.journal.claimIntent(input); time += 30_001; return result; } } });
  await assert.rejects(root.run(e, signal())); assert.equal(f.state.deletes, 0); assert.equal(f.state.claims, 1);
  const g = await fixture(), ge = await g.event();
  const changed = createPreparedSealedCellTtlExecutorV3({ ...g.dependencies, journal: { ...g.dependencies.journal,
    async claimIntent(input) { const result = await g.dependencies.journal.claimIntent(input); g.results[3].rows = []; g.results[4].rows = []; return result; } } });
  await assert.rejects(changed.run(ge, signal())); assert.equal(g.state.deletes, 0);
});

test("restart read-only recovery is allowed after authority expiry, never another DeleteStack", async () => {
  const f = await fixture(), e = await f.event(); f.state.lostClaim = true; await assert.rejects(f.root.run(e, signal())); f.state.missing = true;
  const later = now + 60_001; f.results[1].rows[0].observed_at = later;
  const root = createPreparedSealedCellTtlExecutorV3({ ...f.dependencies, now: () => later });
  const result = await root.run(e, signal()); assert.equal(result.receipt.outcome, "RECOVERED"); assert.equal(f.state.deletes, 0);
});

class Command { readonly input: Record<string, unknown>; constructor(input: Record<string, unknown>) { this.input = input; } }
test("SDK atomic authority reads bind unchanged provision; installer transaction is absent-only and never rewrites old records", async () => {
  const f = await fixture(); const calls: Record<string, unknown>[] = [];
  const sdk = { client: { async send(command: unknown) { const input = (command as Command).input; calls.push(input);
    if (input.TransactItems && !(input.TransactItems as Record<string, unknown>[])[0].ConditionCheck) return { Responses: [
      { Item: { authority_key: f.record.authorityKey, schema_version: 3, revision: f.record.revision, record_json: canonicalJson(f.record) } },
      { Item: { authority_key: "cell:cell-sandbox-1", schema_version: 2, revision: f.predecessor.revision, record_json: canonicalJson(f.predecessor) } },
    ] }; return {}; } }, commands: { get: Command, put: Command, transactGet: Command, transactWrite: Command } };
  const reader = new AwsSdkSealedCellAuthorityReaderV3(sdk, f.certificateSha256); assert.deepEqual(await reader.readStrong({ signal: signal() }), f.record);
  const installer = new AwsSdkSealedCellAuthorityInstallerV3(sdk, f.certificateSha256, () => now);
  await installer.installOnce({ record: f.record, approvedRecordSha256: f.record.recordSha256, signal: signal() });
  const operations = calls[1].TransactItems as Record<string, Record<string, unknown>>[];
  assert.equal(operations.length, 2); assert(operations[0].ConditionCheck); assert.equal(operations[1].Put.ConditionExpression, "attribute_not_exists(#key)");
  assert.equal(operations.some(o => o.Update || o.Delete), false);
});

test("SDK journal uses isolated v3 keys, strong read and absent-only writes; uncertainty is not retried", async () => {
  const f = await fixture(); const intent = await f.root.inspect(signal()); const calls: Record<string, unknown>[] = [];
  const items = new Map<string, unknown>();
  const sdk = { client: { async send(c: unknown) { const i = (c as Command).input; calls.push(i);
    if (i.Item) { const item = i.Item as Record<string, unknown>; items.set(String(item.authority_key), item); throw new Error("lost"); }
    return { Item: items.get(String((i.Key as Record<string, unknown>).authority_key)) }; } }, commands: { get: Command, put: Command, transactGet: Command } };
  const journal = new AwsSdkSealedCellCleanupJournalV3(sdk, f.certificateSha256);
  await assert.rejects(journal.claimIntent({ intent, signal: signal() }));
  const observed = await journal.readStrong({ planSha256: intent.planSha256, signal: signal() }); assert.deepEqual(observed.intent, intent);
  assert.equal(calls.filter(c => c.Item).length, 1); assert.equal(calls[1].ConsistentRead, true);
  assert.match(String((calls[0].Item as Record<string, unknown>).authority_key), /^sealed-cell-ttl-v3:intent:/);
  assert.equal(calls[0].ConditionExpression, "attribute_not_exists(#key)");
  await assert.rejects(validateSealedCellDeleteIntentV3({ ...intent, schemaVersion: 2 }, intent.planSha256, f.certificateSha256));
});

test("SDK assembly is inert; Lambda rejects old events and context before credentials or network", async () => {
  const f = await fixture(); const before = f.reads(); await createAwsSdkPreparedSealedCellTtlExecutorV3({ source: f.source, certificateSha256: f.certificateSha256 });
  assert.equal(f.reads(), before);
  await assert.rejects(handler({ schemaVersion: 2, action: "execute_reviewed_dedicated_cell_ttl_cleanup", approvedDeletionPlanSha256: "0".repeat(64) }, {}));
  await assert.rejects(handler({ schemaVersion: 3, action: "execute_reviewed_sealed_cell_ttl_cleanup", approvedDeletionPlanSha256: "0".repeat(64) }, {}));
});

test("concurrent invocations have one CAS winner and at most one actuator call", async () => {
  const f = await fixture(), e = await f.event();
  const outcomes = await Promise.allSettled([f.root.run(e, signal()), createPreparedSealedCellTtlExecutorV3(f.dependencies).run(e, signal())]);
  assert.equal(outcomes.some(o => o.status === "fulfilled"), true); assert.equal(f.state.deletes, 1);
});

test("invalid readback configuration is rejected before any capability can act", async () => {
  const f = await fixture();
  for (const override of [{ readbackAttempts: 0 }, { readbackAttempts: 11 }, { readbackDelayMs: -1 }, { readbackDelayMs: 5001 }])
    assert.throws(() => createPreparedSealedCellTtlExecutorV3({ ...f.dependencies, ...override }));
  assert.equal(f.state.deletes, 0); assert.equal(f.state.claims, 0);
});
