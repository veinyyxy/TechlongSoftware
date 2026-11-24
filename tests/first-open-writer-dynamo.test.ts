import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { HttpRequest } from "@smithy/types";
import { AwsSdkDynamoDbEpochAuthority } from "../lib/deployments/execution/aws-sdk-dynamodb-epoch-authority.ts";
import { FIRST_OPEN_AUTHORITY_KEY } from "../lib/deployments/execution/first-onboarding-middle.ts";
import { SANDBOX_FIRST_OPEN as s } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { COST_CONTROL_SCOPE_V1 } from "../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { firstOpenWriterDynamoDependencies } from "../ops/aws-sandbox/first-open-entry/runner-hosts.ts";

test("RunOnce authority round-trips the exact tenant key through real SDK document marshalling", async () => {
  const actions: string[] = [], tableArn = COST_CONTROL_SCOPE_V1.tableArn;
  let item: Record<string, { S?: string; N?: string }> | undefined;
  const transport = new DynamoDBClient({ region: s.region, maxAttempts: 1,
    credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" }, requestHandler: { async handle(request: HttpRequest) {
      const action = request.headers["x-amz-target"];
      actions.push(action);
      const serialized = request.body as string | Uint8Array;
      const body = JSON.parse(typeof serialized === "string" ? serialized : new TextDecoder().decode(serialized));
      assert.equal(body.TableName, tableArn);
      if (action === "DynamoDB_20120810.GetItem") {
        assert.deepEqual(body.Key, { authority_key: { S: FIRST_OPEN_AUTHORITY_KEY } });
        assert.equal(body.ConsistentRead, true);
      } else {
        assert.equal(action, "DynamoDB_20120810.PutItem");
        assert.equal(body.ConditionExpression, "attribute_not_exists(#authorityKey)");
        assert.deepEqual(body.Item.authority_key, { S: FIRST_OPEN_AUTHORITY_KEY });
        assert.deepEqual(body.Item.schema_version, { N: "1" });
        assert.deepEqual(body.Item.revision, { N: "1" });
        assert.equal(JSON.parse(body.Item.record_json.S).predecessor, null);
        item = body.Item;
      }
      const responseBody = action.endsWith("GetItem") && item ? { Item: item } : {};
      return { response: { statusCode: 200, headers: { "content-type": "application/x-amz-json-1.0" },
        body: Readable.from([Buffer.from(JSON.stringify(responseBody))]) } };
    } } });
  try {
    const store = new AwsSdkDynamoDbEpochAuthority({ tableArn }, firstOpenWriterDynamoDependencies(transport));
    const scope = { authorityKey: FIRST_OPEN_AUTHORITY_KEY, signal: new AbortController().signal };
    const expected = await store.observe(scope);
    assert.equal(expected.revision, "rev:0");
    const written = await store.compareAndSet({ ...scope, expected, next: { schemaVersion: 1, stableIdentityHash: s.stableIdentity,
      generation: 1, epoch: 1, intent: "provision", ownerDeploymentId: s.deploymentId, operationHash: "a".repeat(64),
      marker: `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1` } });
    assert.equal(written.applied, true);
    assert.deepEqual(await store.observe(scope), written.snapshot);
    assert.deepEqual(actions, ["DynamoDB_20120810.GetItem", "DynamoDB_20120810.PutItem", "DynamoDB_20120810.GetItem"]);
  } finally { transport.destroy(); }
});
