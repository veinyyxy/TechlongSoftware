import { canonicalJson, sha256Hex } from "./hash.ts";
import { assertCellStackPlanV3, cellV3Clock, type CellStackPlanV3 } from "../cloudformation/shared-cell-stack-v3.ts";
import { RESERVED_RETIREMENT_RECOVERY_V7 as t } from "./cell-reserved-retirement-recovery-v7.ts";

type Json = Record<string, unknown>;
const fail = (code: string): never => { throw Error(`DELETED_INSPECT_${code}`); };
const eq = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function map(raw: unknown, key: string, value: string): Record<string, string> {
  if (!Array.isArray(raw)) return fail("STACK_MAP_INVALID"); const out: Record<string, string> = {};
  for (const row of raw) {
    if (!row || typeof row !== "object" || typeof row[key] !== "string" || typeof row[value] !== "string" || Object.hasOwn(out, row[key])) fail("STACK_MAP_INVALID");
    out[row[key]] = row[value];
  }
  return out;
}
/** Only DELETE_COMPLETE may omit the optional protection field, and only with
 * a bound pre-delete false proof. This is not normalization for a live stack,
 * not a claim that missing means false, and not write/cleanup authority. */
export async function inspectDeletedIdentityFrameV8(plan: CellStackPlanV3, before: Json, after: Json, template: unknown,
  resources: unknown[], events: Json[], requestToken: string, attemptedAt: number, now: number) {
  assertCellStackPlanV3(plan); cellV3Clock(now); cellV3Clock(attemptedAt);
  if (plan.birthIntentSha256 !== t.birthIntentSha256 || !/^cell-v7-retire-[a-f0-9]{64}$/.test(requestToken) || attemptedAt > now ||
    before.StackStatus !== "CREATE_COMPLETE" || before.EnableTerminationProtection !== false || before.DeletionTime ||
    after.StackStatus !== "DELETE_COMPLETE" || (after.EnableTerminationProtection !== undefined && after.EnableTerminationProtection !== false) ||
    (after.DeletionMode !== undefined && after.DeletionMode !== "STANDARD")) fail("EXACT_DELETED_TERMINAL_AND_PRE_FALSE_REQUIRED");
  const binding = async (s: Json) => {
    if (s.StackId !== t.stackId || s.StackName !== t.stackName || s.RoleARN !== t.roleArn || s.DisableRollback !== true || s.ParentId || s.RootId || s.LastUpdatedTime ||
      !eq(map(s.Parameters, "ParameterKey", "ParameterValue"), plan.phaseParameters.RESERVED) || !eq(map(s.Tags, "Key", "Value"), plan.tags) ||
      !eq(map(s.Outputs ?? [], "OutputKey", "OutputValue"), { BirthIntentSha256: plan.birthIntentSha256, CellExpiresAt: plan.intent.cellExpiresAt })) fail("STACK_BINDING_DRIFT");
    const stable = { id: s.StackId, name: s.StackName, status: "CREATE_COMPLETE", phase: "RESERVED", parameters: map(s.Parameters, "ParameterKey", "ParameterValue"),
      tags: map(s.Tags, "Key", "Value"), outputs: map(s.Outputs ?? [], "OutputKey", "OutputValue"), role: s.RoleARN,
      createdAt: new Date(s.CreationTime as string).toISOString(), updatedAt: null, disableRollback: true };
    if (await sha256Hex(stable) !== t.stableStackSha256) fail("ORIGINAL_STACK_HASH_DRIFT");
  };
  await binding(before); await binding(after);
  const body = typeof template === "string" ? JSON.parse(template) : template;
  if (!eq(body, plan.template) || !Array.isArray(resources) || resources.length || !Array.isArray(events) || !events.length ||
    events.some(e => !e || typeof e.EventId !== "string") || new Set(events.map(e => e.EventId)).size !== events.length) fail("TEMPLATE_RESOURCE_OR_EVENT_DRIFT");
  const created = new Set<string>(), deleted = new Map<string, number>();
  for (const e of events) {
    const timestamp = new Date(e.Timestamp as string).getTime();
    if (e.StackId !== t.stackId || e.StackName !== t.stackName || e.PhysicalResourceId !== t.stackId || e.LogicalResourceId !== t.stackName ||
      e.ResourceType !== "AWS::CloudFormation::Stack" || !Number.isFinite(timestamp) || timestamp < plan.intent.input.base.requestedAt || timestamp > now) fail("UNEXPECTED_EVENT");
    const status = String(e.ResourceStatus);
    if (["CREATE_IN_PROGRESS", "CREATE_COMPLETE"].includes(status)) {
      if (e.ClientRequestToken !== plan.reservationClientToken) fail("BIRTH_TOKEN_DRIFT"); created.add(status);
    } else if (["DELETE_IN_PROGRESS", "DELETE_COMPLETE"].includes(status)) {
      if (e.ClientRequestToken !== requestToken || timestamp < attemptedAt || deleted.has(status)) fail("DELETE_TOKEN_OR_EVENT_DRIFT"); deleted.set(status, timestamp);
    } else fail("NON_BIRTH_OR_DELETE_EVENT");
  }
  if (!created.has("CREATE_IN_PROGRESS") || !created.has("CREATE_COMPLETE") || !deleted.has("DELETE_IN_PROGRESS") || !deleted.has("DELETE_COMPLETE") ||
    deleted.get("DELETE_COMPLETE")! < deleted.get("DELETE_IN_PROGRESS")!) fail("BIRTH_AND_DELETION_EVENTS_REQUIRED");
  const deletionTime = new Date(after.DeletionTime as string).getTime();
  if (!Number.isFinite(deletionTime) || deletionTime < attemptedAt || deletionTime > now) fail("DELETION_TIME_DRIFT");
  return { stackId: t.stackId, stackStatus: "DELETE_COMPLETE", originalStableStackSha256: t.stableStackSha256, templateCanonicalSha256: await sha256Hex(body), resourceCount: 0,
    deletionTime: new Date(deletionTime).toISOString(), birthEventsVerified: true, exactApprovedDeletionEventsVerified: true,
    terminationProtectionBeforeDelete: false, terminationProtectionPostDeleteObserved: after.EnableTerminationProtection === false ? false : null,
    terminationProtectionPostDeleteOmitted: after.EnableTerminationProtection === undefined, noMissingFieldConvertedToLiveFalse: true };
}
