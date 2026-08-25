import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const lifecycleLogSupportSafety = Object.freeze({
  SchemaVersion: 1,
  ExpectedAccountId: "402010193138",
  ExpectedRegion: "ca-central-1",
  ApprovedStackName: "techlong-sandbox-tenant-b5j4logs",
  LogGroupName: "/saas/cell-sandbox-1/tenant-lifecycle",
  RetentionInDays: 1,
  CreatesLogGroupOnly: true,
  CreatesLogStreams: false,
  CreatesSubscriptionFilters: false,
  CreatesMetricFilters: false,
  UsesKms: false,
  RunsTask: false,
  CreatesSharedCell: false,
  RegistrationReady: false,
  LiveReadbackReady: false,
  ApplyRuntimeReady: false,
  CleanupRuntimeReady: false,
});

const accountId = lifecycleLogSupportSafety.ExpectedAccountId;
const region = lifecycleLogSupportSafety.ExpectedRegion;
const stackName = lifecycleLogSupportSafety.ApprovedStackName;
const logGroupName = lifecycleLogSupportSafety.LogGroupName;
const logicalId = "TenantLifecycleLogGroup";
const logGroupArn = `arn:aws:logs:${region}:${accountId}:log-group:${logGroupName}`;
const clusterArn = `arn:aws:ecs:${region}:${accountId}:cluster/cell-sandbox-1`;
const stackIdPattern =
  /^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-tenant-b5j4logs\/[a-f0-9-]{36}$/i;
const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const credentialPatterns = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:sk_(?:live|test)|whsec_)[A-Za-z0-9]{16,}/,
];

const clone = (value) => JSON.parse(JSON.stringify(value));

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])]),
    );
  }
  return value;
}

export const canonicalJson = (value) => JSON.stringify(normalized(value));
export const sha256Canonical = (value) =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

function assertNoCredentials(value, label) {
  const source = JSON.stringify(value);
  for (const pattern of credentialPatterns) {
    assert.doesNotMatch(source, pattern, `${label} contains credential material`);
  }
}

function assertExactUtc(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, isoUtcPattern, `${label} must be second-precision UTC`);
  const date = new Date(value);
  assert.ok(Number.isFinite(date.valueOf()), `${label} must be a real timestamp`);
  assert.equal(date.toISOString().replace(".000Z", "Z"), value, `${label} must be canonical UTC`);
}

function expectedExplicitTags(expiresAt) {
  return {
    AppInstanceId: "tenant-lifecycle",
    Component: "tenant-lifecycle-logs",
    DeploymentId: "b5j4-log-support",
    Environment: "aws-sandbox",
    ExpiresAt: expiresAt,
    ManagedBy: "techlong-provisioner",
  };
}

