import { renderSingleTenantAcceptanceWorkload, renderSupervisedTenantWorkloadBase, assertSingleTenantWorkloadRender } from "../cloudformation/single-tenant-acceptance-workload.ts";
import { assertAwsSandboxTenantRuntimeSecretRef, type AwsSandboxTenantStackInput } from "../cloudformation/tenant-stack.ts";
import type { ApplyReadyTenantStack, AwsDeploymentPort, DeploymentExecutionBinding, DeploymentExecutionContext } from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { validateExternalParameter } from "./parameters.ts";
import { validateSingleDeploymentScope, type SingleDeploymentClaimScope } from "./single-deployment-scope.ts";
import type { FirstOnboardingExpressComposition } from "./first-onboarding-express.ts";
import { FIRST_OPEN_BASELINE_BINDING } from "./first-onboarding-baseline-versions.ts";
import { assertFirstOpenBuyerParameters } from "./first-open-buyer-binding.ts";
import { freezeFirstOpenTemplate } from "./first-open-frozen-template.ts";
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
  window?: FirstOpenExecutionWindow) {
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
  if (!window || !context.binding || !scopedBindings.has(context.binding)) return finalizedStack;
  // The renderer has two built-in String defaults not supplied by the
  // protected environment. Freeze those too, so DescribeStacks agrees.
  const parameters = { JwtExpiresIn: "7d", MerchantJwtExpiresIn: "12h", ...finalizedStack.parameters,
    SubnetIds: finalizedStack.parameters.SubnetIds.split(",").map(s => s.trim()).join(",") };
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
}): TenantWorkloadExecutionStrategy {
  return createSupervisedStrategy(Object.freeze(structuredClone(input.scope)), input.cleanupReadiness, true, input.express, input.window,
    input.secondSlot === undefined ? undefined : structuredClone(input.secondSlot));
}

function createSupervisedStrategy(scope: Readonly<SingleDeploymentClaimScope>, cleanup: SupervisedCleanupReadinessPort,
  firstOnboarding: boolean, express?: FirstOnboardingExpressComposition, window?: FirstOpenExecutionWindow,
  secondSlot?: FirstOpenSecondSlotApproval): TenantWorkloadExecutionStrategy {
  if (!cleanup || typeof cleanup.verify !== "function") fail("SUPERVISED_CLEANUP_VERIFIER_MISSING");
  if (secondSlot !== undefined) {
    assertFirstOpenSecondSlot(secondSlot);
    if (!firstOnboarding || !express || !window || scope.appInstanceId !== FIRST_OPEN_SECOND_SLOT.instanceId ||
      scope.deploymentId !== FIRST_OPEN_SECOND_SLOT.deploymentId || scope.environmentId !== FIRST_OPEN_SECOND_SLOT.environmentId) {
      fail("FIRST_OPEN_SECOND_SLOT_STRATEGY_SCOPE");
    }
  }
  const assertScope = (context: DeploymentExecutionContext) => {
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
          render: x => express.render(x, context) }, window);
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
