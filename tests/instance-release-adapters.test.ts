import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { CloudFormationClient, type DescribeChangeSetOutput } from "@aws-sdk/client-cloudformation";
import { S3Client } from "@aws-sdk/client-s3";
import type { HttpRequest } from "@smithy/types";
import { ReleaseCloudFormationAdapter, ReleaseCloudSubmissionUnknown, ReleaseEvidenceAdapter,
  reviewImageChangeSet, type ReleaseInspectionDocument } from "../lib/deployments/releases/adapters.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import { releaseFixture, h } from "./instance-release-fixture.ts";

const credentials = { accessKeyId: "synthetic", secretAccessKey: "synthetic" };
const response = (body: string, headers: Record<string, string> = {}, statusCode = 200) => ({
  response: { statusCode, headers, body: Readable.from([Buffer.from(body)]) },
});

test("release CFN real SDK: previous template, ImageUri only, no RoleARN/drift mode; TaskDefinition replacement True is normal", async () => {
  const f = await releaseFixture(), forms: URLSearchParams[] = [];
  const client = new CloudFormationClient({ region: "ca-central-1", credentials, maxAttempts: 1,
    endpoint: "https://cloudformation.ca-central-1.amazonaws.com", requestHandler: { handle: async (request: HttpRequest) => {
      const form = new URLSearchParams(String(request.body)); forms.push(form); const action = form.get("Action")!;
      assert.equal(form.has("RoleARN"), false); assert.equal(form.has("DeploymentMode"), false);
      assert.equal(form.has("DeploymentConfig.Mode"), false);
      const result = action === "CreateChangeSet" ? `<Id>${f.changeSetId}</Id><StackId>${f.plan.changeSet.StackName}</StackId>` :
        action === "DescribeChangeSet" ? `<StackId>${f.plan.changeSet.StackName}</StackId><ChangeSetId>${f.changeSetId}</ChangeSetId>
          <Status>CREATE_COMPLETE</Status><ExecutionStatus>AVAILABLE</ExecutionStatus><Changes>
          <member><Type>Resource</Type><ResourceChange><LogicalResourceId>TenantTaskDefinition</LogicalResourceId>
          <ResourceType>AWS::ECS::TaskDefinition</ResourceType><Action>Modify</Action><Replacement>True</Replacement></ResourceChange></member>
          <member><Type>Resource</Type><ResourceChange><LogicalResourceId>TenantService</LogicalResourceId>
          <ResourceType>AWS::ECS::Service</ResourceType><Action>Modify</Action><Replacement>False</Replacement></ResourceChange></member></Changes>` : "";
      return response(`<${action}Response xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/"><${action}Result>${result}</${action}Result>
        <ResponseMetadata><RequestId>synthetic</RequestId></ResponseMetadata></${action}Response>`, { "content-type": "text/xml" });
    } } });
  try {
    const adapter = new ReleaseCloudFormationAdapter(client);
    const id = await adapter.create(f.plan, f.sha, "release-test", "create-token");
    assert.equal(forms.length, 1); // create does NOT execute or poll.
    const reviewed = await adapter.describe(f.plan, f.sha, id); assert.equal(forms.length, 2);
    await adapter.execute(reviewed, "execute-token"); assert.equal(forms.length, 3);
    assert.equal(forms[0].get("UsePreviousTemplate"), "true"); assert.equal(forms[0].get("ChangeSetType"), "UPDATE");
    assert.equal(forms[0].get("Parameters.member.1.UsePreviousValue"), "true");
    assert.equal(forms[0].get("Parameters.member.2.ParameterValue"), f.plan.to.imageUri);
    assert.equal(forms[2].get("ClientRequestToken"), "execute-token");
    assert.equal(forms[2].get("DisableRollback"), "false");
  } finally { client.destroy(); }
});

