import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand, ListChangeSetsCommand, DeleteStackCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { RESERVED_RETIREMENT_RECOVERY_V7 as t, assertRecoveryCompleteReadV7, assertRecoveryLightFrameV7, assertRecoveryFinalReadV7,
  assertRecoveryApprovalV7 } from "../../../lib/deployments/execution/cell-reserved-retirement-recovery-v7.ts";
import { createReservedRetirementAwsV6 } from "./cell-reserved-retirement-aws-v6.mjs";

const cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const eq = (a, b) => canonicalJson(a) === canonicalJson(b), fail = code => { throw Error(`RECOVERY_${code}`); };
const map = (rows, key, value) => {
  if (!Array.isArray(rows)) fail("STACK_MAP_INVALID"); const result = {};
  for (const r of rows) { if (typeof r[key] !== "string" || typeof r[value] !== "string" || Object.hasOwn(result, r[key])) fail("STACK_MAP_INVALID"); result[r[key]] = r[value]; }
  return result;
};
export function createRetirementRecoveryAwsV7(original, reviewed, approvedSha, codeBindingSha256) {
  // The frozen factory is READ-ONLY here: no reviewed request capability is
  // supplied. The only recovery writer is the single native DeleteStack below.
  const frozenRead = createReservedRetirementAwsV6(original, undefined), credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg }),
    sts = new STSClient({ ...cfg, credentials }), cfn = new CloudFormationClient({ ...cfg, credentials });
  let entered = false, sdkDeleteSendEntered = false, fullCache, finalCache;
  const instrument = async (operation, action) => {
    try { return await action(); }
    catch (e) { if (e && typeof e === "object") e.recoveryOperation = operation; throw e; }
  };
  const call = (Command, input) => instrument(Command.name.replace(/Command$/, ""), () => cfn.send(new Command(input), { abortSignal: AbortSignal.timeout(10000) }));
  const identity = () => instrument("SourceIdentity", async () => {
    const r = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(10000) });
    if (r.Account !== "402010193138" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev") fail("SOURCE_IDENTITY_INVALID");
  });
  const pages = async (Command, field) => {
    const rows = [], seen = new Set(); let token;
    do {
      const r = await call(Command, { StackName: t.stackId, ...(token ? { NextToken: token } : {}) });
      if (!Array.isArray(r[field])) fail("PAGINATED_ROWS_INVALID"); rows.push(...r[field]);
      if (r.NextToken === undefined) token = undefined;
      else if (typeof r.NextToken !== "string" || !r.NextToken || seen.has(r.NextToken) || seen.size >= 99) fail("PAGINATION_INVALID");
      else { token = r.NextToken; seen.add(token); }
    } while (token);
    return rows;
  };
  const frame = async () => {
    const [r, template, resources, changes] = await Promise.all([call(DescribeStacksCommand, { StackName: t.stackId }),
      call(GetTemplateCommand, { StackName: t.stackId, TemplateStage: "Original" }), pages(ListStackResourcesCommand, "StackResourceSummaries"), pages(ListChangeSetsCommand, "Summaries")]);
    const s = r.Stacks?.[0];
    if (r.Stacks?.length !== 1 || s.StackId !== t.stackId || s.StackName !== t.stackName || s.StackStatus !== "CREATE_COMPLETE" || s.RoleARN !== t.roleArn ||
      s.DisableRollback !== true || s.EnableTerminationProtection !== false || s.ParentId || s.RootId || s.LastUpdatedTime || s.DeletionTime) fail("FINAL_STACK_FLAGS_DRIFT");
    const body = typeof template.TemplateBody === "string" ? JSON.parse(template.TemplateBody) : template.TemplateBody;
    const stable = { id: s.StackId, name: s.StackName, status: s.StackStatus, phase: "RESERVED", parameters: map(s.Parameters, "ParameterKey", "ParameterValue"),
      tags: map(s.Tags, "Key", "Value"), outputs: map(s.Outputs ?? [], "OutputKey", "OutputValue"), role: s.RoleARN,
      createdAt: new Date(s.CreationTime).toISOString(), updatedAt: null, disableRollback: true };
    const evidence = { stackId: s.StackId, stackStatus: s.StackStatus, stableOriginalSha256: await sha256Hex(stable),
      templateCanonicalSha256: await sha256Hex(body), resourceCount: resources.length, changeSetCount: changes.length, flagsVerified: true };
    assertRecoveryLightFrameV7(evidence);
    return { evidence, stack: JSON.parse(JSON.stringify(s)), resources, changes };
  };
  return Object.freeze({ identity,
    async readComplete() {
      const startedAt = Date.now(), live = await instrument("CompleteRead", () => frozenRead.readBefore());
      fullCache = { startedAt, completedAt: Date.now(), before: live.before };
      assertRecoveryCompleteReadV7(fullCache, Date.now()); return { complete: fullCache, live };
    },
    async readFinalStack() {
      const startedAt = Date.now(); await identity(); const a = await frame(), b = await frame(); await identity();
      if (!eq(a, b)) fail("FINAL_STACK_DOUBLE_READ_DRIFT");
      finalCache = { startedAt, completedAt: Date.now(), frame: b.evidence, sourceVerified: true };
      if (!fullCache) fail("COMPLETE_READ_MISSING"); assertRecoveryFinalReadV7(finalCache, fullCache, Date.now()); return finalCache;
    },
    async deleteOnce(request) {
      if (entered || !reviewed || !approvedSha || !codeBindingSha256 || !eq(request, reviewed.request) ||
        request.StackName !== t.stackId || request.RoleARN !== t.roleArn || request.DeletionMode !== "STANDARD" ||
        Object.keys(request).sort().join(",") !== "ClientRequestToken,DeletionMode,RoleARN,StackName") fail("DELETE_CAPABILITY_INVALID");
      entered = true; await identity();
      if (!fullCache || !finalCache) fail("FINAL_STACK_READ_MISSING");
      assertRecoveryFinalReadV7(finalCache, fullCache, Date.now()); assertRecoveryApprovalV7(reviewed, approvedSha, codeBindingSha256, Date.now());
      sdkDeleteSendEntered = true; await call(DeleteStackCommand, request);
    },
    inspect: (token, attemptedAt, slotMatches) => instrument("IndependentInspect", () => frozenRead.inspect(token, attemptedAt, slotMatches)),
    sdkDeleteSendEntered: () => sdkDeleteSendEntered,
    dispose: () => { frozenRead.dispose(); sts.destroy(); cfn.destroy(); },
  });
}
