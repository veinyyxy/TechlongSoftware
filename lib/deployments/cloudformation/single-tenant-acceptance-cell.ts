import { AWS_SANDBOX_MONTHLY_BUDGET_CENTS } from "../environment.ts";
import {
  renderAwsSandboxSharedCellStack,
  type AwsSandboxSharedCellStackInput,
} from "./shared-cell-stack.ts";
import { canonicalJson, sha256Hex } from "../execution/hash.ts";

export type SingleTenantAcceptanceCellInput = Omit<
  AwsSandboxSharedCellStackInput,
  "cellJanitorFunctionArn" | "cellSchedulerInvokeRoleArn" | "cellSchedulerGroupName"
>;

const removedParameters = [
  "CellJanitorFunctionArn", "CellSchedulerInvokeRoleArn", "CellSchedulerGroupName", "CleanupAt",
] as const;

const renderedCells = new WeakMap<object, string>();
export function assertSingleTenantCellRender(value: object): void {
  if (!renderedCells.has(value) || renderedCells.get(value) !== canonicalJson(value)) {
    throw Error("SINGLE_TENANT_CELL_RENDER_CHANGED_OR_UNRECOGNIZED");
  }
}

/** A separate infrastructure candidate, not a live root or an authority brand.
 * Reuses the existing infrastructure without installing the old PLAN_ONLY
 * schedule or the deferred F3c9 parent protocol. Execution requires a separately
 * reviewed supervised cleanup procedure; deadline tags do not delete resources.
 */
export async function renderSingleTenantAcceptanceCell(raw: SingleTenantAcceptanceCellInput) {
  const input = structuredClone(raw);
  if (input.environment.applyEnabled !== false ||
    input.environment.policy.budgetLimitCents !== AWS_SANDBOX_MONTHLY_BUDGET_CENTS ||
    input.environment.policy.maxTaskCount !== 1 || input.environment.baseDomain !== "sandbox.techlong.cloud") {
    throw Error("SINGLE_TENANT_ACCEPTANCE_SCOPE_INVALID");
  }
  // These fixed historical coordinates are required only by the original pure
  // renderer. Its schedule and all references to these coordinates are removed.
  const original = renderAwsSandboxSharedCellStack({
    ...input,
    cellJanitorFunctionArn: "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
    cellSchedulerInvokeRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole",
    cellSchedulerGroupName: "techlong-sandbox-cell",
  });
  const template = structuredClone(original.template);
  const resources = template.Resources as Record<string, Record<string, unknown>>;
  const parameters = template.Parameters as Record<string, unknown>;
  if (Object.keys(resources).length !== 26 || resources.CellCleanupSchedule?.Type !== "AWS::Scheduler::Schedule") {
    throw Error("SINGLE_TENANT_ACCEPTANCE_BASE_TEMPLATE_DRIFT");
  }
  delete resources.CellCleanupSchedule;
  for (const name of removedParameters) delete parameters[name];
  const tags = { ...original.tags, DeliveryTrack: "single-tenant-acceptance", CleanupMode: "supervised-reviewed" };
  for (const resource of Object.values(resources)) {
    if (!Array.isArray(resource.DependsOn) || !resource.DependsOn.includes("CellCleanupSchedule")) {
      throw Error("SINGLE_TENANT_ACCEPTANCE_BASE_TEMPLATE_DRIFT");
    }
    const dependencies = resource.DependsOn.filter(id => id !== "CellCleanupSchedule");
    if (dependencies.length) resource.DependsOn = dependencies;
    else delete resource.DependsOn;
    const properties = resource.Properties as Record<string, unknown>;
    if (Array.isArray(properties.Tags)) {
      properties.Tags = [...properties.Tags,
        { Key: "DeliveryTrack", Value: tags.DeliveryTrack },
        { Key: "CleanupMode", Value: tags.CleanupMode },
      ];
    }
  }
  template.Description = "Single-tenant supervised acceptance infrastructure candidate; separate paid deployment and exact-resource cleanup approval required.";
  template.Metadata = {
    DeliveryTrack: tags.DeliveryTrack,
    CleanupMode: tags.CleanupMode,
    DeadlineDoesNotInstallAutomaticDeletion: true,
    F3c9ParentProtocolNotSelected: true,
  };
  const templateBody = canonicalJson(template);
  if (removedParameters.some(name => templateBody.includes(name)) ||
    templateBody.includes("delete_shared_cell_stack") ||
    Object.values(resources).some(resource =>
      typeof resource.Type !== "string" || /^(AWS::(?:IAM|Lambda|Scheduler)::|Custom::)/.test(resource.Type))) {
    throw Error("SINGLE_TENANT_ACCEPTANCE_DEFERRED_CONTROL_REFERENCE");
  }
  const result = {
    schemaVersion: 1 as const,
    protocol: "single-tenant-supervised-acceptance" as const,
    stackName: original.stackName,
    accountId: original.accountId,
    region: original.region,
    template, templateBody, templateSha256: await sha256Hex(template),
    parameters: Object.fromEntries(Object.entries(original.parameters).filter(([name]) =>
      !(removedParameters as readonly string[]).includes(name))),
    tags,
    resourceInventory: Object.entries(resources).map(([logicalId, resource]) => ({ logicalId, type: resource.Type as string })),
    reviewDeadline: original.tags.ExpiresAt,
    safety: {
      renderOnly: true, callsAws: false, executionAuthorized: false, runtimeEnabled: false,
      createsChargeableResourcesIfExecuted: true, automaticCleanupInstalled: false,
      supervisedExactArnCleanupMustBeReviewedBeforeCreate: true,
      liveInventoryAndPermissionsStillRequired: true, appServiceAndTaskDefinitionIncluded: false,
      f3c9ParentOrLegacyAuthorityIssued: false,
      maxCells: 1, maxTenants: 1, maxAcu: 1, monthlyBudgetTargetUsd: 50, monthlyBudgetIsHardCap: false,
    },
  };
  renderedCells.set(result, canonicalJson(result));
  return result;
}
