import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { GetBucketPolicyCommand, GetObjectCommand, S3Client, type GetBucketPolicyCommandOutput, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { AssumeRoleWithWebIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { canonical as ordinal, hash as templateHash } from "../temporary-idle/environment-cfn.mjs";
import { bindFirstOpenInstallProvisionerReadback, bindFirstOpenInstallSharedPredecessorReadback } from "./first-open-inspector-authority-readback.ts";
import { firstOpenInstallInspectorPolicies, firstOpenInstallProvisionerChangeSetName, firstOpenInstallProvisionerLane,
  firstOpenInstallProvisionerObservation, isFirstOpenInstallProvisionerChangeSetId, type FirstOpenInstallWindow,
  type FirstOpenInstallStagingScope } from "./first-open-install-inspector-scope.ts";
import { firstOpenProvisionerChanges, firstOpenProvisionerProjection, type renderFirstOpenProvisionerTargets } from "./first-open-provisioner-policy.ts";
import { assertFirstOpenSession, bindFirstOpenSession, type FirstOpenCaller, type FirstOpenCredentialSource } from "./first-open-sessions.ts";
import { sdkConfig } from "./first-open-express-aws.ts";
import { firstOpenRunnerOidc } from "./first-open-workflow-launcher.ts";
import { firstOpenOwnerStageKey } from "./first-open-owner-stage-proof.ts";
import type { FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import oidc from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

type Env = Readonly<Record<string, string | undefined>>;
type Read = Awaited<ReturnType<typeof bindFirstOpenInstallProvisionerReadback>>;
type Phase = Parameters<Read>[0];
type Projection = Awaited<ReturnType<typeof firstOpenProvisionerProjection>>;
type Targets = Awaited<ReturnType<typeof renderFirstOpenProvisionerTargets>>;
type Target = { templateSha256: string; projection: Projection };
const repo = "veinyyxy/TechlongSoftware", caller = repo + "/.github/workflows/sandbox-first-open-v1.yml@refs/heads/main";
const hex = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, id = /^[1-9][0-9]{0,19}$/;
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSTALL_READBACK_" + code); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const phases = ["grant", "relock"] as const;
const stagePhases = ["shared", ...phases] as const;
type Stage = typeof stagePhases[number];
const stagingPhase = (phase: Stage) => phase === "shared" ? "shared-predecessor" as const : phase === "grant" ? "provisioner-grant" as const : "provisioner-relock" as const;
const planSchema = "techlong/fc41597f-independent-install-readback/v2" as const;
const reportSchema = "techlong/fc41597f-independent-install-observed/v2" as const;
type StagingUpload = { versionId: string; acknowledgedAt: number; putReceiptRawSha256: string };
type UploadEarly = (input: { name: string; member: "handoff.json"; bytes: Uint8Array; signal: AbortSignal }) => Promise<{ artifactId: string }>;
type ReadStaging = {
  readBucketPolicy: (command: GetBucketPolicyCommand, signal: AbortSignal) => Promise<GetBucketPolicyCommandOutput>;
  readObject: (command: GetObjectCommand, signal: AbortSignal) => Promise<GetObjectCommandOutput>;
};

export type FirstOpenInstallReadbackPlan = {
  schema: typeof planSchema;
  lane: typeof firstOpenInstallProvisionerLane;
  jobId: typeof s.jobId;
  release: FirstOpenFrozenRelease;
  releaseSha256: string;
  authorityScopeSha256: string;
  factsReceiptSha256: string;
  window: FirstOpenInstallWindow;
  expectedBucketSha256: string;
  targets: Record<Phase, Target>;
  staging?: { scope: FirstOpenInstallStagingScope; uploads: Partial<Record<Stage, StagingUpload>> };
};

/** Freeze coordinates from the actual install target bytes before any PUT.
 * The inner release approval is distinct from the outer installation plan SHA. */
export function firstOpenInstallStagingKeys(release: FirstOpenFrozenRelease, targets: Targets, readBefore: number, includeShared = false) {
  // The shared transition installs exactly the same closed template that the
  // later Provisioner Relock restores. Separate phases never share a key.
  const entries = stagePhases.filter(phase => phase !== "shared" || includeShared).flatMap(phase => {
    const template = phase === "grant" ? targets.grant : targets.restore;
    const targetBytes = Buffer.byteLength(JSON.stringify(ordinal(template))), targetCanonicalSha256 = templateHash(template);
    if (targetBytes > 1_048_576 || (phase === "shared" && targetBytes <= 51_200)) return fail("STAGE_SIZE");
    if (targetBytes <= 51_200) return [];
    return [[phase, { targetBytes, targetCanonicalSha256, key: firstOpenOwnerStageKey({ approvalSha256: release.approvalSha256,
      phase: stagingPhase(phase), targetCanonicalSha256 }) }]] as const;
  });
  return { readBefore, targets: Object.fromEntries(entries) as Partial<Record<Stage, { targetBytes: number; targetCanonicalSha256: string; key: string }>> };
}

/** Render only projections of exact reviewed templates, never the templates
 * or protected runtime capsules. Seal with a distinct install approval. */
export async function buildFirstOpenInstallReadbackPlan(input: Omit<FirstOpenInstallReadbackPlan, "schema" | "lane" | "jobId" | "targets"> & {
  targets: Targets;
}) {
  const { targets, ...rest } = structuredClone(input);
  if (await sha256Hex(targets.grant) !== targets.grantSha256 || await sha256Hex(targets.restore) !== targets.restoreSha256) return fail("TARGET");
  if (rest.staging) {
    const { sharedObservation } = rest.staging.scope;
    const expected = firstOpenInstallStagingKeys(rest.release, targets, rest.staging.scope.readBefore, sharedObservation !== undefined);
    const pins = Object.fromEntries(Object.entries(expected.targets).map(([k, pin]) => [k,
      { targetBytes: pin.targetBytes, targetCanonicalSha256: pin.targetCanonicalSha256 }]));
    if (!same(rest.staging.scope, { readBefore: expected.readBefore, targets: pins, ...(sharedObservation && { sharedObservation }) })) return fail("STAGE_TARGET");
  }
  const plan: FirstOpenInstallReadbackPlan = { ...rest, schema: planSchema, lane: firstOpenInstallProvisionerLane, jobId: s.jobId,
    targets: {
      grant: { templateSha256: targets.grantSha256, projection: await firstOpenProvisionerProjection(targets.grant) },
      relock: { templateSha256: targets.restoreSha256, projection: await firstOpenProvisionerProjection(targets.restore) },
    } };
  await checkPlan(plan);
  return plan;
}

async function checkPlan(p: FirstOpenInstallReadbackPlan) {
  if (p?.schema !== planSchema || p.lane !== firstOpenInstallProvisionerLane || p.jobId !== s.jobId ||
    ![p.factsReceiptSha256, p.expectedBucketSha256, p.authorityScopeSha256, p.releaseSha256].every(x => hex.test(x)) ||
    ![p.release?.callerCommit, p.release?.runtimeCommit].every(x => commit.test(x)) || !id.test(p.release.workflowId)) return fail("PLAN");
  const { scope } = await firstOpenInstallInspectorPolicies(p.release, p.releaseSha256, p.window, p.authorityScopeSha256, p.staging?.scope);
  if (p.staging) {
    if (!scope.staging || !p.staging.uploads || !same(Object.keys(p.staging.uploads).sort(), Object.keys(scope.staging.targets).sort())) return fail("STAGE_UPLOAD");
    const shared = scope.staging.targets.shared, relock = scope.staging.targets.relock;
    if (shared && (!relock || shared.targetCanonicalSha256 !== relock.targetCanonicalSha256 || shared.targetBytes !== relock.targetBytes)) {
      return fail("SHARED_PREIMAGE");
    }
    for (const x of Object.values(p.staging.uploads)) {
      if (!x || !same(Object.keys(x).sort(), ["acknowledgedAt", "putReceiptRawSha256", "versionId"]) ||
        !validFirstOpenVersionId(x.versionId) || !hex.test(x.putReceiptRawSha256) || !Number.isSafeInteger(x.acknowledgedAt) ||
        x.acknowledgedAt < p.window.startAt || x.acknowledgedAt >= p.staging.scope.readBefore) return fail("STAGE_UPLOAD");
    }
  }
  for (const stage of phases) {
    const t = p.targets[stage], r = t?.projection?.role, docs = t?.projection?.policies;
    const inlineName = stage === "grant" ? "FirstOpenFc41597fWriterFence" : "FirstOpenFc41597fWriterLock";
    if (!r || !docs || !hex.test(t.templateSha256) || r.arn !== scope.roleToRead || r.roleId !== "AROAV3GNMXTZMEBX7MOF7" ||
      r.boundaryArn !== scope.boundaryToRead || !same(r.attached, [r.boundaryArn]) || r.inline.length !== 1 ||
      r.inline[0].name !== inlineName || ![r.inline[0].sha256, r.trustSha256].every(x => hex.test(x)) ||
      docs.length !== 1 || docs[0].policyArn !== r.boundaryArn || !hex.test(docs[0].documentSha256)) return fail("TARGET");
  }
  if (p.targets.grant.templateSha256 === p.targets.relock.templateSha256) return fail("TARGET");
  return scope;
}

export async function authorizeFirstOpenInstallReadback(input: { env: Env; actualCheckout: string }, now = Date.now()) {
  const e = input.env, approved = e.FIRST_OPEN_INSTALL_APPROVED_PLAN_SHA256 ?? "", raw = e.FIRST_OPEN_INSTALL_PROTECTED_PLAN;
  if (e.GITHUB_REPOSITORY !== repo || e.GITHUB_REPOSITORY_ID !== "1323312747" || e.GITHUB_REPOSITORY_OWNER_ID !== "14145707" ||
    e.GITHUB_ACTOR_ID !== "14145707" || e.GITHUB_REF !== "refs/heads/main" || e.GITHUB_RUN_ATTEMPT !== "1" ||
    e.GITHUB_EVENT_NAME !== "workflow_dispatch" || e.GITHUB_WORKFLOW_REF !== caller || !id.test(e.GITHUB_RUN_ID ?? "") ||
    e.GITHUB_RUN_ID !== e.FIRST_OPEN_INSTALL_APPROVED_RUN_ID ||
    !hex.test(approved) || approved !== e.FIRST_OPEN_INSTALL_REQUESTED_PLAN_SHA256 || !raw || Buffer.byteLength(raw) > 32_768) return fail("CONTEXT");
  const p = JSON.parse(raw) as FirstOpenInstallReadbackPlan;
  if (!p || await sha256Hex(p) !== approved || p.release?.callerCommit !== e.GITHUB_SHA ||
    p.release?.runtimeCommit !== input.actualCheckout || p.release?.runtimeCommit !== e.FIRST_OPEN_INSTALL_RUNTIME_COMMIT ||
    p.releaseSha256 !== e.FIRST_OPEN_INSTALL_REQUESTED_RELEASE_SHA256) return fail("PLAN_BINDING");
  const scope = await checkPlan(p);
  if (now < p.window.startAt || now >= p.window.issueBefore || (p.staging &&
    (now >= p.staging.scope.readBefore || Object.values(p.staging.uploads).some(x => x!.acknowledgedAt > now)))) return fail("ISSUE_WINDOW");
  return { plan: p, planSha256: approved, scope, runId: e.GITHUB_RUN_ID! };
}

/** First verify the exact evidence-bucket policy, then make one GET per
 * prepared install object using the same identified install session. */
export async function readFirstOpenInstallStaging(a: Awaited<ReturnType<typeof authorizeFirstOpenInstallReadback>>,
  identity: FirstOpenCaller, read: ReadStaging, upstream: AbortSignal, now = Date.now) {
  const { plan, scope, planSha256, runId } = a;
  const Bucket = FIRST_OPEN_BASELINE_BINDING.bucket;
  if (!plan.staging || !scope.staging || scope.evidenceBucketArn !== `arn:aws:s3:::${Bucket}`) return fail("STAGE_SCOPE");
  assertFirstOpenSession("installObserver", identity, now(), plan.window.relockBefore);
  const deadline = scope.staging.readBefore, remaining = deadline - now();
  if (now() < plan.window.startAt || remaining <= 0) return fail("STAGE_WINDOW");
  const signal = AbortSignal.any([upstream, AbortSignal.timeout(remaining)]);
  signal.throwIfAborted();
  const bucket = await read.readBucketPolicy(new GetBucketPolicyCommand({ Bucket, ExpectedBucketOwner: s.account }), signal);
  signal.throwIfAborted();
  if (now() >= deadline) return fail("STAGE_WINDOW");
  if (bucket.$metadata.httpStatusCode !== 200 || !bucket.Policy || Buffer.byteLength(bucket.Policy) > 32_768) return fail("STAGE_BUCKET_POLICY");
  let evidenceBucketPolicySha256: string;
  try {
    const policy = JSON.parse(bucket.Policy);
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) return fail("STAGE_BUCKET_POLICY");
    evidenceBucketPolicySha256 = await sha256Hex(policy);
  } catch { return fail("STAGE_BUCKET_POLICY"); }
  signal.throwIfAborted();
  if (now() >= deadline) return fail("STAGE_WINDOW");
  if (evidenceBucketPolicySha256 !== plan.expectedBucketSha256) return fail("STAGE_BUCKET_POLICY");
  const receipts: Partial<Record<Stage, { rawSha256: string; receiptB64: string }>> = {};
  for (const phase of stagePhases) {
    const pin = scope.staging.targets[phase];
    if (!pin) continue;
    signal.throwIfAborted();
    const upload = plan.staging.uploads[phase];
    if (!upload || upload.acknowledgedAt > now() || now() >= deadline) return fail("STAGE_WINDOW");
    const req = { Bucket, Key: pin.key, ExpectedBucketOwner: s.account,
      VersionId: upload.versionId, ChecksumMode: "ENABLED" as const };
    const got = await read.readObject(new GetObjectCommand(req), signal);
    const body = got.Body as (AsyncIterable<Uint8Array> & { destroy?(): void }) | undefined;
    const checksum = Buffer.from(pin.targetCanonicalSha256, "hex").toString("base64");
    try {
      if (got.$metadata.httpStatusCode !== 200 || got.VersionId !== req.VersionId || got.DeleteMarker === true ||
        got.ContentType !== "application/json" || got.ContentLength !== pin.targetBytes || got.ContentEncoding !== undefined ||
        got.ServerSideEncryption !== "AES256" || got.ChecksumSHA256 !== checksum || !body?.[Symbol.asyncIterator]) return fail("STAGE_BODY");
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of body) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array) || (bytes += chunk.byteLength) > pin.targetBytes) return fail("STAGE_BODY");
        hash.update(chunk);
      }
      const raw = hash.digest("hex"), checkedAt = now();
      if (bytes !== pin.targetBytes || raw !== pin.targetCanonicalSha256 || checkedAt >= deadline) return fail("STAGE_BODY");
      const receipt = Buffer.from(canonicalJson({ schema: "techlong/fc41597f-owner-stage-exact-get/v1", jobId: s.jobId,
        approvalSha256: plan.release.approvalSha256, phase: stagingPhase(phase), checkedAt,
        putReceiptRawSha256: upload.putReceiptRawSha256, source: { Account: identity.accountId, Arn: identity.arn,
          UserId: `${identity.roleId}:${scope.roleSessionName}` }, request: req, response: { ContentType: got.ContentType,
          ContentLength: bytes, ChecksumSHA256: checksum, ServerSideEncryption: "AES256", bodyRawSha256: raw,
          httpStatus: 200, VersionId: got.VersionId, DeleteMarker: false, ContentEncoding: null } }));
      receipts[phase] = { rawSha256: createHash("sha256").update(receipt).digest("hex"), receiptB64: receipt.toString("base64") };
    } finally { body?.destroy?.(); }
  }
  signal.throwIfAborted();
  if (now() >= deadline) return fail("STAGE_WINDOW");
  return { schema: "techlong/fc41597f-install-staging-observed/v1", jobId: s.jobId, planSha256, runId, attempt: 1,
    approvalSha256: plan.release.approvalSha256, evidenceBucketPolicySha256, receipts };
}

