import type { TaskDefinition } from "@aws-sdk/client-ecs";
import { renderSingleTenantAcceptanceWorkload, renderSupervisedTenantWorkloadBase, assertSingleTenantWorkloadRender } from "../cloudformation/single-tenant-acceptance-workload.ts";
import { assertAwsSandboxTenantRuntimeSecretRef, tenantRuntimeSecretJsonKeys, type AwsSandboxTenantStackInput } from "../cloudformation/tenant-stack.ts";
import type { ApplyReadyTenantStack, AwsDeploymentPort, DeploymentExecutionBinding, DeploymentExecutionContext } from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { validateExternalParameter } from "./parameters.ts";
import { validateSingleDeploymentScope, type SingleDeploymentClaimScope } from "./single-deployment-scope.ts";
import type { FirstOnboardingExpressComposition } from "./first-onboarding-express.ts";
import { assertEcsFirstOpenRdsContext, ECS_FIRST_OPEN_RDS_ENVIRONMENT_ID, type EcsFirstOpenRdsAuthority } from "./gates.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { assertFirstOpenBuyerParameters } from "./first-open-buyer-binding.ts";
import { freezeFirstOpenTemplate } from "./first-open-frozen-template.ts";
import { isFirstOpenRdsPrivateSubnetIds } from "./first-open-tenant-network.ts";
import { FIRST_OPEN_CELL_STACK, FIRST_OPEN_CLEANUP_RESERVE_MS, FIRST_OPEN_TTL_SECONDS, type FirstOpenExecutionWindow } from "./first-onboarding-window.ts";
import { assertFirstOpenSecondSlot, FIRST_OPEN_SECOND_SLOT, matchesFirstOpenSecondSlotEnvironment,
  type FirstOpenSecondSlotApproval } from "./first-open-second-slot.ts";

type Rendered = Awaited<ReturnType<typeof renderSingleTenantAcceptanceWorkload>>;
export interface SupervisedTenantStack extends Omit<Rendered, "safety"> {
  cloudFormationRoleArn: string;
  safety: Rendered["safety"] & { parametersValidated: true };
}
export type WorkerTenantStack = ApplyReadyTenantStack | SupervisedTenantStack;
type ApplyResult = Awaited<ReturnType<AwsDeploymentPort["applyTenantStack"]>>;
export interface SupervisedWorkloadAwsPort extends AwsDeploymentPort {
  applySupervisedTenantStack(stack: SupervisedTenantStack, input: { signal: AbortSignal; createOnly?: true }): Promise<ApplyResult>;
}

/** Independent cleanup readiness, NOT an installed Scheduler receipt. The
 * future reviewed root must supply a live verifier, not a local "enabled" flag.
 * Metadata validation here does not itself prove permissions or human approval.
 */
export interface SupervisedCleanupReadinessPort {
  verify(input: { scope: SingleDeploymentClaimScope; context: DeploymentExecutionContext; signal: AbortSignal }): Promise<{
    scopeSha256: string;
    reviewSha256: string;
    permissionsEvidenceSha256: string;
    cellStackId: string;
    verifiedAt: number;
    expiresAt: number;
    responsibleCallerArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev";
    order: "workload_database_role_generation_secret_then_cell";
  }>;
  /** Fixed first-open review only: uses the held scope, not a claimed context. */
  verifyBeforeClaim?(input: { scope: SingleDeploymentClaimScope; jobId: string; approvalSha256: string;
    window: FirstOpenExecutionWindow; signal: AbortSignal }): Promise<SupervisedCleanupObservation>;
}
type SupervisedCleanupObservation = Awaited<ReturnType<SupervisedCleanupReadinessPort["verify"]>>;

export async function assertFirstOpenCleanupReadiness(observed: SupervisedCleanupObservation, scope: SingleDeploymentClaimScope,
  window: FirstOpenExecutionWindow, checkedAt: number) {
  if (!observed || observed.scopeSha256 !== await sha256Hex(scope) || observed.reviewSha256 !== window.cleanupReviewSha256 ||
    observed.permissionsEvidenceSha256 !== window.cleanupPermissionsEvidenceSha256 || observed.cellStackId !== FIRST_OPEN_CELL_STACK ||
    observed.responsibleCallerArn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" ||
    observed.order !== "workload_database_role_generation_secret_then_cell" ||
    !Number.isSafeInteger(observed.verifiedAt) || observed.verifiedAt > checkedAt || checkedAt - observed.verifiedAt > 30_000 ||
    observed.expiresAt !== window.workloadExpiresAt || checkedAt >= window.writeBefore ||
    observed.expiresAt <= checkedAt + FIRST_OPEN_CLEANUP_RESERVE_MS) fail("SUPERVISED_CLEANUP_READINESS_UNPROVED");
}
export interface TenantWorkloadExecutionStrategy {
  readonly mode: "single-tenant-supervised";
  assertScope(context: DeploymentExecutionContext): void;
  ensureCleanup(input: { context: DeploymentExecutionContext; signal: AbortSignal; now: number }): Promise<string>;
  render(input: { context: DeploymentExecutionContext; stackInput: AwsSandboxTenantStackInput }): Promise<SupervisedTenantStack>;
  apply(input: { aws: AwsDeploymentPort; stack: SupervisedTenantStack; signal: AbortSignal }): Promise<ApplyResult>;
}

