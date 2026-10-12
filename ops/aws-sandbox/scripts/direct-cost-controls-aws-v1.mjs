import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { DynamoDBClient, DescribeTableCommand, UpdateTableCommand } from "@aws-sdk/client-dynamodb";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { DIRECT_COST_SCOPE_V1 as s, assertDirectApprovalV1, assertDirectFreshV1, assertDirectPhaseV1 } from "../../../lib/deployments/execution/direct-cost-controls-v1.ts";
import { createCostRecoveryRuntimeV1 } from "./cost-stack-recovery-aws-v1.mjs";
const cfg = { region: s.region, maxAttempts: 1, ignoreConfiguredEndpointUrls: true }, exec = promisify(execFile);
const equal = (a, b) => canonicalJson(a) === canonicalJson(b), fail = code => { throw Error(code); }, sleep = ms => new Promise(r => setTimeout(r, ms));
export function createDirectCostRuntimeV1(recovery, originalSlot, recoverySlot, slot, verifyHistory) {
  // Borrow only snapshots. No CloudFormation mutator is called or exposed here.
  const recoveredReads = createCostRecoveryRuntimeV1(recovery.originalManifest, originalSlot, recoverySlot, verifyHistory);
  const provider = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  const session = async () => {
    const credentials = await provider(), c = new STSClient({ ...cfg, credentials });
    try { const id = await c.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
      if (id.Account !== s.accountId || id.Arn !== s.sourceArn || id.UserId !== s.sourceUserId) fail("DIRECT_COST_SOURCE_INVALID"); return credentials;
    } finally { c.destroy(); }
  };
  const withClient = async (Type, fn) => { const c = new Type({ ...cfg, credentials: await session() }); try { return await fn(c); } finally { c.destroy(); } };
  const send = (c, x) => c.send(x, { abortSignal: AbortSignal.timeout(15000) });
  const permissions = () => withClient(IAMClient, async c => {
    const checks = [];
    for (const [action, resource, region] of [["budgets:ModifyBudget", s.budgetArn, s.budgetRegion], ["dynamodb:UpdateTable", s.tableArn, s.region]]) {
      const r = await send(c, new SimulatePrincipalPolicyCommand({ PolicySourceArn: s.sourceArn, ActionNames: [action], ResourceArns: [resource], ContextEntries: [{ ContextKeyName: "aws:RequestedRegion", ContextKeyType: "string", ContextKeyValues: [region] }] }));
      if (r.IsTruncated || r.Marker || r.EvaluationResults?.length !== 1) fail("DIRECT_COST_PERMISSION_UNVERIFIED"); checks.push({ action, resource, decision: r.EvaluationResults[0].EvalDecision });
    }
    return checks;
  });
  const snapshot = async checkPermissions => {
    const v = await recoveredReads.snapshot(false), permissionChecks = checkPermissions ? await permissions() : [];
    assertDirectFreshV1(v.observedAt, Date.now());
    return { ...v, permissionChecks, permissionsAllowed: checkPermissions && permissionChecks.length === 2 && permissionChecks.every(p => p.decision === "allowed") };
  };
  const bound = async m => { await verifyHistory(); if (!equal(JSON.parse(await readFile(path.join(slot, "approved-manifest.json"), "utf8")), m)) fail("DIRECT_COST_SLOT_MANIFEST_DRIFT"); };
  const nativeBudget = async (kind, m, v) => {
    if (!["update-budget", "describe-budget"].includes(kind)) fail("DIRECT_COST_BUDGET_COMMAND_REJECTED");
    const credentials = await session();
    const args = kind === "update-budget" ? ["--cli-input-json", JSON.stringify(m.budgetRequest)] : ["--account-id", s.accountId, "--budget-name", s.budgetName];
    if (kind === "update-budget") { assertDirectApprovalV1(m, m.manifestSha256, Date.now()); assertDirectFreshV1(v.observedAt, Date.now()); assertDirectFreshV1(v.inventory.observedAt, Date.now()); }
    try { const r = await exec("aws", ["budgets", kind, ...args, "--region", s.budgetRegion, "--no-cli-pager", "--no-paginate", "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "20"],
      { windowsHide: true, timeout: 30000, maxBuffer: 2000000, env: { ...process.env, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey, AWS_SESSION_TOKEN: credentials.sessionToken,
        AWS_MAX_ATTEMPTS: "1", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" } });
      return r.stdout.trim() ? JSON.parse(r.stdout) : {};
    } catch { fail(kind === "update-budget" ? "DIRECT_COST_BUDGET_API_RESULT_UNVERIFIED" : "DIRECT_COST_BUDGET_READ_UNVERIFIED"); }
  };
  const updateBudgetOnce = async m => {
    await bound(m); const v = await snapshot(true); if (!v.permissionsAllowed) fail("DIRECT_COST_PERMISSIONS_UNVERIFIED"); assertDirectPhaseV1(m, v, "before");
    await nativeBudget("update-budget", m, v);
  };
  const waitBudget = async m => {
    for (let n = 0; n < 10; n++) {
      const r = await nativeBudget("describe-budget"), b = r.Budget;
      if (!b || b.BudgetName !== s.budgetName || !b.BudgetLimit || ![10, 50].includes(Number(b.BudgetLimit.Amount))) fail("DIRECT_COST_BUDGET_WAIT_DRIFT");
      if (Number(b.BudgetLimit.Amount) === 50 && b.BudgetLimit.Unit === "USD" &&
        equal({ Start: new Date(b.TimePeriod.Start).toISOString(), End: new Date(b.TimePeriod.End).toISOString() }, m.before.budget.config.TimePeriod)) return;
      await sleep(1000);
    }
    fail("DIRECT_COST_BUDGET_PENDING_INSPECT_ONLY");
  };
  const updateTableOnce = async m => {
    await bound(m); const v = await snapshot(true); if (!v.permissionsAllowed) fail("DIRECT_COST_PERMISSIONS_UNVERIFIED"); assertDirectPhaseV1(m, v, "budget");
    await withClient(DynamoDBClient, async c => {
      assertDirectApprovalV1(m, m.manifestSha256, Date.now()); assertDirectFreshV1(v.observedAt, Date.now()); assertDirectFreshV1(v.inventory.observedAt, Date.now());
      const r = await send(c, new UpdateTableCommand(m.tableRequest));
      if (r.TableDescription?.TableId !== s.tableId || r.TableDescription?.TableArn !== s.tableArn) fail("DIRECT_COST_TABLE_RESPONSE_UNVERIFIED");
    });
  };
  const waitTable = async () => {
    for (let n = 0; n < 15; n++) {
      const status = await withClient(DynamoDBClient, async c => { const r = await send(c, new DescribeTableCommand({ TableName: s.tableName }));
        if (r.Table?.TableId !== s.tableId || r.Table?.TableArn !== s.tableArn) fail("DIRECT_COST_TABLE_IDENTITY_UNVERIFIED"); return r.Table.TableStatus; });
      if (status === "ACTIVE") return; if (status !== "UPDATING") fail("DIRECT_COST_TABLE_NOT_READY"); await sleep(2000);
    }
    fail("DIRECT_COST_TABLE_PENDING_INSPECT_ONLY");
  };
  const inspect = async m => {
    await waitTable(); const v = await snapshot(false); let targetVerified = false;
    try { assertDirectPhaseV1(m, v, "complete"); targetVerified = true; } catch {}
    return { observedAt: Date.now(), targetVerified, stackStatus: v.inventory.stackStatus, stackMonthlyBudgetUsd: Number(v.inventory.settings.stack.parameters.MonthlyBudgetUsd), stackTemplateSha256: v.inventory.settings.stack.templateSha256,
      actualBudgetUsd: Number(v.inventory.settings.budget.config.BudgetLimit.Amount), budgetTimePeriod: v.inventory.settings.budget.config.TimePeriod,
      maxReadUnits: v.inventory.settings.table.maxRead, maxWriteUnits: v.inventory.settings.table.maxWrite, tableId: v.inventory.settings.table.id, tableStatus: v.inventory.tableStatus,
      settingsSha256: await sha256Hex(v.inventory.settings), notificationsAndSubscribersSha256: await sha256Hex(v.inventory.settings.budget.notifications), trackedChangeSets: v.changeSets, latestStackEvent: v.latestStackEvent,
      approvedSettingsExceptBudgetAmountAndReadLimitPreserved: targetVerified, cfnAmountDriftExpected: true,
      cfnAmountDriftObserved: Number(v.inventory.settings.budget.config.BudgetLimit.Amount) !== Number(v.inventory.settings.stack.parameters.MonthlyBudgetUsd),
      noCfnCloudDriftDetectionPerformed: true, writes: 0, retryAuthorized: false, runtimeEnabled: false, paidCellCreated: false };
  };
  return Object.freeze({ snapshot, updateBudgetOnce, waitBudget, updateTableOnce, waitTable, inspect });
}
