import test from "node:test";
import assert from "node:assert/strict";
import { ACCEPTANCE_CELL_IAM as t, compileAcceptanceCellIam } from "../lib/deployments/execution/single-tenant-cell-iam.ts";
import { prepareCellIamReview, decodeCellIamReview, runCellIamInstall, cellIamSourceSimulationAllowed, type CellIamInventory } from "../lib/deployments/execution/single-tenant-cell-iam-review.ts";
const now = Date.UTC(2026, 9, 13, 18, 20);
const inventory = (): CellIamInventory => ({ observedAt: now, identity: { Account: t.account, Arn: t.sourceArn, UserId: t.sourceUserId },
  roleAbsent: true, boundaryAbsent: true, sourceInstallSimulationAllowed: true,
  serviceLinkedRoles: { rds: "AROAV3GNMXTZAUVFEZZNN", ecs: "AROAV3GNMXTZFKBPHQEYN", elb: "AROAV3GNMXTZNUJ5QVBFD" },
  keys: { rds: { arn: "arn:aws:kms:ca-central-1:402010193138:key/637acceb-4c09-49d5-ac95-7ff8b22069a9", keyManager: "AWS", enabled: true },
    secrets: { arn: "arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570", keyManager: "AWS", enabled: true } } });
const validation = () => ({ identityErrors: [], boundaryErrors: [], identityWarnings: [], boundaryWarnings: [] });
const review = () => prepareCellIamReview({ inventory: inventory(), validation: validation(), codeBindingSha256: "a".repeat(64) }, now);
test("dedicated Cell material preserves narrow identity scopes without widening to fit managed boundary", async () => {
  const i = inventory(), p = await compileAcceptanceCellIam({ rdsKmsKeyArn: i.keys.rds.arn, secretsKmsKeyArn: i.keys.secrets.arn });
  assert.ok(p.policyBytes <= 10240); assert.ok(p.boundaryBytes <= 6144);
  assert.equal(p.installAuthorized, false); assert.equal(p.cellDeploymentAuthorized, false);
  const allow = p.policyDocument.Statement.filter(s => s.Effect === "Allow"), actions = allow.flatMap(s => s.Action ?? []);
  for (const forbidden of ["iam:CreateRole", "iam:PassRole", "ecs:RunTask", "ecs:CreateService", "secretsmanager:GetSecretValue", "secretsmanager:DeleteSecret",
    "rds:CreateDBClusterSnapshot", "rds:RestoreDBClusterFromSnapshot", "ec2:AttachVpnGateway", "ec2:CreateNatGateway"])
    assert.equal(actions.includes(forbidden), false, forbidden);
  assert.deepEqual(p.trustDocument.Statement[0].Principal, { Service: "cloudformation.amazonaws.com" });
  assert.deepEqual(p.mutations, ["CreateBoundaryPolicy", "CreatePolicyEmptyRoleWithExactBoundary", "PutExactResourceScopedInlinePolicy"]);
  assert.equal(Object.isFrozen(p.policyDocument.Statement), true);
  assert.ok(allow.find(s => s.Sid === "UseOnlyOwnedParentVpc")?.Condition?.StringEquals?.["aws:ResourceTag/CellId"]);
  assert.equal(allow.find(s => s.Sid === "NamedAlbListenersAndRules")?.Condition, undefined);
});
test("actual install action/resource pairs are checked, not six invalid cross-type pairs", () => {
  const raw = { EvaluationResults: ["iam:CreatePolicy", "iam:CreateRole", "iam:PutRolePolicy"].map(action => ({ EvalActionName: action, EvalDecision: "allowed",
    MissingContextValues: [], ResourceSpecificResults: [t.boundaryArn, t.roleArn].map(resource => ({ EvalResourceName: resource,
      EvalResourceDecision: (action === "iam:CreatePolicy") === (resource === t.boundaryArn) ? "allowed" : "implicitDeny" })) })) };
  assert.equal(cellIamSourceSimulationAllowed(raw), true);
  raw.EvaluationResults[2].ResourceSpecificResults[1].EvalResourceDecision = "implicitDeny";
  assert.equal(cellIamSourceSimulationAllowed(raw), false);
  assert.equal(cellIamSourceSimulationAllowed({ ...raw, IsTruncated: true }), false);
});
test("fresh absent inventory, fixed Source and validated policies are mandatory; manifest roundtrip is immutable", async () => {
  const r = await review(); assert.deepEqual(await decodeCellIamReview(JSON.parse(JSON.stringify(r))), r);
  for (const change of ["expired", "occupied", "foreign", "kms", "simulation"] as const) {
    const v = inventory();
    if (change === "expired") v.observedAt -= 30001;
    if (change === "occupied") v.roleAbsent = false;
    if (change === "foreign") v.identity.Arn = "foreign";
    if (change === "kms") v.keys.rds.enabled = false;
    if (change === "simulation") v.sourceInstallSimulationAllowed = false;
    await assert.rejects(prepareCellIamReview({ inventory: v, validation: validation(), codeBindingSha256: "a".repeat(64) }, now));
  }
  await assert.rejects(prepareCellIamReview({ inventory: inventory(), validation: { ...validation(), identityErrors: ["UNSUPPORTED_ACTION_FOR_CONDITION_KEY"] }, codeBindingSha256: "a".repeat(64) }, now));
  const changed = JSON.parse(JSON.stringify(r)); changed.scope.createsCell = true;
  await assert.rejects(decodeCellIamReview(changed));
});
test("approved install has exactly three ordered stages and leaves runtime disabled pending independent inspect", async () => {
  const r = await review(), events: string[] = [];
  const result = await runCellIamInstall({ review: r, approvedManifestSha256: r.manifestSha256, currentCodeBindingSha256: r.codeBindingSha256, signal: new AbortController().signal, now: () => now,
    port: { inventory: async () => inventory(), createBoundary: async () => { events.push("policy"); return { arn: t.boundaryArn, policyId: "ANPAV3GNMXTZAAAAAAAA" }; },
      createRole: async () => { events.push("role"); return { arn: t.roleArn, roleId: "AROAV3GNMXTZAAAAAAAA" }; }, putInline: async () => { events.push("inline"); } },
    journal: { consume: async () => { events.push("consume"); }, record: async () => {} } });
  assert.deepEqual(events, ["consume", "policy", "role", "inline"]);
  assert.equal(result.outcome, "IAM_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT"); assert.equal(result.runtimeEnabled, false);
});
test("wrong/expired approval or fresh inventory drift makes zero writes and consumes no slot", async () => {
  const r = await review();
  for (const problem of ["sha", "expired", "drift"] as const) {
    const events: string[] = [], forbidden = async (): Promise<never> => { events.push("write"); throw Error("must not reach"); };
    const v = inventory(); if (problem === "drift") v.serviceLinkedRoles.elb = "AROAV3GNMXTZBBBBBBBB";
    await assert.rejects(runCellIamInstall({ review: r, approvedManifestSha256: problem === "sha" ? "b".repeat(64) : r.manifestSha256,
      currentCodeBindingSha256: r.codeBindingSha256, now: () => problem === "expired" ? now + 3600000 : now, signal: new AbortController().signal,
      port: { inventory: async () => v, createBoundary: forbidden, createRole: forbidden, putInline: forbidden },
      journal: { consume: forbidden, record: async () => {} } }));
    assert.deepEqual(events, []);
  }
});
test("partial role failure never falls through to inline, retries or deletes", async () => {
  const r = await review(), events: string[] = [];
  const result = await runCellIamInstall({ review: r, approvedManifestSha256: r.manifestSha256, currentCodeBindingSha256: r.codeBindingSha256, signal: new AbortController().signal, now: () => now,
    port: { inventory: async () => inventory(), createBoundary: async () => { events.push("policy"); return { arn: t.boundaryArn, policyId: "ANPAV3GNMXTZAAAAAAAA" }; },
      createRole: async () => { events.push("role"); throw Error("uncertain"); }, putInline: async () => { events.push("inline"); } },
    journal: { consume: async () => { events.push("consume"); }, record: async () => {} } });
  assert.deepEqual(events, ["consume", "policy", "role"]); assert.equal(result.outcome, "PARTIAL_OR_UNCERTAIN_REQUIRES_INSPECT_NO_RETRY");
});
test("expiry between writes stops after boundary without creating role or repairing the attempt", async () => {
  const r = await review(), events: string[] = []; let current = now;
  const result = await runCellIamInstall({ review: r, approvedManifestSha256: r.manifestSha256, currentCodeBindingSha256: r.codeBindingSha256,
    signal: new AbortController().signal, now: () => current,
    port: { inventory: async () => inventory(), createBoundary: async () => { events.push("policy"); current = r.expiresAt;
      return { arn: t.boundaryArn, policyId: "ANPAV3GNMXTZAAAAAAAA" }; },
      createRole: async () => { throw Error("must not reach role"); }, putInline: async () => { throw Error("must not reach inline"); } },
    journal: { consume: async () => { events.push("consume"); }, record: async () => {} } });
  assert.deepEqual(events, ["consume", "policy"]);
  assert.equal(result.outcome, "PARTIAL_OR_UNCERTAIN_REQUIRES_INSPECT_NO_RETRY");
  assert.equal(result.writeStagesEntered, 1); assert.ok("failureCode" in result); assert.equal(result.failureCode, "CELL_IAM_FRESH_EXACT_APPROVAL_REQUIRED");
});
test("occupied permanent journal stops all cloud writes even with valid fresh approval", async () => {
  const r = await review(), forbidden = async (): Promise<never> => { throw Error("must not reach write"); };
  await assert.rejects(runCellIamInstall({ review: r, approvedManifestSha256: r.manifestSha256, currentCodeBindingSha256: r.codeBindingSha256,
    signal: new AbortController().signal, now: () => now,
    port: { inventory: async () => inventory(), createBoundary: forbidden, createRole: forbidden, putInline: forbidden },
    journal: { consume: async () => { throw Object.assign(Error("occupied"), { code: "EEXIST" }); }, record: async () => {} } }), /occupied/);
});
