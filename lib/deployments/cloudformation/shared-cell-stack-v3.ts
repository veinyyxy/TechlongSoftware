import { canonicalJson, sha256Hex } from "../execution/hash.ts";
import { renderAwsSandboxSharedCellStack, type AwsSandboxSharedCellStackInput } from "./shared-cell-stack.ts";

type Json = Record<string, unknown>;
const plans = new WeakSet<object>();
export const CELL_V3_PHASES = Object.freeze(["RESERVED", "ARMED", "PAID"] as const);
export type CellV3Phase = typeof CELL_V3_PHASES[number];
export const CELL_LIFECYCLE_COORDINATOR_V3 = "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3";
export const CELL_LIFECYCLE_SCHEDULER_ROLE_V3 = "arn:aws:iam::402010193138:role/TechlongSandboxCellLifecycleSchedulerInvokeRoleV3";
export const CELL_V3_CFN_ROLE = "arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole";
export interface CellStackInputV3 {
  base: Omit<AwsSandboxSharedCellStackInput, "cellJanitorFunctionArn" | "cellSchedulerInvokeRoleArn" | "cellSchedulerGroupName">;
  ownerDeploymentId: string; generation: number; provisionEpoch: number; launchNonce: string;
}
export function cellV3Fail(code: string): never { throw Error(code); }
export function cellV3Freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(cellV3Freeze); Object.freeze(v); } return v; }
export function cellV3Exact(v: unknown, keys: string[]) { return !!v && typeof v === "object" && !Array.isArray(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...keys].sort()); }
export function cellV3Clock(n: number) { if (!Number.isSafeInteger(n) || n <= 0) cellV3Fail("CELL_V3_CLOCK_INVALID"); return n; }
export function assertCellV3ForwardPhase(from: CellV3Phase, to: CellV3Phase) {
  if ((from === "RESERVED" && to === "ARMED") || (from === "ARMED" && to === "PAID")) return;
  cellV3Fail("CELL_V3_PHASE_TRANSITION_FORBIDDEN");
}
/** Complete resource blueprint, not an apply capability. Old renderer is used
 * only to reuse immutable infrastructure choices; its cleanup object is removed. */