export function validateLifecycleLogSupportTemplate(template) {
  assert.deepEqual(Object.keys(template), [
    "AWSTemplateFormatVersion",
    "Description",
    "Metadata",
    "Parameters",
    "Conditions",
    "Resources",
    "Outputs",
  ]);
  assert.equal(template.AWSTemplateFormatVersion, "2010-09-09");
  assert.deepEqual(template.Metadata, { SafetyBoundary: lifecycleLogSupportSafety });
  assert.deepEqual(template.Parameters, {
    ExpiresAt: {
      Type: "String",
      Description:
        "Exact second-precision UTC expiry ownership tag; the operation script restricts initial creation to 15 minutes through 3 hours in the future.",
      AllowedPattern:
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
    },
  });
  assert.deepEqual(template.Conditions, {
    IsExpectedTarget: {
      "Fn::And": [
        { "Fn::Equals": [{ Ref: "AWS::AccountId" }, accountId] },
        { "Fn::Equals": [{ Ref: "AWS::Region" }, region] },
      ],
    },
  });
  assert.deepEqual(Object.keys(template.Resources), [logicalId]);
  const resource = template.Resources[logicalId];
  assert.deepEqual(Object.keys(resource), [
    "Type",
    "Condition",
    "DeletionPolicy",
    "UpdateReplacePolicy",
    "Properties",
  ]);
  assert.equal(resource.Type, "AWS::Logs::LogGroup");
  assert.equal(resource.Condition, "IsExpectedTarget");
  assert.equal(resource.DeletionPolicy, "Delete");
  assert.equal(resource.UpdateReplacePolicy, "Delete");
  assert.deepEqual(resource.Properties, {
    LogGroupName: logGroupName,
    LogGroupClass: "STANDARD",
    RetentionInDays: 1,
    Tags: [
      { Key: "Environment", Value: "aws-sandbox" },
      { Key: "ManagedBy", Value: "techlong-provisioner" },
      { Key: "Component", Value: "tenant-lifecycle-logs" },
    ],
  });
  assert.equal(Object.hasOwn(resource.Properties, "KmsKeyId"), false);
  assert.deepEqual(template.Outputs, {
    LogGroupName: {
      Condition: "IsExpectedTarget",
      Value: { Ref: logicalId },
    },
    LogGroupArn: {
      Condition: "IsExpectedTarget",
      Value: { "Fn::GetAtt": [logicalId, "Arn"] },
    },
  });
  for (const gate of [
    "RegistrationReady",
    "LiveReadbackReady",
    "ApplyRuntimeReady",
    "CleanupRuntimeReady",
  ]) assert.equal(template.Metadata.SafetyBoundary[gate], false);
  assertNoCredentials(template, "template");
  return Object.freeze({
    schemaVersion: 1,
    accountId,
    region,
    stackName,
    logicalId,
    logGroupName,
    retentionInDays: 1,
    propertiesCanonicalSha256: sha256Canonical(resource.Properties),
    runtimeGates: {
      registrationReady: false,
      liveReadbackReady: false,
      applyRuntimeReady: false,
      cleanupRuntimeReady: false,
    },
  });
}