const finalized = new WeakSet<object>();
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const externalNames = ["ClusterName", "VpcId", "SubnetIds", "TaskSecurityGroupId", "OneShotTaskSecurityGroupId",
  "HttpsListenerArn", "ControlListenerArn", "TaskExecutionRoleArn", "TaskRoleArn", "ControlPublicKeyValueFrom",
  "ControlIssuer", "CorsAllowedOrigins", "StripePublishableKey", "StripeSuccessUrl", "StripeCancelUrl"];
const scopedNames = externalNames.filter(k => k !== "OneShotTaskSecurityGroupId" && k !== "TaskRoleArn");
const scopedBindings = new WeakMap<DeploymentExecutionBinding, string>();
type ExpressBinding = Pick<FirstOnboardingExpressComposition, "controlRef" | "applicationRoleArn">;
export type FirstOpenRdsSecretVersion = Readonly<{ arn: string; versionId: string }>;
export type FirstOpenRdsControlPublicKey = FirstOpenRdsSecretVersion & Readonly<{ jsonKey?: string }>;
export type FirstOpenRdsPersistence = Readonly<{
  bucket: string;
  providerVariable: "IMAGE_STORAGE_PROVIDER";
  bucketVariable: "IMAGE_S3_BUCKET";
  verificationSha256: string;
  mediaPublicBaseUrl: string;
}>;
export type FirstOpenRdsWorkload = Readonly<{
  application: FirstOpenRdsSecretVersion;
  control: FirstOpenRdsControlPublicKey;
  persistence: FirstOpenRdsPersistence;
  privateSubnetIds: readonly string[];
}>;
const secretVersionId = /^[A-Za-z0-9-]{32,64}$/;
const controlSecretArn = /^arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong\/sandbox\/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/;
const secretJsonKey = /^[A-Za-z0-9_.-]{1,128}$/;

function bindRdsWorkload(application: FirstOpenRdsSecretVersion | undefined, control: FirstOpenRdsControlPublicKey | undefined,
  persistence: FirstOpenRdsPersistence | undefined, privateSubnetIds: readonly string[] | undefined): FirstOpenRdsWorkload {
  if (!application || !control || typeof application.arn !== "string" || typeof application.versionId !== "string" ||
      !secretVersionId.test(application.versionId) || typeof control.arn !== "string" || !controlSecretArn.test(control.arn) ||
      typeof control.versionId !== "string" || !secretVersionId.test(control.versionId) || application.arn === control.arn ||
      (control.jsonKey !== undefined && (typeof control.jsonKey !== "string" || !secretJsonKey.test(control.jsonKey)))) {
    fail("ECS_FIRST_OPEN_RDS_SECRET_VERSION_REQUIRED");
  }
  if (!persistence || typeof persistence.bucket !== "string" || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(persistence.bucket) ||
      persistence.providerVariable !== "IMAGE_STORAGE_PROVIDER" || persistence.bucketVariable !== "IMAGE_S3_BUCKET" ||
      typeof persistence.verificationSha256 !== "string" || !/^[a-f0-9]{64}$/.test(persistence.verificationSha256) ||
      typeof persistence.mediaPublicBaseUrl !== "string" || !/^https:\/\/[a-z0-9]+\.cloudfront\.net$/.test(persistence.mediaPublicBaseUrl)) {
    fail("ECS_FIRST_OPEN_RDS_PERSISTENCE_REQUIRED");
  }
  if (!isFirstOpenRdsPrivateSubnetIds(privateSubnetIds)) fail("ECS_FIRST_OPEN_RDS_PRIVATE_SUBNETS_REQUIRED");
  return freeze({ application: { ...application }, control: { ...control }, persistence: { ...persistence }, privateSubnetIds: [...privateSubnetIds] });
}

