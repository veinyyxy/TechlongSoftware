import type { DescribeChangeSetCommandOutput, DescribeStacksCommandOutput, GetTemplateCommandOutput } from "@aws-sdk/client-cloudformation";
import type { GetBucketPolicyCommandInput, GetBucketPolicyCommandOutput } from "@aws-sdk/client-s3";
import type { GetCallerIdentityCommandOutput } from "@aws-sdk/client-sts";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { hash as templateHash } from "../temporary-idle/environment-cfn.mjs";
import { firstOpenInstallBucketStack, firstOpenInstallBucketTargets, type FirstOpenInstallBucketPlan } from "./first-open-install-bucket-executor.ts";
import type { FirstOpenInstallOwnerExecuteAck } from "./first-open-install-owner-executor.ts";
import { parseCloudFormationTemplateDocument } from "./scripts/cloudformation-template-document.mjs";

const account = "402010193138", { bucket, jobId } = FIRST_OPEN_BASELINE_BINDING;
const sourceArn = `arn:aws:iam::${account}:user/techlong-sandbox-dev`, sourceId = "AIDAV3GNMXTZEO7SHLC2X";
const changePrefix = `arn:aws:cloudformation:ca-central-1:${account}:changeSet/`;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hex = /^[a-f0-9]{64}$/;
type Phase = "protect" | "restore";
type Identity = { Account: string; Arn: string; UserId: string };
export type FirstOpenInstallIndependentBucketPorts = {
  identify(signal: AbortSignal): Promise<GetCallerIdentityCommandOutput>;
  describeStack(stackId: string, signal: AbortSignal): Promise<DescribeStacksCommandOutput>;
  describeChange(stackId: string, changeSetId: string, signal: AbortSignal): Promise<DescribeChangeSetCommandOutput>;
  getOriginal(stackId: string, signal: AbortSignal): Promise<GetTemplateCommandOutput>;
  getBucketPolicy(input: GetBucketPolicyCommandInput, signal: AbortSignal): Promise<GetBucketPolicyCommandOutput>;
};
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSTALL_INDEPENDENT_BUCKET_" + code); };
function need(value: unknown, code: string): asserts value { if (!value) fail(code); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const ok = (response: { $metadata?: { httpStatusCode?: number; attempts?: number } } | undefined) =>
  response?.$metadata?.httpStatusCode === 200 && (response.$metadata.attempts === undefined || response.$metadata.attempts === 1);
const clock = (at: unknown): at is number => Number.isSafeInteger(at) && typeof at === "number" && at > 0;

/** The host must supply the previously approved independent reader's exact
 * no-retry transport. Neither this binder nor its two observations mint a role,
 * acquire credentials, write resources or accept Source's assertion as proof. */
export function bindFirstOpenInstallIndependentBucket(input: { plan: FirstOpenInstallBucketPlan; expectedIdentity: Identity;
  ports: FirstOpenInstallIndependentBucketPorts; restoreOnly?: true; terminalSourceOnly?: true; now?: () => number }) {
  const { ports, restoreOnly = false, terminalSourceOnly = false, now = Date.now } = input;
  const plan = structuredClone(input.plan), expected = structuredClone(input.expectedIdentity);
  need(plan?.jobId === jobId && plan.schema === "techlong/fc41597f-install-bucket-retention/v1" && clock(plan.factsExpireAt) &&
    hex.test(plan.installIntentSha256) && [plan.phases?.protect, plan.phases?.restore].every(p => p && clock(p.startAt) && clock(p.writeBefore) &&
      p.startAt < p.writeBefore && p.writeBefore <= plan.factsExpireAt) && plan.phases.protect.writeBefore <= plan.phases.restore.startAt,
    "PLAN");
  const allowed = terminalSourceOnly ? restoreOnly && same(expected, { Account: account, Arn: sourceArn, UserId: sourceId }) :
    expected && expected.Account === account && expected.Arn !== sourceArn && typeof expected.UserId === "string" &&
      expected.UserId.split(":", 1)[0] !== sourceId && /^[A-Z0-9]+(?::[\w+=,.@-]{2,64})?$/.test(expected.UserId) &&
      new RegExp(`^arn:aws:(?:iam::${account}:user|sts::${account}:assumed-role)/[\\w+=,.@/-]{1,160}$`).test(expected.Arn);
  need(allowed, "IDENTITY_SCOPE");
  const targets = firstOpenInstallBucketTargets(plan), witnessed = new Set<Phase>();
  let identity: Identity | undefined, identification: Promise<Identity> | undefined, busy = false, stopped = false;
  const active = (signal: AbortSignal) => {
    const at = now();
    need(!signal.aborted && !stopped && clock(at) && at < plan.factsExpireAt, "WINDOW_OR_STOPPED");
    return at;
  };
  const classify = async <T>(fn: () => Promise<T>, code: string) => {
    try { return await fn(); } catch { return fail(code); }
  };
  return {
    async identify(signal: AbortSignal) {
      active(signal);
      return structuredClone(await (identification ??= (async () => {
        try {
          const response = await classify(() => ports.identify(signal), "IDENTITY_READ_STOP_NO_RETRY");
          active(signal);
          const { Account, Arn, UserId } = response;
          need(ok(response) && same({ Account, Arn, UserId }, expected), "IDENTITY_MISMATCH");
          return (identity = expected);
        } catch (error) { stopped = true; throw error; }
      })()));
    },
    async bucket(phase: Phase, ack: FirstOpenInstallOwnerExecuteAck, signal: AbortSignal) {
      const at = active(signal);
      need((phase === "protect" || phase === "restore") && identity && !busy && !witnessed.has(phase) &&
        (restoreOnly ? phase === "restore" : phase === "protect" || witnessed.has("protect")), "PHASE_OR_IDENTITY");
      const t = phase === "protect" ? targets.protected : targets.original, w = plan.phases[phase];
      const changeSetName = `fc41597f-install-bucket-${plan.installIntentSha256.slice(0, 24)}-${phase}`;
      const prefix = `${changePrefix}${changeSetName}/`;
      need(ack && ack.targetSha256 === t.canonicalSha256 && clock(ack.executedAt) && ack.executedAt >= w.startAt &&
        ack.executedAt < w.writeBefore && ack.executedAt <= at && typeof ack.changeSetId === "string" &&
        ack.changeSetId.startsWith(prefix) && uuid.test(ack.changeSetId.slice(prefix.length)), "ACK_SCOPE");
      const { changeSetId } = ack;
      busy = true;
      try {
        const stack = await classify(() => ports.describeStack(firstOpenInstallBucketStack, signal), "STACK_READ_STOP_NO_RETRY");
        active(signal);
        const s = stack?.Stacks?.[0];
        need(ok(stack) && !stack.NextToken && stack.Stacks?.length === 1 && s?.StackId === firstOpenInstallBucketStack && s.StackStatus === "UPDATE_COMPLETE" &&
          !s.DeletionTime && !s.RoleARN && !s.ParentId && !s.RootId, "STACK_SCOPE");
        const change = await classify(() => ports.describeChange(firstOpenInstallBucketStack, changeSetId, signal), "CHANGE_READ_STOP_NO_RETRY");
        active(signal);
        const c = change?.Changes?.[0];
        need(ok(change) && !change.NextToken && change.StackId === firstOpenInstallBucketStack && change.ChangeSetId === changeSetId &&
          change.ChangeSetName === changeSetName && change.Status === "CREATE_COMPLETE" && change.ExecutionStatus === "EXECUTE_COMPLETE" &&
          !change.ParentChangeSetId && !change.RootChangeSetId && !change.IncludeNestedStacks && !change.ImportExistingResources &&
          change.Changes?.length === 1 && c?.Type === "Resource" && c.ResourceChange?.Action === "Modify" &&
          c.ResourceChange?.LogicalResourceId === "EvidencePolicy" && c.ResourceChange?.ResourceType === "AWS::S3::BucketPolicy" &&
          c.ResourceChange?.PhysicalResourceId === bucket && c.ResourceChange?.Replacement === "False", "CHANGE_SCOPE");
        const template = await classify(() => ports.getOriginal(firstOpenInstallBucketStack, signal), "ORIGINAL_READ_STOP_NO_RETRY");
        active(signal);
        need(ok(template) && template.StagesAvailable?.filter(x => x === "Original").length === 1 &&
          template.StagesAvailable.every(x => x === "Original" || x === "Processed"), "ORIGINAL_STAGE");
        let original: unknown;
        try { original = parseCloudFormationTemplateDocument(template.TemplateBody); } catch { return fail("ORIGINAL_DOCUMENT"); }
        const templateSha256 = templateHash(original);
        need(templateSha256 === t.canonicalSha256, "ORIGINAL_TARGET");
        const bucketResult = await classify(() => ports.getBucketPolicy({ Bucket: bucket, ExpectedBucketOwner: account }, signal), "POLICY_READ_STOP_NO_RETRY");
        active(signal);
        need(ok(bucketResult) && typeof bucketResult.Policy === "string" && Buffer.byteLength(bucketResult.Policy) <= 32_768, "POLICY_SHAPE");
        let doc: unknown;
        try { doc = JSON.parse(bucketResult.Policy); } catch { return fail("POLICY_DOCUMENT"); }
        const policySha256 = await sha256Hex(doc);
        need(policySha256 === await sha256Hex(t.template.Resources.EvidencePolicy.Properties.PolicyDocument), "POLICY_TARGET");
        const observedAt = active(signal);
        need(observedAt >= ack.executedAt, "OBSERVATION_CLOCK");
        witnessed.add(phase);
        return { identity: structuredClone(identity), changeSetId, observedAt, templateSha256, policySha256, matched: true as const };
      } catch (error) { stopped = true; throw error; }
      finally { busy = false; }
    },
  };
}
