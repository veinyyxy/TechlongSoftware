import {
  CreateChangeSetCommand, DescribeChangeSetCommand, ExecuteChangeSetCommand, DescribeStacksCommand, GetTemplateCommand,
  type CloudFormationClient, type DescribeChangeSetOutput,
} from "@aws-sdk/client-cloudformation";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import type { ImageUpdatePlan } from "./contract.ts";
import type { ReleaseEvidenceReference, ReleaseInspection } from "./repository.ts";

export interface ReviewedReleaseChangeSet {
  stackId: string;
  changeSetId: string;
  planSha256: string;
}

export class ReleaseCloudSubmissionUnknown extends Error {
  constructor() { super("RELEASE_CLOUD_SUBMISSION_REQUIRES_INSPECTION"); }
}

/** Shared with the intent ledger: hash the exact API input, not an approximate action description. */
export function createReleaseChangeSetInput(plan: ImageUpdatePlan, name: string, token: string) {
  return { StackName: plan.changeSet.StackName, ChangeSetName: name, ChangeSetType: "UPDATE" as const,
    UsePreviousTemplate: true, ClientToken: token, Parameters: plan.changeSet.Parameters.map(p => p.ParameterKey === "ImageUri" ?
      { ParameterKey: "ImageUri", ParameterValue: plan.to.imageUri } : { ParameterKey: p.ParameterKey, UsePreviousValue: true }) };
}
export function executeReleaseChangeSetInput(reviewed: ReviewedReleaseChangeSet, token: string) {
  return { StackName: reviewed.stackId, ChangeSetName: reviewed.changeSetId, ClientRequestToken: token, DisableRollback: false };
}

/** Scope review only. Fresh stack/template/role checks and durable intent belong to D2-3. */
export function reviewImageChangeSet(plan: ImageUpdatePlan, planSha256: string,
  changeSetId: string, response: DescribeChangeSetOutput): ReviewedReleaseChangeSet {
  if (response.StackId !== plan.changeSet.StackName || response.ChangeSetId !== changeSetId ||
    response.Status !== "CREATE_COMPLETE" || response.ExecutionStatus !== "AVAILABLE" || response.NextToken ||
    response.DeploymentMode || response.DeploymentConfig?.Mode && response.DeploymentConfig.Mode !== "STANDARD" ||
    response.DeploymentConfig?.DisableRollback === true || response.IncludeNestedStacks ||
    response.Capabilities?.length || response.Changes?.length !== 2) {
    throw new Error("RELEASE_CHANGE_SET_SCOPE_MISMATCH");
  }
  for (const expected of plan.expectedChanges) {
    const matches = response.Changes.filter(({ Type, ResourceChange: c }) => Type === "Resource" &&
      c?.LogicalResourceId === expected.logicalId && c.Action === expected.action && c.Replacement === expected.replacement &&
      c.ResourceType === (expected.logicalId === "TenantTaskDefinition" ? "AWS::ECS::TaskDefinition" : "AWS::ECS::Service"));
    if (matches.length !== 1) throw new Error("RELEASE_CHANGE_SET_SCOPE_MISMATCH");
  }
  // DescribeChangeSet has NO RoleARN. Check the stack's real role via DescribeStacks in live preflight.
  return { stackId: plan.changeSet.StackName, changeSetId, planSha256 };
}

/** Thin, injected transport, NOT an executor or authorization boundary. No default AWS clients. */
export class ReleaseCloudFormationAdapter {
  private readonly client: CloudFormationClient;
  constructor(client: CloudFormationClient) { this.client = client; }

  async create(plan: ImageUpdatePlan, planSha256: string, name: string, token: string): Promise<string> {
    if (await sha256Hex(plan) !== planSha256) throw new Error("RELEASE_PLAN_HASH_MISMATCH");
    if (await this.client.config.maxAttempts() !== 1) throw new Error("RELEASE_RETRIES_MUST_BE_DISABLED");
    const parameters = plan.changeSet.Parameters;
    if (parameters.filter(p => p.ParameterKey === "ImageUri").length !== 1 || parameters.some(p =>
      p.ParameterKey === "ImageUri" ? !("ParameterValue" in p) || p.ParameterValue !== plan.to.imageUri :
        !("UsePreviousValue" in p) || p.UsePreviousValue !== true)) throw new Error("RELEASE_IMAGE_ONLY_REQUIRED");
    try {
      const result = await this.client.send(new CreateChangeSetCommand(createReleaseChangeSetInput(plan, name, token)));
      if (result.StackId !== plan.changeSet.StackName || !result.Id?.startsWith(
        `arn:aws:cloudformation:${plan.region}:${plan.accountId}:changeSet/${name}/`)) throw new Error("RELEASE_CREATE_ACK_MISMATCH");
      return result.Id;
    } catch { throw new ReleaseCloudSubmissionUnknown(); }
  }

  async describe(plan: ImageUpdatePlan, planSha256: string, changeSetId: string): Promise<ReviewedReleaseChangeSet> {
    if (await sha256Hex(plan) !== planSha256) throw new Error("RELEASE_PLAN_HASH_MISMATCH");
    const response = await this.client.send(new DescribeChangeSetCommand({
      StackName: plan.changeSet.StackName, ChangeSetName: changeSetId,
    }));
    return reviewImageChangeSet(plan, planSha256, changeSetId, response);
  }