const rdsTlsEnvironment = {
  PGSSLMODE: "verify-full",
  PGSSL_REJECT_UNAUTHORIZED: "true",
  PGSSLROOTCERT: "/usr/local/share/ca-certificates/aws-rds-global-bundle.pem",
};
const rdsSecretKeys = {
  DATABASE_URL: tenantRuntimeSecretJsonKeys.databaseUrl,
  HMAC_SECRET_KEY: tenantRuntimeSecretJsonKeys.hmacSecretKey,
  JWT_SECRET_KEY: tenantRuntimeSecretJsonKeys.jwtSecretKey,
  STRIPE_SECRET_KEY: tenantRuntimeSecretJsonKeys.stripeSecretKey,
  STRIPE_WEBHOOK_SECRET: tenantRuntimeSecretJsonKeys.stripeWebhookSecret,
};
const rdsWorkloadEnvironment = (persistence: FirstOpenRdsPersistence) => ({
  PG_DATABASE_PROFILE: "full_password",
  IMAGE_STORAGE_PROVIDER: "s3",
  IMAGE_S3_BUCKET: persistence.bucket,
  IMAGE_PUBLIC_BASE_URL: persistence.mediaPublicBaseUrl,
  ALLOW_EPHEMERAL_IMAGE_STORAGE: "false",
});

/** Compare the freshly described task definition with the same exact secret
 * versions and PostgreSQL transport settings used to render its template. */
export function assertFirstOpenRdsTaskDefinition(pins: FirstOpenRdsWorkload, task: TaskDefinition) {
  const containers = task.containerDefinitions;
  const app = containers?.length === 1 ? containers[0] : undefined;
  const requiredEnvironment = { ...rdsTlsEnvironment, ...rdsWorkloadEnvironment(pins.persistence) };
  const expected = Object.entries(rdsSecretKeys).map(([name, key]) => ({ name,
    valueFrom: `${pins.application.arn}:${key}::${pins.application.versionId}` }));
  expected.push({ name: "SAAS_CONTROL_PUBLIC_KEY", valueFrom: `${pins.control.arn}:${pins.control.jsonKey ?? ""}::${pins.control.versionId}` });
  const byName = (a: { name?: string }, b: { name?: string }) => (a.name ?? "").localeCompare(b.name ?? "");
  if (app?.name !== "speedfeast-backend" || !app.environment ||
    canonicalJson([...(app.secrets ?? [])].sort(byName)) !== canonicalJson(expected.sort(byName)) ||
    app.environment.some(entry => expected.some(secret => entry.name === secret.name)) ||
    Object.entries(requiredEnvironment).some(([name, value]) => {
      const matches = app.environment!.filter(entry => entry.name === name);
      return matches.length !== 1 || matches[0].value !== value;
    })) fail("ECS_FIRST_OPEN_RDS_WORKLOAD_READBACK_MISMATCH");
}

function assertRdsWorkloadSubnets(pins: FirstOpenRdsWorkload, binding: RenderContext["binding"]) {
  const legacySubnetIds = binding?.tenantStackParameters.SubnetIds?.split(",").map(id => id.trim());
  if (!isFirstOpenRdsPrivateSubnetIds(pins.privateSubnetIds) || !legacySubnetIds?.length ||
    legacySubnetIds.some(id => pins.privateSubnetIds.includes(id))) fail("ECS_FIRST_OPEN_RDS_PRIVATE_SUBNETS_SCOPE");
}

