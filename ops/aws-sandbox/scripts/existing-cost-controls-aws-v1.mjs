import { readFile } from "node:fs/promises";
import path from "node:path";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, DescribeChangeSetCommand, GetTemplateCommand, DescribeStacksCommand, ExecuteChangeSetCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, UpdateTableCommand } from "@aws-sdk/client-dynamodb";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { COST_CONTROL_SCOPE_V1 as originalScope, assertCostProgressV1 } from "../../../lib/deployments/execution/sandbox-cost-controls-v1.ts";
import { EXISTING_COST_SCOPE_V1 as scope, normalizeExistingCostPlanV1, assertExistingCostSnapshotV1, assertExistingCostApprovalV1, assertExistingCostFreshV1 } from "../../../lib/deployments/execution/existing-cost-controls-v1.ts";
import { createCostControlsAwsRuntimeV1 } from "./sandbox-cost-controls-aws-v1.mjs";

const cfg = { region: originalScope.region, ignoreConfiguredEndpointUrls: true, maxAttempts: 1 };
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = code => { throw Error(code); }, sleep = ms => new Promise(r => setTimeout(r, ms));
export function createExistingCostRuntimeV1(original, originalSlot, slot, verifyHistory) {
  // Only read closures are borrowed; none of the consumed protocol's mutators are exposed or called.
  const originalReads = createCostControlsAwsRuntimeV1(originalSlot);
  const provider = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  const session = async () => {
    const credentials = await provider(), c = new STSClient({ ...cfg, credentials });
    try { const r = await c.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
      if (r.Account !== originalScope.accountId || r.Arn !== originalScope.sourceArn || r.UserId !== originalScope.sourceUserId) fail("EXISTING_COST_SOURCE_INVALID");
      return credentials;
    } finally { c.destroy(); }
  };
  const withClient = async (Type, fn) => { const c = new Type({ ...cfg, credentials: await session() }); try { return await fn(c); } finally { c.destroy(); } };
  const send = (c, cmd) => c.send(cmd, { abortSignal: AbortSignal.timeout(15000) });
  const inventory = () => originalReads.inventory(false);
  const permissions = () => withClient(IAMClient, async c => {
    const checks = [];
    for (const [action, resource, region] of [
      ["cloudformation:ExecuteChangeSet", originalScope.stackId, originalScope.region],
      ["budgets:ModifyBudget", `arn:aws:budgets::${originalScope.accountId}:budget/${originalScope.budgetName}`, "us-east-1"],
      ["dynamodb:UpdateTable", originalScope.tableArn, originalScope.region],
    ]) {
      const r = await send(c, new SimulatePrincipalPolicyCommand({ PolicySourceArn: originalScope.sourceArn, ActionNames: [action], ResourceArns: [resource],
        ContextEntries: [{ ContextKeyName: "aws:RequestedRegion", ContextKeyType: "string", ContextKeyValues: [region] }] }));
      if (r.IsTruncated || r.Marker || r.EvaluationResults?.length !== 1) fail("EXISTING_COST_PERMISSION_UNVERIFIED");
      checks.push({ action, resource, decision: r.EvaluationResults[0].EvalDecision });
    }
    return checks;
  });
  const snapshot = async () => {
    await verifyHistory(); const observedAt = Date.now();
    const reviewed = await withClient(CloudFormationClient, async c => {
      const raw = await send(c, new DescribeChangeSetCommand({ StackName: originalScope.stackId, ChangeSetName: scope.changeSetArn, IncludePropertyValues: true }));
      const t = await send(c, new GetTemplateCommand({ StackName: originalScope.stackId, ChangeSetName: scope.changeSetArn, TemplateStage: "Original" }));
      const preservedFailedChangeSets = [];
      for (const arn of originalScope.oldFailedChangeSetIds) {
        const r = await send(c, new DescribeChangeSetCommand({ StackName: originalScope.stackId, ChangeSetName: arn }));
        if (r.ChangeSetId !== arn || r.StackId !== originalScope.stackId || r.NextToken || r.Status !== "FAILED" || r.ExecutionStatus !== "UNAVAILABLE") fail("EXISTING_COST_OLD_RECORD_DRIFT");
        const copy = { ...r }; delete copy.$metadata; preservedFailedChangeSets.push(copy);
      }
      return { plan: normalizeExistingCostPlanV1(raw), template: typeof t.TemplateBody === "string" ? JSON.parse(t.TemplateBody) : t.TemplateBody, preservedFailedChangeSets };
    });
    const i = await inventory(), permissionChecks = await permissions();
    i.permissionsAllowed = permissionChecks.length === 3 && permissionChecks.every(p => p.decision === "allowed");
    assertExistingCostFreshV1(observedAt, Date.now());
    return { observedAt, inventory: i, ...reviewed, permissionChecks };
  };
  const bound = async m => {
    await verifyHistory();
    if (!equal(JSON.parse(await readFile(path.join(slot, "approved-manifest.json"), "utf8")), m)) fail("EXISTING_COST_SLOT_MANIFEST_DRIFT");
  };
  const executeOnce = async m => {
    await bound(m); const reviewedSnapshot = await snapshot(); await assertExistingCostSnapshotV1(m, reviewedSnapshot, Date.now());
    await withClient(CloudFormationClient, async c => {
      // Credential refresh and identity checks precede the final approval deadline test.
      assertExistingCostApprovalV1(m, m.manifestSha256, Date.now());
      assertExistingCostFreshV1(reviewedSnapshot.observedAt, Date.now());
      assertExistingCostFreshV1(reviewedSnapshot.inventory.observedAt, Date.now());
      await send(c, new ExecuteChangeSetCommand({ StackName: originalScope.stackId, ChangeSetName: scope.changeSetArn,
        ClientRequestToken: `f3c3b-execute-${m.manifestSha256}`, DisableRollback: true }));
    });
  };
  const waitBudget = async () => {
    for (let n = 0; n < 20; n++) {
      const ready = await withClient(CloudFormationClient, async c => {
        const r = await send(c, new DescribeStacksCommand({ StackName: originalScope.stackId }));
        const p = await send(c, new DescribeChangeSetCommand({ StackName: originalScope.stackId, ChangeSetName: scope.changeSetArn }));
        if (r.Stacks?.length !== 1 || r.Stacks[0].StackId !== originalScope.stackId || p.ChangeSetId !== scope.changeSetArn || p.StackId !== originalScope.stackId) fail("EXISTING_COST_STACK_IDENTITY_DRIFT");
        if (r.Stacks[0].StackStatus === "UPDATE_COMPLETE" && p.ExecutionStatus === "EXECUTE_COMPLETE") return true;
        if (!["CREATE_COMPLETE", "UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_COMPLETE"].includes(r.Stacks[0].StackStatus) || !["AVAILABLE", "EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE"].includes(p.ExecutionStatus)) fail("EXISTING_COST_BUDGET_UPDATE_UNVERIFIED");
        return false;
      });
      if (ready) return; await sleep(3000);
    }
    fail("EXISTING_COST_BUDGET_PENDING_INSPECT_ONLY");
  };
  const updateReadOnce = async m => {
    await bound(m); const i = await inventory(); assertExistingCostFreshV1(i.observedAt, Date.now());
    assertCostProgressV1(original, i, "budget", scope.changeSetArn);
    await withClient(DynamoDBClient, async c => {
      assertExistingCostApprovalV1(m, m.manifestSha256, Date.now());
      assertExistingCostFreshV1(i.observedAt, Date.now());
      const r = await send(c, new UpdateTableCommand({ TableName: originalScope.tableName, OnDemandThroughput: { MaxReadRequestUnits: 100, MaxWriteRequestUnits: 2 } }));
      if (r.TableDescription?.TableId !== originalScope.tableId || r.TableDescription?.TableArn !== originalScope.tableArn) fail("EXISTING_COST_TABLE_RESPONSE_UNVERIFIED");
    });
  };
  const inspect = async () => {
    await verifyHistory(); const r = await originalReads.inspect(original);
    return { ...r, beforeBoundConfigurationUnchangedVerified: r.settingsSha256 === await sha256Hex(original.before), originalConsumedSlotPreserved: true,
      reusedExactChangeSetArn: scope.changeSetArn, noAutomaticRollbackDeleteFillResetOrWriteRetry: true };
  };
  return Object.freeze({ snapshot, inventory, executeOnce, waitBudget, updateReadOnce, inspect });
}
