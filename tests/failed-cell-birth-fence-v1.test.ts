import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../lib/deployments/execution/hash.ts";
import { compileFailedCellBirthFenceV1, decodeFailedCellBirthFenceV1, NeonFailedCellBirthFenceWriterV1 } from "../lib/deployments/execution/failed-cell-birth-fence-v1.ts";
import { createNeonFailedCellBirthControlV1 } from "../lib/deployments/execution/neon-failed-cell-birth-source-v1.ts";
import { v3Fixture, v3Now } from "./fixtures/cell-stack-v3.ts";
import { sealedEvidenceFixture } from "./fixtures/sealed-cell-ownership-v3.ts";

test("failed fence intent is separate, precise and data only; successful/copy/hash/epoch substitutes reject", async () => {
  const f = await v3Fixture("PAID", "UPDATE_FAILED"), failure = await f.read(); assert.ok("protocol" in failure);
  const input = { plan: f.plan, failure, environmentIdentitySha256: "e".repeat(64), expectedAdmissionEpoch: 0, now: v3Now + 2000 };
  const p = await compileFailedCellBirthFenceV1(input); assert.equal(p.databaseWriteAuthorized, false); assert.equal(p.cloudDeleteAuthorized, false);
  assert.equal("provisionOperationHash" in p.intent, false); assert.equal((await decodeFailedCellBirthFenceV1(structuredClone(p.intent),p.fenceSha256)).stackId, failure.stackId);
  await assert.rejects(() => compileFailedCellBirthFenceV1({ ...input, expectedAdmissionEpoch: 1 }));
  await assert.rejects(() => compileFailedCellBirthFenceV1({ ...input, failure: structuredClone(failure) }));
  await assert.rejects(() => decodeFailedCellBirthFenceV1({ ...p.intent, failedStackStatus: "UPDATE_COMPLETE" },p.fenceSha256));
  const good = await v3Fixture(), successful = await good.read(); assert.ok("protocol" in successful);
  await assert.rejects(() => compileFailedCellBirthFenceV1({ ...input, failure: successful }));
});
test("exact writer checks approval before one SQL and lost result never grants retry or deletion", async () => {
  const f = await v3Fixture("ARMED", "UPDATE_FAILED"), failure = await f.read(); assert.ok("protocol" in failure);
  const p = await compileFailedCellBirthFenceV1({ plan:f.plan,failure,environmentIdentitySha256:"e".repeat(64),expectedAdmissionEpoch:0,now:v3Now+2000 });
  let calls=0; const writer = new NeonFailedCellBirthFenceWriterV1({ async query(statement,values) { calls++; assert.equal(statement,"SELECT public.begin_failed_cell_birth_fence_v1($1,$2) AS fence_sha256");
    assert.equal(values[0],canonicalJson(p.intent)); throw Error("private provider detail must not be returned"); } });
  await assert.rejects(() => writer.installOnce({intent:p.intent,approvedFenceSha256:"f".repeat(64),signal:new AbortController().signal})); assert.equal(calls,0);
  const r = await writer.installOnce({intent:p.intent,approvedFenceSha256:p.fenceSha256,signal:new AbortController().signal}); assert.equal(calls,1); assert.equal(r.retryAuthorized,false);
  assert.equal(canonicalJson(r).includes("private"),false);
});
test("schema and privilege candidates never alter protected business table/catalog or create roles", async () => {
  const raw = await readFile(new URL("../ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-fence.sql",import.meta.url),"utf8"), sql = raw.replace(/--[^\r\n]*/g,"");
  assert.match(sql,/admission_provision_operation_hash=NULL/); assert.match(sql,/FOR UPDATE/); assert.match(sql,/failed_unadmitted/);
  assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.(guard_sealed|sealed_plan|validate_sealed|touch_sealed)/);
  assert.doesNotMatch(sql,/(?:ALTER TABLE|UPDATE|INSERT INTO|DELETE FROM) public\.(?:app_instance_deployments|deployment_jobs|deployment_step_runs|deployment_plan_only_isolations)\b/);
  assert.doesNotMatch(sql,/IF NOT EXISTS|CREATE ROLE|GRANT |DELETE FROM|TRUNCATE TABLE/);
});
test("runtime material factory rejects synthetic certificate before constructing any Neon transport", async () => {
  const f=await sealedEvidenceFixture(); await assert.rejects(() => createNeonFailedCellBirthControlV1({readerDatabaseUrl:"postgres://any.invalid/any",expectedRegisteredCertificate:f.cert,approvedProtectionSha256:"e".repeat(64)}),/CONTROL_BINDING_INVALID/);
});