async function pinRdsWorkload(rendered: Rendered, input: AwsSandboxTenantStackInput, context: RenderContext, pins: FirstOpenRdsWorkload) {
  if (input.runtimeSecretRef !== pins.application.arn || context.binding?.tenantStackParameters.ControlPublicKeyValueFrom !== pins.control.arn) {
    fail("ECS_FIRST_OPEN_RDS_SECRET_SCOPE_CHANGED");
  }
  assertRdsWorkloadSubnets(pins, context.binding);
  type Value = string | Record<string, string>;
  const resources = rendered.template.Resources as Record<string, {
    Type?: string;
    Properties?: { ContainerDefinitions?: Array<{ Name: string; Environment: { Name: string; Value: Value }[];
      Secrets: { Name: string; ValueFrom: Value }[] }>;
      NetworkConfiguration?: { AwsvpcConfiguration?: { AssignPublicIp?: string; Subnets?: Value; SecurityGroups?: Value[] } } };
  }>;
  const task = resources.TenantTaskDefinition;
  const containers = task?.Properties?.ContainerDefinitions;
  const service = resources.TenantService;
  const network = service?.Properties?.NetworkConfiguration?.AwsvpcConfiguration;
  if (task?.Type !== "AWS::ECS::TaskDefinition" || containers?.length !== 1 || containers[0].Name !== "speedfeast-backend" ||
    service?.Type !== "AWS::ECS::Service" || !network || network.AssignPublicIp !== "ENABLED" ||
    canonicalJson(network.Subnets) !== canonicalJson({ Ref: "SubnetIds" }) ||
    canonicalJson(network.SecurityGroups) !== canonicalJson([{ Ref: "TaskSecurityGroupId" }])) {
    fail("ECS_FIRST_OPEN_RDS_WORKLOAD_TEMPLATE_CHANGED");
  }
  const container = containers[0];
  if (container.Environment.some(item => item.Name === "PG_DATABASE_PROFILE") ||
    Object.entries(rdsTlsEnvironment).some(([name, value]) => {
      const matches = container.Environment.filter(item => item.Name === name);
      return matches.length !== 1 || matches[0].Value !== value;
    })) fail("ECS_FIRST_OPEN_RDS_WORKLOAD_TEMPLATE_CHANGED");

  const keys = new Map(Object.entries(rdsSecretKeys));
  if (container.Secrets.length !== keys.size + 1 || new Set(container.Secrets.map(secret => secret.Name)).size !== container.Secrets.length) {
    fail("ECS_FIRST_OPEN_RDS_WORKLOAD_TEMPLATE_CHANGED");
  }
  for (const secret of container.Secrets) {
    if (secret.Name === "SAAS_CONTROL_PUBLIC_KEY") {
      if (canonicalJson(secret.ValueFrom) !== canonicalJson({ Ref: "ControlPublicKeyValueFrom" })) {
        fail("ECS_FIRST_OPEN_RDS_WORKLOAD_TEMPLATE_CHANGED");
      }
      secret.ValueFrom = { "Fn::Sub": `\${ControlPublicKeyValueFrom}:${pins.control.jsonKey ?? ""}::${pins.control.versionId}` };
      continue;
    }
    const key = keys.get(secret.Name);
    if (!key || canonicalJson(secret.ValueFrom) !== canonicalJson({ "Fn::Sub": `\${TenantRuntimeSecretArn}:${key}::` })) {
      fail("ECS_FIRST_OPEN_RDS_WORKLOAD_TEMPLATE_CHANGED");
    }
    secret.ValueFrom = { "Fn::Sub": `\${TenantRuntimeSecretArn}:${key}::${pins.application.versionId}` };
  }
  const rdsEnvironment = rdsWorkloadEnvironment(pins.persistence);
  container.Environment = [...container.Environment.filter(item => !Object.hasOwn(rdsEnvironment, item.Name)),
    ...Object.entries(rdsEnvironment).map(([Name, Value]) => ({ Name, Value }))];
  network.AssignPublicIp = "DISABLED";
  rendered.templateBody = canonicalJson(rendered.template);
  rendered.templateSha256 = await sha256Hex(rendered.template);
}

type RenderContext = Pick<DeploymentExecutionContext, "environment" | "binding"> & {
  appInstance: Pick<DeploymentExecutionContext["appInstance"], "id">;
  deployment: Pick<DeploymentExecutionContext["deployment"], "id" | "artifactRef">;
};
function validateBinding(context: Pick<RenderContext, "binding" | "environment">, express?: ExpressBinding): void {
  const binding = context.binding;
  const scoped = binding !== null && scopedBindings.has(binding);
  const names = scoped ? scopedNames : externalNames;
  if (!binding || (scoped && !express) || binding.status !== "active" || binding.environmentId !== context.environment.id ||
    binding.workerRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole" ||
    binding.cloudFormationRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole" ||
    canonicalJson(Object.keys(binding.tenantStackParameters).sort()) !== canonicalJson([...names].sort())) fail("SUPERVISED_PARAMETER_SET_INVALID");
  for (const name of names) {
    const value = binding.tenantStackParameters[name];
    if (express && name === "ControlPublicKeyValueFrom" &&
      (value === express.controlRef || value === express.controlRef.split(":::")[0])) continue;
    validateExternalParameter({ name, value, environment: context.environment });
  }
  if (binding.tenantStackParameters.HttpsListenerArn === binding.tenantStackParameters.ControlListenerArn) fail("SUPERVISED_LISTENERS_NOT_SEPARATED");
}

/** Only the pinned hosted entry prepares this from its independently sealed
 * Inspector seed, not from a Neon row, runtime port, or dispatcher field. */
export async function sealFirstOpenTaskBinding(input: Pick<RenderContext, "binding" | "environment"> & {
  approvalSha256: string; parametersSha256: string; express: ExpressBinding;
}) {
  const binding = input.binding && structuredClone(input.binding), { environment, express } = input;
  if (!binding || !/^[a-f0-9]{64}$/.test(input.approvalSha256) || environment.id !== "env_aws_sandbox_ca_central_1" ||
    environment.key !== "aws-sandbox-ca-central-1" || environment.kind !== "aws_sandbox" || environment.applyEnabled !== false || environment.status !== "active" ||
    environment.expectedAccountId !== "402010193138" || environment.region !== "ca-central-1" || environment.cellKey !== "cell-sandbox-1" ||
    binding.tenantStackParameters?.ControlPublicKeyValueFrom !== express.controlRef ||
    await sha256Hex(binding.tenantStackParameters) !== input.parametersSha256) fail("FIRST_OPEN_TASK_BINDING_SEAL");
  scopedBindings.set(binding, input.approvalSha256);
  validateBinding({ binding, environment }, express);
  assertFirstOpenBuyerParameters(binding.tenantStackParameters);
  const parent = (arn: string) => arn.slice(0, arn.lastIndexOf("/"));
  if (parent(binding.tenantStackParameters.HttpsListenerArn) !== parent(binding.tenantStackParameters.ControlListenerArn)) {
    fail("FIRST_OPEN_TASK_BINDING_LISTENER_GENERATION");
  }
  return freeze(binding);
}

