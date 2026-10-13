import test from "node:test";
import assert from "node:assert/strict";
import { prepareCellFoundationReview, decodeCellFoundationReview, assertCellFoundationApproval, createCellFoundationOperationControl,
  estimateCellFoundationPrice, prepareUnstartedCellCleanupReview, createUnstartedCellCleanupControl } from "../lib/deployments/execution/single-tenant-cell-foundation-review.ts";
import type { CellFoundationFacts } from "../ops/aws-sandbox/scripts/single-tenant-cell-live-readonly.ts";
import { renderSingleTenantAcceptanceCell } from "../lib/deployments/cloudformation/single-tenant-acceptance-cell.ts";
import { ACCEPTANCE_CELL_SERVICE_ROLE, type AcceptanceCellCreateReceipt } from "../lib/deployments/execution/single-tenant-cell-operations.ts";
import { v3Environment } from "./fixtures/cell-stack-v3.ts";
const now = Date.parse("2026-10-13T22:45:00.000Z"), code = "c".repeat(64), signal = () => new AbortController().signal;
function input() {
  const facts: CellFoundationFacts = { observedAt: now, identity: { account: "402010193138", arn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev", userId: "AIDAV3GNMXTZEO7SHLC2X" },
    roleChecks: { roleId: true, policyId: true, boundary: true, trust: true, tags: true, session: true, identityPolicy: true, boundaryPolicy: true, exactInline: true, noAttached: true },
    collisionChecks: { cellStackAbsent: true, publicKeySecretAbsent: true, rdsClusterAbsent: true, writerAbsent: true, ecsClusterAbsent: true, albAbsent: true, databaseLogAbsent: true },
    prerequisites: { certificateIssued: true, truststoreActive: true, engineAvailable: true, twoAvailableZones: true, keysEnabledAwsManaged: true },
    simulations: ["createCell", "deleteCellNamespace", "passCellRole", "createPublicKeySecret", "tagPublicKeySecretAtCreate"].map(name => ({ name, action: "fixture", resourceNamespace: "fixture", allowed: true, decision: "allowed", missingContext: [] })),
    roleId: "AROAV3GNMXTZESNMKM56K", policyId: "ANPAV3GNMXTZL4VMJHXXZ", roleMaterialSha256: "d".repeat(64), defaultKeys: { rds: "fixture", secrets: "fixture" },
    checksPassed: true, simulationIsExecutionProof: false, awsWrites: 0, secretValueReads: 0 };
  return { cellInput: { environment: v3Environment(), requestedAt: now, availabilityZones: ["ca-central-1a", "ca-central-1b"] as [string, string],
    certificateArn: "arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d",
    controlTrustStoreArn: "arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/aa1771fd0469cc44" }, facts,
    businessInspect: { observedAt: new Date(now).toISOString(), checks: Object.fromEntries(Array.from({ length: 13 }, (_, n) => [`fixture${n}`, true])), outcome: "BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL" },
    prices: { priceFileSha256: "f".repeat(64), observedAt: now, region: "ca-central-1" as const, currency: "USD" as const,
      rates: { albHour: .02475, truststoreHour: .0055, lcuHour: .0088, ipv4Hour: .005, acuHour: .14, secretMonth: .4, storageGbMonth: .11, ioRequest: .00000022 } }, codeBindingSha256: code };
}
test("foundation binds exact existing inputs, two API calls and honest 3-hour/monthly estimate", async () => {
  const r = await prepareCellFoundationReview(input(), now); assert.deepEqual(await decodeCellFoundationReview(JSON.parse(JSON.stringify(r))), r);
  assert.equal(r.scope.maximumDirectCreateApiCalls, 2); assert.equal(r.scope.operatorDeletes, 0); assert.equal(r.scope.iamWrites, 0);
  assert.equal(r.estimate.hardCap, false); assert.ok(Math.abs(r.estimate.threeHourInfrastructureUsageUsd - .56715) < 1e-10);
  assert.ok(r.estimate.continuouslyActive730HoursUsd > 50); assert.equal(Object.isFrozen(r.cellInput), true);
  const changed = JSON.parse(JSON.stringify(r)); changed.scope.operatorDeletes = 1; await assert.rejects(decodeCellFoundationReview(changed));
  assert.throws(() => estimateCellFoundationPrice({ ...input().prices, rates: { ...input().prices.rates, acuHour: NaN } }));
});
test("stale/missing facts, business-started, TLS and price drift reject before review", async () => {
  for (const mutate of [(i: ReturnType<typeof input>) => { i.facts.collisionChecks.cellStackAbsent = false; },
    (i: ReturnType<typeof input>) => { i.facts.observedAt = now - 60001; }, (i: ReturnType<typeof input>) => { i.businessInspect.checks.fixture12 = false; },
    (i: ReturnType<typeof input>) => { i.cellInput.certificateArn = i.cellInput.certificateArn.replace("6d1f2880", "12345678"); },
    (i: ReturnType<typeof input>) => { i.prices.observedAt = now - 86400001; }]) { const i = input(); mutate(i); await assert.rejects(prepareCellFoundationReview(i, now)); }
});
test("expired/wrong SHA and code approval reject, no automatic extension", async () => {
  const r = await prepareCellFoundationReview(input(), now); assertCellFoundationApproval(r, r.manifestSha256, code, now);
  for (const [sha, c, t] of [["a".repeat(64), code, now], [r.manifestSha256, "a".repeat(64), now], [r.manifestSha256, code, r.expiresAt]] as const)
    assert.throws(() => assertCellFoundationApproval(r, sha, c, t));
});
test("actual guard permits only own created public Secret difference and refuses create-SHA deletion", async () => {
  const i = input(), r = await prepareCellFoundationReview(i, now), draft = await renderSingleTenantAcceptanceCell(i.cellInput);
  const after = structuredClone(i.facts); after.collisionChecks.publicKeySecretAbsent = false; after.checksPassed = false;
  let publicChecks = 0, consumed = false;
  const control = createCellFoundationOperationControl({ review: r, approvedSha256: r.manifestSha256, currentCodeBindingSha256: code, now: () => now,
    readFacts: async () => after, verifyPublicKeySecret: async () => { publicChecks++; }, verifyBusinessUnstarted: async () => {},
    journal: { consumeCell: async () => { if (consumed) throw Error("occupied"); consumed = true; }, captureCell: async () => {} } });
  await control.beforeCreate({ draft, reviewSha256: r.manifestSha256, signal: signal() }); assert.equal(publicChecks, 1);
  await control.consume({ action: "create", reviewSha256: r.manifestSha256, target: draft.stackName, clientRequestToken: `accept-cell-${r.manifestSha256}` });
  await assert.rejects(control.consume({ action: "create", reviewSha256: r.manifestSha256, target: draft.stackName, clientRequestToken: `accept-cell-${r.manifestSha256}` }), /occupied/);
  after.roleChecks.identityPolicy = false; await assert.rejects(control.beforeCreate({ draft, reviewSha256: r.manifestSha256, signal: signal() }));
  await assert.rejects(control.beforeDelete({} as never), { code: "CELL_FOUNDATION_CREATE_APPROVAL_CANNOT_DELETE" });
});
test("exact unstarted cleanup is separately hashed, rejects tasks/tenant/UUID drift and cannot create", async () => {
  const i = input(), draft = await renderSingleTenantAcceptanceCell(i.cellInput);
  const receipt: AcceptanceCellCreateReceipt = { schemaVersion: 1, stackId: "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/11111111-2222-3333-4444-555555555555",
    clientRequestToken: "accept-cell-fixture", reviewSha256: "a".repeat(64), templateSha256: draft.templateSha256, tags: draft.tags, serviceRoleArn: ACCEPTANCE_CELL_SERVICE_ROLE, inventory: draft.resourceInventory };
  const snapshot = { stackId: receipt.stackId, status: "CREATE_COMPLETE", roleArn: receipt.serviceRoleArn, tags: draft.tags, templateSha256: draft.templateSha256, resources: [] };
  const proof = { observedAt: now, noDeploymentOrJob: true, noTenantGeneration: true, noEcsServicesOrTasks: true, permissionsAllowed: true };
  const r = await prepareUnstartedCellCleanupReview(receipt, snapshot, proof, code, now);
  let verified = 0;
  const control = createUnstartedCellCleanupControl({ review: r, approvedSha256: r.manifestSha256, currentCodeBindingSha256: code, now: () => now,
    verifyStillUnstarted: async () => { verified++; }, consume: async () => {} });
  await control.beforeDelete({ receipt, snapshot, reviewSha256: r.manifestSha256, signal: signal() }); assert.equal(verified, 1);
  await assert.rejects(control.beforeDelete({ receipt, snapshot: { ...snapshot, stackId: "foreign" }, reviewSha256: r.manifestSha256, signal: signal() }));
  await assert.rejects(prepareUnstartedCellCleanupReview(receipt, snapshot, { ...proof, noTenantGeneration: false }, code, now));
  await assert.rejects(control.beforeCreate({} as never)); assert.equal(r.scope.deletePublicKeySecret, false);
});