export function firstOpenInstallInspectorCredentials(a: Awaited<ReturnType<typeof authorizeFirstOpenInstallReadback>>,
  env: Env, now = Date.now, getToken = firstOpenRunnerOidc(env),
  openSts: () => Pick<STSClient, "send" | "destroy"> = () => new STSClient({ region: s.region, maxAttempts: 1,
    ignoreConfiguredEndpointUrls: true, credentials: async () => fail("SOURCE_FALLBACK") }),
): FirstOpenCredentialSource {
  let once: ReturnType<FirstOpenCredentialSource> | undefined;
  const { window } = a.plan;
  return () => once ??= (async () => {
    if (now() < window.startAt || now() >= window.issueBefore) return fail("ISSUE_WINDOW");
    const signal = AbortSignal.timeout(Math.max(1, Math.min(15_000, window.issueBefore - now())));
    const token = await getToken("sts.amazonaws.com", signal);
    if (typeof token !== "string" || token.length > 32_768 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return fail("OIDC");
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const common = Object.fromEntries(Object.entries(oidc.federatedTrust.commonClaims).map(([k, v]) => [k.split(":")[1], v]));
    const expected = { ...common, iss: oidc.federatedTrust.issuer, actor_id: a.plan.release.actorId, job_workflow_ref: a.scope.reusableRef,
      run_id: a.runId, run_attempt: "1", event_name: "workflow_dispatch", sha: a.plan.release.callerCommit, workflow_ref: caller };
    if (!Object.entries(expected).every(([k, v]) => claims[k] === v) || now() >= window.issueBefore) return fail("OIDC");
    signal.throwIfAborted();
    const sts = openSts();
    try {
      const { Credentials: c } = await sts.send(new AssumeRoleWithWebIdentityCommand({ RoleArn: a.scope.roleArn,
        RoleSessionName: a.scope.roleSessionName, WebIdentityToken: token,
        DurationSeconds: Math.max(900, Math.ceil((window.relockBefore - now()) / 1000) + 180) }), { abortSignal: signal });
      signal.throwIfAborted();
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !(c.Expiration instanceof Date) ||
        c.Expiration.getTime() <= window.relockBefore) return fail("SESSION");
      return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
    } finally { sts.destroy(); }
  })();
}