function described(f: Awaited<ReturnType<typeof releaseFixture>>): DescribeChangeSetOutput {
  return { StackId: f.plan.changeSet.StackName, ChangeSetId: f.changeSetId,
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Changes: f.plan.expectedChanges.map(c => ({
      Type: "Resource", ResourceChange: { LogicalResourceId: c.logicalId, Action: c.action, Replacement: c.replacement,
        ResourceType: c.logicalId === "TenantService" ? "AWS::ECS::Service" : "AWS::ECS::TaskDefinition" } })) };
}

test("release CFN scope review rejects extra/remove/conditional changes, drift, pagination and unrelated stack/CS", async () => {
  const f = await releaseFixture(), good = described(f);
  for (const patch of [{ StackId: "foreign" }, { ChangeSetId: "foreign" }, { NextToken: "more" },
    { DeploymentMode: "REVERT_DRIFT" as const }, { DeploymentConfig: { DisableRollback: true } },
    { IncludeNestedStacks: true }, { Changes: [...good.Changes!, good.Changes![0]] }]) {
    assert.throws(() => reviewImageChangeSet(f.plan, f.sha, f.changeSetId, { ...good, ...patch }), /SCOPE_MISMATCH/);
  }
  for (const mutation of ["Remove", "Conditional", "False"] as const) {
    const bad = structuredClone(good), c = bad.Changes![0].ResourceChange!;
    if (mutation === "Remove") c.Action = "Remove"; else c.Replacement = mutation;
    assert.throws(() => reviewImageChangeSet(f.plan, f.sha, f.changeSetId, bad), /SCOPE_MISMATCH/);
  }
  assert.doesNotThrow(() => reviewImageChangeSet(f.plan, f.sha, f.changeSetId,
    { ...good, DeploymentConfig: { Mode: "STANDARD", DisableRollback: false } }));
});

test("release CFN real SDK: ambiguous write is sent once, sanitized, never auto-executed/retried", async () => {
  const f = await releaseFixture(); let calls = 0;
  const client = new CloudFormationClient({ region: "ca-central-1", credentials, maxAttempts: 1,
    requestHandler: { handle: async () => { calls++; throw new Error("secret-canary-network-error"); } } });
  try {
    const adapter = new ReleaseCloudFormationAdapter(client);
    await assert.rejects(adapter.create(f.plan, f.sha, "release-test", "create-token"), e => {
      assert.ok(e instanceof ReleaseCloudSubmissionUnknown); assert.doesNotMatch(String(e), /secret-canary/); return true;
    });
    assert.equal(calls, 1);
    await assert.rejects(adapter.execute({ stackId: f.plan.changeSet.StackName,
      changeSetId: f.changeSetId, planSha256: f.sha }, "execute-token"), ReleaseCloudSubmissionUnknown);
    assert.equal(calls, 2); // One attempt per separately invoked write, never an automatic replay.
  } finally { client.destroy(); }
});

test("release CFN adapter rejects SDK automatic retries and changed plan before any request", async () => {
  const f = await releaseFixture(); let calls = 0;
  const client = new CloudFormationClient({ region: "ca-central-1", credentials, maxAttempts: 3,
    requestHandler: { handle: async () => { calls++; throw new Error("must not send"); } } });
  try {
    const adapter = new ReleaseCloudFormationAdapter(client);
    await assert.rejects(adapter.create(f.plan, f.sha, "release-test", "create-token"), /RETRIES_MUST_BE_DISABLED/);
    await assert.rejects(adapter.execute({ stackId: f.plan.changeSet.StackName, changeSetId: f.changeSetId, planSha256: f.sha }, "token"), /RETRIES_MUST_BE_DISABLED/);
    await assert.rejects(adapter.create(f.plan, h("0"), "release-test", "token"), /PLAN_HASH_MISMATCH/);
    assert.equal(calls, 0);
  } finally { client.destroy(); }
});

