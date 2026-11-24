import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { CreateStackCommand, DescribeStacksCommand, type CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { GetObjectCommand, PutObjectCommand, type GetObjectCommandOutput, type S3Client } from "@aws-sdk/client-s3";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK } from "../lib/deployments/execution/first-onboarding-run-once.ts";
import { canonicalJson, sha256Hex } from "../lib/deployments/execution/hash.ts";
import type { SupervisedTenantStack } from "../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { createFirstOpenControlledCfnAuthor, createFirstOpenControlledCfnSubmitter, firstOpenControlledCfnTemplate,
  type FirstOpenVersionAuthorityReader } from "../ops/aws-sandbox/first-open-controlled-cfn.ts";
import { firstOpenManagementBucket } from "../ops/aws-sandbox/first-open-management-bridge.ts";
import { freezeFirstOpenTemplate } from "../lib/deployments/execution/first-open-frozen-template.ts";

const approvalSha256 = "a".repeat(64), startAt = Date.UTC(2026, 10, 22, 12), writeBefore = startAt + 30 * 60_000;
const submitBefore = writeBefore - 90_000, authoritySourceSha256 = "c".repeat(64), runId = "123456";
const versionId = "fixed+Version.With/Encoding==";
const id = `arn:aws:cloudformation:${s.region}:${s.account}:stack/${SANDBOX_FIRST_OPEN_STACK}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;
const vac = (name = SANDBOX_FIRST_OPEN_STACK) => Object.assign(Error(`Stack with id ${name} does not exist`), { name: "ValidationError" });
const signal = () => new AbortController().signal;
const resources = {
  TenantLogGroup: "AWS::Logs::LogGroup", TenantTaskDefinition: "AWS::ECS::TaskDefinition", TenantTargetGroup: "AWS::ElasticLoadBalancingV2::TargetGroup",
  TenantBusinessControlDenyRule: "AWS::ElasticLoadBalancingV2::ListenerRule", TenantListenerRule: "AWS::ElasticLoadBalancingV2::ListenerRule",
  TenantControlListenerRule: "AWS::ElasticLoadBalancingV2::ListenerRule", TenantService: "AWS::ECS::Service",
};

async function fixture() {
  const parameters = { AppInstanceId: s.instanceId, TenantHostname: s.hostname, TaskExecutionRoleArn: s.executionRole, TaskRoleArn: s.applicationRole,
    ControlPublicKeyValueFrom: `${s.controlArn}:::${s.controlVersion}`, TenantRuntimeSecretArn: `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-Abc123`,
    SubnetIds: "subnet-aa,subnet-bb" };
  const template = freezeFirstOpenTemplate({ AWSTemplateFormatVersion: "2010-09-09",
    Parameters: Object.fromEntries(Object.keys(parameters).map(k => [k, { Type: k === "SubnetIds" ? "List<AWS::EC2::Subnet::Id>" : "String" }])),
    Resources: Object.fromEntries(Object.entries(resources).map(([k, Type]) => [k, { Type }])) ,
    Outputs: { test: { Value: { Ref: "SubnetIds" } } } }, parameters);
  const op = "b".repeat(64);
  const stack: SupervisedTenantStack = {
    schemaVersion: 1, protocol: "single-tenant-supervised-workload", stackName: SANDBOX_FIRST_OPEN_STACK, accountId: s.account, region: s.region,
    cloudFormationRoleArn: s.cfnRole, onFailure: "ROLLBACK", capabilities: [], clientRequestToken: `render-${s.deploymentId}-v1-e1-${op.slice(0, 16)}`,
    template, templateBody: canonicalJson(template), templateSha256: await sha256Hex(template),
    tags: { AppInstanceId: s.instanceId, DeploymentId: s.deploymentId, ResourceGeneration: "1", ExternalOperationEpoch: "1",
      ExternalOperationIntent: "provision", ExternalOperationMarker: `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1`, ExternalOperationHash: op,
      Environment: "aws-sandbox", ManagedBy: "techlong-provisioner", CleanupMode: "supervised-reviewed", DeliveryTrack: "single-tenant-acceptance" },
    parameters,
    requiredExternalParameters: [], resourceInventory: Object.entries(resources).map(([logicalId, type]) => ({ logicalId, type })),
    safety: { renderOnly: true, executionAuthorized: false, runtimeEnabled: false, callsAws: false,
      createsDatabaseResources: false, automaticCleanupInstalled: false, supervisedExactArnCleanupRequired: true,
      fixedTaskCount: 1, capacityProvider: "FARGATE", ownershipChecksRetained: true,
      existingWorkerRendererUnchanged: true, appReadyNotYetVerified: true, parametersValidated: true },
  };
  const proof = await firstOpenControlledCfnTemplate(approvalSha256, stack);
  return { stack, proof };
}

type AuthorityScope = Parameters<FirstOpenVersionAuthorityReader["readVerified"]>[0];
async function approvedAuthority(scope: AuthorityScope) {
  return { schema: "techlong/fc41597f-exact-cfn-version-authority/v2", scopeSha256: await sha256Hex(scope),
    policySha256: "d".repeat(64), checkedAt: scope.putAcknowledgedAt, expiresAt: scope.submitBefore,
    evidence: "MATCHED_INSTALLED_POLICY_DOCUMENTS" };
}
async function adapters(options: {
  object?(body: Buffer): Partial<GetObjectCommandOutput>; describe?(): object; create?(): object; now?: () => number;
  readVerified?: FirstOpenVersionAuthorityReader["readVerified"]; sourceSha256?: string; omitReader?: boolean; checkClaim?: () => void;
} = {}) {
  const { stack, proof } = await fixture(), calls: (GetObjectCommand | DescribeStacksCommand | CreateStackCommand)[] = [];
  const order: string[] = [], authorityScopes: AuthorityScope[] = [];
  const s3 = { async send(command: GetObjectCommand) {
    calls.push(command);
    order.push("read-exact-version");
    return { Body: Readable.from([proof.bytes.subarray(0, 8), proof.bytes.subarray(8)]), ContentType: "application/json",
      ContentLength: proof.bytes.length, VersionId: versionId, ServerSideEncryption: "AES256", ...options.object?.(proof.bytes) };
  } } as unknown as Pick<S3Client, "send">;
  const cloudFormation = { async send(command: DescribeStacksCommand | CreateStackCommand) {
    calls.push(command);
    if (command instanceof DescribeStacksCommand) {
      order.push("vacant-stack");
      if (!options.describe) throw vac();
      return options.describe();
    }
    if (!(command instanceof CreateStackCommand)) assert.fail("unexpected AWS operation");
    order.push("create");
    return options.create ? options.create() : { StackId: id };
  } } as unknown as Pick<CloudFormationClient, "send">;
  const authorityReader = options.omitReader ? undefined : {
    sourceSha256: options.sourceSha256 ?? authoritySourceSha256,
    async readVerified(scope: AuthorityScope, abortSignal: AbortSignal) {
      order.push("authority"); authorityScopes.push(scope);
      return (options.readVerified ?? approvedAuthority)(scope, abortSignal);
    },
  };
  const submit = createFirstOpenControlledCfnSubmitter({ approvalSha256, writeBefore, startAt, submitBefore, runId, authoritySourceSha256,
    authorityReader, async verifyClaim() { order.push("claim"); options.checkClaim?.(); }, s3, cloudFormation }, options.now ?? (() => startAt));
  return { calls, order, authorityScopes, stack, proof, submit,
    input: { expectedStack: stack, requestSha256: proof.requestSha256, versionId, putAcknowledgedAt: startAt, signal: signal() } };
}

test("broker proves a single fixed object version and exact vacancy before one versioned CreateStack", async () => {
  const { calls, order, authorityScopes, stack, proof, submit, input } = await adapters();
  assert.equal(proof.key, `first-open-management/${s.jobId}/${approvalSha256}/cfn-template.json`);
  assert.deepEqual(await submit(input), { operation: "create", stackId: id });
  assert.equal(calls.length, 3);
  assert.deepEqual(order, ["authority", "read-exact-version", "vacant-stack", "claim", "create"]);
  assert.equal(authorityScopes.length, 1);
  const authority = authorityScopes[0];
  assert.deepEqual([authority.jobId, authority.runId, authority.attempt, authority.versionId, authority.templateSha256, authority.key,
    authority.approvalSha256, authority.putAcknowledgedAt, authority.operationSha256],
  [s.jobId, runId, 1, versionId, proof.sha256, proof.key, approvalSha256, startAt, stack.tags.ExternalOperationHash]);
  assert.ok(calls[0] instanceof GetObjectCommand && calls[1] instanceof DescribeStacksCommand && calls[2] instanceof CreateStackCommand);
  assert.deepEqual(calls[0].input, { Bucket: firstOpenManagementBucket, Key: proof.key, VersionId: versionId, ExpectedBucketOwner: s.account });
  assert.deepEqual(calls[1].input, { StackName: SANDBOX_FIRST_OPEN_STACK });
  assert.deepEqual(calls[2].input, {
    StackName: SANDBOX_FIRST_OPEN_STACK, TemplateURL: `https://${firstOpenManagementBucket}.s3.${s.region}.amazonaws.com/${proof.key}?versionId=${encodeURIComponent(versionId)}`,
    RoleARN: s.cfnRole, OnFailure: "ROLLBACK", EnableTerminationProtection: false, ClientRequestToken: `first-open-${proof.requestSha256}`,
    Tags: Object.entries(stack.tags).sort().map(([Key, Value]) => ({ Key, Value })),
  });
  await assert.rejects(submit(input), /SLOT_USED/);
  assert.equal(calls.length, 3);
});