const changed = firstOpenProvisionerChanges.map(c => ({
  logicalId: c.logicalId, type: c.logicalId === "ProvisionerRole" ? "AWS::IAM::Role" : "AWS::IAM::ManagedPolicy",
  action: "Modify", replacement: "False",
})).sort((a, b) => a.logicalId.localeCompare(b.logicalId));

/** One scheduled observation per phase, no AWS polling and no rollback API.
 * Failure to observe Grant never suppresses the independent Relock observation.
 * Actual operator Execute ACKs must be reconciled separately. */
export async function observeFirstOpenInstallReadback(
  a: Awaited<ReturnType<typeof authorizeFirstOpenInstallReadback>>, read: Read, upstream: AbortSignal, now = Date.now,
  pause = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }),
) {
  const { plan: p, scope, planSha256, runId } = a;
  const report = { schema: reportSchema, lane: firstOpenInstallProvisionerLane, jobId: s.jobId,
    approvalSha256: p.release.approvalSha256, authorityScopeSha256: p.authorityScopeSha256, planSha256, runId, attempt: 1,
    runtimeCommit: p.release.runtimeCommit, issuerSessionArnSha256: await sha256Hex(`arn:aws:sts::${s.account}:assumed-role/${scope.roleArn.split("/").at(-1)}/${scope.roleSessionName}`),
    phases: {} as Partial<Record<Phase, { status: "UNPROVED" } | { status: "MATCHED_INSTALLED_POLICY_DOCUMENTS"; checkedAt: number;
      changeSetId: string; changeSetName: string; targetSha256: string; projectionSha256: string }>>, executionAuthorized: false as const };
  for (const phase of phases) {
    upstream.throwIfAborted();
    const at = phase === "grant" ? p.window.grantAt : p.window.relockAt;
    const before = phase === "grant" ? p.window.grantBefore : p.window.relockBefore;
    try {
      if (now() < at) await pause(at - now(), upstream);
      if (now() < at || now() >= before) return fail("OBSERVATION_WINDOW");
      const t = p.targets[phase], signal = AbortSignal.any([upstream, AbortSignal.timeout(Math.max(1, before - now()))]);
      const o = await read(phase, [t.projection.role.inline.map(x => x.name)], signal);
      signal.throwIfAborted();
      const name = scope.changeSetNames[phase === "grant" ? 0 : 1];
      if (o.schema !== firstOpenInstallProvisionerObservation || o.lane !== firstOpenInstallProvisionerLane || o.authorizationProved !== false ||
        o.phase !== phase || !Number.isSafeInteger(o.checkedAt) || o.checkedAt < at || o.checkedAt > now() || now() >= before ||
        o.scopeSha256 !== p.authorityScopeSha256 || o.exactOwnerStackArn !== scope.ownerStackArn ||
        o.changeSetName !== name || !isFirstOpenInstallProvisionerChangeSetId(o.exactChangeSetId, name) ||
        o.ownerStackOriginalSha256 !== t.templateSha256 || o.evidenceBucketPolicySha256 !== p.expectedBucketSha256 ||
        !same(o.roles, [t.projection.role]) || !same(o.policies, t.projection.policies) ||
        !same([...o.changes].sort((l, r) => (l.logicalId ?? "").localeCompare(r.logicalId ?? "")), changed)) return fail("OBSERVATION");
      report.phases[phase] = { status: "MATCHED_INSTALLED_POLICY_DOCUMENTS", checkedAt: o.checkedAt,
        changeSetId: o.exactChangeSetId, changeSetName: name,
        targetSha256: t.templateSha256, projectionSha256: await sha256Hex(o) };
    } catch {
      report.phases[phase] = { status: "UNPROVED" };
    }
  }
  return report;
}

