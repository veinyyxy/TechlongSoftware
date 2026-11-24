import { firstOpenBuyerSignerEnvName, firstOpenBuyerSignerSecretName, isFirstOpenBuyerSignerPin } from "../../lib/buyer-forward/signer-binding.ts";
import { sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { canonical, P } from "../platform-ecs-v1/contract.mjs";
import { buyerForwardHostingTarget } from "../platform-ecs-v1/first-purchase-activation.mjs";

const firstOpenBuyerForwardEnv = firstOpenBuyerSignerEnvName;
const accountPrefix = `arn:aws:cloudformation:${P.region}:${P.account}:stack/`;
const hostingStackId = accountPrefix + "techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7";
const accessStackId = accountPrefix + "techlong-sandbox-platform-access-v1/01b4bb80-ce60-11f1-9435-0e85c8c75895";
const permissionSid = "FirstOpenExactBuyerForwardSignerVersion";

type Props = Record<string, unknown>;
type Resource = { Type: string; Properties: Props };
type Template = { Resources: Record<string, Resource> } & Props;
type Snapshot<T extends Template> = { stackId: string; canonicalSha256: string; template: T };
type SignerPin = { arn: string; versionId: string };
type PublishedBuyerForward = {
  locked: boolean;
  artifactId: number;
  sourceRecipeSha256: string;
  sourceTreeOid: string;
  imageConfigDigest: string;
  manifestDigest: string;
};

function requireScope(condition: unknown, code: string): asserts condition {
  if (!condition) throw Error(`FIRST_OPEN_BUYER_FORWARD_HOSTING_${code}`);
}

/** Offline diff against separately verified template bytes. Never reads or
 * creates a Secret, rolls a service, or supplies live approval. The reviewed
 * first-open supply must use that same raw signer-only version, not g1 JSON.
 * Use the service-managed aws/secretsmanager key; no new KMS permission. */
export async function renderFirstOpenBuyerForwardHosting<A extends Template, H extends Template>(input: {
  access: Snapshot<A>;
  hosting: Snapshot<H>;
  signer?: SignerPin;
  published?: PublishedBuyerForward;
}) {
  const { access: previousAccess, hosting: previousHosting, signer, published } = structuredClone(input);
  for (const [previous, id] of [[previousAccess, accessStackId], [previousHosting, hostingStackId]] as const) {
    requireScope(previous.stackId === id && /^[a-f0-9]{64}$/.test(previous.canonicalSha256) &&
      await sha256Hex(canonical(previous.template)) === previous.canonicalSha256, "BASELINE");
  }
  // The caller must first independently verify the published ECR manifest and
  // Locked readback. Reject an image-only rollout of this relay by construction.
  requireScope(published === undefined || signer !== undefined, "IMAGE_REQUIRES_SIGNER");
  const access = previousAccess.template;
  const hosting: H = published === undefined ? previousHosting.template : buyerForwardHostingTarget(previousHosting, published).template;
  const boundary = access.Resources.ExecutionBoundary, role = access.Resources.ExecutionRole;
  const task = hosting.Resources.TaskDefinition, service = hosting.Resources.Service;
  requireScope(boundary?.Type === "AWS::IAM::ManagedPolicy" && boundary.Properties.ManagedPolicyName === P.boundary &&
    role?.Type === "AWS::IAM::Role" && role.Properties.RoleName === P.role &&
    canonical(role.Properties.PermissionsBoundary) === canonical({ Ref: "ExecutionBoundary" }) &&
    task?.Type === "AWS::ECS::TaskDefinition" && task.Properties.ExecutionRoleArn === P.roleArn && !task.Properties.TaskRoleArn &&
    task.Properties.Family === P.family && service?.Type === "AWS::ECS::Service" && service.Properties.ServiceName === P.service &&
    canonical(service.Properties.TaskDefinition) === canonical({ Ref: "TaskDefinition" }), "RESOURCE_SCOPE");

  const inline = role.Properties.Policies as { PolicyName: string; PolicyDocument: { Statement: Props[] } }[];
  const boundaryPolicy = boundary.Properties.PolicyDocument as { Statement: Props[] };
  const containers = task.Properties.ContainerDefinitions as {
    Name: string;
    Secrets: { Name: string; ValueFrom: string }[];
    Environment: { Name: string; Value: string }[];
  }[];
  requireScope(Array.isArray(inline) && inline.length === 1 && inline[0].PolicyName === P.inline &&
    Array.isArray(boundaryPolicy?.Statement) && canonical(inline[0].PolicyDocument) === canonical(boundaryPolicy) &&
    !boundaryPolicy.Statement.some(s => s?.Sid === permissionSid || JSON.stringify(s?.Resource)?.includes(firstOpenBuyerSignerSecretName)) &&
    Array.isArray(containers) && containers.length === 1 && containers[0].Name === "web" &&
    Array.isArray(containers[0].Secrets) && Array.isArray(containers[0].Environment) &&
    containers[0].Environment.some(v => v?.Name === "TECHLONG_PLATFORM_PUBLIC_ORIGIN" && v.Value === `https://${P.domain}`) &&
    containers[0].Environment.some(v => v?.Name === "TECHLONG_PLATFORM_INGRESS" && v.Value === "alb-https-v1") &&
    ![...containers[0].Secrets, ...containers[0].Environment].some(v => v?.Name === firstOpenBuyerForwardEnv) &&
    !containers[0].Secrets.some(v => v?.ValueFrom?.includes(firstOpenBuyerSignerSecretName)), "RUNTIME_SCOPE");

  if (signer !== undefined) {
    requireScope(signer !== null && Object.keys(signer).sort().join(",") === "arn,versionId" &&
      isFirstOpenBuyerSignerPin(signer), "SIGNER_PIN");
    const permission = {
      Sid: permissionSid, Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: signer.arn,
      Condition: { StringEquals: { "secretsmanager:VersionId": signer.versionId } },
    };
    // Replace both documents independently; structuredClone preserves aliases
    // when a caller supplied the same policy object to both template resources.
    boundary.Properties.PolicyDocument = { ...boundaryPolicy, Statement: [...boundaryPolicy.Statement, permission] };
    inline[0].PolicyDocument = { ...inline[0].PolicyDocument,
      Statement: [...inline[0].PolicyDocument.Statement, structuredClone(permission)] };
    containers[0].Secrets.push({ Name: firstOpenBuyerForwardEnv, ValueFrom: `${signer.arn}:::${signer.versionId}` });
  }
  return {
    executionAuthorized: false as const,
    signerConfigured: signer !== undefined,
    access: { ...previousAccess, canonicalSha256: await sha256Hex(canonical(access)), expectedChanges: signer ?
      ["ExecutionRole:Modify:False", "ExecutionBoundary:Modify:False"] : [] },
    hosting: { ...previousHosting, template: hosting, canonicalSha256: await sha256Hex(canonical(hosting)), expectedChanges: signer ?
      ["TaskDefinition:Modify:True", "Service:Modify:False"] : [] },
  };
}