test("no independent source, wrong version or run, premature/expired receipt and unresolved denial cannot build", async () => {
  await assert.rejects(adapters({ omitReader: true }), /AUTHORITY_SOURCE_REQUIRED/);
  await assert.rejects(adapters({ sourceSha256: "f".repeat(64) }), /AUTHORITY_SOURCE_REQUIRED/);
  for (const readVerified of [
    async () => null,
    async (scope: AuthorityScope) => approvedAuthority({ ...scope, versionId: "different.version" }),
    async (scope: AuthorityScope) => approvedAuthority({ ...scope, runId: "456789" }),
    async (scope: AuthorityScope) => ({ ...await approvedAuthority(scope), checkedAt: scope.putAcknowledgedAt - 1 }),
    async (scope: AuthorityScope) => ({ ...await approvedAuthority(scope), expiresAt: startAt }),
    async (scope: AuthorityScope) => ({ ...await approvedAuthority(scope), evidence: "PROVIDER_ACCEPTED_CREATE" }),
  ]) {
    const { submit, input, calls, authorityScopes } = await adapters({ readVerified });
    await assert.rejects(submit(input), /AUTHORITY_UNPROVED/);
    await assert.rejects(submit(input), /SLOT_USED/);
    assert.deepEqual(calls, []);
    assert.equal(authorityScopes.length, 1);
  }
});