export function isFirstOpenTaskBinding(binding: DeploymentExecutionBinding, approvalSha256: string) {
  return scopedBindings.get(binding) === approvalSha256;
}

/** No substitution if a shared row appeared after the preclaim readiness read. */
export function attachFirstOpenTaskBinding(context: DeploymentExecutionContext, binding: DeploymentExecutionBinding, approvalSha256: string) {
  if (!isFirstOpenTaskBinding(binding, approvalSha256) || context.job.id !== FIRST_OPEN_BASELINE_BINDING.jobId ||
    context.environment.id !== binding.environmentId || context.environment.applyEnabled !== false || context.binding !== null) {
    fail("FIRST_OPEN_TASK_BINDING_CONTEXT_CHANGED");
  }
  return { ...context, binding };
}
export function assertFinalizedSupervisedTenantStack(stack: SupervisedTenantStack): void {
  if (!stack || !finalized.has(stack)) fail("SUPERVISED_STACK_NOT_FINALIZED");
}

/** Parameter validation alone issues no execution approval. Unlike the old
 * ApplyReady type, this material never claims a cleanup schedule exists.
 */
export function finalizeSupervisedTenantStack(input: {
  rendered: Rendered; context: DeploymentExecutionContext; expectedRuntimeSecretName: string;
}): SupervisedTenantStack {
  assertSingleTenantWorkloadRender(input.rendered);
  return finalizeRenderedStack(input);
}

function finalizeRenderedStack(input: {
  rendered: Rendered; context: RenderContext; expectedRuntimeSecretName: string;
  express?: ExpressBinding;
}): SupervisedTenantStack {
  const { rendered, context } = input, binding = context.binding;
  validateBinding(context, input.express);
  if (!binding || binding.status !== "active" || binding.environmentId !== context.environment.id ||
    binding.workerRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole" ||
    binding.cloudFormationRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole" ||
    rendered.accountId !== context.environment.expectedAccountId || rendered.region !== context.environment.region ||
    rendered.protocol !== "single-tenant-supervised-workload" || !rendered.safety.renderOnly ||
    rendered.safety.automaticCleanupInstalled || rendered.resourceInventory.length !== 7 ||
    rendered.tags.AppInstanceId !== context.appInstance.id || rendered.tags.DeploymentId !== context.deployment.id ||
    rendered.parameters.ImageUri !== context.deployment.artifactRef) fail("SUPERVISED_STACK_SCOPE_INVALID");
  const parameters = structuredClone(binding.tenantStackParameters);
  if (input.express) {
    if (rendered.parameters.TaskRoleArn !== input.express.applicationRoleArn ||
      ![input.express.controlRef, input.express.controlRef.split(":::")[0]].includes(parameters.ControlPublicKeyValueFrom)) {
      fail("FIRST_ONBOARDING_EXPRESS_REFERENCE_CHANGED");
    }
    delete parameters.TaskRoleArn;
    parameters.ControlPublicKeyValueFrom = input.express.controlRef;
  }
  const runtimeOnly = "OneShotTaskSecurityGroupId";
  if (canonicalJson(Object.keys(parameters).filter(key => key !== runtimeOnly).sort()) !==
    canonicalJson([...rendered.requiredExternalParameters].sort())) fail("SUPERVISED_PARAMETER_SET_INVALID");
  const names = scopedBindings.has(binding) ? rendered.requiredExternalParameters : [...rendered.requiredExternalParameters, runtimeOnly];
  for (const name of names) {
    if (input.express && name === "ControlPublicKeyValueFrom") continue;
    validateExternalParameter({ name, value: parameters[name], environment: context.environment });
  }
  if (parameters.HttpsListenerArn === parameters.ControlListenerArn) fail("SUPERVISED_LISTENERS_NOT_SEPARATED");
  assertAwsSandboxTenantRuntimeSecretRef({ runtimeSecretRef: rendered.parameters.TenantRuntimeSecretArn,
    expectedSecretName: input.expectedRuntimeSecretName, accountId: rendered.accountId, region: rendered.region });
  delete parameters[runtimeOnly];
  const stack: SupervisedTenantStack = freeze({ ...structuredClone(rendered),
    parameters: { ...parameters, ...rendered.parameters }, cloudFormationRoleArn: binding.cloudFormationRoleArn,
    safety: { ...rendered.safety, parametersValidated: true } });
  finalized.add(stack);
  return stack;
}

