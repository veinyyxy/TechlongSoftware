import assert from "node:assert/strict";
import test from "node:test";
import { runReadonlyLambdaProbeV1, readonlyProbeReadLabelsV1, type ReadonlyProbePortsV1 } from "../lib/deployments/execution/readonly-lambda-probe-v1.ts";
import { READONLY_RUNTIME_IAM_TARGETS_V1 } from "../lib/deployments/execution/readonly-runtime-iam-v1.ts";
import { sha256Hex } from "../lib/deployments/execution/hash.ts";

const nonce = "a".repeat(64), event = { schemaVersion: 1, action: "verify_readonly_runtime_v1", nonce };
function fixture() {
  const calls: string[] = [], t = READONLY_RUNTIME_IAM_TARGETS_V1[1];
  const ctx = { functionName: t.functionName, invokedFunctionArn: `arn:aws:lambda:ca-central-1:402010193138:function:${t.functionName}`, awsRequestId: "12345678-1234-1234-1234-123456789abc" };
  const ports: ReadonlyProbePortsV1 = {
    identity: async () => { calls.push("identity"); return { Account: "402010193138", Arn: `arn:aws:sts::402010193138:assumed-role/${t.role}/session` }; },
    secret: async () => { calls.push("secret"); return { ARN: t.secretArn, VersionId: t.secretVersionId, VersionStages: ["AWSCURRENT"], SecretString: JSON.stringify({ databaseUrl: "postgres://techlong_cell_drain:do-not-leak@fixture.neon.tech/db?sslmode=require" }) }; },
    read: async label => { calls.push(label); return "ABSENT"; }, log: value => calls.push(value),
  };
  return { calls, ctx, ports };
}
test("malformed/extra/execute events rejected before any provider", async () => {
  for (const e of [{ ...event, action: "execute" }, { ...event, password: "bad" }, { ...event, nonce: "bad" }, null]) {
    const f = fixture(); await assert.rejects(runReadonlyLambdaProbeV1(1, e, f.ctx, f.ports), /EVENT_INVALID/); assert.deepEqual(f.calls, []);
  }
});
test("wrong or qualified Lambda context rejected before any provider", async () => {
  const f = fixture(); await assert.rejects(runReadonlyLambdaProbeV1(1, event, { ...f.ctx, invokedFunctionArn: f.ctx.invokedFunctionArn + ":1" }, f.ports), /CONTEXT_INVALID/); assert.deepEqual(f.calls, []);
});
test("wrong runtime identity never reads the Secret or other API", async () => {
  const f = fixture(); f.ports.identity = async () => ({ Account: "another", Arn: "wrong" });
  const result = await runReadonlyLambdaProbeV1(1, event, f.ctx, f.ports); assert.equal(result.outcome, "READONLY_PROBE_IDENTITY_NOT_VERIFIED"); assert.deepEqual(f.calls, []);
});
test("drain probe only validates own credential in memory and reads fixed provision key", async () => {
  const f = fixture(), result = await runReadonlyLambdaProbeV1(1, event, f.ctx, f.ports);
  assert.equal(result.outcome, "READONLY_PROBE_READS_VERIFIED"); assert.equal(result.runtimeEnabled, false);
  assert.deepEqual(f.calls.slice(0, 3), ["identity", "secret", "provision-authority"]);
  assert.doesNotMatch(JSON.stringify({ result, calls: f.calls }), /do-not-leak|postgres:|databaseUrl/);
  assert.equal(JSON.parse(f.calls[3]).nonce, nonce);
  assert.equal(JSON.parse(f.calls[3]).responseSha256, await sha256Hex(result));
});
test("Secret failure has no retry/fallback; remaining reads still diagnose independently", async () => {
  const f = fixture(); f.ports.secret = async () => { f.calls.push("secret"); throw Object.assign(new Error("RAW_PASSWORD_VALUE"), { name: "AccessDeniedException" }); };
  const result = await runReadonlyLambdaProbeV1(1, event, f.ctx, f.ports);
  assert.equal(result.outcome, "READONLY_PROBE_READS_NOT_VERIFIED"); assert.equal(result.steps[1].errorCode, "AccessDeniedException");
  assert.equal(f.calls.filter(x => x === "secret").length, 1); assert.doesNotMatch(JSON.stringify(result), /RAW_PASSWORD/);
});
test("exact Secret version and payload required; no raw diagnostics", async () => {
  const f = fixture(), original = f.ports.secret; f.ports.secret = async () => ({ ...await original(), VersionId: "wrong" });
  const result = await runReadonlyLambdaProbeV1(1, event, f.ctx, f.ports); assert.equal(result.steps[1].passed, false);
  assert.doesNotMatch(JSON.stringify(result), /do-not-leak|wrong/);
});
test("TTL read set has no mutation and explicitly labels incomplete CF list", () => {
  assert.deepEqual(readonlyProbeReadLabelsV1(0), ["atomic-authority", "intent-journal", "receipt-journal", "stack-list-first-page", "cell-describe", "cell-template", "cell-resources"]);
  assert.deepEqual(readonlyProbeReadLabelsV1(1), ["provision-authority"]);
});
test("TTL validates the exact registered certificate and executes only its fixed read set", async () => {
  const f = fixture(), t = READONLY_RUNTIME_IAM_TARGETS_V1[0];
  const cert = { deployment_id: "dep_d00144511731f1c20991aa56", environment_id: "env_aws_sandbox_ca_central_1", app_instance_id: "app_fb1962e93a9a4cc2acf046170593d9e3",
    original_row_sha256: "9f2cc13138f577783c72d86ea7caa5ab0f80d9b3e394748c4b651e0f70c41a11",
    original_plan_bytes_sha256: "00a57bb81fdaaf91d5a846e00608c7aea89412acf24ae1b4b391e0ec682d40b5", original_plan_hash: "00a57bb81fdaaf91d5a846e00608c7aea89412acf24ae1b4b391e0ec682d40b5",
    business_state_sha256: "6364420b1903d8588515e5efb423b01cfb9494f060a776e1db6395a4d921f659",
    approved_registration_sha256: "1fba989e681c6e7bb0c71178adfde6686f618359ad9e422db549b7b038aab333",
    protection_schema_sha256: "41eea5ac8b64801144fa568dce2b42d5dcb350a520a82df91f973c23bedab168", sealed_at: 1791480771883 };
  const certificateSha256 = await sha256Hex(cert); assert.equal(certificateSha256, "dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f");
  f.ports.identity = async () => ({ Account: "402010193138", Arn: `arn:aws:sts::402010193138:assumed-role/${t.role}/session` });
  f.ports.secret = async () => ({ ARN: t.secretArn, VersionId: t.secretVersionId, VersionStages: ["AWSCURRENT"], SecretString: JSON.stringify({
    schemaVersion: 3, protocol: "sealed-cell-cleanup-control-v3", databaseUrl: "postgres://techlong_cell_cleanup_reader:do-not-leak@fixture.neon.tech/db?sslmode=require", certificateSha256, expectedRegisteredCertificate: cert }) });
  const result = await runReadonlyLambdaProbeV1(0, event, { ...f.ctx, functionName: t.functionName, invokedFunctionArn: `arn:aws:lambda:ca-central-1:402010193138:function:${t.functionName}` }, f.ports);
  assert.equal(result.outcome, "READONLY_PROBE_READS_VERIFIED"); assert.deepEqual(f.calls.slice(0, 7), readonlyProbeReadLabelsV1(0));
  assert.doesNotMatch(JSON.stringify(result), /do-not-leak|postgres:/);
});