/** Reconcile a report obtained from the authenticated exact GitHub run with
 * the independent installer receipt. Observation time is not Execute time. */
export function assertFirstOpenInstallReadbackAck(report: Awaited<ReturnType<typeof observeFirstOpenInstallReadback>>,
  phase: Phase, expected: { lane: typeof firstOpenInstallProvisionerLane; approvalSha256: string;
    planSha256: string; runId: string; changeSetId: string; targetSha256: string; executedAt: number }) {
  if (expected.lane !== firstOpenInstallProvisionerLane || !hex.test(expected.approvalSha256)) return fail("EXECUTE_ACK");
  const name = firstOpenInstallProvisionerChangeSetName(expected.approvalSha256, phase), p = report.phases?.[phase];
  if (report.schema !== reportSchema || report.lane !== firstOpenInstallProvisionerLane || report.jobId !== s.jobId ||
    report.approvalSha256 !== expected.approvalSha256 || !hex.test(report.authorityScopeSha256) || report.executionAuthorized !== false ||
    report.planSha256 !== expected.planSha256 || report.runId !== expected.runId || report.attempt !== 1 ||
    p?.status !== "MATCHED_INSTALLED_POLICY_DOCUMENTS" || p.changeSetId !== expected.changeSetId ||
    p.changeSetName !== name || !isFirstOpenInstallProvisionerChangeSetId(expected.changeSetId, name) ||
    p.targetSha256 !== expected.targetSha256 || !Number.isSafeInteger(expected.executedAt) || !Number.isSafeInteger(p.checkedAt) ||
    expected.executedAt <= 0 || p.checkedAt < expected.executedAt) return fail("EXECUTE_ACK");
  return p;
}

