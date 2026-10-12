import { readFile } from "node:fs/promises";
import path from "node:path";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, DescribeStackEventsCommand, DescribeStacksCommand, DescribeChangeSetCommand, RollbackStackCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as old } from "../../../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { COST_RECOVERY_SCOPE_V1 as s, assertRecoveryBeforeV1, assertRecoveryFreshV1, assertRecoveryApprovalV1, recoveryTokenV1, recoveryRestoredV1 } from "../../../lib/deployments/execution/cost-stack-recovery-v1.ts";
import { createCostControlsAwsRuntimeV1 } from "./sandbox-cost-controls-aws-v1.mjs";
const cfg = { region: s.region, ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
const equal = (a, b) => canonicalJson(a) === canonicalJson(b), fail = code => { throw Error(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function createCostRecoveryRuntimeV1(original, originalSlot, slot, verifyHistory) {
  const reads = createCostControlsAwsRuntimeV1(originalSlot), provider = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  const session = async () => {
    const credentials = await provider(), c = new STSClient({ ...cfg, credentials });
    try { const id = await c.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
      if (id.Account !== s.accountId || id.Arn !== s.sourceArn || id.UserId !== s.sourceUserId) fail("COST_RECOVERY_SOURCE_INVALID"); return credentials;
    } finally { c.destroy(); }
  };
  const withClient = async (Type, fn) => { const c = new Type({ ...cfg, credentials: await session() }); try { return await fn(c); } finally { c.destroy(); } };
  const send = (c, x) => c.send(x, { abortSignal: AbortSignal.timeout(15000) });
  const permissions = () => withClient(IAMClient, async c => {
    const checks = [];
    for (const [action, resource, region] of [["cloudformation:RollbackStack", s.stackId, s.region], ["budgets:ModifyBudget", `arn:aws:budgets::${s.accountId}:budget/${old.budgetName}`, "us-east-1"]]) {
      const r = await send(c, new SimulatePrincipalPolicyCommand({ PolicySourceArn: s.sourceArn, ActionNames: [action], ResourceArns: [resource], ContextEntries: [{ ContextKeyName: "aws:RequestedRegion", ContextKeyValues: [region], ContextKeyType: "string" }] }));
      if (r.IsTruncated || r.Marker || r.EvaluationResults?.length !== 1) fail("COST_RECOVERY_PERMISSION_UNVERIFIED");
      checks.push({ action, resource, decision: r.EvaluationResults[0].EvalDecision });
    }
    return checks;
  });
  const snapshot = async checkPermissions => {
    await verifyHistory(); const observedAt = Date.now(), inventory = await reads.inventory(false);
    const extra = await withClient(CloudFormationClient, async c => {
      const stack = await send(c, new DescribeStacksCommand({ StackName: s.stackId })), events = await send(c, new DescribeStackEventsCommand({ StackName: s.stackId }));
      if (stack.Stacks?.length !== 1 || stack.Stacks[0].StackId !== s.stackId || stack.Stacks[0].StackStatus !== inventory.stackStatus || events.NextToken || !Array.isArray(events.StackEvents)) fail("COST_RECOVERY_STACK_READ_UNVERIFIED");
      const rootEvents = events.StackEvents.filter(e => e.LogicalResourceId === old.stackName && e.PhysicalResourceId === s.stackId && e.ResourceType === "AWS::CloudFormation::Stack");
      const stackEvents = rootEvents.map(e => ({ id: e.EventId, at: new Date(e.Timestamp).toISOString(), status: e.ResourceStatus, token: e.ClientRequestToken ?? null }));
      const changeSets = [];
      for (const id of s.trackedChangeSetIds) {
        try { const r = await send(c, new DescribeChangeSetCommand({ StackName: s.stackId, ChangeSetName: id }));
          if (r.ChangeSetId !== id || r.StackId !== s.stackId || r.NextToken || r.IncludeNestedStacks) fail("COST_RECOVERY_CHANGESET_IDENTITY_DRIFT");
          changeSets.push({ id, present: true, status: r.Status, executionStatus: r.ExecutionStatus });
        } catch (e) { if (["ValidationError", "ChangeSetNotFound"].includes(e.name) && /does not exist|not found/i.test(e.message ?? "")) changeSets.push({ id, present: false, status: null, executionStatus: null }); else throw e; }
      }
      return { disableRollback: stack.Stacks[0].DisableRollback, stableEvent: stackEvents.find(e => e.status.endsWith("_COMPLETE")) ?? null,
        latestStackEvent: stackEvents[0] ?? null, stackEvents, changeSets };
    });
    const permissionChecks = checkPermissions ? await permissions() : [];
    assertRecoveryFreshV1(observedAt, Date.now());
    return { observedAt, inventory, ...extra, permissionChecks, permissionsAllowed: checkPermissions && permissionChecks.length === 2 && permissionChecks.every(p => p.decision === "allowed") };
  };
  const rollbackOnce = async m => {
    await verifyHistory(); if (!equal(JSON.parse(await readFile(path.join(slot, "approved-manifest.json"), "utf8")), m)) fail("COST_RECOVERY_SLOT_MANIFEST_DRIFT");
    const v = await snapshot(true); assertRecoveryBeforeV1(original, v, Date.now());
    return withClient(CloudFormationClient, async c => {
      assertRecoveryApprovalV1(m, m.manifestSha256, Date.now()); assertRecoveryFreshV1(v.observedAt, Date.now()); assertRecoveryFreshV1(v.inventory.observedAt, Date.now());
      const r = await send(c, new RollbackStackCommand({ ...m.request, ClientRequestToken: recoveryTokenV1(m) }));
      if (r.StackId !== s.stackId) fail("COST_RECOVERY_RESPONSE_IDENTITY_UNVERIFIED");
      return { stackId: r.StackId, operationId: r.OperationId ?? null };
    });
  };
  const waitRestored = async () => {
    for (let n = 0; n < 20; n++) {
      const status = await withClient(CloudFormationClient, async c => { const r = await send(c, new DescribeStacksCommand({ StackName: s.stackId })); if (r.Stacks?.length !== 1 || r.Stacks[0].StackId !== s.stackId) fail("COST_RECOVERY_STACK_IDENTITY_UNVERIFIED"); return r.Stacks[0].StackStatus; });
      if (["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(status)) return;
      if (!["UPDATE_FAILED", "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS"].includes(status)) fail("COST_RECOVERY_STACK_RESTORATION_FAILED");
      await sleep(3000);
    }
    fail("COST_RECOVERY_STACK_PENDING_INSPECT_ONLY");
  };
  const inspect = async m => {
    const v = await snapshot(false); return { observedAt: Date.now(), restorationVerified: recoveryRestoredV1(m, v), stackId: s.stackId, stackStatus: v.inventory.stackStatus,
      disableRollback: v.disableRollback, budgetUsd: Number(v.inventory.settings.budget.config.BudgetLimit.Amount), budgetTimePeriod: v.inventory.settings.budget.config.TimePeriod,
      maxReadUnits: v.inventory.settings.table.maxRead, maxWriteUnits: v.inventory.settings.table.maxWrite, tableId: v.inventory.settings.table.id, tableStatus: v.inventory.tableStatus,
      settingsSha256: await sha256Hex(v.inventory.settings), trackedChangeSets: v.changeSets, latestStackEvent: v.latestStackEvent, writes: 0,
      target50Read100Verified: false, directBudgetUpdateAuthorized: false, tableUpdateAuthorized: false, retryAuthorized: false, paidCellCreated: false, runtimeEnabled: false };
  };
  return Object.freeze({ snapshot, rollbackOnce, waitRestored, inspect });
}