async function renderFirstOnboardingStack(input: AwsSandboxTenantStackInput, context: RenderContext, reviewedImage: string,
  express?: ExpressBinding & { render(input: AwsSandboxTenantStackInput): ReturnType<FirstOnboardingExpressComposition["render"]> },
  window?: FirstOpenExecutionWindow, rdsWorkload?: FirstOpenRdsWorkload) {
  if ((context.binding && scopedBindings.has(context.binding) && !window) || input.imageUri !== reviewedImage || input.resourceGeneration !== 1 ||
    !/^402010193138\.dkr\.ecr\.ca-central-1\.amazonaws\.com\/techlong-sandbox-speedfeast@sha256:[a-f0-9]{64}$/.test(reviewedImage) ||
    input.environment.policy.budgetLimitCents !== 5000 || input.environment.policy.maxTaskCount !== 1 ||
    input.plan.deploymentProfileKey !== "standard-v1" || input.environment.baseDomain !== "sandbox.techlong.cloud") {
    fail("FIRST_ONBOARDING_WORKLOAD_SCOPE_INVALID");
  }
  // Reuse the unchanged pinned renderer's data-only transform. This entry
  // validates the new digest before privately finalizing that exact output.
  const rendered = express
    ? { ...await express.render(input), protocol: "single-tenant-supervised-workload" as const }
    : await renderSupervisedTenantWorkloadBase(input);
  if (rdsWorkload) await pinRdsWorkload(rendered, input, context, rdsWorkload);
  if (window) {
    // The supervised template has no scheduler. Retag only this first-open
    // output; the immutable requestedAt and legacy renderers stay untouched.
    const expiration = new Date(window.workloadExpiresAt).toISOString(), old = rendered.tags.ExpiresAt;
    const resources = rendered.template.Resources as Record<string, { Properties?: { Tags?: { Key: string; Value: unknown }[] } }>;
    for (const resource of Object.values(resources)) {
      const properties = resource.Properties, tags = properties?.Tags;
      if (!tags) continue;
      const expiry = tags.filter(tag => tag.Key === "ExpiresAt");
      if (expiry.length !== 1 || expiry[0].Value !== old) fail("FIRST_ONBOARDING_EXPIRY_TAG_DRIFT");
      // The base template shares tag entries between resources.
      properties.Tags = tags.map(tag => tag.Key === "ExpiresAt" ? { ...tag, Value: expiration } : tag);
    }
    rendered.tags = { ...rendered.tags, ExpiresAt: expiration };
    rendered.templateBody = canonicalJson(rendered.template);
    rendered.templateSha256 = await sha256Hex(rendered.template);
  }
  const finalizedStack = finalizeRenderedStack({ rendered, context, express, expectedRuntimeSecretName: input.runtimeSecretName });
  if (!rdsWorkload && (!window || !context.binding || !scopedBindings.has(context.binding))) return finalizedStack;
  // Include the two defaults in the exact parameter readback. The fixed
  // definitions expose only the two already-approved Secret ARN references.
  const parameters = { JwtExpiresIn: "7d", MerchantJwtExpiresIn: "12h", ...finalizedStack.parameters,
    SubnetIds: rdsWorkload ? rdsWorkload.privateSubnetIds.join(",") : finalizedStack.parameters.SubnetIds.split(",").map(s => s.trim()).join(",") };
  const template = freezeFirstOpenTemplate(finalizedStack.template, parameters);
  const stack = freeze({ ...finalizedStack, parameters, template,
    templateBody: canonicalJson(template), templateSha256: await sha256Hex(template) });
  finalized.add(stack);
  return stack;
}

/** Inspector gets only data, never the apply-capable, process-local object. */
export async function renderFirstOnboardingExpectation(...args: Parameters<typeof renderFirstOnboardingStack>) {
  return structuredClone(await renderFirstOnboardingStack(...args));
}

/** Wired into the existing Worker without changing its lease, epoch, database,
 * control or ready checks. The prepared composition remains disabled until a
 * separately reviewed live root supplies actual cleanup/permission readback.
 */
export function createSingleTenantWorkloadStrategy(input: {
  scope: SingleDeploymentClaimScope; cleanupReadiness: SupervisedCleanupReadinessPort;
}): TenantWorkloadExecutionStrategy {
  return createSupervisedStrategy(validateSingleDeploymentScope(input.scope), input.cleanupReadiness, false);
}