type SharedObservation = Awaited<ReturnType<Awaited<ReturnType<typeof bindFirstOpenInstallSharedPredecessorReadback>>>>;
type SharedReport = { schema: "techlong/fc41597f-install-shared-predecessor-observed/v1"; jobId: string; planSha256: string;
  authorityScopeSha256: string; runId: string; attempt: number; approvalSha256: string; result: SharedObservation };

/** Compare the decoded report from the authenticated exact install run with
 * the separate operator ACK. Neither report can substitute for the other. */
export function assertFirstOpenInstallSharedPredecessorAck(report: SharedReport,
  a: Awaited<ReturnType<typeof authorizeFirstOpenInstallReadback>>,
  ack: { changeSetId: string; executedAt: number; targetSha256: string }) {
  const { plan, scope, planSha256, runId } = a;
  const shared = scope.staging?.sharedObservation, pin = scope.staging?.targets.shared, r = report?.result;
  if (!shared || !pin || report.schema !== "techlong/fc41597f-install-shared-predecessor-observed/v1" || report.jobId !== s.jobId ||
    report.planSha256 !== planSha256 || report.authorityScopeSha256 !== plan.authorityScopeSha256 || report.runId !== runId ||
    report.attempt !== 1 || report.approvalSha256 !== plan.release.approvalSha256 || !r ||
    r.schema !== report.schema || r.lane !== firstOpenInstallProvisionerLane || r.jobId !== s.jobId ||
    r.releaseSha256 !== plan.releaseSha256 || r.approvalSha256 !== report.approvalSha256 || r.authorityScopeSha256 !== plan.authorityScopeSha256 ||
    r.executionAuthorized !== false || r.exactOwnerStackArn !== scope.ownerStackArn || r.changeSetName !== shared.changeSetName ||
    r.changeSetId !== ack.changeSetId || !isFirstOpenInstallProvisionerChangeSetId(ack.changeSetId, shared.changeSetName) ||
    r.targetCanonicalSha256 !== pin.targetCanonicalSha256 || r.targetBytes !== pin.targetBytes || r.key !== pin.key || !hex.test(r.changesSha256) ||
    ack.targetSha256 !== plan.targets.relock.templateSha256 || !Number.isSafeInteger(ack.executedAt) || !Number.isSafeInteger(r.checkedAt) ||
    ack.executedAt < plan.staging!.scope.readBefore || r.checkedAt < Math.max(ack.executedAt, shared.at) || r.checkedAt >= shared.before) {
    return fail("SHARED_EXECUTE_ACK");
  }
  return r;
}

