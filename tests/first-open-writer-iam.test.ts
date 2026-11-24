import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { FIRST_OPEN_AUTHORITY_POLICY } from "../lib/deployments/execution/first-onboarding-middle.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenSessionArn } from "../ops/aws-sandbox/first-open-sessions.ts";
import { firstOpenProvisionerFederationStatus, projectFirstOpenWriterWriteAuthority, renderFirstOpenWriterRevokeTargets }
  from "../ops/aws-sandbox/scripts/first-open-lifecycle-iam-delta.mjs";
import oidc from "../ops/aws-sandbox/first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

const startAt = Date.UTC(2026, 10, 22, 12), writeBefore = startAt + 60 * 60_000;
const fence = { ...oidc.federatedTrust.runOnce.targets[0], status: firstOpenProvisionerFederationStatus,
  roleSessionName: firstOpenSessionArn("provisioner").split("/").at(-1), writeBefore };

test("writer review projects only the exact authority key and four write attributes, not the CAS body", () => {
  const review = projectFirstOpenWriterWriteAuthority(fence, startAt);
  const { Action, Resource, Condition, cannotEnforceCompareAndSwapBody } = review.dynamoDb;
  const expected = FIRST_OPEN_AUTHORITY_POLICY.Statement[0];
  assert.equal(review.executableApprovalSha256, null);
  assert.equal(Action, "dynamodb:PutItem");
  assert.equal(Resource, expected.Resource);
  assert.deepEqual(Condition, {
    StringEquals: { "aws:userid": `${fence.roleId}:${fence.roleSessionName}`, "aws:RequestedRegion": s.region },
    "ForAllValues:StringEquals": { ...expected.Condition["ForAllValues:StringEquals"],
      "dynamodb:Attributes": ["authority_key", "schema_version", "revision", "record_json"] },
    Null: { ...expected.Condition.Null, "dynamodb:Attributes": "false" },
    DateGreaterThanEquals: { "aws:CurrentTime": new Date(startAt).toISOString() },
    DateLessThan: { "aws:CurrentTime": new Date(writeBefore).toISOString() },
  });
  assert.equal(cannotEnforceCompareAndSwapBody, true);
  assert.throws(() => projectFirstOpenWriterWriteAuthority(fence, startAt - 1), /WRITER_AUTHORITY_WINDOW/);
  assert.throws(() => projectFirstOpenWriterWriteAuthority(fence, writeBefore), /WRITER_AUTHORITY_WINDOW/);
  assert.throws(() => projectFirstOpenWriterWriteAuthority({ ...fence, roleSessionName: "techlong-sandbox-provisioner" }, startAt), /WRITER_FENCE_SCOPE/);
});

test("one g1 name and exact tags do not unlock tagged-create or inline CloudFormation", () => {
  const review = projectFirstOpenWriterWriteAuthority(fence, startAt);
  const { generationSecret, cloudFormation } = review;
  assert.match(generationSecret.status, /^BLOCKED_/);
  assert.equal(generationSecret.Action, "secretsmanager:CreateSecret");
  assert.equal(generationSecret.Resource, `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-??????`);
  const tags = { ManagedBy: "techlong-sandbox", SecretSchema: "techlong-runtime-four-key-v2", DatabaseProfile: "express_iam",
    ResourceGeneration: "1", StableIdentity: s.stableIdentity, AppInstanceId: s.instanceId, DeploymentId: s.deploymentId,
    OwnershipMarker: `tl_owner_${s.stableIdentity.slice(0, 32)}_g1` };
  assert.deepEqual(generationSecret.Condition.StringEquals, { "aws:userid": `${fence.roleId}:${fence.roleSessionName}`,
    "aws:RequestedRegion": s.region, "secretsmanager:Name": s.secretName,
    ...Object.fromEntries(Object.entries(tags).map(([key, value]) => [`aws:RequestTag/${key}`, value])) });
  assert.deepEqual(generationSecret.Condition["ForAllValues:StringEquals"], { "aws:TagKeys": Object.keys(tags) });
  assert.deepEqual(generationSecret.Condition.Null, { "aws:TagKeys": "false", "secretsmanager:AddReplicaRegions": "true", "secretsmanager:KmsKeyId": "true" });
  assert.equal(generationSecret.dependentAction, "secretsmanager:TagResource");
  assert.equal(generationSecret.cannotEnforceInitialTokenOrPayload, true);
  assert.equal(cloudFormation.stackArnPattern, `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/*`);
  assert.equal(cloudFormation.executionRoleArn, s.cfnRole);
  assert.match(cloudFormation.status, /^BLOCKED_/);
  assert.equal(cloudFormation.immutableTemplateUrl, null);
  assert.equal(cloudFormation.requiresProvedParameterAndServiceRoleEnforcement, true);
  assert.doesNotMatch(JSON.stringify(review), /"Effect"|"Statement"/);
});

test("writer rollback target only restores the two sealed resources and preserves the reserved-session denial", t => {
  assert.throws(() => renderFirstOpenWriterRevokeTargets({ Resources: {} }, fence), /ORIGINAL/);
  // Exercise against an already-sealed IAM policy Original when available;
  // this test reads no credentials, configuration values or Secret values.
  const file = new URL("../.local-secrets/first-open-fc41597f-iam-originals-woNyuO/shared-original.template", import.meta.url);
  if (!existsSync(file)) return t.skip("sealed IAM Original unavailable");
  const original = JSON.parse(readFileSync(file, "utf8"));
  const revoke = renderFirstOpenWriterRevokeTargets(original, fence);
  assert.deepEqual(Object.keys(revoke.resources).sort(), ["ProvisionerBoundary", "ProvisionerRole"]);
  assert.deepEqual(revoke.resources.ProvisionerBoundary, original.Resources.ProvisionerBoundary);
  const { Policies, ...props } = revoke.resources.ProvisionerRole.Properties;
  assert.deepEqual(props, original.Resources.ProvisionerRole.Properties);
  assert.equal(Policies.length, 1);
  assert.deepEqual(Policies[0].PolicyDocument.Statement[1], {
    Sid: "FirstOpenFc41597fWriterLocked", Effect: "Deny", Action: "*", Resource: "*",
    Condition: { StringEquals: { "aws:userid": `${fence.roleId}:${fence.roleSessionName}` } },
  });
  assert.equal(revoke.requiresIndependentlyMatchedActivePreimage, true);
  assert.equal(revoke.retainReservedSessionDeniesUntilLastIssuedSessionExpires, true);
  assert.equal(revoke.executableApprovalSha256, null);
});
