import { CreateStackCommand, DescribeStacksCommand, type CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { addAbortListener } from "node:events";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { SANDBOX_FIRST_OPEN as s, SANDBOX_FIRST_OPEN_STACK as stackName } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import type { SupervisedTenantStack } from "../../lib/deployments/execution/single-tenant-workload-strategy.ts";
import { assertFirstOpenFrozenTemplate } from "../../lib/deployments/execution/first-open-frozen-template.ts";
import { firstOpenSessionArn } from "./first-open-sessions.ts";

const fail = (code: string): never => { throw Error("FIRST_OPEN_CONTROLLED_CFN_" + code); };
const hex = /^[a-f0-9]{64}$/;
const { bucket } = FIRST_OPEN_BASELINE_BINDING;
const stackArn = new RegExp(`^arn:aws:cloudformation:${s.region}:${s.account}:stack/${stackName}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`);
const secretArn = `arn:aws:secretsmanager:${s.region}:${s.account}:secret:${s.secretName}-`;
const types = {
  TenantLogGroup: "AWS::Logs::LogGroup", TenantTaskDefinition: "AWS::ECS::TaskDefinition", TenantTargetGroup: "AWS::ElasticLoadBalancingV2::TargetGroup",
  TenantBusinessControlDenyRule: "AWS::ElasticLoadBalancingV2::ListenerRule", TenantListenerRule: "AWS::ElasticLoadBalancingV2::ListenerRule",
  TenantControlListenerRule: "AWS::ElasticLoadBalancingV2::ListenerRule", TenantService: "AWS::ECS::Service",
};
const exactMissing = (error: unknown) => error instanceof Error && error.name === "ValidationError" &&
  error.message.trim() === `Stack with id ${stackName} does not exist`;
const sorted = (values: Record<string, string>) => Object.entries(values).sort(([a], [b]) => a.localeCompare(b));

export type VersionAuthorityScope = Readonly<{
  jobId: string; approvalSha256: string; sourceSha256: string; runId: string; attempt: 1; generation: 1; epoch: 1;
  operationSha256: string; requestSha256: string; putAcknowledgedAt: number;
  bucket: string; key: string; versionId: string; templateSha256: string; templateURL: string; stackName: string;
  submitterArn: string; executionRoleArn: string; submitBefore: number;
}>;

export function firstOpenVersionAuthorityScope(input: Pick<VersionAuthorityScope, "approvalSha256" | "sourceSha256" | "runId" |
  "operationSha256" | "requestSha256" | "putAcknowledgedAt" | "versionId" | "templateSha256" | "submitBefore">): VersionAuthorityScope {
  const { approvalSha256, sourceSha256, runId, operationSha256, requestSha256, putAcknowledgedAt, versionId, templateSha256, submitBefore } = input;
  if (![approvalSha256, sourceSha256, operationSha256, requestSha256, templateSha256].every(x => typeof x === "string" && hex.test(x)) ||
    !/^[1-9][0-9]{0,19}$/.test(runId) || !validFirstOpenVersionId(versionId) ||
    ![putAcknowledgedAt, submitBefore].every(Number.isSafeInteger) ||
    putAcknowledgedAt <= 0 || putAcknowledgedAt >= submitBefore) return fail("AUTHORITY_REQUEST_SCOPE");
  const key = `first-open-management/${s.jobId}/${approvalSha256}/cfn-template.json`;
  const templateURL = `https://${bucket}.s3.${s.region}.amazonaws.com/${key}?versionId=${encodeURIComponent(versionId)}`;
  if (templateURL.length > 1024) return fail("VERSION_URL");
  return Object.freeze({
    approvalSha256, sourceSha256, runId, operationSha256, requestSha256, putAcknowledgedAt, versionId, templateSha256, submitBefore,
    jobId: s.jobId, attempt: 1, generation: 1, epoch: 1, bucket, key, templateURL, stackName,
    submitterArn: firstOpenSessionArn("lifecycle"), executionRoleArn: s.cfnRole,
  });
}

/** This port is supplied only by the sealed Management host. Its adapter must
 * authenticate a separate authority and its effective-policy evidence. A
 * mailbox author, static digest, or simulator has no authority to fill it. */
export interface FirstOpenVersionAuthorityReader {
  readonly sourceSha256: string;
  readVerified(scope: VersionAuthorityScope, signal: AbortSignal): Promise<unknown>;
}

async function readExactVersionAuthority(reader: FirstOpenVersionAuthorityReader["readVerified"], scope: VersionAuthorityScope,
  signal: AbortSignal, now: () => number) {
  if (signal.aborted || now() >= scope.submitBefore) return fail("AUTHORITY_WINDOW");
  let listener: ReturnType<typeof addAbortListener> | undefined;
  const untilAbort = new Promise<never>((_, reject) => {
    listener = addAbortListener(signal, () => reject(Error("authority window closed")));
  });
  let received: unknown;
  try {
    received = await Promise.race([reader(scope, signal), untilAbort]);
  } catch {
    return fail(signal.aborted || now() >= scope.submitBefore ? "AUTHORITY_WINDOW" : "AUTHORITY_READ_STOP_NO_RETRY");
  } finally {
    listener?.[Symbol.dispose]();
  }
  if (signal.aborted || now() >= scope.submitBefore) return fail("AUTHORITY_WINDOW");
  const r = received as { schema?: unknown; scopeSha256?: unknown; policySha256?: unknown;
    checkedAt: number; expiresAt: number; evidence?: unknown } | null;
  if (!r || typeof r !== "object" ||
    Object.keys(r).sort().join(",") !== "checkedAt,evidence,expiresAt,policySha256,schema,scopeSha256" ||
    r.schema !== "techlong/fc41597f-exact-cfn-version-authority/v2" ||
    r.scopeSha256 !== await sha256Hex(scope) || typeof r.policySha256 !== "string" || !hex.test(r.policySha256) ||
    !Number.isSafeInteger(r.checkedAt) || !Number.isSafeInteger(r.expiresAt) ||
    r.checkedAt < scope.putAcknowledgedAt || r.checkedAt > now() ||
    r.expiresAt <= now() || r.expiresAt > scope.submitBefore ||
    r.evidence !== "MATCHED_INSTALLED_POLICY_DOCUMENTS") return fail("AUTHORITY_UNPROVED");
  return r.expiresAt;
}

/** Each party computes the same digest from its independently built stack.
 * Frozen defaults are the only permitted values, including for subnet lists. */
export async function firstOpenControlledCfnTemplate(approvalSha256: string, expectedStack: SupervisedTenantStack) {
  const stack = structuredClone(expectedStack);
  const parameters = stack?.parameters, tags = stack?.tags, template = stack?.template;
  const expectedResources = Object.entries(types);
  const parameterRows = parameters && sorted(parameters), tagRows = tags && sorted(tags);
  if (!hex.test(approvalSha256) || stack?.schemaVersion !== 1 || stack.protocol !== "single-tenant-supervised-workload" ||
    stack.stackName !== stackName || stack.accountId !== s.account || stack.region !== s.region ||
    stack.cloudFormationRoleArn !== s.cfnRole || stack.onFailure !== "ROLLBACK" ||
    !Array.isArray(stack.capabilities) || stack.capabilities.length !== 0 ||
    !parameterRows?.length || !tagRows?.length || ![...parameterRows, ...tagRows].every(([, value]) => typeof value === "string") ||
    parameters.AppInstanceId !== s.instanceId || parameters.TenantHostname !== s.hostname ||
    parameters.TaskExecutionRoleArn !== s.executionRole || parameters.TaskRoleArn !== s.applicationRole ||
    parameters.ControlPublicKeyValueFrom !== `${s.controlArn}:::${s.controlVersion}` ||
    !parameters.TenantRuntimeSecretArn?.startsWith(secretArn) || !/^[A-Za-z0-9]{6}$/.test(parameters.TenantRuntimeSecretArn.slice(secretArn.length)) ||
    tags.AppInstanceId !== s.instanceId || tags.DeploymentId !== s.deploymentId || tags.ResourceGeneration !== "1" ||
    tags.ExternalOperationEpoch !== "1" || tags.ExternalOperationIntent !== "provision" ||
    !hex.test(tags.ExternalOperationHash) || tags.ExternalOperationMarker !== `tl_epoch_${s.stableIdentity.slice(0, 24)}_g1_e1` ||
    stack.clientRequestToken !== `render-${s.deploymentId}-v1-e1-${tags.ExternalOperationHash.slice(0, 16)}` ||
    tags.Environment !== "aws-sandbox" || tags.ManagedBy !== "techlong-provisioner" ||
    tags.CleanupMode !== "supervised-reviewed" || tags.DeliveryTrack !== "single-tenant-acceptance" ||
    !stack.safety?.parametersValidated || stack.safety.callsAws || stack.safety.executionAuthorized || stack.safety.automaticCleanupInstalled ||
    !template || Object.hasOwn(template, "Transform") || !template.Resources ||
    Object.keys(template.Resources).length !== expectedResources.length ||
    !Array.isArray(stack.resourceInventory) || stack.resourceInventory.length !== expectedResources.length ||
    !expectedResources.every(([id, type]) => (template.Resources as Record<string, { Type?: unknown }>)[id]?.Type === type &&
      stack.resourceInventory.filter(resource => resource.logicalId === id && resource.type === type).length === 1)) return fail("EXPECTATION");
  assertFirstOpenFrozenTemplate(template, parameters);
  const body = canonicalJson(template), bytes = Buffer.from(body, "utf8"), sha256 = await sha256Hex(body);
  if (stack.templateBody !== body || stack.templateSha256 !== sha256 || bytes.length === 0 || bytes.length > 51_200) return fail("TEMPLATE");
  const key = `first-open-management/${s.jobId}/${approvalSha256}/cfn-template.json`;
  const requestSha256 = await sha256Hex({ schema: "techlong/sandbox-first-open-controlled-cfn/v2", jobId: s.jobId, approvalSha256,
    bucket, key, templateSha256: sha256, stackName, roleArn: s.cfnRole, onFailure: "ROLLBACK", clientRequestToken: stack.clientRequestToken,
    parameters: parameterRows, tags: tagRows, terminationProtection: false });
  // The renderer's internal token includes dep_…; the AWS CreateStack
  // token accepts only alphanumerics and hyphens. Derive a stable wire token
  // from the whole reviewed request instead of passing that token through.
  return { bucket, key, sha256, bytes, requestSha256, clientRequestToken: `first-open-${requestSha256}` };
}

/** RunOnce only: one conditional Put, no read or CloudFormation client. */
export function createFirstOpenControlledCfnAuthor(input: { approvalSha256: string; writeBefore: number; s3: Pick<S3Client, "send"> }, now = Date.now) {
  let used = false;
  return async (stack: SupervisedTenantStack, upstream: AbortSignal) => {
    if (used) return fail("AUTHOR_SLOT_USED");
    used = true;
    const remaining = input.writeBefore - now();
    if (!Number.isSafeInteger(input.writeBefore) || remaining <= 0 || remaining > 3_600_000 || upstream.aborted) return fail("WINDOW");
    const signal = AbortSignal.any([upstream, AbortSignal.timeout(Math.min(30_000, remaining))]);
    const expected = await firstOpenControlledCfnTemplate(input.approvalSha256, stack);
    if (signal.aborted || now() >= input.writeBefore) return fail("WINDOW");
    const ack = await input.s3.send(new PutObjectCommand({ Bucket: expected.bucket, Key: expected.key, ExpectedBucketOwner: s.account,
      Body: expected.bytes, ChecksumSHA256: Buffer.from(expected.sha256, "hex").toString("base64"),
      ContentType: "application/json", ServerSideEncryption: "AES256", IfNoneMatch: "*" }), { abortSignal: signal })
      .catch(() => fail("AUTHOR_PUT_STOP_NO_RETRY"));
    const putAcknowledgedAt = now();
    if (signal.aborted || putAcknowledgedAt >= input.writeBefore) return fail("WINDOW");
    if (!validFirstOpenVersionId(ack.VersionId)) return fail("AUTHOR_VERSION_UNPROVED");
    return { requestSha256: expected.requestSha256, versionId: ack.VersionId, putAcknowledgedAt };
  };
}

/** Broker-only, process-local one-shot. `expectedStack` and `versionId` must
 * come from the broker's reconstruction and the versioned mailbox receipt.
 * The key is recomputed rather than supplied by the author. The clients must already
 * be bound to the exact isolated Management session with SDK maxAttempts 1.
 * This adapter does not issue credentials, prove IAM, or apply grants. The
 * broker's existing permanent mailbox/Put slot is the cross-process gate. */
export function createFirstOpenControlledCfnSubmitter(input: {
  approvalSha256: string; writeBefore: number; s3: Pick<S3Client, "send">; cloudFormation: Pick<CloudFormationClient, "send">;
  startAt: number; submitBefore: number; runId: string; authoritySourceSha256: string;
  authorityReader: FirstOpenVersionAuthorityReader | undefined; verifyClaim(signal: AbortSignal): Promise<void>;
}, now = Date.now) {
  const { approvalSha256, startAt, submitBefore, writeBefore, runId, authoritySourceSha256, authorityReader,
    s3, cloudFormation, verifyClaim } = input;
  if (!hex.test(approvalSha256) || ![startAt, submitBefore, writeBefore].every(Number.isSafeInteger) ||
    startAt <= 0 || startAt >= submitBefore || submitBefore >= writeBefore || !/^[1-9][0-9]{0,19}$/.test(runId)) return fail("APPROVAL");
  if (!authorityReader || typeof authorityReader.readVerified !== "function" || !hex.test(authoritySourceSha256) ||
    authorityReader.sourceSha256 !== authoritySourceSha256) return fail("AUTHORITY_SOURCE_REQUIRED");
  const readVerified = authorityReader.readVerified.bind(authorityReader);
  let consumed = false;
  return async (request: { expectedStack: SupervisedTenantStack; requestSha256: string; versionId: string;
    putAcknowledgedAt: number; signal: AbortSignal }) => {
    if (consumed) return fail("SLOT_USED");
    consumed = true;
    const { requestSha256, versionId, putAcknowledgedAt, signal } = request;
    const check = (s: AbortSignal) => {
      if (s.aborted || now() >= writeBefore) return fail("WINDOW");
    };
    check(signal);
    const remaining = submitBefore - now();
    if (remaining <= 0 || remaining > 3_600_000) return fail("WINDOW");
    const expectedStack = structuredClone(request.expectedStack);
    const expected = await firstOpenControlledCfnTemplate(approvalSha256, expectedStack);
    if (requestSha256 !== expected.requestSha256 || !validFirstOpenVersionId(versionId) ||
      !Number.isSafeInteger(putAcknowledgedAt) || putAcknowledgedAt < startAt || putAcknowledgedAt > now() ||
      putAcknowledgedAt >= submitBefore) return fail("REQUEST_SCOPE");
    const authority = firstOpenVersionAuthorityScope({
      approvalSha256, sourceSha256: authoritySourceSha256, runId,
      operationSha256: expectedStack.tags.ExternalOperationHash, requestSha256, putAcknowledgedAt,
      versionId, templateSha256: expected.sha256, submitBefore,
    });
    const authoritySignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, submitBefore - now()))]);
    const expiresAt = await readExactVersionAuthority(readVerified, authority, authoritySignal, now);
    const bounded = AbortSignal.any([authoritySignal, AbortSignal.timeout(Math.max(1, Math.min(30_000, expiresAt - now())))]);
    const checkGrant = () => {
      check(bounded);
      if (now() >= expiresAt || now() >= submitBefore) return fail("AUTHORITY_WINDOW");
    };
    checkGrant();

    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: expected.key, VersionId: versionId,
        ExpectedBucketOwner: s.account }), { abortSignal: bounded });
      const body = object.Body;
      try {
        if (!body || !(Symbol.asyncIterator in body) || object.VersionId !== versionId || object.DeleteMarker ||
          object.ContentLength !== expected.bytes.length || object.ContentType !== "application/json" || object.ContentEncoding ||
          object.ServerSideEncryption !== "AES256") return fail("OBJECT_SCOPE");
        let offset = 0;
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          checkGrant();
          if (!(chunk instanceof Uint8Array) || offset + chunk.length > expected.bytes.length ||
            !expected.bytes.subarray(offset, offset + chunk.length).equals(chunk)) return fail("OBJECT_BYTES");
          offset += chunk.length;
        }
        if (offset !== expected.bytes.length) return fail("OBJECT_BYTES");
      } finally {
        if (body && "destroy" in body && typeof body.destroy === "function") body.destroy();
      }
    } catch (error) {
      if (error instanceof Error && /^FIRST_OPEN_CONTROLLED_CFN_(OBJECT_SCOPE|OBJECT_BYTES|WINDOW|AUTHORITY_WINDOW)$/.test(error.message)) throw error;
      return fail("OBJECT_READ_STOP_NO_RETRY");
    }
    checkGrant();

    const present = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }), { abortSignal: bounded })
      .then(() => true, (error: unknown) => exactMissing(error) ? false : fail("VACANCY_UNPROVED"));
    checkGrant();
    if (present) return fail("STACK_NOT_VACANT");

    await verifyClaim(bounded);
    checkGrant();
    try {
      const result = await cloudFormation.send(new CreateStackCommand({ StackName: stackName, TemplateURL: authority.templateURL,
        Tags: sorted(expectedStack.tags).map(([Key, Value]) => ({ Key, Value })), ClientRequestToken: expected.clientRequestToken,
        RoleARN: s.cfnRole, OnFailure: "ROLLBACK", EnableTerminationProtection: false,
      }), { abortSignal: bounded });
      if (!result.StackId || !stackArn.test(result.StackId)) return fail("CREATE_ACK_UNPROVED");
      if (bounded.aborted || now() >= expiresAt || now() >= submitBefore) return fail("CREATE_ACK_OUTSIDE_WINDOW");
      return { operation: "create" as const, stackId: result.StackId };
    } catch (error) {
      if (error instanceof Error && /^FIRST_OPEN_CONTROLLED_CFN_CREATE_ACK_(UNPROVED|OUTSIDE_WINDOW)$/.test(error.message)) throw error;
      return fail("CREATE_STOP_NO_RETRY");
    }
  };
}