async function proofDocument(): Promise<ReleaseInspectionDocument> {
  const f = await releaseFixture(); return { requestId: f.plan.selection.requestId, planSha256: f.sha, runId: "123", runAttempt: 1,
    stackId: f.plan.changeSet.StackName, releaseId: f.plan.to.releaseId, imageUri: f.plan.to.imageUri,
    platformDigest: f.plan.to.platformDigest, templateSha256: f.plan.templateSha256,
    configurationSha256: f.plan.configurationSha256, result: "SUCCEEDED" };
}

test("release S3 real SDK: conditional PUT, fixed version GET and SHA; unexpected sensitive extras never enter evidence", async () => {
  const proof = await proofDocument(); let bytes = "", calls = 0;
  const client = new S3Client({ region: "ca-central-1", credentials, maxAttempts: 1, requestHandler: { handle: async (request: HttpRequest) => {
    calls++; assert.equal(request.headers["x-amz-expected-bucket-owner"], "111111111111");
    if (request.method === "PUT") {
      assert.equal(request.headers["if-none-match"], "*"); bytes = String(request.body);
      assert.doesNotMatch(bytes, /secret-canary|privateKey|password/);
      return response("", { "x-amz-version-id": "fixed-version" });
    }
    assert.equal(request.query?.versionId, "fixed-version");
    return response(bytes, { "x-amz-version-id": "fixed-version", "content-length": String(Buffer.byteLength(bytes)) });
  } } });
  try {
    const adapter = new ReleaseEvidenceAdapter(client, { bucket: "synthetic-private", owner: "111111111111", prefix: "releases" });
    const reference = await adapter.putInspection({ ...proof, privateKey: "secret-canary" } as ReleaseInspectionDocument);
    assert.equal(calls, 1); assert.equal(reference.sha256, await sha256Hex(bytes));
    assert.deepEqual(await adapter.read(reference), proof); assert.equal(calls, 2);
    await assert.rejects(adapter.read({ ...reference, bucket: "other" }), /REFERENCE_MISMATCH/);
    await assert.rejects(adapter.read({ ...reference, versionId: "null" }), /REFERENCE_MISMATCH/); assert.equal(calls, 2);
    await assert.rejects(adapter.read({ ...reference, sha256: h("0") }), /HASH_MISMATCH/); assert.equal(calls, 3);
  } finally { client.destroy(); }
});

test("release S3 real SDK: existing object or absent version leaves unknown, never overwrites or retries", async () => {
  for (const conflict of [true, false]) {
    let calls = 0;
    const client = new S3Client({ region: "ca-central-1", credentials, maxAttempts: 1, requestHandler: { handle: async () => {
      calls++; return conflict ? response('<Error><Code>PreconditionFailed</Code></Error>', {}, 412) : response("");
    } } });
    try {
      const adapter = new ReleaseEvidenceAdapter(client, { bucket: "synthetic-private", owner: "111111111111", prefix: "releases" });
      await assert.rejects(adapter.putInspection(await proofDocument()), ReleaseCloudSubmissionUnknown);
      assert.equal(calls, 1);
    } finally { client.destroy(); }
  }
});

test("release S3 real SDK: exact bytes and response version are required, not just a success status", async () => {
  const proof = await proofDocument(), body = canonicalJson(proof);
  for (const patch of [{ version: "other", body }, { version: "fixed-version", body: body + " " }]) {
    const client = new S3Client({ region: "ca-central-1", credentials, maxAttempts: 1, requestHandler: { handle: async () =>
      response(patch.body, { "x-amz-version-id": patch.version, "content-length": String(Buffer.byteLength(patch.body)) }) } });
    try {
      const adapter = new ReleaseEvidenceAdapter(client, { bucket: "synthetic-private", owner: "111111111111", prefix: "releases" });
      await assert.rejects(adapter.read({ bucket: "synthetic-private", key: "releases/request/proof.json",
        versionId: "fixed-version", sha256: await sha256Hex(body) }), /RESPONSE_MISMATCH|HASH_MISMATCH/);
    } finally { client.destroy(); }
  }
});
