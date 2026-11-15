/** Pure offline candidates only. The caller must separately establish live CFN ownership and exact outputs. */
import { isDeepStrictEqual } from "node:util";

export type PersistenceTemplate = {
  Resources: Record<string, { Type: string; Properties: Record<string, unknown>; [key: string]: unknown }>;
  [key: string]: unknown;
};
export interface MediaOutputs { MediaBucketName: string; MediaBucketArn: string; MediaPublicBaseUrl: string }
export interface ExistingRuntimeIam {
  roleArn: string; boundaryArn: string;
  inlinePolicies: { PolicyName: string; PolicyDocument: Record<string, unknown> }[];
  boundaryDocument: Record<string, unknown>;
}

const bucketName = "techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad";
const applicationRoleArn = "arn:aws:iam::402010193138:role/TechlongSandboxTaskRole";
const sid = "D2ProductImagesWrite";
const policyName = "WriteExactTenantProductImagesD2";
const actions = ["s3:PutObject", "s3:DeleteObject"];
const runtimePolicyName = "ConnectExactExpressTenantC4e";
const runtimeSids = ["C4eAppConnect", "C4eMgmtConnect", "C4eOtherSecretVersion"];
function ensure(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
const record = (v: unknown): Record<string, unknown> => {
  ensure(v && typeof v === "object" && !Array.isArray(v), "PERSISTENCE_LITERAL_OBJECT_REQUIRED");
  return v as Record<string, unknown>;
};

function media(outputs: MediaOutputs) {
  ensure(outputs.MediaBucketName === bucketName && outputs.MediaBucketArn === `arn:aws:s3:::${bucketName}` &&
    /^https:\/\/[a-z0-9]+\.cloudfront\.net$/.test(outputs.MediaPublicBaseUrl), "PERSISTENCE_OUTPUT_SCOPE_MISMATCH");
  return { objectArn: `${outputs.MediaBucketArn}/products/*`, values: {
    IMAGE_STORAGE_PROVIDER: "s3", IMAGE_S3_BUCKET: outputs.MediaBucketName,
    IMAGE_PUBLIC_BASE_URL: outputs.MediaPublicBaseUrl, ALLOW_EPHEMERAL_IMAGE_STORAGE: "false",
  } };
}

/** Only the four observed declaration gaps, not a general policy synchronizer or intrinsic resolver. */
export function alignPersistenceRuntimeIam(original: PersistenceTemplate, ids: { role: string; boundary: string }, runtime: ExistingRuntimeIam) {
  ensure(runtime?.roleArn === applicationRoleArn && runtime.boundaryArn ===
    "arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary", "PERSISTENCE_RUNTIME_IAM_REQUIRED");
  const template = structuredClone(original);
  const role = template.Resources[ids.role], boundary = template.Resources[ids.boundary];
  ensure(role?.Type === "AWS::IAM::Role" && boundary?.Type === "AWS::IAM::ManagedPolicy", "PERSISTENCE_IAM_OWNER_LAYOUT_MISMATCH");
  const rp = role.Properties, bp = boundary.Properties;
  ensure(rp.RoleName === "TechlongSandboxTaskRole" && bp.ManagedPolicyName === "TechlongSandboxServiceRoleBoundary" &&
    record(rp.PermissionsBoundary).Ref === ids.boundary, "PERSISTENCE_IAM_SCOPE_MISMATCH");
  const doc = record(bp.PolicyDocument);
  ensure(Array.isArray(doc.Statement) && Array.isArray(runtime.boundaryDocument.Statement), "PERSISTENCE_RUNTIME_STATEMENTS_REQUIRED");
  const declaredStatements = doc.Statement.map(record), actualStatements = runtime.boundaryDocument.Statement.map(record);
  const declaredSids = declaredStatements.map(s => s.Sid), actualSids = actualStatements.map(s => s.Sid);
  ensure(declaredSids.every(s => typeof s === "string") && new Set(declaredSids).size === declaredSids.length &&
    actualSids.every(s => typeof s === "string") && new Set(actualSids).size === actualSids.length &&
    declaredSids.every(s => actualSids.includes(s)) && actualSids.every(s => declaredSids.includes(s) || runtimeSids.includes(s as string)),
  "PERSISTENCE_UNREVIEWED_BOUNDARY_GAP");
  for (const name of runtimeSids) {
    const actual = actualStatements.find(s => s.Sid === name), declared = declaredStatements.filter(s => s.Sid === name);
    ensure(actual && declared.length <= 1, "PERSISTENCE_RUNTIME_STATEMENT_REQUIRED");
    if (declared.length) ensure(isDeepStrictEqual(declared[0], actual), "PERSISTENCE_RUNTIME_DECLARATION_CONFLICT");
    else declaredStatements.push(structuredClone(actual));
  }
  ensure(rp.Policies === undefined || Array.isArray(rp.Policies), "PERSISTENCE_ROLE_POLICY_LAYOUT_MISMATCH");
  const policies = ((rp.Policies ?? []) as unknown[]).map(record);
  const declaredNames = policies.map(p => p.PolicyName), actualNames = runtime.inlinePolicies.map(p => p.PolicyName);
  ensure(new Set(actualNames).size === actualNames.length && declaredNames.every(n => actualNames.includes(n as string)) &&
    actualNames.every(n => declaredNames.includes(n) || n === runtimePolicyName), "PERSISTENCE_UNREVIEWED_INLINE_GAP");
  const observed = runtime.inlinePolicies.find(p => p.PolicyName === runtimePolicyName);
  ensure(observed && policies.filter(p => p.PolicyName === runtimePolicyName).length <= 1, "PERSISTENCE_RUNTIME_POLICY_REQUIRED");
  for (const policy of policies) ensure(isDeepStrictEqual(policy, runtime.inlinePolicies.find(p => p.PolicyName === policy.PolicyName)),
    "PERSISTENCE_RUNTIME_DECLARATION_CONFLICT");
  if (!declaredNames.includes(runtimePolicyName)) policies.push(structuredClone(observed));
  rp.Policies = policies; doc.Statement = declaredStatements;
  return { template, executionAuthorized: false as const, liveOwnershipVerified: false as const,
    otherIntrinsicPolicyEquivalenceVerified: false as const };
}

/** Alignment is mandatory before adding the image grant; the rest of the original declaration stays untouched. */
export function draftPersistenceIam(original: PersistenceTemplate, ids: { role: string; boundary: string }, outputs: MediaOutputs,
  runtime: ExistingRuntimeIam) {
  const { objectArn } = media(outputs), aligned = alignPersistenceRuntimeIam(original, ids, runtime), template = aligned.template;
  const rp = template.Resources[ids.role].Properties, doc = record(template.Resources[ids.boundary].Properties.PolicyDocument);
  ensure(Array.isArray(doc.Statement) && doc.Statement.every(s => record(s).Sid !== sid), "PERSISTENCE_BOUNDARY_ALREADY_PRESENT_OR_UNSUPPORTED");
  ensure(rp.Policies === undefined || Array.isArray(rp.Policies), "PERSISTENCE_ROLE_POLICY_LAYOUT_MISMATCH");
  const policies = (rp.Policies ?? []) as Record<string, unknown>[];
  ensure(policies.every(p => p.PolicyName !== policyName), "PERSISTENCE_ROLE_POLICY_ALREADY_PRESENT");
  rp.Policies = [...policies, { PolicyName: policyName, PolicyDocument: { Version: "2012-10-17",
    Statement: [{ Sid: sid, Effect: "Allow", Action: [...actions], Resource: objectArn }] } }];
  doc.Statement = [...doc.Statement, { Sid: sid, Effect: "Allow", Action: [...actions], Resource: objectArn,
    Condition: { ArnEquals: { "aws:PrincipalArn": applicationRoleArn } } }];
  const projectedActual = { ...runtime.boundaryDocument, Statement: [
    ...runtime.boundaryDocument.Statement as unknown[], (doc.Statement as unknown[]).at(-1),
  ] };
  ensure(Buffer.byteLength(JSON.stringify(projectedActual), "utf8") <= 6144, "PERSISTENCE_BOUNDARY_SIZE_LIMIT");
  return { ...aligned, template };
}

/** Changes only four container environment values. It neither creates a Service nor changes its desired count. */
export function draftPersistenceTenant(original: PersistenceTemplate, outputs: MediaOutputs) {
  const { values } = media(outputs), template = structuredClone(original);
  const task = template.Resources.TenantTaskDefinition;
  ensure(task?.Type === "AWS::ECS::TaskDefinition", "PERSISTENCE_TENANT_TASK_REQUIRED");
  const containers = task.Properties.ContainerDefinitions;
  ensure(Array.isArray(containers) && containers.length === 1 && record(containers[0]).Name === "speedfeast-backend",
    "PERSISTENCE_TENANT_CONTAINER_MISMATCH");
  const container = record((containers as unknown[])[0]), environment = container.Environment;
  ensure(Array.isArray(environment), "PERSISTENCE_ENVIRONMENT_REQUIRED");
  const entries = (environment as unknown[]).map(record);
  ensure(entries.every(e => typeof e.Name === "string") && new Set(entries.map(e => e.Name)).size === entries.length,
    "PERSISTENCE_AMBIGUOUS_ENVIRONMENT");
  ensure(entries.find(e => e.Name === "IMAGE_STORAGE_PROVIDER")?.Value === "local", "PERSISTENCE_LOCAL_BASELINE_REQUIRED");
  container.Environment = entries.map(e => Object.hasOwn(values, String(e.Name)) ? { ...e, Value: values[e.Name as keyof typeof values] } : e);
  for (const [Name, Value] of Object.entries(values)) {
    if (!entries.some(e => e.Name === Name)) (container.Environment as unknown[]).push({ Name, Value });
  }
  return { template, servicePresent: Object.hasOwn(template.Resources, "TenantService"),
    executionAuthorized: false as const, liveOwnershipVerified: false as const };
}
