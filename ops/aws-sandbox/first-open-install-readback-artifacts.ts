import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_OPEN_BASELINE_BINDING, validFirstOpenVersionId } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { SANDBOX_FIRST_OPEN as s } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { firstOpenArtifactIo } from "./first-open-github-handoff.ts";
import { decodeFirstOpenHandoffArchive } from "./first-open-oidc-offline.ts";
import { firstOpenInstallInspectorPolicies, firstOpenInstallProvisionerLane,
  isFirstOpenInstallProvisionerChangeSetId } from "./first-open-install-inspector-scope.ts";
import { assertFirstOpenInstallSharedPredecessorAck, type FirstOpenInstallReadbackPlan,
  type observeFirstOpenInstallReadback } from "./first-open-install-readback.ts";
import contract from "./first-open-fc41597f-oidc-handoffs.prepared.json" with { type: "json" };

const repo = "veinyyxy/TechlongSoftware", repoId = "1323312747", actorId = "14145707";
const api = `https://api.github.com/repos/${repo}/actions`;
const sha = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, numericId = /^[1-9][0-9]{0,19}$/;
const maxZip = contract.artifactContract.maxZipBytes, maxJson = contract.artifactContract.maxJsonBytes;
const stagePhases = { shared: "shared-predecessor", grant: "provisioner-grant", relock: "provisioner-relock" } as const;
type Stage = keyof typeof stagePhases;
type Kind = "staging" | "shared" | "final";
type Fields = Record<string, unknown>;
const fail = (code: string): never => { throw Error("FIRST_OPEN_INSTALL_ARTIFACT_" + code); };
const object = (value: unknown): Fields => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Fields : fail("BODY");
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const keys = (a: Fields, b: readonly string[]) => same(Object.keys(a).sort(), [...b].sort());
const digest = (v: unknown) => typeof v === "string" && sha.test(v);
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const time = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) ? Date.parse(v) : NaN;
const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) :
  typeof v === "string" && numericId.test(v) ? v : "";
type ExecuteAck = Parameters<typeof assertFirstOpenInstallSharedPredecessorAck>[2];
type SharedReport = Parameters<typeof assertFirstOpenInstallSharedPredecessorAck>[0];
type FinalReport = Awaited<ReturnType<typeof observeFirstOpenInstallReadback>>;
export type FirstOpenInstallStageReadback = Readonly<Record<Stage, { readonly rawSha256: string; readonly bytes: Buffer }>>;

function readFinalZip(zip: Uint8Array, digest: string) {
  if (zip.length < 1 || zip.length > maxZip || hash(zip) !== digest) return fail("ZIP");
  try {
    let count = 0;
    const name = "fc41597f-install-readback.json", files = unzipSync(zip, { filter(entry) {
      if (++count !== 1 || entry.name !== name || ![0, 8].includes(entry.compression) ||
        entry.originalSize < 1 || entry.originalSize > maxJson) return fail("ZIP_MEMBER");
      return true;
    } });
    const bytes = files[name];
    if (count !== 1 || !bytes?.length || bytes.length > maxJson) return fail("ZIP_MEMBER");
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes), body = object(JSON.parse(source));
    // The existing final uploader uses JSON.stringify plus LF, not canonical
    // JSON like the early handoffs. Keep the raw byte hash for reconciliation.
    if (JSON.stringify(body) + "\n" !== source) return fail("BODY");
    return { body, bodySha256: hash(bytes) };
  } catch { return fail("ZIP_BODY"); }
}

/** Requires an independently frozen plan digest, exact GitHub dispatch ACK run
 * ID, and approved Actions-read credential. No discovery, upload, polling,
 * retry, dispatch or AWS API access. Never use producer-supplied REST objects.
 * Provenance assumes the reviewed immutable caller/reusable closure had only
 * its own protected uploader; a GitHub artifact is not an Execute ACK. */