/** Not reachable via flags or the ordinary worker composition. */
export function createFirstOnboardingWorkloadStrategy(input: {
  scope: SingleDeploymentClaimScope; cleanupReadiness: SupervisedCleanupReadinessPort;
  express?: FirstOnboardingExpressComposition; window?: FirstOpenExecutionWindow;
  secondSlot?: FirstOpenSecondSlotApproval;
  rdsAuthority?: EcsFirstOpenRdsAuthority;
  rdsApplicationSecret?: FirstOpenRdsSecretVersion;
  rdsControlPublicKey?: FirstOpenRdsControlPublicKey;
  rdsPersistence?: FirstOpenRdsPersistence;
  rdsPrivateSubnetIds?: readonly string[];
}): TenantWorkloadExecutionStrategy {
  if (input.rdsAuthority && (input.express || input.window || input.secondSlot ||
      input.scope.environmentId !== ECS_FIRST_OPEN_RDS_ENVIRONMENT_ID ||
      input.scope.appInstanceId !== input.rdsAuthority.instanceId)) fail("ECS_FIRST_OPEN_RDS_CONTEXT_SCOPE");
  if (!input.rdsAuthority && (input.rdsApplicationSecret || input.rdsControlPublicKey || input.rdsPersistence || input.rdsPrivateSubnetIds)) {
    fail("ECS_FIRST_OPEN_RDS_CONTEXT_SCOPE");
  }
  const rdsWorkload = input.rdsAuthority ? bindRdsWorkload(input.rdsApplicationSecret, input.rdsControlPublicKey,
    input.rdsPersistence, input.rdsPrivateSubnetIds) : undefined;
  return createSupervisedStrategy(Object.freeze(structuredClone(input.scope)), input.cleanupReadiness, true, input.express, input.window,
    input.secondSlot === undefined ? undefined : structuredClone(input.secondSlot), input.rdsAuthority, rdsWorkload);
}