test("an aborted authority wait closes the slot, and lease loss after receipt never submits", async () => {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const upstream = new AbortController();
  const { submit, input, calls } = await adapters({ async readVerified() {
    entered();
    return new Promise<never>(() => {});
  } });
  const pending = submit({ ...input, signal: upstream.signal });
  await ready;
  upstream.abort();
  await assert.rejects(pending, /AUTHORITY_WINDOW/);
  await assert.rejects(submit(input), /SLOT_USED/);
  assert.deepEqual(calls, []);
  const lost = await adapters({ checkClaim() { throw Error("lost lease"); } });
  await assert.rejects(lost.submit(lost.input), /lost lease/);
  assert.ok(lost.calls.every(c => !(c instanceof CreateStackCommand)));
});

test("a recomputed plan digest is bound to approval, params/tags, and exact execution roles", async () => {
  const { stack, proof } = await fixture();
  const clone = structuredClone(stack);
  assert.equal((await firstOpenControlledCfnTemplate(approvalSha256, clone)).requestSha256, proof.requestSha256);
  clone.parameters.CleanupAt = "2030-01-01T00:00:00Z";
  await assert.rejects(firstOpenControlledCfnTemplate(approvalSha256, clone), /FIXED_TEMPLATE_PARAMETERS/);
  assert.notEqual((await firstOpenControlledCfnTemplate("c".repeat(64), stack)).requestSha256, proof.requestSha256);
  for (const x of [{ ...stack, cloudFormationRoleArn: s.workerRole }, { ...stack, parameters: { ...stack.parameters, TaskRoleArn: s.workerRole } },
    { ...stack, template: { ...stack.template, Transform: "AWS::Include" } }]) {
    await assert.rejects(firstOpenControlledCfnTemplate(approvalSha256, x), /EXPECTATION/);
  }
  const { submit, input, calls } = await adapters();
  await assert.rejects(submit({ ...input, expectedStack: clone }), /FIXED_TEMPLATE_PARAMETERS/);
  assert.deepEqual(calls, []);
  const noVersion = await adapters();
  await assert.rejects(noVersion.submit({ ...noVersion.input, versionId: "null" }), /REQUEST_SCOPE/);
  assert.deepEqual(noVersion.calls, []);
});