export async function renderAwsSandboxSharedCellStackV3(raw: CellStackInputV3) {
  const input = cellV3Freeze(structuredClone(raw));
  if (!cellV3Exact(input, ["base", "ownerDeploymentId", "generation", "provisionEpoch", "launchNonce"]) ||
    !cellV3Exact(input.base, ["environment", "requestedAt", "availabilityZones", "certificateArn", "controlTrustStoreArn"]) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(input.ownerDeploymentId) || !/^[a-f0-9]{32}$/.test(input.launchNonce) ||
    !Number.isSafeInteger(input.generation) || input.generation < 1 || !Number.isSafeInteger(input.provisionEpoch) || input.provisionEpoch < 1 ||
    input.base.environment.policy.budgetLimitCents !== 5000 || input.base.environment.applyEnabled !== false) cellV3Fail("CELL_V3_RENDER_INPUT_INVALID");
  cellV3Clock(input.base.requestedAt);
  const old = renderAwsSandboxSharedCellStack({ ...input.base,
    cellJanitorFunctionArn: "arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-janitor",
    cellSchedulerInvokeRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellSchedulerInvokeRole", cellSchedulerGroupName: "techlong-sandbox-cell" });
  const intent = cellV3Freeze({ schemaVersion: 3 as const, protocol: "cell-birth-intent-v3" as const, input,
    stackName: old.stackName, cellExpiresAt: old.tags.ExpiresAt, cleanupDelegationNotAfter: new Date(Date.parse(old.tags.ExpiresAt) + 3600000).toISOString(),
    coordinatorFunctionArn: CELL_LIFECYCLE_COORDINATOR_V3, schedulerInvokeRoleArn: CELL_LIFECYCLE_SCHEDULER_ROLE_V3,
    requiresFreshExplicitBirthAndCleanupDelegationApproval: true, doesNotAuthorizeNewGenerationOrSlotReset: true });
  const birthIntentSha256 = await sha256Hex(intent), template = structuredClone(old.template) as Json;
  const parameters = template.Parameters as Json, resources = template.Resources as Record<string, Json>, outputs = template.Outputs as Record<string, Json>;
  for (const k of ["CellJanitorFunctionArn", "CellSchedulerInvokeRoleArn", "CellSchedulerGroupName"]) delete parameters[k];
  parameters.LifecyclePhase = { Type: "String", Default: "RESERVED", AllowedValues: [...CELL_V3_PHASES] };
  template.Conditions = { HasLifecycleSchedule: { "Fn::Not": [{ "Fn::Equals": [{ Ref: "LifecyclePhase" }, "RESERVED"] }] },
    HasPaidCellResources: { "Fn::Equals": [{ Ref: "LifecyclePhase" }, "PAID"] } };
  template.Description = "Review-only v3 Cell: reserve identity, arm approved cleanup, then separately approved paid resources. No IAM or runtime activation.";
  template.Metadata = { CellLifecycleProtocol: "cell-birth-intent-v3", BirthIntentSha256: birthIntentSha256 };
  delete resources.CellCleanupSchedule;
  for (const r of Object.values(resources)) {
    r.Condition = "HasPaidCellResources";
    if (!Array.isArray(r.DependsOn) || !r.DependsOn.includes("CellCleanupSchedule")) cellV3Fail("CELL_V3_BASE_RESOURCE_DEPENDENCY_DRIFT");
    r.DependsOn = r.DependsOn.map(d => d === "CellCleanupSchedule" ? "CellLifecycleScheduleV3" : d);
  }
  resources.CellLifecycleScheduleV3 = { Type: "AWS::Scheduler::Schedule", Condition: "HasLifecycleSchedule", Properties: {
    Name: "techlong-sandbox-cell-sandbox-1-lifecycle-v3", GroupName: "techlong-sandbox-cell", State: "ENABLED", ActionAfterCompletion: "NONE",
    FlexibleTimeWindow: { Mode: "OFF" }, ScheduleExpression: { "Fn::Sub": "at(${CleanupAt})" }, ScheduleExpressionTimezone: "UTC",
    Target: { Arn: CELL_LIFECYCLE_COORDINATOR_V3, RoleArn: CELL_LIFECYCLE_SCHEDULER_ROLE_V3, RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 },
      Input: { "Fn::Sub": canonicalJson({ schemaVersion: 3, action: "reconcile_approved_cell_birth_v3", birthIntentSha256, stackId: "${AWS::StackId}" }) } } } };
  for (const [name, o] of Object.entries(outputs)) if (name !== "CellExpiresAt") o.Condition = "HasPaidCellResources";
  outputs.BirthIntentSha256 = { Value: birthIntentSha256 };
  const shared = { ...Object.fromEntries(Object.entries(old.parameters).filter(([k]) => !["CellJanitorFunctionArn", "CellSchedulerInvokeRoleArn", "CellSchedulerGroupName"].includes(k))),
    CleanupAt: new Date(Math.ceil(Date.parse(old.tags.ExpiresAt) / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "") };
  const phaseParameters: Record<CellV3Phase, Record<string, string>> = {
    RESERVED: { ...shared, LifecyclePhase: "RESERVED" }, ARMED: { ...shared, LifecyclePhase: "ARMED" }, PAID: { ...shared, LifecyclePhase: "PAID" },
  };
  const material = { schemaVersion: 3 as const, protocol: "shared-cell-stack-v3" as const, intent, birthIntentSha256, stackName: old.stackName,
    accountId: old.accountId, region: old.region, template, templateBody: canonicalJson(template), templateCanonicalSha256: await sha256Hex(template),
    phaseParameters, tags: old.tags, resourceLogicalIds: Object.keys(resources).sort(), reservationClientToken: `cell-v3-reserve-${birthIntentSha256}` };
  const plan = cellV3Freeze({ ...material, planSha256: await sha256Hex(material), safety: { renderOnly: true, applyReady: false, callsAws: false,
    currentPhase: "RESERVED", reservedResourceCount: 0, armedResourceCount: 1, cleanupScheduleFirst: true, automaticCleanupDelegationInstalled: false,
    noPhaseRegressionOrPaidToReservedUpdate: true, cfnCannotPreventExternalManualPhaseRegression: true,
    lambdaAsyncDeliveryAndDuplicateExecutionNotProved: true, paidResourcesRequireSeparateFreshApproval: true, maxCells: 1, maxTenants: 1,
    cellTtlSeconds: 10800, tenantTtlSeconds: 7200, cleanupBufferSeconds: 900, natGateways: 0, interfaceEndpoints: 0, maxAcu: 1 } });
  plans.add(plan); return plan;
}
export type CellStackPlanV3 = Awaited<ReturnType<typeof renderAwsSandboxSharedCellStackV3>>;
export function assertCellStackPlanV3(v: CellStackPlanV3) { if (!plans.has(v)) cellV3Fail("CELL_V3_PLAN_PROVENANCE_INVALID"); }
/** Reload verifies the entire deterministic plan, not only a caller's hash. */
export async function decodeCellStackPlanV3(v: CellStackPlanV3) {
  const expected = await renderAwsSandboxSharedCellStackV3(v.intent?.input);
  if (canonicalJson(v) !== canonicalJson(expected)) cellV3Fail("CELL_V3_SERIALIZED_PLAN_DRIFT"); return expected;
}
