import { canonicalJson, sha256Hex } from "./hash.ts";
import { ARN_PROBE_ACCOUNT, ARN_PROBE_REGION, ARN_PROBE_SOURCE, ARN_PROBE_FIXTURE_STACK, ARN_PROBE_EXECUTION_ROLE, validateArnProbeFixtureEvidence } from "./arn-compatibility-probe-fixture.ts";
import { assertArnProbeGrantPlan, type ArnProbeGrantPlan } from "./arn-compatibility-probe-grant.ts";
import { assertArnProbeWorkflowManifest, probeObject as object, probeSame as same, probeInstant,
  type ArnProbeWorkflowManifest, type ArnProbeWorkflowReads, type ArnProbeWorkflowWrites, type ProbeAfterState, type ProbeRevokeState,
  ARN_PROBE_OPERATOR_ROLE, ARN_PROBE_OPERATOR_SESSION, ARN_PROBE_OPERATOR_CALLER, ARN_PROBE_MFA,
  type ArnProbeOperatorReadPort, type ArnProbeOperatorReadiness } from "./arn-compatibility-probe-workflow.ts";
import { sanitizeArnProbeFailure } from "./arn-compatibility-probe-diagnostics.ts";
import type { ArnProbeEmptyManagementInventory } from "./arn-compatibility-probe-renewal-review.ts";
import type { AwsSdkSharedCellAuthorCompensationManagementReadAdapter } from "./aws-sdk-shared-cell-author-compensation-management.ts";
import type { AwsSdkArnProbeFixtureReadAdapter } from "./aws-sdk-arn-compatibility-probe-fixture.ts";
import type { AwsSdkArnProbeGrantReadAdapter } from "./aws-sdk-arn-compatibility-probe-grant.ts";

export interface ArnProbeSdkClient { send(command: unknown, options: { abortSignal: AbortSignal }): Promise<Record<string, unknown>>; }
export type ArnProbeSdkCommand = new (input: Record<string, unknown>) => unknown;
type ReadCommands = { describeStacks: ArnProbeSdkCommand; listStackResources: ArnProbeSdkCommand; getTemplate: ArnProbeSdkCommand;
  describeChangeSet: ArnProbeSdkCommand; listChangeSets: ArnProbeSdkCommand };
function empty(value: unknown) { return value === undefined || value === null || value === ""; }
function array(value: unknown) { if (!Array.isArray(value)) throw new Error("Incomplete probe inventory."); return value.map(object); }
function stable(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$metadata")); }
function stackMissing(error: unknown, target: string) {
  const value = object(error);
  return value.name === "ValidationError" && value.message === `Stack with id ${target} does not exist` && object(value.$metadata).httpStatusCode === 400;
}
function changeSetMissing(error: unknown, arn: string) {
  const value = object(error);
  return value.name === "ChangeSetNotFoundException" && value.message === `ChangeSet [${arn}] does not exist` && object(value.$metadata).httpStatusCode === 404;
}
async function pause(signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 2_000);
    const aborted = () => { clearTimeout(timer); reject(new Error("Probe read wait cancelled.")); };
    signal.addEventListener("abort", aborted, { once: true });
  });
}
/** Read-only capability using ONLY the existing fixed MFA Operator session.
 * Two consecutive complete exact-ARN fixture reads, at most three attempts.
 * This observes read access, never infers Delete access or retries a mutation.
 */
