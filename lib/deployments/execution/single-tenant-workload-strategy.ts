import { renderSingleTenantAcceptanceWorkload, assertSingleTenantWorkloadRender } from "../cloudformation/single-tenant-acceptance-workload.ts";
import { assertAwsSandboxTenantRuntimeSecretRef, type AwsSandboxTenantStackInput } from "../cloudformation/tenant-stack.ts";
import type { ApplyReadyTenantStack, AwsDeploymentPort, DeploymentExecutionContext } from "./contracts.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { validateExternalParameter } from "./parameters.ts";
import { validateSingleDeploymentScope, type SingleDeploymentClaimScope } from "./single-deployment-scope.ts";

type Rendered = Awaited<ReturnType<typeof renderSingleTenantAcceptanceWorkload>>;
export interface SupervisedTenantStack extends Omit<Rendered, "safety"> {
  cloudFormationRoleArn: string;
  safety: Rendered["safety"] & { parametersValidated: true };
}
export type WorkerTenantStack = ApplyReadyTenantStack | SupervisedTenantStack;
type ApplyResult = Awaited<ReturnType<AwsDeploymentPort["applyTenantStack"]>>;
export interface SupervisedWorkloadAwsPort extends AwsDeploymentPort {
  applySupervisedTenantStack(stack: SupervisedTenantStack, input: { signal: AbortSignal }): Promise<ApplyResult>;
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
function validateBinding(context: DeploymentExecutionContext): void {
  const binding = context.binding;
  if (!binding || binding.status !== "active" || binding.environmentId !== context.environment.id ||
    binding.workerRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole" ||
    binding.cloudFormationRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole" ||
    canonicalJson(Object.keys(binding.tenantStackParameters).sort()) !== canonicalJson([...externalNames].sort())) fail("SUPERVISED_PARAMETER_SET_INVALID");
  for (const name of externalNames) validateExternalParameter({ name, value: binding.tenantStackParameters[name], environment: context.environment });
  if (binding.tenantStackParameters.HttpsListenerArn === binding.tenantStackParameters.ControlListenerArn) fail("SUPERVISED_LISTENERS_NOT_SEPARATED");
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
  const { rendered, context } = input, binding = context.binding;
  validateBinding(context);
  assertSingleTenantWorkloadRender(rendered);
  if (!binding || binding.status !== "active" || binding.environmentId !== context.environment.id ||
    binding.workerRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole" ||
    binding.cloudFormationRoleArn !== "arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole" ||
    rendered.accountId !== context.environment.expectedAccountId || rendered.region !== context.environment.region ||
    rendered.protocol !== "single-tenant-supervised-workload" || !rendered.safety.renderOnly ||
    rendered.safety.automaticCleanupInstalled || rendered.resourceInventory.length !== 7 ||
    rendered.tags.AppInstanceId !== context.appInstance.id || rendered.tags.DeploymentId !== context.deployment.id ||
    rendered.parameters.ImageUri !== context.deployment.artifactRef) fail("SUPERVISED_STACK_SCOPE_INVALID");
  const parameters = structuredClone(binding.tenantStackParameters);
  const runtimeOnly = "OneShotTaskSecurityGroupId";
  if (canonicalJson(Object.keys(parameters).filter(key => key !== runtimeOnly).sort()) !==
    canonicalJson([...rendered.requiredExternalParameters].sort())) fail("SUPERVISED_PARAMETER_SET_INVALID");
  for (const name of [...rendered.requiredExternalParameters, runtimeOnly]) {
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

/** Wired into the existing Worker without changing its lease, epoch, database,
 * control or ready checks. The prepared composition remains disabled until a
 * separately reviewed live root supplies actual cleanup/permission readback.
 */
export function createSingleTenantWorkloadStrategy(input: {
  scope: SingleDeploymentClaimScope; cleanupReadiness: SupervisedCleanupReadinessPort;
}): TenantWorkloadExecutionStrategy {
  const scope = validateSingleDeploymentScope(input.scope), cleanup = input.cleanupReadiness;
  if (!cleanup || typeof cleanup.verify !== "function") fail("SUPERVISED_CLEANUP_VERIFIER_MISSING");
  const assertScope = (context: DeploymentExecutionContext) => {
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
    if (!["cleanup", "rollback"].includes(context.job.jobType)) validateBinding(context);
  };
  const strategy: TenantWorkloadExecutionStrategy = { mode: "single-tenant-supervised", assertScope,
    async ensureCleanup({ context, signal, now }) {
      assertScope(context); signal.throwIfAborted();
      const startedAt = performance.now();
      const observed = structuredClone(await cleanup.verify({ scope, context, signal })); signal.throwIfAborted();
      const checkedAt = now + Math.max(0, performance.now() - startedAt);
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
      return finalizeSupervisedTenantStack({ rendered: await renderSingleTenantAcceptanceWorkload(stackInput), context,
        expectedRuntimeSecretName: stackInput.runtimeSecretName });
    },
    async apply({ aws, stack, signal }) {
      assertFinalizedSupervisedTenantStack(stack); signal.throwIfAborted();
      if (!("applySupervisedTenantStack" in aws) || typeof aws.applySupervisedTenantStack !== "function") {
        fail("SUPERVISED_AWS_ADAPTER_MISSING");
      }
      return (aws as SupervisedWorkloadAwsPort).applySupervisedTenantStack(stack, { signal });
    },
  };
  return Object.freeze(strategy);
}