  changes(plan: ImageUpdatePlan, changeSetId: string): Promise<DescribeChangeSetOutput> {
    return this.client.send(new DescribeChangeSetCommand({ StackName: plan.changeSet.StackName, ChangeSetName: changeSetId }));
  }

  async template(plan: ImageUpdatePlan, changeSetId: string): Promise<unknown> {
    const response = await this.client.send(new GetTemplateCommand({
      StackName: plan.changeSet.StackName, ChangeSetName: changeSetId, TemplateStage: "Original",
    }));
    if (!response.TemplateBody) throw new Error("RELEASE_TEMPLATE_MISSING");
    return JSON.parse(response.TemplateBody) as unknown;
  }

  async stackState(plan: ImageUpdatePlan): Promise<{ status: string; updatedAt: number }> {
    const response = await this.client.send(new DescribeStacksCommand({ StackName: plan.changeSet.StackName }));
    if (response.Stacks?.length !== 1 || response.Stacks[0].StackId !== plan.changeSet.StackName) throw new Error("RELEASE_STACK_MISMATCH");
    const stack = response.Stacks[0];
    const updatedAt = (stack.LastUpdatedTime ?? stack.CreationTime)?.getTime();
    if (!stack.StackStatus || updatedAt === undefined) throw new Error("RELEASE_STACK_STATE_MISSING");
    return { status: stack.StackStatus, updatedAt };
  }

  async execute(reviewed: ReviewedReleaseChangeSet, token: string): Promise<void> {
    if (await this.client.config.maxAttempts() !== 1) throw new Error("RELEASE_RETRIES_MUST_BE_DISABLED");
    try {
      await this.client.send(new ExecuteChangeSetCommand(executeReleaseChangeSetInput(reviewed, token)));
    } catch { throw new ReleaseCloudSubmissionUnknown(); }
  }
}

export type ReleaseInspectionDocument = Omit<ReleaseInspection, "evidence">;

/** Reuses an installed, versioned private bucket. It creates no bucket, policy or artifact service. */
export class ReleaseEvidenceAdapter {
  private readonly client: S3Client;
  private readonly target: { bucket: string; owner: string; prefix: string };
  constructor(client: S3Client, target: { bucket: string; owner: string; prefix: string }) {
    this.client = client;
    this.target = target;
  }

  async putInspection(proof: ReleaseInspectionDocument): Promise<ReleaseEvidenceReference> {
    if (!/^[a-zA-Z0-9_-]+$/.test(proof.requestId)) throw new Error("RELEASE_REQUEST_ID_INVALID");
    if (await this.client.config.maxAttempts() !== 1) throw new Error("RELEASE_RETRIES_MUST_BE_DISABLED");
    // Explicit projection: accidental runtime extras (e.g. environment/credential objects) are not serialized.
    const body = canonicalJson({ requestId: proof.requestId, planSha256: proof.planSha256,
      runId: proof.runId, runAttempt: proof.runAttempt, stackId: proof.stackId, releaseId: proof.releaseId,
      imageUri: proof.imageUri, platformDigest: proof.platformDigest, templateSha256: proof.templateSha256,
      configurationSha256: proof.configurationSha256, result: proof.result, changeSetId: proof.changeSetId,
      serviceArn: proof.serviceArn, taskDefinitionArn: proof.taskDefinitionArn, observedAt: proof.observedAt,
      runtimeSha256: proof.runtimeSha256 });
    const sha256 = await sha256Hex(body);
    const key = `${this.target.prefix}/${proof.requestId}/inspection-${sha256}.json`;
    try {
      const result = await this.client.send(new PutObjectCommand({ Bucket: this.target.bucket, Key: key,
        ExpectedBucketOwner: this.target.owner, IfNoneMatch: "*", ContentType: "application/json", Body: body }));
      if (!result.VersionId || result.VersionId === "null") throw new Error("RELEASE_VERSIONED_EVIDENCE_REQUIRED");
      return { bucket: this.target.bucket, key, versionId: result.VersionId, sha256 };
    } catch { throw new ReleaseCloudSubmissionUnknown(); }
  }

  async read(reference: ReleaseEvidenceReference): Promise<unknown> {
    if (reference.bucket !== this.target.bucket || !reference.key.startsWith(`${this.target.prefix}/`) ||
      !reference.versionId || reference.versionId === "null" || !/^[a-f0-9]{64}$/.test(reference.sha256)) {
      throw new Error("RELEASE_EVIDENCE_REFERENCE_MISMATCH");
    }
    const result = await this.client.send(new GetObjectCommand({ Bucket: reference.bucket, Key: reference.key,
      VersionId: reference.versionId, ExpectedBucketOwner: this.target.owner }));
    if (result.VersionId !== reference.versionId || !result.Body || result.ContentLength === undefined || result.ContentLength > 1_048_576) {
      throw new Error("RELEASE_EVIDENCE_RESPONSE_MISMATCH");
    }
    const bytes = await result.Body.transformToByteArray();
    if (bytes.length > 1_048_576) throw new Error("RELEASE_EVIDENCE_TOO_LARGE");
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (await sha256Hex(body) !== reference.sha256) throw new Error("RELEASE_EVIDENCE_HASH_MISMATCH");
    return JSON.parse(body) as unknown;
  }
}
