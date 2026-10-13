import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { IAMClient, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand, GetTemplateCommand,
  ListStackResourcesCommand, DescribeStackEventsCommand, ListStacksCommand, ListChangeSetsCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { assertReservedEvidenceV5, reservationParentCommonHashV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { RESERVED_RETIREMENT_V6 as t, assertRetirementBeforeV6, classifyRetirementHistoryV6 } from "../../../lib/deployments/execution/cell-reserved-retirement-v6.ts";
import { createReservationAwsV5 } from "./cell-reservation-aws-v5.mjs";

const cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
const eq = (a, b) => canonicalJson(a) === canonicalJson(b), fail = code => { throw Error(`RETIREMENT_${code}`); };
const sortedMap = (rows, key, value) => {
  if (!Array.isArray(rows)) fail("STACK_MAP_INVALID"); const map = {};
  for (const x of rows) {
    if (typeof x[key] !== "string" || typeof x[value] !== "string" || Object.hasOwn(map, x[key])) fail("STACK_MAP_INVALID"); map[x[key]] = x[value];
  }
  return map;
};
export function createReservedRetirementAwsV6(original, reviewedRequest) {
  if (original.manifestSha256 !== t.originalApprovalSha256 || original.plan.birthIntentSha256 !== t.birthIntentSha256 || original.plan.intent.cellExpiresAt !== t.cellExpiresAt) fail("ORIGINAL_BIRTH_INVALID");
  const credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg }),
    sts = new STSClient({ ...cfg, credentials }), iam = new IAMClient({ ...cfg, credentials }), cfn = new CloudFormationClient({ ...cfg, credentials }), reservation = createReservationAwsV5(original.plan);
  let entered = false;
  const call = (client, Command, input) => client.send(new Command(input), { abortSignal: AbortSignal.timeout(25000) });
  const identity = async () => {
    const r = await call(sts, GetCallerIdentityCommand, {});
    if (r.Account !== "402010193138" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev") fail("SOURCE_IDENTITY_INVALID");
  };
  const pages = async (Command, input, field) => {
    const all = [], seen = new Set(); let token;
    do {
      const r = await call(cfn, Command, { ...input, ...(token ? { NextToken: token } : {}) });
      if (!Array.isArray(r[field])) fail("PAGINATED_ROWS_INVALID"); all.push(...r[field]);
      if (r.NextToken === undefined) token = undefined;
      else if (typeof r.NextToken !== "string" || !r.NextToken || seen.has(r.NextToken) || seen.size >= 99) fail("PAGINATION_INVALID");
      else { token = r.NextToken; seen.add(token); }
    } while (token);
    return all;
  };
  const simulate = async (action, arn, contextKey, contextValue) => {
    const r = await call(iam, SimulatePrincipalPolicyCommand, { PolicySourceArn: "arn:aws:iam::402010193138:user/techlong-sandbox-dev",
      ActionNames: [action], ResourceArns: [arn], ContextEntries: [{ ContextKeyName: contextKey, ContextKeyType: "string", ContextKeyValues: [contextValue] }] });
    const x = r.EvaluationResults?.[0];
    if (r.IsTruncated || r.Marker || r.EvaluationResults?.length !== 1 || x.EvalActionName !== action || x.EvalResourceName !== arn ||
      x.EvalDecision !== "allowed" || x.MissingContextValues?.length || x.ResourceSpecificResults?.some(y => y.EvalResourceName !== arn || y.EvalResourceDecision !== "allowed" || y.MissingContextValues?.length)) fail("DELETE_OR_PASSROLE_SIMULATION_UNVERIFIED");
  };
  const historyOnce = async (token, attemptedAt) => {
    const [raw, template, resources, events, names] = await Promise.all([
      call(cfn, DescribeStacksCommand, { StackName: t.stackId }), call(cfn, GetTemplateCommand, { StackName: t.stackId, TemplateStage: "Original" }),
      pages(ListStackResourcesCommand, { StackName: t.stackId }, "StackResourceSummaries"), pages(DescribeStackEventsCommand, { StackName: t.stackId }, "StackEvents"),
      pages(ListStacksCommand, {}, "StackSummaries"),
    ]);
    const s = raw.Stacks?.[0], plan = original.plan;
    const body = typeof template.TemplateBody === "string" ? JSON.parse(template.TemplateBody) : template.TemplateBody;
    if (raw.Stacks?.length !== 1 || s.StackId !== t.stackId || s.StackName !== t.stackName || s.RoleARN !== t.roleArn || s.ParentId || s.RootId ||
      s.DisableRollback !== true || s.EnableTerminationProtection !== false || s.LastUpdatedTime || !eq(sortedMap(s.Parameters, "ParameterKey", "ParameterValue"), plan.phaseParameters.RESERVED) ||
      !eq(sortedMap(s.Tags, "Key", "Value"), plan.tags) || !eq(sortedMap(s.Outputs ?? [], "OutputKey", "OutputValue"), { BirthIntentSha256: plan.birthIntentSha256, CellExpiresAt: plan.intent.cellExpiresAt }) ||
      !eq(body, plan.template) || resources.length) fail("ORIGINAL_ZERO_RESOURCE_STACK_DRIFT");
    const stableOriginal = { id: s.StackId, name: s.StackName, status: "CREATE_COMPLETE", phase: "RESERVED",
      parameters: sortedMap(s.Parameters, "ParameterKey", "ParameterValue"), tags: sortedMap(s.Tags, "Key", "Value"),
      outputs: sortedMap(s.Outputs ?? [], "OutputKey", "OutputValue"), role: s.RoleARN,
      createdAt: new Date(s.CreationTime).toISOString(), updatedAt: null, disableRollback: true };
    if (await sha256Hex(stableOriginal) !== t.stableStackSha256) fail("ORIGINAL_STACK_HISTORY_DRIFT");
    const active = names.filter(x => x.StackStatus !== "DELETE_COMPLETE" && x.StackName?.startsWith("techlong-sandbox-cell-"));
    if (active.some(x => x.StackId !== t.stackId || x.StackName !== t.stackName) || active.length > 1 ||
      (s.StackStatus === "CREATE_COMPLETE" && (active.length !== 1 || active[0].StackStatus !== s.StackStatus)) ||
      (s.StackStatus === "DELETE_COMPLETE" && active.length)) fail("OTHER_LIVE_CELL_OR_NAME_REUSE");
    if (!events.length || new Set(events.map(x => x.EventId)).size !== events.length) fail("STACK_EVENTS_INVALID");
    let birth = false, completeBirth = false, deletionStarted = false, deletionComplete = false;
    for (const e of events) {
      const ms = new Date(e.Timestamp).getTime();
      if (e.StackId !== t.stackId || e.StackName !== t.stackName || e.PhysicalResourceId !== t.stackId || e.LogicalResourceId !== t.stackName ||
        e.ResourceType !== "AWS::CloudFormation::Stack" || !Number.isFinite(ms) || ms < plan.intent.input.base.requestedAt || ms > Date.now()) fail("UNEXPECTED_STACK_EVENT");
      if (["CREATE_IN_PROGRESS", "CREATE_COMPLETE"].includes(e.ResourceStatus)) {
        if (e.ClientRequestToken !== plan.reservationClientToken) fail("BIRTH_EVENT_TOKEN_DRIFT");
        birth ||= e.ResourceStatus === "CREATE_IN_PROGRESS"; completeBirth ||= e.ResourceStatus === "CREATE_COMPLETE";
      } else if (["DELETE_IN_PROGRESS", "DELETE_COMPLETE"].includes(e.ResourceStatus)) {
        if (!token || e.ClientRequestToken !== token || !Number.isFinite(attemptedAt) || ms < attemptedAt) fail("DELETE_EVENT_TOKEN_OR_CLOCK_DRIFT");
        deletionStarted ||= e.ResourceStatus === "DELETE_IN_PROGRESS"; deletionComplete ||= e.ResourceStatus === "DELETE_COMPLETE";
      } else fail("UPDATE_FAILED_OR_NON_CREATION_EVENT");
    }
    if (!birth || !completeBirth || (s.StackStatus === "DELETE_COMPLETE" && (!deletionStarted || !deletionComplete))) fail("BIRTH_OR_DELETE_EVENTS_UNVERIFIED");
    const deletedAt = s.DeletionTime ? new Date(s.DeletionTime).toISOString() : null;
    if (deletedAt && (!Number.isFinite(attemptedAt) || Date.parse(deletedAt) < attemptedAt || Date.parse(deletedAt) > Date.now())) fail("DELETION_CLOCK_DRIFT");
    // Provider metadata is omitted; all stack fields and all event entries are
    // otherwise retained and compared across the two independently fetched frames.
    return { frame: { stackId: s.StackId, stackName: s.StackName, status: s.StackStatus, zeroResourcesAndOriginalBindingsVerified: true,
      noOtherLiveCell: true, birthEventsVerified: true, deletionEventsVerified: deletionStarted && (s.StackStatus !== "DELETE_COMPLETE" || deletionComplete), deletionTime: deletedAt },
      stack: JSON.parse(JSON.stringify(s)), events: JSON.parse(JSON.stringify(events)).sort((a, b) => a.EventId.localeCompare(b.EventId)), resources,
      templateCanonicalSha256: await sha256Hex(body), liveCells: JSON.parse(JSON.stringify(active)).sort((a, b) => a.StackId.localeCompare(b.StackId)) };
  };
  const historyStable = async (token, attemptedAt) => {
    await identity(); const started = Date.now(), a = await historyOnce(token, attemptedAt), b = await historyOnce(token, attemptedAt);
    await identity(); if (!eq(a, b) || Date.now() - started > 30000) fail("HISTORY_DOUBLE_READ_DRIFT"); return b;
  };
  const readBefore = async () => {
    await identity();
    const [live, h, changes] = await Promise.all([reservation.inspect(t.stackId), historyStable(null, NaN), pages(ListChangeSetsCommand, { StackName: t.stackId }, "Summaries")]);
    if ("state" in live.evidence) fail("OLD_IDENTITY_MISSING"); assertReservedEvidenceV5(original, live.evidence);
    if (live.evidence.stackId !== t.stackId || changes.length || classifyRetirementHistoryV6(h.frame, false) !== "RETIREMENT_NOT_DELETED_INSPECT_ONLY") fail("OLD_IDENTITY_NOT_PRISTINE");
    await Promise.all([simulate("cloudformation:DeleteStack", t.stackId, "cloudformation:RoleArn", t.roleArn), simulate("iam:PassRole", t.roleArn, "iam:PassedToService", "cloudformation.amazonaws.com")]);
    const before = { observedAt: Date.now(), stackId: t.stackId, stableStackSha256: live.evidence.stableStackSha256,
      parentCommonSha256: await reservationParentCommonHashV5(live.parent, false, Date.now()), foundationSha256: await sha256Hex(live.foundation),
      zeroResourcesReservedAndFlagsVerified: live.stackFlagsVerified, noChangeSetsOrNonCreationEvents: true, sourceDeleteAndPassRoleSimulated: true };
    assertRetirementBeforeV6(before, Date.now()); return { before, live, history: h, changeSets: [] };
  };
  return Object.freeze({ identity, readBefore,
    async deleteOnce(request) {
      if (entered || !reviewedRequest || !eq(request, reviewedRequest) || request.StackName !== t.stackId || request.RoleARN !== t.roleArn ||
        request.DeletionMode !== "STANDARD" || Object.keys(request).sort().join(",") !== "ClientRequestToken,DeletionMode,RoleARN,StackName") fail("DELETE_CAPABILITY_INVALID");
      await identity(); entered = true;
      await call(cfn, DeleteStackCommand, request);
    },
    async inspect(token, attemptedAt, slotMatches) {
      const h = await historyStable(token, attemptedAt), outcome = classifyRetirementHistoryV6(h.frame, slotMatches);
      if (h.frame.status === "DELETE_IN_PROGRESS") return { outcome, history: h, locks: null, lockedStateReverificationComplete: false, cloudWriteCalls: 0 };
      const deleted = h.frame.status === "DELETE_COMPLETE", locks = deleted ? await reservation.readBefore() : await reservation.inspect(t.stackId);
      if (deleted && !locks.absence) fail("POST_DELETE_NAME_NOT_ABSENT");
      if (await reservationParentCommonHashV5(locks.parent, deleted, Date.now()) !== t.parentCommonSha256 || await sha256Hex(locks.foundation) !== t.foundationSha256) fail("POST_INSPECT_LOCK_OR_ROLE_DRIFT");
      await identity(); return { outcome, history: h, locks, cloudWriteCalls: 0 };
    },
    dispose: () => { sts.destroy(); iam.destroy(); cfn.destroy(); reservation.dispose(); },
  });
}