test("RunOnce authors one exact conditional Put; frozen subnet value cannot be an allowed subset or alternate order", async () => {
  const { stack, proof } = await fixture(), seen: PutObjectCommand[] = [];
  const s3 = { async send(command: PutObjectCommand) { seen.push(command); return { VersionId: versionId }; } } as unknown as Pick<S3Client, "send">;
  const author = createFirstOpenControlledCfnAuthor({ approvalSha256, writeBefore, s3 }, () => startAt);
  assert.deepEqual(await author(stack, signal()), { requestSha256: proof.requestSha256, versionId, putAcknowledgedAt: startAt });
  assert.ok(seen[0] instanceof PutObjectCommand);
  assert.equal(seen[0].input.IfNoneMatch, "*");
  assert.equal(seen[0].input.ServerSideEncryption, "AES256");
  assert.equal(seen[0].input.Key, proof.key);
  assert.deepEqual(seen[0].input.Body, proof.bytes);
  assert.deepEqual(stack.template.Parameters, Object.fromEntries(Object.entries(stack.parameters).map(([k, v]) =>
    [k, { Type: "String", Default: v, AllowedValues: [v] }])));
  assert.deepEqual(stack.template.Outputs, { test: { Value: { "Fn::Split": [",", { Ref: "SubnetIds" }] } } });
  await assert.rejects(author(stack, signal()), /AUTHOR_SLOT_USED/);
  assert.equal(seen.length, 1);
});

test("concurrent duplicate submission loses the slot before either request can yield", async () => {
  const { calls, submit, input } = await adapters();
  const first = submit(input);
  await assert.rejects(submit(input), /SLOT_USED/);
  assert.deepEqual(await first, { operation: "create", stackId: id });
  assert.equal(calls.filter(call => call instanceof CreateStackCommand).length, 1);
});

test("malformed S3 version, altered bytes, existing stack and nonexact not-found all stop before CreateStack", async () => {
  for (const [options, code] of [
    [{ object: () => ({ VersionId: "new-current-version" }) }, /OBJECT_SCOPE/],
    [{ object: () => ({ ContentEncoding: "gzip" }) }, /OBJECT_SCOPE/],
    [{ object: (bytes: Buffer) => ({ Body: Readable.from([Buffer.alloc(bytes.length)]) }) }, /OBJECT_BYTES/],
    [{ describe: () => ({ Stacks: [{ StackId: id }] }) }, /STACK_NOT_VACANT/],
    [{ describe: () => ({}) }, /STACK_NOT_VACANT/],
    [{ describe: () => { throw vac("other-stack"); } }, /VACANCY_UNPROVED/],
  ] as const) {
    const { calls, submit, input } = await adapters(options as Parameters<typeof adapters>[0]);
    await assert.rejects(submit(input), code);
    assert.ok(!calls.some(c => c instanceof CreateStackCommand));
    await assert.rejects(submit(input), /SLOT_USED/);
  }
});

test("clock expiry during vacancy proof stops before create, and unknown writes never retry", async () => {
  let at = startAt;
  const expired = await adapters({ now: () => at, describe: () => { at = writeBefore; throw vac(); } });
  await assert.rejects(expired.submit(expired.input), /WINDOW/);
  assert.equal(expired.calls.length, 2);
  at = startAt;
  const late = await adapters({ now: () => at, create: () => { at = writeBefore; return { StackId: id }; } });
  await assert.rejects(late.submit(late.input), /CREATE_ACK_OUTSIDE_WINDOW/);
  await assert.rejects(late.submit(late.input), /SLOT_USED/);
  assert.equal(late.calls.filter(call => call instanceof CreateStackCommand).length, 1);
  for (const [create, failure] of [[() => ({}), /CREATE_ACK_UNPROVED/], [() => ({ StackId: id.replace(SANDBOX_FIRST_OPEN_STACK, "other-stack") }), /CREATE_ACK_UNPROVED/],
    [() => { throw Error("timeout unknown"); }, /CREATE_STOP_NO_RETRY/]] as const) {
    const { calls, submit, input } = await adapters({ create });
    await assert.rejects(submit(input), failure);
    await assert.rejects(submit(input), /SLOT_USED/);
    assert.equal(calls.filter(call => call instanceof CreateStackCommand).length, 1);
  }
});
