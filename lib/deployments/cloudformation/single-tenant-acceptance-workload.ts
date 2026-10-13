import { renderAwsSandboxTenantStack, type AwsSandboxTenantStackInput } from "./tenant-stack.ts";
import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE } from "../execution/single-deployment-scope.ts";

const renderedWorkloads = new WeakMap<object, string>();
export function assertSingleTenantWorkloadRender(value: object): void {
  if (!renderedWorkloads.has(value) || renderedWorkloads.get(value) !== canonicalJson(value)) {
    throw Error("SINGLE_TENANT_WORKLOAD_RENDER_CHANGED_OR_UNRECOGNIZED");
  }
}

/** Independent render-only workload for supervised acceptance. Retains the
 * original epoch/Secret/tenant isolation checks; never masquerades as the old
 * scheduled CloudFormationTenantStackPlan or issues an ApplyReady capability.
 */
export async function renderSingleTenantAcceptanceWorkload(input: AwsSandboxTenantStackInput) {
  if (input.environment.policy.budgetLimitCents !== 5000 || input.plan.deploymentProfileKey !== "standard-v1" ||
    input.imageUri !== FIRST_ACCEPTANCE_APP_IMAGE || input.environment.policy.maxTaskCount !== 1 ||
    input.environment.baseDomain !== "sandbox.techlong.cloud") throw Error("SINGLE_TENANT_WORKLOAD_SCOPE_INVALID");
  const old = renderAwsSandboxTenantStack(input), template = structuredClone(old.template);
  const resources = template.Resources as Record<string, Record<string, unknown>>;
  const parameters = template.Parameters as Record<string, unknown>;
  const removed = ["JanitorFunctionArn", "SchedulerInvokeRoleArn", "SchedulerGroupName", "CleanupAt"];
  if (resources.TenantCleanupSchedule?.Type !== "AWS::Scheduler::Schedule") throw Error("SINGLE_TENANT_WORKLOAD_BASE_DRIFT");
  delete resources.TenantCleanupSchedule;
  for (const name of removed) delete parameters[name];
  for (const resource of Object.values(resources)) {
    if (Array.isArray(resource.DependsOn)) {
      const dependencies = resource.DependsOn.filter(id => id !== "TenantCleanupSchedule");
      if (dependencies.length) resource.DependsOn = dependencies; else delete resource.DependsOn;
    }
    const properties = resource.Properties as Record<string, unknown>;
    if (Array.isArray(properties.Tags)) properties.Tags = [...properties.Tags,
      { Key: "DeliveryTrack", Value: "single-tenant-acceptance" }, { Key: "CleanupMode", Value: "supervised-reviewed" }];
  }
  // Delivery-first: the previous SPOT choice was a cost optimization. A single
  // standard Fargate task avoids SPOT interruption during this acceptance run.
  (resources.TenantService.Properties as Record<string, unknown>).CapacityProviderStrategy = [
    { CapacityProvider: "FARGATE", Base: 1, Weight: 1 },
  ];
  template.Description = "Single-tenant supervised acceptance workload; exact owned cleanup approval required, no legacy TTL schedule.";
  template.Metadata = { DeliveryTrack: "single-tenant-acceptance", AutomaticCleanupInstalled: false };
  const templateBody = canonicalJson(template);
  if (removed.some(name => templateBody.includes(name))) throw Error("SINGLE_TENANT_WORKLOAD_LEGACY_REFERENCE");
  const tags: Record<string, string> = { ...old.tags, DeliveryTrack: "single-tenant-acceptance", CleanupMode: "supervised-reviewed" };
  const result = {
    schemaVersion: 1 as const, protocol: "single-tenant-supervised-workload" as const,
    stackName: old.stackName, accountId: old.accountId, region: old.region,
    clientRequestToken: old.clientRequestToken, onFailure: old.onFailure, capabilities: old.capabilities,
    template, templateBody, templateSha256: await sha256Hex(template),
    parameters: Object.fromEntries(Object.entries(old.parameters).filter(([key]) => !removed.includes(key))),
    requiredExternalParameters: old.requiredExternalParameters.filter(key => !removed.includes(key)),
    tags,
    resourceInventory: Object.entries(resources).map(([logicalId, resource]) => ({ logicalId, type: resource.Type })),
    safety: { renderOnly: true, executionAuthorized: false, runtimeEnabled: false, callsAws: false,
      createsDatabaseResources: false, automaticCleanupInstalled: false, supervisedExactArnCleanupRequired: true,
      fixedTaskCount: 1, capacityProvider: "FARGATE", ownershipChecksRetained: true,
      existingWorkerRendererUnchanged: true, appReadyNotYetVerified: true },
  };
  renderedWorkloads.set(result, canonicalJson(result));
  return result;
}
