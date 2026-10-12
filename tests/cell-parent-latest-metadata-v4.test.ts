import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cellParentLockedFunctionChecksV4 } from "../lib/deployments/execution/cell-parent-latest-metadata-v4.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as t } from "../lib/deployments/execution/cell-parent-bootstrap-v4.ts";
const config = () => ({ FunctionArn: `${t.functionArn}:$LATEST`, FunctionName: t.functionName, Version: "$LATEST", Role: t.roleArn,
  CodeSha256: t.zipCodeSha256Base64, Runtime: "nodejs22.x", Handler: "cell-birth-coordinator-v4.handler", PackageType: "Zip", State: "Active", LastUpdateStatus: "Successful", Timeout: 120, MemorySize: 256, Architectures: ["x86_64"] });
test("accepts only the actual exact qualified or unqualified $LATEST metadata identity", () => {
  assert.ok(Object.values(cellParentLockedFunctionChecksV4(config())).every(Boolean));
  assert.ok(Object.values(cellParentLockedFunctionChecksV4({ ...config(), FunctionArn: t.functionArn })).every(Boolean));
  for (const Layers of [null, undefined, []])
    assert.ok(Object.values(cellParentLockedFunctionChecksV4({ ...config(), Layers })).every(Boolean));
  for (const FunctionArn of [`${t.functionArn}:1`, `${t.functionArn}:current`, `${t.functionArn}:$LATEST:other`, t.functionArn.replace("402010193138", "111111111111"), t.functionArn + "-other:$LATEST"])
    assert.equal(cellParentLockedFunctionChecksV4({ ...config(), FunctionArn }).exactLatestIdentity, false);
  assert.equal(cellParentLockedFunctionChecksV4({ ...config(), Version: "1" }).exactLatestIdentity, false);
});
test("qualification does not excuse wrong ZIP, role, runtime, state or configured limits", () => {
  for (const drift of [{ CodeSha256: "wrong" }, { Role: "other" }, { Runtime: "nodejs20.x" }, { Handler: "other.handler" }, { State: "Pending" }, { LastUpdateStatus: "Failed" }, { MemorySize: 512 }, { Architectures: ["arm64"] }])
    assert.ok(Object.values(cellParentLockedFunctionChecksV4({ ...config(), ...drift })).some(v => !v));
});
test("layers, application environment and VPC remain rejected and no environment value is exposed by checks", () => {
  for (const Layers of [{}, "[]", false, [{ Arn: "layer" }]])
    assert.equal(cellParentLockedFunctionChecksV4({ ...config(), Layers }).noLayers, false);
  for (const drift of [{ Layers: [{ Arn: "layer" }] }, { Environment: { Variables: { token: "private-value" } } }, { Environment: { Error: { Message: "private-value" } } }, { VpcConfig: { SubnetIds: ["subnet"] } }]) {
    const checks = cellParentLockedFunctionChecksV4({ ...config(), ...drift }); assert.ok(Object.values(checks).some(v => !v)); assert.doesNotMatch(JSON.stringify(checks), /private-value/);
  }
});
test("independent verifier has only read SDK/native operations and pins, not mutation constructors or write repair", async () => {
  const source = await readFile(new URL("../ops/aws-sandbox/scripts/inspect-cell-parent-locked-bootstrap-v4.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CreateRoleCommand|CreatePolicyCommand|InvokeCommand|DeleteStackCommand|PutRolePolicyCommand|GetSecretValueCommand|--mode Run/);
  assert.match(source, /const first = await collect\(\), second = await collect\(\)/);
  assert.match(source, /approved63Unchanged: true/); assert.match(source, /awsWritesThisVerifier: 0/);
});