function createSupervisedStrategy(scope: Readonly<SingleDeploymentClaimScope>, cleanup: SupervisedCleanupReadinessPort,
  firstOnboarding: boolean, express?: FirstOnboardingExpressComposition, window?: FirstOpenExecutionWindow,
  secondSlot?: FirstOpenSecondSlotApproval, rdsAuthority?: EcsFirstOpenRdsAuthority, rdsWorkload?: FirstOpenRdsWorkload): TenantWorkloadExecutionStrategy {
  if (!cleanup || typeof cleanup.verify !== "function") fail("SUPERVISED_CLEANUP_VERIFIER_MISSING");
  if (secondSlot !== undefined) {
    assertFirstOpenSecondSlot(secondSlot);
    if (!firstOnboarding || !express || !window || scope.appInstanceId !== FIRST_OPEN_SECOND_SLOT.instanceId ||
      scope.deploymentId !== FIRST_OPEN_SECOND_SLOT.deploymentId || scope.environmentId !== FIRST_OPEN_SECOND_SLOT.environmentId) {
      fail("FIRST_OPEN_SECOND_SLOT_STRATEGY_SCOPE");
    }
  }
  const assertScope = (context: DeploymentExecutionContext) => {
    if (rdsAuthority) assertEcsFirstOpenRdsContext(rdsAuthority, context);
    if (rdsWorkload && (context.binding?.tenantStackParameters.ControlPublicKeyValueFrom !== rdsWorkload.control.arn ||
        (context.tenantResources?.runtimeSecretRef && context.tenantResources.runtimeSecretRef !== rdsWorkload.application.arn))) {
      fail("ECS_FIRST_OPEN_RDS_SECRET_SCOPE_CHANGED");
    }
    if (rdsWorkload) assertRdsWorkloadSubnets(rdsWorkload, context.binding);
    if (secondSlot && (context.job.id !== FIRST_OPEN_SECOND_SLOT.jobId || context.activeCellCount !== 1 || context.activeTenantCount !== 1 ||
      !matchesFirstOpenSecondSlotEnvironment(secondSlot, context.environment))) fail("FIRST_OPEN_SECOND_SLOT_CONTEXT_CHANGED");
    if (firstOnboarding && ((context.job.id === FIRST_OPEN_BASELINE_BINDING.jobId) !== Boolean(window) ||
      (window && context.environment.policy.ttlSeconds !== FIRST_OPEN_TTL_SECONDS))) fail("FIRST_ONBOARDING_WINDOW_SCOPE_CHANGED");
    if (context.deployment.id !== scope.deploymentId || context.deployment.appInstanceId !== scope.appInstanceId ||
      context.appInstance.id !== scope.appInstanceId || context.deployment.environmentId !== scope.environmentId ||
      context.environment.id !== scope.environmentId || context.deployment.planHash !== scope.planHash ||
      context.deployment.configurationHash !== scope.configurationHash || context.deployment.artifactRef !== scope.artifactRef ||
      context.job.deploymentId !== scope.deploymentId || context.job.payload.deploymentId !== scope.deploymentId ||
      context.job.payload.planHash !== scope.planHash || context.environment.cellKey !== "cell-sandbox-1" ||
      context.environment.expectedAccountId !== "402010193138" || context.environment.region !== "ca-central-1" ||
      context.environment.baseDomain !== "sandbox.techlong.cloud" || context.environment.policy.budgetLimitCents !== 5000) {
      fail("SUPERVISED_DEPLOYMENT_SCOPE_MISMATCH");
    }
    if (!["cleanup", "rollback"].includes(context.job.jobType)) validateBinding(context, express);
  };
  const strategy: TenantWorkloadExecutionStrategy = { mode: "single-tenant-supervised", assertScope,
    async ensureCleanup({ context, signal, now }) {
      assertScope(context); signal.throwIfAborted();
      const startedAt = performance.now();
      const observed = structuredClone(await cleanup.verify({ scope, context, signal })); signal.throwIfAborted();
      const checkedAt = now + Math.max(0, performance.now() - startedAt);
      if (window) {
        await assertFirstOpenCleanupReadiness(observed, scope, window, checkedAt);
        return `supervised-review:${observed.reviewSha256}`;
      }
      const expiresAt = context.deployment.createdAt + context.environment.policy.ttlSeconds * 1000;
      if (observed.scopeSha256 !== await sha256Hex(scope) ||
        !/^[a-f0-9]{64}$/.test(observed.reviewSha256) || !/^[a-f0-9]{64}$/.test(observed.permissionsEvidenceSha256) ||
        !/^arn:aws:cloudformation:ca-central-1:402010193138:stack\/techlong-sandbox-cell-sandbox-1\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(observed.cellStackId) ||
        !Number.isSafeInteger(observed.verifiedAt) || observed.verifiedAt > checkedAt || checkedAt - observed.verifiedAt > 30_000 ||
        observed.expiresAt !== expiresAt || expiresAt <= checkedAt + 5 * 60_000 ||
        observed.responsibleCallerArn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev" ||
        observed.order !== "workload_database_role_generation_secret_then_cell") fail("SUPERVISED_CLEANUP_READINESS_UNPROVED");
      return `supervised-review:${observed.reviewSha256}`;
    },
    async render({ context, stackInput }) {
      assertScope(context);
      if (stackInput.deploymentId !== scope.deploymentId || stackInput.imageUri !== scope.artifactRef ||
        await sha256Hex(stackInput.plan) !== scope.planHash || canonicalJson(stackInput.environment) !== canonicalJson(context.environment) ||
        stackInput.requestedAt !== context.deployment.createdAt || stackInput.listenerPriority !== 100 ||
        stackInput.tenantHostname !== `${context.appInstance.slug.trim().toLowerCase()}.sandbox.techlong.cloud` ||
        stackInput.resourceGeneration !== context.tenantResources?.generation ||
        stackInput.runtimeSecretRef !== context.tenantResources?.runtimeSecretRef ||
        stackInput.externalOperation.epoch !== context.tenantExternalOperation?.epoch ||
        stackInput.externalOperation.marker !== context.tenantExternalOperation?.marker ||
        stackInput.externalOperation.operationHash !== context.tenantExternalOperation?.operationHash) fail("SUPERVISED_RENDER_CONTEXT_MISMATCH");
      const reviewedStackInput = secondSlot ? { ...stackInput, listenerPriority: secondSlot.listenerPriority } : stackInput;
      if (firstOnboarding) return renderFirstOnboardingStack(reviewedStackInput, context, scope.artifactRef,
        express && { controlRef: express.controlRef, applicationRoleArn: express.applicationRoleArn,
          render: x => express.render(x, context) }, window, rdsWorkload);
      return finalizeSupervisedTenantStack({ rendered: await renderSingleTenantAcceptanceWorkload(stackInput), context,
        expectedRuntimeSecretName: stackInput.runtimeSecretName });
    },
    async apply({ aws, stack, signal }) {
      assertFinalizedSupervisedTenantStack(stack); signal.throwIfAborted();
      if (!("applySupervisedTenantStack" in aws) || typeof aws.applySupervisedTenantStack !== "function") {
        fail("SUPERVISED_AWS_ADAPTER_MISSING");
      }
      const result = await (aws as SupervisedWorkloadAwsPort).applySupervisedTenantStack(stack, firstOnboarding ? { signal, createOnly: true } : { signal });
      if (firstOnboarding && result.operation !== "create") fail("FIRST_ONBOARDING_STACK_NOT_CREATED");
      return result;
    },
  };
  return Object.freeze(strategy);
}