export async function runFirstOpenInstallReadback(input: Parameters<typeof authorizeFirstOpenInstallReadback>[0] & { uploadEarly?: UploadEarly }) {
  const a = await authorizeFirstOpenInstallReadback(input);
  if (a.plan.staging && !input.uploadEarly) return fail("STAGE_ARTIFACT");
  const signal = AbortSignal.timeout(Math.max(1, a.plan.window.relockBefore - Date.now()));
  const observer = bindFirstOpenSession("installObserver", firstOpenInstallInspectorCredentials(a, input.env), a.plan.window.relockBefore);
  // Issue and identify while issuance is allowed, not after the first wait.
  const identity = await observer.identify(signal);
  const { plan: { release, releaseSha256, window, authorityScopeSha256, staging } } = a;
  if (staging) {
    if (Date.now() >= staging.scope.readBefore) return fail("STAGE_WINDOW");
    const early = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, staging.scope.readBefore - Date.now()))]);
    const client = new S3Client(sdkConfig(await observer.credentials(early)));
    try {
      const evidence = await readFirstOpenInstallStaging(a, identity, {
        readBucketPolicy: (cmd, mark) => client.send(cmd, { abortSignal: mark }),
        readObject: (cmd, mark) => client.send(cmd, { abortSignal: mark }),
      }, early);
      await input.uploadEarly!({ name: `fc41597f-${a.planSha256}-install-staging-readback`, member: "handoff.json",
        bytes: Buffer.from(canonicalJson(evidence)), signal: early });
      early.throwIfAborted();
    } finally { client.destroy(); }
  }
  const shared = a.scope.staging?.sharedObservation;
  if (staging && shared) {
    const remaining = shared.before - Date.now();
    if (remaining <= 0) return fail("SHARED_WINDOW");
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
    const wait = shared.at - Date.now();
    if (wait > 0) await delay(wait, undefined, { signal: bounded });
    const read = await bindFirstOpenInstallSharedPredecessorReadback({ release, releaseSha256, window,
      approvedScopeSha256: authorityScopeSha256, credentials: observer.credentials, staging: staging.scope });
    const result = await read(bounded);
    bounded.throwIfAborted();
    if (Date.now() >= shared.before) return fail("SHARED_WINDOW");
    await input.uploadEarly!({ name: `fc41597f-${a.planSha256}-install-shared-predecessor-observed`, member: "handoff.json",
      bytes: Buffer.from(canonicalJson({ schema: "techlong/fc41597f-install-shared-predecessor-observed/v1", jobId: s.jobId,
        planSha256: a.planSha256, authorityScopeSha256, runId: a.runId, attempt: 1, approvalSha256: release.approvalSha256, result })),
      signal: bounded });
    bounded.throwIfAborted();
  }
  const read = await bindFirstOpenInstallProvisionerReadback({ release, releaseSha256, window,
    approvedScopeSha256: authorityScopeSha256, credentials: observer.credentials, staging: staging?.scope });
  return observeFirstOpenInstallReadback(a, read, signal);
}