export function validateLifecycleLogSupportReadback(
  describePayload,
  tagsPayload,
  streamsPayload,
  subscriptionsPayload,
  accountSubscriptionsPayload,
  clusterPayload,
  { expectedExpiresAt, expectedStackId } = {},
) {
  assertExactUtc(expectedExpiresAt, "expectedExpiresAt");
  assert.match(expectedStackId, stackIdPattern, "stack id is outside the exact stack fence");
  assert.deepEqual(Object.keys(describePayload), ["logGroups"]);
  assert.equal(describePayload.logGroups.length, 1, "describe must return exactly one prefix result");
  const logGroup = describePayload.logGroups[0];
  const allowedLogFields = new Set([
    "arn",
    "bearerTokenAuthenticationEnabled",
    "creationTime",
    "dataProtectionStatus",
    "deletionProtectionEnabled",
    "inheritedProperties",
    "logGroupArn",
    "logGroupClass",
    "logGroupName",
    "metricFilterCount",
    "retentionInDays",
    "storedBytes",
  ]);
  for (const key of Object.keys(logGroup)) {
    assert.ok(allowedLogFields.has(key), `unexpected log-group field ${key}`);
  }
  assert.equal(logGroup.logGroupName, logGroupName);
  assert.equal(logGroup.retentionInDays, 1);
  assert.equal(logGroup.metricFilterCount, 0);
  assert.equal(logGroup.arn, `${logGroupArn}:*`);
  if (logGroup.logGroupArn !== undefined) assert.equal(logGroup.logGroupArn, logGroupArn);
  assert.equal(Object.hasOwn(logGroup, "kmsKeyId"), false);
  assert.ok(Number.isSafeInteger(logGroup.creationTime) && logGroup.creationTime > 0);
  assert.equal(logGroup.storedBytes, 0);
  assert.equal(logGroup.logGroupClass, "STANDARD");
  assert.equal(logGroup.deletionProtectionEnabled ?? false, false);
  assert.equal(logGroup.bearerTokenAuthenticationEnabled ?? false, false);
  assert.equal(
    Object.hasOwn(logGroup, "dataProtectionStatus"),
    false,
    "log group must not have a data-protection policy",
  );
  assert.deepEqual(logGroup.inheritedProperties ?? [], []);

  assert.deepEqual(streamsPayload, { logStreams: [] }, "lifecycle log group must contain zero streams");
  assert.deepEqual(
    subscriptionsPayload,
    { subscriptionFilters: [] },
    "lifecycle log group must contain zero subscription filters",
  );
  assert.deepEqual(
    accountSubscriptionsPayload,
    { accountPolicies: [] },
    "account must contain zero subscription-filter policies",
  );
  assert.deepEqual(clusterPayload.clusters, []);
  assert.equal(clusterPayload.failures.length, 1);
  const clusterFailure = clusterPayload.failures[0];
  assert.ok(
    ["arn,reason", "arn,detail,reason"].includes(Object.keys(clusterFailure).sort().join(",")),
    "cluster MISSING failure contains unexpected fields",
  );
  assert.equal(clusterFailure.arn, clusterArn);
  assert.equal(clusterFailure.reason, "MISSING");
  assert.ok(clusterFailure.detail === undefined || clusterFailure.detail === "");
  assert.deepEqual(Object.keys(clusterPayload).sort(), ["clusters", "failures"]);

  assert.deepEqual(Object.keys(tagsPayload), ["tags"]);
  assert.ok(tagsPayload.tags && typeof tagsPayload.tags === "object" && !Array.isArray(tagsPayload.tags));
  const observedTags = tagsPayload.tags;
  const expectedTags = expectedExplicitTags(expectedExpiresAt);
  for (const [key, value] of Object.entries(expectedTags)) assert.equal(observedTags[key], value);
  const allowedSystemTags = new Set([
    "aws:cloudformation:logical-id",
    "aws:cloudformation:stack-id",
    "aws:cloudformation:stack-name",
  ]);
  for (const key of Object.keys(observedTags)) {
    assert.ok(Object.hasOwn(expectedTags, key) || allowedSystemTags.has(key), `unexpected log-group tag ${key}`);
  }
  assert.deepEqual(
    Object.keys(observedTags).filter((key) => !key.startsWith("aws:")).sort(),
    Object.keys(expectedTags).sort(),
  );
  if (Object.hasOwn(observedTags, "aws:cloudformation:logical-id")) {
    assert.equal(observedTags["aws:cloudformation:logical-id"], logicalId);
  }
  if (Object.hasOwn(observedTags, "aws:cloudformation:stack-name")) {
    assert.equal(observedTags["aws:cloudformation:stack-name"], stackName);
  }
  if (Object.hasOwn(observedTags, "aws:cloudformation:stack-id")) {
    assert.equal(observedTags["aws:cloudformation:stack-id"], expectedStackId);
  }
  assertNoCredentials(
    {
      describePayload,
      tagsPayload,
      streamsPayload,
      subscriptionsPayload,
      accountSubscriptionsPayload,
      clusterPayload,
    },
    "readback",
  );

  const canonical = {
    schemaVersion: 1,
    mode: "cloudwatch_log_group_exact_readback",
    accountId,
    region,
    stackName,
    stackId: expectedStackId,
    logicalResourceId: logicalId,
    logGroup: {
      name: logGroupName,
      arn: logGroupArn,
      retentionInDays: 1,
      metricFilterCount: 0,
      subscriptionFilters: 0,
      accountSubscriptionPolicies: 0,
      encryptedWithKms: false,
      dataProtectionPolicy: false,
      bearerTokenAuthentication: false,
      class: logGroup.logGroupClass ?? "STANDARD",
      creationTime: logGroup.creationTime,
      storedBytes: 0,
    },
    sharedCellCluster: { name: "cell-sandbox-1", state: "MISSING" },
    tags: Object.fromEntries(Object.entries(observedTags).sort(([a], [b]) => a.localeCompare(b))),
    runtimeGates: {
      registrationReady: false,
      liveReadbackReady: false,
      applyRuntimeReady: false,
      cleanupRuntimeReady: false,
    },
  };
  return Object.freeze({ canonical: clone(canonical), canonicalSha256: sha256Canonical(canonical) });
}
