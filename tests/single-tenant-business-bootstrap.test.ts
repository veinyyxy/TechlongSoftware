import test from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_BOOTSTRAP_TARGET as t, prepareBusinessBootstrap, decodeBusinessBootstrap, businessBootstrapStatements, runBusinessBootstrap,
  type BusinessInventory, type BusinessSeed, type BusinessBootstrapPort } from "../lib/deployments/execution/single-tenant-business-bootstrap.ts";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { v3Environment } from "./fixtures/cell-stack-v3.ts";

const now = Date.UTC(2026, 9, 13, 18, 50), code = "a".repeat(64);
const seed = (): BusinessSeed => ({ ownerId: `usr_${"6".repeat(24)}`, workspaceId: `ws_${"1".repeat(32)}`, memberId: `wsm_${"2".repeat(32)}`,
  subscriptionId: `sub_${"3".repeat(32)}`, appInstanceId: `app_${"4".repeat(32)}`, entitlementId: `ent_${"5".repeat(32)}` });
function inventory(): BusinessInventory {
  const environment = v3Environment(); environment.policy.budgetLimitCents = 1000;
  return { observedAt: now, database: { name: "fixture", role: "fixture_owner", roleOid: "12345", hostSha256: "f".repeat(64) },
    owner: { id: seed().ownerId, status: "active", isPlatformAdmin: 1, exactEmailMatched: true },
    plan: { id: t.planId, productId: t.productId, productStatus: "active", templateVersionId: t.templateVersionId,
      templateStatus: "published", templateActive: "active", status: "active", profile: "standard-v1",
      schema: { schemaVersion: 2, contract: "speedfeast-saas-control-v1", fields: [
        { key: "defaultStoreName", label: "Store", type: "text", source: "customer", required: true, minLength: 1, maxLength: 120, outputPath: "/default_store/name" },
        { key: "firstOwnerUsername", label: "Owner", type: "text", source: "customer", required: true, minLength: 3, maxLength: 64, format: "merchant_username", outputPath: "/first_owner/username" },
        { key: "storesMax", label: "Stores", type: "integer", source: "plan", required: true, min: 1, outputPath: "/entitlements/stores.max" },
      ] }, templateDefaults: { storesMax: 1 }, planConfiguration: { storesMax: 2 }, limits: {} }, environment,
    environmentState: { policyBytes: canonicalJson(environment.policy), updatedAt: now - 100000, admissionState: "open", admissionEpoch: 0, admissionStackId: null },
    legacy: { deploymentSha256: "1".repeat(64), instanceSha256: "2".repeat(64), subscriptionSha256: "3".repeat(64),
      certificateSha256: "4".repeat(64), fenceSha256: "5".repeat(64), originalRegistrationMatches: true, sealed: true },
    collisions: 0, sourcePrivileges: Array(6).fill(true), tablesRlsDisabled: true, protectionSchemaSha256: "b".repeat(64), businessSchemaSha256: "c".repeat(64) };
}
const review = () => prepareBusinessBootstrap({ inventory: inventory(), seed: seed(), codeBindingSha256: code }, now);
function port(events: string[]): BusinessBootstrapPort {
  return { beginAndLock: async () => { events.push("begin-lock"); }, inventory: async () => inventory(),
    execute: async statement => { events.push(statement.name); return 1; }, verify: async () => { events.push("verify"); return true; },
    commit: async () => { events.push("commit"); }, rollback: async () => { events.push("rollback"); } };
}
test("business draft uses plan override and approved customer inputs without starting TTL or generating secrets", async () => {
  const r = await review(); assert.deepEqual(r.material.configuration, { defaultStoreName: t.storeName, firstOwnerUsername: t.firstOwnerUsername, storesMax: 2 });
  assert.equal(r.material.plan.mode, "aws_sandbox"); assert.equal(r.inventory.environment.policy.budgetLimitCents, 1000);
  assert.equal(r.material.targetPolicy.budgetLimitCents, 5000); assert.equal(r.inventory.environment.applyEnabled, false);
  assert.deepEqual(await decodeBusinessBootstrap(JSON.parse(JSON.stringify(r))), r);
  assert.equal(r.scope.jobs, 0); assert.equal(r.scope.deploymentRows, 0); assert.equal(r.scope.startsTtl, false);
  assert.ok(Object.isFrozen(r.material.configuration));
  const statements = businessBootstrapStatements(r); assert.equal(statements.length, 6);
  assert.equal(statements.filter(s => s.text.startsWith("INSERT")).length, 5);
  for (const statement of statements) assert.doesNotMatch(statement.text, /deployment_jobs|app_instance_deployments|CREATE |ALTER |DELETE |TRUNCATE|ON CONFLICT/i);
  assert.match(statements[5].text, /policy=\$4 AND updated_at=\$5/); assert.match(statements[5].text, /apply_enabled=0/);
});
test("source identity, closed runtime, isolation, privileges and unknown/secret defaults fail closed", async () => {
  const mutations: ((i: BusinessInventory) => void)[] = [i => { i.owner.id = "foreign"; }, i => { i.owner.exactEmailMatched = false; },
    i => { i.environment.applyEnabled = true; }, i => { i.environmentState.admissionStackId = "foreign"; }, i => { i.legacy.sealed = false; },
    i => { i.legacy.originalRegistrationMatches = false; }, i => { i.sourcePrivileges[0] = false; }, i => { i.tablesRlsDisabled = false; },
    i => { i.collisions = 1; }, i => { i.observedAt -= 30001; }, i => { i.plan.templateDefaults.password = "never store this"; },
    i => { i.plan.templateDefaults.defaultStoreName = "sk_test_do_not_store_me"; }, i => { i.plan.templateStatus = "draft"; }];
  for (const mutate of mutations) { const i = inventory(); mutate(i); await assert.rejects(prepareBusinessBootstrap({ inventory: i, seed: seed(), codeBindingSha256: code }, now)); }
  const changed = JSON.parse(JSON.stringify(await review())); changed.scope.jobs = 1; await assert.rejects(decodeBusinessBootstrap(changed));
});
test("approved transaction uses six one-row DMLs, verifies before commit and consumes one journal", async () => {
  const r = await review(), events: string[] = [];
  const result = await runBusinessBootstrap({ review: r, approvedSha256: r.manifestSha256, currentCodeBindingSha256: code,
    signal: new AbortController().signal, now: () => now, port: port(events), consumeSlot: async () => { events.push("slot"); } });
  assert.deepEqual(events, ["begin-lock", "slot", "workspace", "membership", "subscription", "app_instance", "entitlement", "sandbox_policy", "verify", "commit"]);
  assert.equal(result.outcome, "BUSINESS_COMMITTED_REQUIRES_INDEPENDENT_INSPECT"); assert.equal(result.dmlInvocations, 6);
  assert.equal(result.runtimeEnabled, false); assert.equal(result.startsTtl, false);
});
test("wrong/expired approval stops before transaction; source drift rolls back before slot or DML", async () => {
  const r = await review();
  for (const problem of ["sha", "code", "expired"] as const) {
    const events: string[] = [];
    await assert.rejects(runBusinessBootstrap({ review: r, approvedSha256: problem === "sha" ? "b".repeat(64) : r.manifestSha256,
      currentCodeBindingSha256: problem === "code" ? "b".repeat(64) : code, signal: new AbortController().signal,
      now: () => problem === "expired" ? r.expiresAt : now, port: port(events), consumeSlot: async () => { events.push("slot"); } }));
    assert.deepEqual(events, []);
  }
  const events: string[] = [], p = port(events); p.inventory = async () => ({ ...inventory(), businessSchemaSha256: "d".repeat(64) });
  const result = await runBusinessBootstrap({ review: r, approvedSha256: r.manifestSha256, currentCodeBindingSha256: code,
    signal: new AbortController().signal, now: () => now, port: p, consumeSlot: async () => { events.push("slot"); } });
  assert.deepEqual(events, ["begin-lock", "rollback"]); assert.equal(result.dmlInvocations, 0); assert.equal(result.slotConsumed, false);
});
test("row mismatch or failed postcondition aborts uncommitted transaction, never falls through to commit", async () => {
  const r = await review();
  for (const problem of ["row", "verify"] as const) {
    const events: string[] = [], p = port(events);
    if (problem === "row") p.execute = async statement => { events.push(statement.name); return 0; }; else p.verify = async () => false;
    const result = await runBusinessBootstrap({ review: r, approvedSha256: r.manifestSha256, currentCodeBindingSha256: code,
      signal: new AbortController().signal, now: () => now, port: p, consumeSlot: async () => { events.push("slot"); } });
    assert.equal(result.outcome, "STOPPED_INSPECT_NO_RETRY"); assert.equal("rollbackConfirmed" in result && result.rollbackConfirmed, true);
    assert.equal(events.includes("commit"), false); assert.equal(events.at(-1), "rollback");
  }
});
test("lost COMMIT response is uncertain and never followed by rollback, delete or retry", async () => {
  const r = await review(), events: string[] = [], p = port(events); p.commit = async () => { events.push("commit"); throw Object.assign(Error("lost"), { code: "08006" }); };
  const result = await runBusinessBootstrap({ review: r, approvedSha256: r.manifestSha256, currentCodeBindingSha256: code,
    signal: new AbortController().signal, now: () => now, port: p, consumeSlot: async () => { events.push("slot"); } });
  assert.equal(result.outcome, "COMMIT_UNCERTAIN_INSPECT_NO_RETRY"); assert.equal(events.at(-1), "commit"); assert.equal(events.includes("rollback"), false);
  assert.equal(events.filter(e => e === "workspace").length, 1);
});
test("occupied journal and expiry during DML prevent subsequent writes and commit", async () => {
  const r = await review();
  for (const problem of ["slot", "expired"] as const) {
    const events: string[] = [], p = port(events); let current = now;
    if (problem === "expired") p.execute = async statement => { events.push(statement.name); current = r.expiresAt; return 1; };
    const result = await runBusinessBootstrap({ review: r, approvedSha256: r.manifestSha256, currentCodeBindingSha256: code,
      signal: new AbortController().signal, now: () => current, port: p, consumeSlot: async () => { events.push("slot"); if (problem === "slot") throw Error("occupied"); } });
    assert.equal(events.includes("commit"), false); assert.equal(events.at(-1), "rollback");
    assert.equal(result.dmlInvocations, problem === "slot" ? 0 : 1);
  }
});