export class AwsSdkArnProbeOperatorReadAdapter implements ArnProbeOperatorReadPort {
  private readonly sdk: { operator: ArnProbeSdkClient; commands: Omit<ReadCommands, "listChangeSets">;
    verifyIdentity: (signal: AbortSignal) => ReturnType<ArnProbeWorkflowWrites["prepareOperator"]>; pause?: (signal: AbortSignal) => Promise<void> };
  private readonly now: () => number;
  constructor(sdk: AwsSdkArnProbeOperatorReadAdapter["sdk"], now = Date.now) {
    if (typeof sdk.operator?.send !== "function" || typeof sdk.verifyIdentity !== "function" ||
        ["describeStacks", "listStackResources", "getTemplate", "describeChangeSet"].some((key) => typeof sdk.commands?.[key as keyof typeof sdk.commands] !== "function")) throw new Error("Fixed Operator read dependencies are incomplete.");
    this.sdk = sdk; this.now = now;
  }
  async checkReadiness(manifest: ArnProbeWorkflowManifest, signal: AbortSignal): Promise<ArnProbeOperatorReadiness> {
    await assertArnProbeWorkflowManifest(manifest);
    const plan = manifest.input.plan, started = this.now(), bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const failures: ArnProbeOperatorReadiness["failures"][number][] = [];
    let attempts = 0, consecutive = 0, identityVerified = false, previous: string | null = null;
    const proofs: string[] = [];
    const live = () => {
      bounded.throwIfAborted(); const current = this.now();
      if (current < started || current - started >= 30_000 || current < Date.parse(manifest.input.reviewedAt) ||
          current >= Date.parse(manifest.input.expiresAt) || current >= Date.parse(plan.deleteCutoff)) throw new Error("Operator read approval expired or exceeded its bound.");
    };
    let readOperation: ArnProbeOperatorReadiness["failures"][number]["readOperation"] = "GetCallerIdentity";
    const send = async (operation: typeof readOperation, command: ArnProbeSdkCommand, input: Record<string, unknown>) => {
      readOperation = operation; live();
      const reply = object(JSON.parse(JSON.stringify(await this.sdk.operator.send(new command(input), { abortSignal: bounded }))));
      live(); return reply;
    };
    while (attempts < 3 && consecutive < 2) {
      attempts++;
      try {
        readOperation = "GetCallerIdentity"; live(); identityVerified = false;
        const caller = await this.sdk.verifyIdentity(bounded); live();
        if (caller.account !== ARN_PROBE_ACCOUNT || caller.callerArn !== ARN_PROBE_OPERATOR_CALLER || probeInstant(caller.expiresAt) <= this.now() + 60_000) throw new Error("Fixed Operator identity drifted or expired.");
        identityVerified = true;
        const stackInput = { StackName: plan.input.fixtureStackId }, changeInput = { ...plan.futureProbeRequest };
        const first = await send("DescribeStacks", this.sdk.commands.describeStacks, stackInput);
        const stack = array(first.Stacks)[0];
        if (array(first.Stacks).length !== 1 || stack.StackId !== stackInput.StackName || stack.StackName !== ARN_PROBE_FIXTURE_STACK || stack.StackStatus !== "REVIEW_IN_PROGRESS") throw new Error("Exact unexecuted Operator Stack is required.");
        const resources = await send("ListStackResources", this.sdk.commands.listStackResources, stackInput);
        const original = await send("GetTemplate", this.sdk.commands.getTemplate, { ...stackInput, TemplateStage: "Original" });
        const before = await send("DescribeChangeSet", this.sdk.commands.describeChangeSet, changeInput);
        if (before.StackId !== stackInput.StackName || before.ChangeSetId !== changeInput.ChangeSetName || before.RoleARN !== plan.input.fixturePlan.request.RoleARN) throw new Error("Exact full ARN Operator Change Set drifted.");
        const template = await send("GetTemplate", this.sdk.commands.getTemplate, { ...changeInput, TemplateStage: "Original" });
        const after = await send("DescribeChangeSet", this.sdk.commands.describeChangeSet, changeInput);
        const last = await send("DescribeStacks", this.sdk.commands.describeStacks, stackInput);
        const verified = await validateArnProbeFixtureEvidence(plan.input.fixturePlan, { stackBefore: first, stackAfter: last, resources,
          originalTemplateProof: { kind: "EMPTY_ORIGINAL_TEMPLATE", stackId: stackInput.StackName, templateBody: original.TemplateBody,
            httpStatusCode: object(original.$metadata).httpStatusCode, requestId: object(original.$metadata).requestId },
          changeSetBefore: before, changeSetAfter: after, changeSetTemplate: template, observedAt: new Date(this.now()).toISOString() });
        if (verified.state !== "READY_UNEXECUTED" || verified.stackId !== stackInput.StackName || verified.changeSetArn !== changeInput.ChangeSetName) throw new Error("Operator fixture proof scope drifted.");
        const proof = await sha256Hex(canonicalJson({ first: stable(first), last: stable(last), resources: stable(resources), original: stable(original),
          before: stable(before), after: stable(after), template: stable(template) }));
        if (previous && proof !== previous) throw new Error("Operator fixture changed between readiness rounds.");
        live(); previous = proof; proofs.push(proof); consecutive++;
      } catch (error) {
        const diagnostic = sanitizeArnProbeFailure(error, "OPERATOR_READINESS", this.now);
        failures.push(Object.freeze({ ...diagnostic, readOperation, attempt: attempts })); consecutive = 0; previous = null; proofs.length = 0;
        // Retry only read calls for bounded authorization/propagation, throttle
        // or transport observations. Missing/drift/unknown is never readiness.
        if (!["AUTHORIZATION_DENIED", "THROTTLED", "TRANSPORT_UNCERTAIN", "TIMEOUT_UNCERTAIN"].includes(diagnostic.classification) || bounded.aborted) break;
      }
      if (attempts < 3 && consecutive < 2) {
        try { live(); await (this.sdk.pause ?? pause)(bounded); live(); }
        catch (error) { failures.push(Object.freeze({ ...sanitizeArnProbeFailure(error, "OPERATOR_READINESS", this.now), readOperation, attempt: attempts })); consecutive = 0; break; }
      }
    }
    const ready = consecutive === 2;
    return Object.freeze({ schemaVersion: 1, manifestSha256: manifest.manifestSha256, callerArn: ARN_PROBE_OPERATOR_CALLER, account: ARN_PROBE_ACCOUNT,
      region: ARN_PROBE_REGION, stackId: plan.input.fixtureStackId, changeSetArn: plan.input.fixtureChangeSetArn,
      outcome: ready ? "READ_READY" : "READ_NOT_READY", attempts, consecutiveSuccessfulReads: consecutive, operatorIdentityVerified: identityVerified,
      evidenceSha256: ready ? await sha256Hex(canonicalJson({ manifestSha256: manifest.manifestSha256, callerArn: ARN_PROBE_OPERATOR_CALLER,
        request: plan.futureProbeRequest, proofs })) : null, failures: Object.freeze(failures), observedAt: new Date(this.now()).toISOString(),
      deleteAuthorizationVerified: false, productionCompatibilityVerified: false, mutationPerformed: false, retryAuthorized: false });
  }
}
export class AwsSdkArnProbeWorkflowReadAdapter implements ArnProbeWorkflowReads {
  private readonly sdk: { client: ArnProbeSdkClient; commands: ReadCommands;
    management: Pick<AwsSdkSharedCellAuthorCompensationManagementReadAdapter, "readArnProbeManagementObservation">;
    fixture: Pick<AwsSdkArnProbeFixtureReadAdapter, "readFixture">; grant: Pick<AwsSdkArnProbeGrantReadAdapter, "readGrantChangeSet"> };
  private readonly now: () => number;
  constructor(sdk: AwsSdkArnProbeWorkflowReadAdapter["sdk"], now = Date.now) {
    if (typeof sdk.client?.send !== "function" || Object.values(sdk.commands).some((command) => typeof command !== "function")) throw new Error("Probe workflow read dependencies are incomplete.");
    this.sdk = sdk; this.now = now;
  }
  private async send(command: ArnProbeSdkCommand, input: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted(); const result = object(JSON.parse(JSON.stringify(await this.sdk.client.send(new command(input), { abortSignal: signal }))));
    signal.throwIfAborted(); return result;
  }
  readManagement(plan: ArnProbeGrantPlan, signal: AbortSignal) { return this.sdk.management.readArnProbeManagementObservation({ plan, signal }); }
  readFixture(plan: ArnProbeGrantPlan, signal: AbortSignal) { return this.sdk.fixture.readFixture(plan.input.fixturePlan, signal); }
  readGrant(plan: ArnProbeGrantPlan, signal: AbortSignal) { return this.sdk.grant.readGrantChangeSet(plan, signal); }
  async readEmptyManagementInventory(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<ArnProbeEmptyManagementInventory> {
    await assertArnProbeGrantPlan(plan);
    const reply = await this.send(this.sdk.commands.listChangeSets, { StackName: plan.managementStackId }, signal);
    if (!empty(reply.NextToken) || array(reply.Summaries).length !== 0) throw new Error("Renewal inventory must be complete and empty; do not clear competing Change Sets.");
    return Object.freeze({ stackId: plan.managementStackId, state: "EMPTY", changeSetCount: 0,
      providerEvidenceSha256: await sha256Hex(canonicalJson(reply)), observedAt: new Date(this.now()).toISOString() });
  }
  async waitGrantSettlement(manifest: ArnProbeWorkflowManifest, signal: AbortSignal) {
    await assertArnProbeWorkflowManifest(manifest);
    const plan = manifest.input.plan;
    for (let count = 0; count < 120; count++) {
      const result = await this.send(this.sdk.commands.describeChangeSet, { StackName: plan.managementStackId, ChangeSetName: manifest.input.grantChangeSetArn }, signal);
      if (result.StackId !== plan.managementStackId || result.ChangeSetId !== manifest.input.grantChangeSetArn || result.ChangeSetName !== plan.request.ChangeSetName || result.Description !== plan.request.Description) throw new Error("Grant settlement identity drifted.");
      if (["EXECUTE_COMPLETE", "EXECUTE_FAILED", "OBSOLETE"].includes(String(result.ExecutionStatus))) return this.waitManagement(plan, signal);
      if (!["AVAILABLE", "EXECUTE_IN_PROGRESS"].includes(String(result.ExecutionStatus))) throw new Error("Grant settlement requires manual reconciliation.");
      await pause(signal);
    }
    throw new Error("Grant submission is not settled; an early Locked read cannot discharge cleanup.");
  }
  async waitManagement(plan: ArnProbeGrantPlan, signal: AbortSignal) {
    await assertArnProbeGrantPlan(plan);
    for (let count = 0; count < 120; count++) {
      const response = await this.send(this.sdk.commands.describeStacks, { StackName: plan.managementStackId }, signal);
      const stacks = array(response.Stacks), stack = stacks[0];
      if (stacks.length !== 1 || stack.StackId !== plan.managementStackId || stack.StackName !== "techlong-s3-b5-cell-lifecycle-management" ||
          !empty(stack.RoleARN) || !empty(stack.ParentId) || !empty(stack.RootId) || stack.EnableTerminationProtection !== false) throw new Error("Management identity drifted while waiting.");
      if (["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(String(stack.StackStatus))) return this.readManagement(plan, signal);
      if (!["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS"].includes(String(stack.StackStatus))) throw new Error("Management needs manual investigation; not a pending update.");
      await pause(signal);
    }
    throw new Error("Management wait exceeded its bound; never retry mutation.");
  }
  async readProbeAfter(plan: ArnProbeGrantPlan, signal: AbortSignal): Promise<ProbeAfterState> {
    await assertArnProbeGrantPlan(plan);
    const started = this.now(), id = plan.input.fixtureStackId, arn = plan.input.fixtureChangeSetArn;
    const readStack = async () => {
      try {
        const response = await this.send(this.sdk.commands.describeStacks, { StackName: id }, signal);
        const stacks = array(response.Stacks), stack = stacks[0];
        if (stacks.length !== 1 || stack.StackId !== id || stack.StackName !== ARN_PROBE_FIXTURE_STACK || stack.StackStatus !== "REVIEW_IN_PROGRESS" ||
            stack.RoleARN !== ARN_PROBE_EXECUTION_ROLE || stack.EnableTerminationProtection !== false || !empty(stack.ParentId) || !empty(stack.RootId)) throw new Error("Probe Stack was executed or drifted.");
        same(stack.Tags, [], "Unmaterialized probe Stack tags");
        return response;
      } catch (error) { signal.throwIfAborted(); if (!stackMissing(error, id)) throw error; return null; }
    };
    const first = await readStack();
    let missing: "CHANGE_SET" | "STACK" | null = null;
    try {
      await this.send(this.sdk.commands.describeChangeSet, { StackName: id, ChangeSetName: arn }, signal);
      if (!first) throw new Error("Probe Change Set exists without the approved Stack.");
      const present = await this.readFixture(plan, signal);
      if (present.state !== "READY_UNEXECUTED" || present.stackId !== id || present.changeSetArn !== arn) throw new Error("Exact unchanged probe was not proved.");
      return Object.freeze({ state: "READY_UNEXECUTED", stackId: id, changeSetArn: arn, stackState: "REVIEW_IN_PROGRESS", resourceCount: 0,
        providerEvidenceSha256: await sha256Hex(canonicalJson(present)), observedAt: new Date(this.now()).toISOString() });
    } catch (error) {
      signal.throwIfAborted();
      if (changeSetMissing(error, arn)) missing = "CHANGE_SET";
      else if (!first && stackMissing(error, id)) missing = "STACK";
      else throw error;
    }
    let resources: Record<string, unknown> | null = null, original: Record<string, unknown> | null = null;
    if (first) {
      resources = await this.send(this.sdk.commands.listStackResources, { StackName: id }, signal);
      same(resources.StackResourceSummaries, [], "Post-probe zero-resource inventory");
      if (!empty(resources.NextToken)) throw new Error("Post-probe inventory is paginated.");
      original = await this.send(this.sdk.commands.getTemplate, { StackName: id, TemplateStage: "Original" }, signal);
      const metadata = object(original.$metadata);
      if (original.TemplateBody !== "" || metadata.httpStatusCode !== 200 || typeof metadata.requestId !== "string" || !metadata.requestId) throw new Error("Post-probe Original template must be explicitly empty.");
    }
    // Independently repeat the exact full-ARN absence read; AccessDenied is never absence.
    try { await this.send(this.sdk.commands.describeChangeSet, { StackName: id, ChangeSetName: arn }, signal); throw new Error("Probe absence was not stable."); }
    catch (error) {
      signal.throwIfAborted();
      if (!(missing === "CHANGE_SET" ? changeSetMissing(error, arn) : stackMissing(error, id))) throw error;
    }
    const last = await readStack(); same(first && stable(first), last && stable(last), "Post-probe Stack stability");
    const ended = this.now();
    if (ended < started || ended - started > 30_000) throw new Error("Post-probe evidence collection exceeded its bound.");
    return Object.freeze({ state: "CHANGE_SET_ABSENT", stackId: id, changeSetArn: arn, stackState: first ? "REVIEW_IN_PROGRESS" : "MISSING", resourceCount: 0,
      providerEvidenceSha256: await sha256Hex(canonicalJson({ first, last, resources, original, missing })), observedAt: new Date(ended).toISOString() });
  }
  async readRevoke(manifest: ArnProbeWorkflowManifest, signal: AbortSignal): Promise<ProbeRevokeState> {
    await assertArnProbeWorkflowManifest(manifest);
    const request = manifest.actions.revoke.createRequest, plan = manifest.input.plan, started = this.now();
    const inventory = await this.send(this.sdk.commands.listChangeSets, { StackName: plan.managementStackId }, signal);
    if (!empty(inventory.NextToken)) throw new Error("Revoke inventory is paginated.");
    const entries = array(inventory.Summaries);
    if (entries.some((item) => item.StackId !== plan.managementStackId || typeof item.ChangeSetId !== "string" || typeof item.ChangeSetName !== "string" ||
      (item.ChangeSetName !== request.ChangeSetName && !["EXECUTE_COMPLETE", "OBSOLETE"].includes(String(item.ExecutionStatus))))) throw new Error("Competing management change requires manual review.");
    const matches = entries.filter((item) => item.ChangeSetName === request.ChangeSetName);
    if (!matches.length) return Object.freeze({ state: "MISSING", observedAt: new Date(this.now()).toISOString() });
    const arn = matches[0].ChangeSetId;
    if (matches.length !== 1 || typeof arn !== "string" || !new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${request.ChangeSetName}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(arn)) throw new Error("Revoke discovered identity drifted.");
    const input = { StackName: plan.managementStackId, ChangeSetName: arn };
    const before = await this.send(this.sdk.commands.describeChangeSet, input, signal);
    if (before.StackId !== plan.managementStackId || before.ChangeSetId !== arn || before.ChangeSetName !== request.ChangeSetName || before.Description !== request.Description) throw new Error("Revoke identity drifted.");
    if (["CREATE_PENDING", "CREATE_IN_PROGRESS"].includes(String(before.Status))) return Object.freeze({ state: "CREATING", observedAt: new Date(this.now()).toISOString() });
    if (before.ExecutionStatus === "EXECUTE_IN_PROGRESS" || before.ExecutionStatus === "EXECUTE_COMPLETE") return Object.freeze({ state: "EXECUTING", observedAt: new Date(this.now()).toISOString() });
    if (before.Status === "FAILED") return Object.freeze({ state: "FAILED", observedAt: new Date(this.now()).toISOString() });
    const original = await this.send(this.sdk.commands.getTemplate, { ...input, TemplateStage: "Original" }, signal);
    const after = await this.send(this.sdk.commands.describeChangeSet, input, signal);
    same(stable(before), stable(after), "Revoke Change Set stability");
    if (before.StackName !== "techlong-s3-b5-cell-lifecycle-management" || before.Status !== "CREATE_COMPLETE" || before.ExecutionStatus !== "AVAILABLE" ||
        !empty(before.NextToken) || !empty(before.RoleARN) || !empty(before.OnStackFailure) || !empty(before.ParentChangeSetId) || !empty(before.RootChangeSetId) ||
        !empty(before.DeploymentMode) || before.IncludeNestedStacks === true || before.ImportExistingResources === true) throw new Error("Revoke Change Set is not exact and available.");
    same(before.Capabilities, ["CAPABILITY_NAMED_IAM"], "Revoke capabilities"); same(before.NotificationARNs ?? [], [], "Revoke notifications");
    same(array(before.Parameters).map((item) => [item.ParameterKey, item.ParameterValue]).sort(), [["ExpectedAccountId", ARN_PROBE_ACCOUNT], ["ExpectedRegion", ARN_PROBE_REGION], ["ManagementPrincipalArn", ARN_PROBE_SOURCE]].sort(), "Revoke parameters");
    const changes = array(before.Changes), resource = object(changes[0]?.ResourceChange);
    if (changes.length !== 1 || changes[0].Type !== "Resource" || resource.Action !== "Modify" || resource.LogicalResourceId !== "CellOperatorBoundary" ||
        resource.ResourceType !== "AWS::IAM::ManagedPolicy" || resource.PhysicalResourceId !== `arn:aws:iam::${ARN_PROBE_ACCOUNT}:policy/TechlongSandboxCellOperatorBoundary` || resource.Replacement !== "False") throw new Error("Revoke may modify only the exact operator boundary.");
    same(typeof original.TemplateBody === "string" ? JSON.parse(original.TemplateBody) : object(original.TemplateBody), JSON.parse(request.TemplateBody), "Revoke exact Locked template");
    const ended = this.now(); if (ended < started || ended - started > 30_000) throw new Error("Revoke evidence exceeded its bound.");
    return Object.freeze({ state: "READY_UNEXECUTED", stackId: plan.managementStackId, changeSetArn: arn,
      providerEvidenceSha256: await sha256Hex(canonicalJson({ before, after, original })), observedAt: new Date(ended).toISOString() });
  }
  async waitRevoke(manifest: ArnProbeWorkflowManifest, signal: AbortSignal) {
    for (let count = 0; count < 60; count++) {
      const value = await this.readRevoke(manifest, signal);
      if (value.state !== "CREATING") return value;
      await pause(signal);
    }
    throw new Error("Revoke creation wait exceeded its bound.");
  }
}

/** Lazily constructed only in explicitly approved Run; no Operator login fallback. */
export function createArnProbeOperatorSession(input: { sts: ArnProbeSdkClient; assumeRole: ArnProbeSdkCommand; getCallerIdentity: ArnProbeSdkCommand;
  mfaCode: () => Promise<string>; createOperatorSts: (credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date }) => ArnProbeSdkClient;
  now?: () => number }) {
  const now = input.now ?? Date.now;
  let session: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date } | null = null;
  let attempted = false;
  return {
    credentials: async () => {
      if (!session || session.expiration.getTime() <= now()) throw new Error("Fixed Operator session is absent or expired.");
      return { ...session };
    },
    prepare: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (!session) {
        if (attempted) throw new Error("Operator AssumeRole is not automatically replayed.");
        const code = await input.mfaCode(); signal.throwIfAborted();
        if (!/^\d{6}$/.test(code)) throw new Error("MFA code must be six digits; never persisted.");
        attempted = true;
        const result = await input.sts.send(new input.assumeRole({ RoleArn: ARN_PROBE_OPERATOR_ROLE, RoleSessionName: ARN_PROBE_OPERATOR_SESSION,
          DurationSeconds: 900, SerialNumber: ARN_PROBE_MFA, TokenCode: code }), { abortSignal: signal });
        const value = object(result.Credentials), user = object(result.AssumedRoleUser), expiry = new Date(String(value.Expiration));
        if (user.Arn !== ARN_PROBE_OPERATOR_CALLER || typeof user.AssumedRoleId !== "string" || !user.AssumedRoleId.startsWith("AROA") || !user.AssumedRoleId.endsWith(`:${ARN_PROBE_OPERATOR_SESSION}`) ||
            typeof value.AccessKeyId !== "string" || typeof value.SecretAccessKey !== "string" || typeof value.SessionToken !== "string" || !Number.isFinite(expiry.getTime()) || expiry.getTime() - now() < 600_000) throw new Error("Fixed MFA Operator session response drifted.");
        session = { accessKeyId: value.AccessKeyId, secretAccessKey: value.SecretAccessKey, sessionToken: value.SessionToken, expiration: expiry };
      }
      const sts = input.createOperatorSts({ ...session });
      const caller = await sts.send(new input.getCallerIdentity({}), { abortSignal: signal }); signal.throwIfAborted();
      if (caller.Account !== ARN_PROBE_ACCOUNT || caller.Arn !== ARN_PROBE_OPERATOR_CALLER || typeof caller.UserId !== "string" || !caller.UserId.startsWith("AROA") || !caller.UserId.endsWith(`:${ARN_PROBE_OPERATOR_SESSION}`)) throw new Error("Operator caller identity drifted.");
      return { callerArn: ARN_PROBE_OPERATOR_CALLER, account: ARN_PROBE_ACCOUNT, expiresAt: session.expiration.toISOString() };
    },
  };
}
export class AwsSdkArnProbeWorkflowWriteAdapter implements ArnProbeWorkflowWrites {
  private readonly manifest: ArnProbeWorkflowManifest;
  private readonly source: ArnProbeSdkClient;
  private readonly operator: ArnProbeSdkClient | undefined;
  private readonly commands: { executeChangeSet: ArnProbeSdkCommand; createChangeSet: ArnProbeSdkCommand; deleteChangeSet?: ArnProbeSdkCommand };
  private readonly prepare: ((signal: AbortSignal) => ReturnType<ArnProbeWorkflowWrites["prepareOperator"]>) | undefined;
  private readonly submitted = new Set<string>();
  constructor(input: { manifest: ArnProbeWorkflowManifest; source: ArnProbeSdkClient; operator?: ArnProbeSdkClient;
    commands: AwsSdkArnProbeWorkflowWriteAdapter["commands"]; prepareOperator?: AwsSdkArnProbeWorkflowWriteAdapter["prepare"] }) {
    this.manifest = JSON.parse(canonicalJson(input.manifest)); this.source = input.source; this.operator = input.operator;
    this.commands = input.commands; this.prepare = input.prepareOperator;
  }
  private async submit(step: string, command: ArnProbeSdkCommand, client: ArnProbeSdkClient, request: unknown, expected: unknown, signal: AbortSignal) {
    await assertArnProbeWorkflowManifest(this.manifest); same(request, expected, `Exact ${step} request`); signal.throwIfAborted();
    if (this.submitted.has(step)) throw new Error("Probe workflow mutation is single-submit; use read-only inspection.");
    this.submitted.add(step);
    return client.send(new command(JSON.parse(canonicalJson(expected))), { abortSignal: signal });
  }
  prepareOperator(signal: AbortSignal) { if (!this.prepare) throw new Error("Revoke-only mode has no Operator capability."); return this.prepare(signal); }
  executeGrant(request: ArnProbeWorkflowManifest["actions"]["grantExecute"]["request"], signal: AbortSignal) {
    if (!this.operator) throw new Error("Revoke-only mode cannot install Grant.");
    return this.submit("grant-execute", this.commands.executeChangeSet, this.source, request, this.manifest.actions.grantExecute.request, signal);
  }
  deleteProbe(request: ArnProbeGrantPlan["futureProbeRequest"], signal: AbortSignal) {
    if (!this.operator || !this.commands.deleteChangeSet) throw new Error("Revoke-only mode cannot delete probe.");
    return this.submit("probe-delete", this.commands.deleteChangeSet, this.operator, request, this.manifest.actions.probeDelete.request, signal);
  }
  createRevoke(request: ArnProbeWorkflowManifest["actions"]["revoke"]["createRequest"], signal: AbortSignal) {
    return this.submit("revoke-create", this.commands.createChangeSet, this.source, request, this.manifest.actions.revoke.createRequest, signal);
  }
  executeRevoke(request: { StackName: string; ChangeSetName: string; ClientRequestToken: string; DisableRollback: false }, signal: AbortSignal) {
    const scope = this.manifest.actions.revoke, name = scope.createRequest.ChangeSetName;
    if (!new RegExp(`^arn:aws:cloudformation:${ARN_PROBE_REGION}:${ARN_PROBE_ACCOUNT}:changeSet/${name}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(request.ChangeSetName)) throw new Error("Revoke Execute requires the exact provider-issued full ARN.");
    return this.submit("revoke-execute", this.commands.executeChangeSet, this.source, request, { StackName: this.manifest.input.plan.managementStackId,
      ChangeSetName: request.ChangeSetName, ClientRequestToken: scope.executeClientToken, DisableRollback: false }, signal);
  }
}