export async function bindFirstOpenInstallReadbackArtifacts(input: {
  plan: FirstOpenInstallReadbackPlan; approvedPlanSha256: string; runId: string; token: string;
  now?: () => number; fetch?: typeof fetch;
}) {
  const { approvedPlanSha256: planSha256, runId } = input, plan = structuredClone(input.plan);
  const { window, release, staging } = plan;
  if (plan.schema !== "techlong/fc41597f-independent-install-readback/v2" || plan.lane !== firstOpenInstallProvisionerLane ||
    plan.jobId !== s.jobId || !digest(planSha256) || await sha256Hex(plan) !== planSha256 ||
    ![plan.releaseSha256, plan.factsReceiptSha256, plan.expectedBucketSha256, plan.authorityScopeSha256].every(digest) ||
    ![release.callerCommit, release.runtimeCommit, release.inspectReusableCommit, release.runOnceReusableCommit,
      release.managementReusableCommit].every(x => commit.test(x)) ||
    !numericId.test(runId) || !numericId.test(release.workflowId) || release.actorId !== actorId || !staging) return fail("SCOPE");
  const { scope } = await firstOpenInstallInspectorPolicies(release, plan.releaseSha256, window, plan.authorityScopeSha256, staging.scope);
  const expectedStages = ["shared", "grant", "relock"] as const, staged = scope.staging, shared = staged?.sharedObservation;
  if (!staged || !shared || !keys(staged.targets, expectedStages) || !keys(staging.uploads, expectedStages) ||
    staged.targets.shared?.targetCanonicalSha256 !== staged.targets.relock?.targetCanonicalSha256 ||
    staged.targets.shared?.targetBytes !== staged.targets.relock?.targetBytes ||
    ![plan.targets?.grant?.templateSha256, plan.targets?.relock?.templateSha256].every(digest)) return fail("SCOPE");
  for (const phase of expectedStages) {
    const upload = staging.uploads[phase];
    if (!upload || !keys(upload, ["versionId", "acknowledgedAt", "putReceiptRawSha256"]) ||
      !validFirstOpenVersionId(upload.versionId) || !digest(upload.putReceiptRawSha256) || !Number.isSafeInteger(upload.acknowledgedAt) ||
      upload.acknowledgedAt < window.startAt || upload.acknowledgedAt >= staged.readBefore) return fail("SCOPE");
  }
  const sender = { Account: s.account, Arn: `arn:aws:sts::${s.account}:assumed-role/${scope.roleArn.split("/").at(-1)}/${scope.roleSessionName}`,
    UserId: `${scope.roleId}:${scope.roleSessionName}` };
  const io = firstOpenArtifactIo({ token: input.token, now: input.now, fetch: input.fetch });
  const runUrl = `${api}/runs/${runId}`;
  const title = `first-open-fc41597f-install-readback-${planSha256}`;
  // GitHub can list referenced reusable files alongside the selected job.
  // Permit only reviewed references, require exactly one exact Inspector ref.
  const reusable = new Map([[scope.reusableRef, release.inspectReusableCommit],
    [`${repo}/${contract.federatedTrust.runOnce.reusablePathCandidate}@${release.runOnceReusableCommit}`, release.runOnceReusableCommit],
    [`${repo}/.github/workflows/sandbox-first-open-management-job-v1.yml@${release.managementReusableCommit}`, release.managementReusableCommit]]);
  function authenticate(run: Fields, kind: Kind) {
    if (id(run.id) !== runId || id(run.workflow_id) !== release.workflowId || run.run_attempt !== 1 || run.event !== "workflow_dispatch" ||
      run.path !== contract.federatedTrust.callerPathCandidate || run.head_branch !== "main" || run.head_sha !== release.callerCommit ||
      run.display_title !== title || id(object(run.actor).id) !== actorId || id(object(run.triggering_actor).id) !== actorId ||
      id(object(run.repository).id) !== repoId || object(run.repository).full_name !== repo ||
      id(object(object(run.repository).owner).id) !== actorId || id(object(run.head_repository).id) !== repoId ||
      (kind === "final" ? run.status !== "completed" || run.conclusion !== "success" :
        run.status !== "in_progress" || run.conclusion !== null) ||
      !Array.isArray(run.referenced_workflows) || run.referenced_workflows.length < 1 || run.referenced_workflows.length > reusable.size) {
      return fail("RUN");
    }
    const seen = new Set<string>();
    for (const unknown of run.referenced_workflows) {
      const ref = object(unknown);
      if (typeof ref.path !== "string" || seen.has(ref.path) || !reusable.has(ref.path) || reusable.get(ref.path) !== ref.sha) return fail("RUN");
      seen.add(ref.path);
    }
    if (!seen.has(scope.reusableRef)) return fail("RUN");
  }

  const names = { staging: `fc41597f-${planSha256}-install-staging-readback`,
    shared: `fc41597f-${planSha256}-install-shared-predecessor-observed`, final: `fc41597f-install-readback-${planSha256}` };
  // Upload cutoff is distinct from operator consumption cutoff.
  const last = Math.min(window.factsCutoff, release.startAt), limits = {
    staging: { from: window.startAt, uploadedBefore: staged.readBefore, consumedBefore: shared.at },
    shared: { from: shared.at, uploadedBefore: shared.before, consumedBefore: window.grantAt },
    final: { from: window.relockAt, uploadedBefore: last, consumedBefore: last },
  };
  const sequence = ["staging", "shared", "final"];
  const seenIds = new Set<string>();
  let index = 0, busy = false, stopped = false;
  function stageReceipts(body: Fields, created: number): FirstOpenInstallStageReadback {
    const rows = object(body.receipts);
    if (!keys(body, ["schema", "jobId", "planSha256", "runId", "attempt", "approvalSha256", "evidenceBucketPolicySha256", "receipts"]) ||
      body.schema !== "techlong/fc41597f-install-staging-observed/v1" || body.jobId !== s.jobId || body.planSha256 !== planSha256 ||
      body.runId !== runId || body.attempt !== 1 || body.approvalSha256 !== release.approvalSha256 ||
      body.evidenceBucketPolicySha256 !== plan.expectedBucketSha256 || !keys(rows, expectedStages)) return fail("STAGING");
    const receipts = {} as Record<Stage, { rawSha256: string; bytes: Buffer }>;
    for (const phase of expectedStages) {
      const row = object(rows[phase]), pin = staged!.targets[phase]!, upload = staging!.uploads[phase]!;
      if (!keys(row, ["rawSha256", "receiptB64"]) || !digest(row.rawSha256) || typeof row.receiptB64 !== "string" ||
        row.receiptB64.length > 10_924) return fail("STAGING");
      const bytes = Buffer.from(row.receiptB64, "base64");
      if (!bytes.length || bytes.length > 8_192 || bytes.toString("base64") !== row.receiptB64 || hash(bytes) !== row.rawSha256) return fail("STAGING");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes), receipt = object(JSON.parse(raw));
      const checksum = Buffer.from(pin.targetCanonicalSha256, "hex").toString("base64");
      if (raw !== canonicalJson(receipt) || !keys(receipt, ["schema", "jobId", "phase", "approvalSha256", "checkedAt", "putReceiptRawSha256",
        "source", "request", "response"]) || receipt.schema !== "techlong/fc41597f-owner-stage-exact-get/v1" || receipt.jobId !== s.jobId ||
        receipt.phase !== stagePhases[phase] || receipt.approvalSha256 !== release.approvalSha256 ||
        !same(receipt.source, sender) || receipt.putReceiptRawSha256 !== upload.putReceiptRawSha256 ||
        !Number.isSafeInteger(receipt.checkedAt) || Number(receipt.checkedAt) < upload.acknowledgedAt ||
        Number(receipt.checkedAt) >= staged!.readBefore || Number(receipt.checkedAt) > created + 1000 || Number(receipt.checkedAt) > io.now() ||
        !same(receipt.request, { Bucket: FIRST_OPEN_BASELINE_BINDING.bucket, Key: pin.key, ExpectedBucketOwner: s.account,
          VersionId: upload.versionId, ChecksumMode: "ENABLED" }) ||
        !same(receipt.response, { ContentType: "application/json", ContentLength: pin.targetBytes, ChecksumSHA256: checksum,
          ServerSideEncryption: "AES256", bodyRawSha256: pin.targetCanonicalSha256, httpStatus: 200, VersionId: upload.versionId,
          DeleteMarker: false, ContentEncoding: null })) return fail("STAGING");
      receipts[phase] = { rawSha256: row.rawSha256 as string, bytes };
    }
    return receipts;
  }

  async function exchange<T>(kind: Kind, upstream: AbortSignal, accept: (body: Fields, rawSha256: string, created: number) => Promise<T> | T) {
    if (busy || stopped || sequence[index] !== kind) return fail("SEQUENCE");
    busy = true;
    const limit = limits[kind], signal = AbortSignal.any([upstream,
      AbortSignal.timeout(Math.max(1, Math.min(3_300_000, limit.consumedBefore - io.now())))]);
    const inside = () => {
      if (signal.aborted || !(io.now() >= limit.from && io.now() < limit.consumedBefore)) return fail("WINDOW");
    };
    try {
      inside();
      authenticate(await io.json(runUrl, signal), kind);
      inside();
      const list = await io.json(`${runUrl}/artifacts?name=${names[kind]}&per_page=2`, signal);
      if (list.total_count !== 1 || !Array.isArray(list.artifacts) || list.artifacts.length !== 1) return fail("ARTIFACT_COUNT");
      const a = object(list.artifacts[0]), ref = object(a.workflow_run), artifactId = id(a.id), created = time(a.created_at);
      if (!artifactId || seenIds.has(artifactId) || a.name !== names[kind] || a.expired !== false || !(time(a.expires_at) > io.now()) ||
        !(created >= limit.from && created <= io.now() && created < limit.uploadedBefore) ||
        typeof a.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(a.digest) ||
        !Number.isSafeInteger(a.size_in_bytes) || Number(a.size_in_bytes) < 1 || Number(a.size_in_bytes) > maxZip ||
        a.archive_download_url !== `${api}/artifacts/${artifactId}/zip` || id(ref.id) !== runId ||
        id(ref.repository_id) !== repoId || id(ref.head_repository_id) !== repoId || ref.head_sha !== release.callerCommit ||
        ref.head_branch !== "main") return fail("ARTIFACT");
      inside();
      const zip = await io.archive(artifactId, signal);
      inside();
      authenticate(await io.json(runUrl, signal), kind);
      inside();
      if (zip.length !== a.size_in_bytes) return fail("ARCHIVE_SIZE");
      const { body, bodySha256 } = kind === "final" ? readFinalZip(zip, a.digest.slice(7)) : decodeFirstOpenHandoffArchive(zip, a.digest.slice(7));
      const result = await accept(body, bodySha256, created);
      inside();
      seenIds.add(artifactId);
      index++;
      return result;
    } catch (error) {
      stopped = true;
      if (error instanceof Error && /^FIRST_OPEN_(?:INSTALL_ARTIFACT|INSTALL_READBACK|HANDOFF|OFFLINE)_[A-Z_]+$/.test(error.message)) throw error;
      return fail("STOP_NO_RETRY");
    } finally { busy = false; }
  }
  return {
    readStaging: (signal: AbortSignal) => exchange("staging", signal, (body, _sha, created) => stageReceipts(body, created)),
    readSharedPredecessor(ack: ExecuteAck, signal: AbortSignal) {
      const observedAck = structuredClone(ack);
      return exchange("shared", signal, (body, rawSha256, created) => {
        if (!keys(body, ["schema", "jobId", "planSha256", "authorityScopeSha256", "runId", "attempt", "approvalSha256", "result"])) return fail("SHARED");
        const resultFields = object(body.result);
        if (!keys(resultFields, ["schema", "lane", "jobId", "releaseSha256", "approvalSha256", "authorityScopeSha256", "checkedAt",
          "exactOwnerStackArn", "changeSetName", "changeSetId", "targetCanonicalSha256", "targetBytes", "key", "changesSha256",
          "executionAuthorized"]) || Number(resultFields.checkedAt) > created + 1000 || Number(resultFields.checkedAt) > io.now()) return fail("SHARED");
        const report = body as unknown as SharedReport;
        return { report, result: assertFirstOpenInstallSharedPredecessorAck(report, { plan, scope, planSha256, runId }, observedAck), rawSha256 };
      });
    },
    readFinal: (signal: AbortSignal) => exchange("final", signal, async (body, rawSha256, created) => {
      if (!keys(body, ["schema", "lane", "jobId", "approvalSha256", "authorityScopeSha256", "planSha256", "runId", "attempt",
        "runtimeCommit", "issuerSessionArnSha256", "phases", "executionAuthorized"]) ||
        body.schema !== "techlong/fc41597f-independent-install-observed/v2" || body.lane !== firstOpenInstallProvisionerLane ||
        body.jobId !== s.jobId || body.approvalSha256 !== release.approvalSha256 || body.authorityScopeSha256 !== plan.authorityScopeSha256 ||
        body.planSha256 !== planSha256 || body.runId !== runId || body.attempt !== 1 || body.runtimeCommit !== release.runtimeCommit ||
        body.issuerSessionArnSha256 !== await sha256Hex(sender.Arn) || body.executionAuthorized !== false) return fail("FINAL");
      const phases = object(body.phases);
      if (!keys(phases, ["grant", "relock"])) return fail("FINAL");
      for (const [index, phase] of (["grant", "relock"] as const).entries()) {
        const p = object(phases[phase]), name = scope.changeSetNames[index], startAt = phase === "grant" ? window.grantAt : window.relockAt,
          before = phase === "grant" ? window.grantBefore : window.relockBefore;
        if (!keys(p, ["status", "checkedAt", "changeSetId", "changeSetName", "targetSha256", "projectionSha256"]) ||
          p.status !== "MATCHED_INSTALLED_POLICY_DOCUMENTS" || p.changeSetName !== name ||
          !isFirstOpenInstallProvisionerChangeSetId(p.changeSetId as string, name) || p.targetSha256 !== plan.targets[phase].templateSha256 ||
          !digest(p.projectionSha256) || !Number.isSafeInteger(p.checkedAt) || Number(p.checkedAt) < startAt ||
          Number(p.checkedAt) >= before || Number(p.checkedAt) > created + 1000 || Number(p.checkedAt) > io.now()) return fail("FINAL");
      }
      return { report: body as unknown as FinalReport, rawSha256 };
    }),
  };
}
