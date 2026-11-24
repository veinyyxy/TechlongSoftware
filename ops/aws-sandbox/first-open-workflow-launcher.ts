import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF } from "../../lib/deployments/execution/first-onboarding-approval.ts";
import { checkSandboxFirstOpenApproval } from "../../lib/deployments/execution/first-onboarding-run-once.ts";
import { bindFirstOpenReleaseEntry, firstOpenLifecycleAuthoritySchedule, firstOpenReleasePairSha256, firstOpenReleaseTransport,
  type FirstOpenFrozenRelease } from "./first-open-release-entry.ts";
import { bindFirstOpenExpressInspector, bindProtectedFirstOpenManagementClient, bindReviewedSandboxFirstOpenWithExpress,
  runProtectedFirstOpenManagement } from "./first-open-express-runtime.ts";
import { prepareFirstOpenInspectSeed, type FirstOpenInspectSeed } from "./first-open-inspect-input.ts";
import { firstOpenGitHubIssuedSession, firstOpenSessionArn } from "./first-open-sessions.ts";
import { firstOpenGitHubAuthorityArtifacts } from "./first-open-github-handoff.ts";
import type { VersionAuthorityScope } from "./first-open-controlled-cfn.ts";

const repo = "veinyyxy/TechlongSoftware", dispatcher = ".github/workflows/sandbox-first-open-v1.yml";
const hex = /^[a-f0-9]{64}$/, id = /^[1-9][0-9]{0,19}$/;
const fail = (code: string): never => { throw Error("FIRST_OPEN_LAUNCH_" + code); };
type Actual = Parameters<typeof bindFirstOpenReleaseEntry>[2];
type Mode = Actual["role"];
type RuntimeApproval = Parameters<typeof checkSandboxFirstOpenApproval>[0];
type HandoffUpload = Parameters<typeof firstOpenReleaseTransport>[3]["uploadOwn"];
type Management = Parameters<typeof runProtectedFirstOpenManagement>[0];
type Writer = Parameters<typeof bindReviewedSandboxFirstOpenWithExpress>[0];
type Inspector = Parameters<typeof bindFirstOpenExpressInspector>[0];
type Managed<T> = T & { dispose?(): void | Promise<void> };

export interface FirstOpenLaunchRecord {
  schema: "techlong/sandbox-first-open-protected-launch/v1";
  release: FirstOpenFrozenRelease;
  approval: RuntimeApproval;
  /** Full split approval SHA, read only from the authenticated launch record. */
  formalApprovalSha256?: string;
  inspectorSeed: FirstOpenInspectSeed;
  hostSha256: Record<Mode, string>;
  /** Exact reviewed Inspector authority-read source; never a workflow input. */
  versionAuthoritySourceSha256?: string;
  /** The operator's formal Grant ACK pin, not an independent IAM receipt. */
  formalProvisionerGrantAckSha256?: string;
}

/** Host-side adapters from the privately sealed installation, never dispatcher
 * arguments. Providers do not choose the role, tenant, lease, peer or SHA. */
export interface FirstOpenRolePorts {
  management(input: { signal: AbortSignal }): Promise<Managed<Pick<Management, "management" | "claimReader"> &
    Partial<Pick<Management, "controlledCfnPreclaimProof" | "versionAuthorityReader">>>>;
  runonce(input: { credentials: Writer["sources"]["provisionerCredentials"]; approvalSha256: string; signal: AbortSignal;
    approval: RuntimeApproval; formalApprovalSha256?: string; seed: FirstOpenInspectSeed; initialVersionId: string }):
    Promise<Managed<Pick<Writer, "sql" | "aws" | "middle" | "ports" | "runtimeGrantEvidenceSha256" | "verifyRuntimeGrant"> & {
      uploadOwn: HandoffUpload; loadTenantPaymentMaterial: Writer["sources"]["loadTenantPaymentMaterial"];
      controlMaterial: NonNullable<Writer["sources"]["controlMaterial"]>;
    }>>;
  inspect(input: { signal: AbortSignal }): Promise<Pick<Inspector, "backendDirectory" | "readOnly"> & { uploadOwn: HandoffUpload;
    versionAuthorityProof?: { sourceSha256: string } & Pick<NonNullable<Inspector["versionAuthority"]>,
      "verifyFormalGrantWithInspector" | "verifyWithInspector" | "verifyRelockWithInspector">;
  }>;
}

type LaunchEnvironment = Readonly<Record<string, string | undefined>>;
export interface LocalLaunch {
  role: Mode;
  env: LaunchEnvironment;
  actualCheckout: string;
  expectedCheckout: string;
}
const same = (l: unknown, r: unknown) => canonicalJson(l) === canonicalJson(r);
const protectedJson = (value: string | undefined): FirstOpenLaunchRecord => {
  if (!value || Buffer.byteLength(value, "utf8") > 128 * 1024) return fail("PROTECTED_RECORD_REQUIRED");
  try { return JSON.parse(value) as FirstOpenLaunchRecord; } catch { return fail("PROTECTED_RECORD_INVALID"); }
};

/** Local gate; no GitHub, OIDC, AWS, Neon, protected adapter load, or upload. */
export async function authorizeFirstOpenLaunch(input: LocalLaunch, now = Date.now()) {
  const { env, role } = input;
  if (!["management", "runonce", "inspect"].includes(role) || env.GITHUB_REPOSITORY !== repo ||
    env.GITHUB_REPOSITORY_ID !== "1323312747" || env.GITHUB_REPOSITORY_OWNER_ID !== "14145707" ||
    env.GITHUB_ACTOR_ID !== "14145707" || env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_RUN_ATTEMPT !== "1" ||
    !id.test(env.GITHUB_RUN_ID ?? "") || !hex.test(env.FIRST_OPEN_PAIR ?? "") ||
    !hex.test(env.FIRST_OPEN_APPROVED_RELEASE_SHA256 ?? "") || env.FIRST_OPEN_APPROVED_RELEASE_SHA256 !== env.FIRST_OPEN_RELEASE ||
    !hex.test(env.FIRST_OPEN_APPROVED_LAUNCH_SHA256 ?? "") ||
    !(role === "inspect" ? env.FIRST_OPEN_INSPECT_RUN === "0" : id.test(env.FIRST_OPEN_INSPECT_RUN ?? ""))) return fail("GITHUB_CONTEXT");
  const record = protectedJson(env.FIRST_OPEN_PROTECTED_RECORD), trustedLaunchSha256 = env.FIRST_OPEN_APPROVED_LAUNCH_SHA256!;
  if (record?.schema !== "techlong/sandbox-first-open-protected-launch/v1" ||
    await sha256Hex(record) !== trustedLaunchSha256 ||
    !same(Object.keys(record.hostSha256 ?? {}).sort(), ["inspect", "management", "runonce"]) ||
    !Object.values(record.hostSha256).every(s => hex.test(s))) return fail("PROTECTED_SEAL");
  const release = record.release, trustedReleaseSha256 = env.FIRST_OPEN_APPROVED_RELEASE_SHA256!;
  if (!release || await sha256Hex(release) !== trustedReleaseSha256 || release.callerCommit !== env.GITHUB_SHA ||
    env.GITHUB_WORKFLOW_REF !== `${repo}/${dispatcher}@refs/heads/main` ||
    release.runtimeCommit !== input.actualCheckout || release.runtimeCommit !== input.expectedCheckout ||
    !Number.isSafeInteger(release.startAt) || !Number.isSafeInteger(release.claimBefore) ||
    now < release.startAt || now >= release.claimBefore) return fail("CODE_OR_WINDOW");
  const { formalApprovalSha256 } = record;
  if (record.approval?.approvalBinding === FIRST_ONBOARDING_DEFERRED_CLEANUP_PROOF ? typeof formalApprovalSha256 !== "string" ||
    !hex.test(formalApprovalSha256) || formalApprovalSha256 === release.approvalSha256 : formalApprovalSha256 !== undefined) {
    return fail("FORMAL_APPROVAL_BINDING");
  }
  const approval = await checkSandboxFirstOpenApproval(record.approval, release.approvalSha256, now, formalApprovalSha256);
  if (formalApprovalSha256 !== undefined && await firstOpenReleasePairSha256(release, trustedReleaseSha256,
    trustedLaunchSha256) !== env.FIRST_OPEN_PAIR) return fail("FORMAL_APPROVAL_PAIR_BINDING");
  if (approval.writeBefore !== release.writeBefore || approval.controlledWindow?.startAt !== release.startAt ||
    approval.controlledWindow?.claimBefore !== release.claimBefore) return fail("APPROVAL_WINDOW");
  if (!same(release.taskRelease ?? null, approval.taskRelease ?? null)) return fail("TASK_RELEASE");
  const sourceSha = record.versionAuthoritySourceSha256, grantAckSha = record.formalProvisionerGrantAckSha256;
  if (release.taskRelease ? typeof sourceSha !== "string" || !hex.test(sourceSha) || typeof grantAckSha !== "string" || !hex.test(grantAckSha)
    : sourceSha !== undefined || grantAckSha !== undefined) return fail("AUTHORITY_SOURCE_UNBOUND");
  firstOpenLifecycleAuthoritySchedule(release);
  return { record, approval, trustedReleaseSha256, trustedLaunchSha256 };
}

/** The installer must independently review and supply the exact per-role
 * ESM capsule in its protected environment. The dispatch cannot name, fetch
 * or replace it, and a clean runner never reads a home directory or .env. */
export async function sealedFirstOpenHost(encoded: string | undefined, role: Mode, expected: string): Promise<FirstOpenRolePorts> {
  if (!encoded || encoded.length > 175_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    !hex.test(expected) || !["management", "runonce", "inspect"].includes(role)) return fail("HOST_SEAL");
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 128 * 1024 || bytes.toString("base64") !== encoded ||
      createHash("sha256").update(bytes).digest("hex") !== expected) return fail("HOST_BYTES");
    // Only the previously approved exact bytes, never code from a dispatch input.
    const host = await import("data:text/javascript;base64," + bytes.toString("base64"));
    if (typeof host.firstOpenHost?.[role] !== "function") return fail("HOST_PORT");
    return Object.freeze({ [role]: host.firstOpenHost[role] }) as FirstOpenRolePorts;
  } catch { return fail("SEALED_HOST_UNAVAILABLE"); }
}

/** Use the current action host's issuer only, never a default AWS profile or
 * a token pasted into a workflow input. STS still validates the signed token. */
export function firstOpenRunnerOidc(env: LaunchEnvironment, fetcher: typeof fetch = fetch) {
  return async (audience: string, signal: AbortSignal) => {
    if (audience !== "sts.amazonaws.com" || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) return fail("OIDC_SOURCE");
    const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
    if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com") || url.port || url.username || url.password || url.hash) return fail("OIDC_SOURCE");
    url.searchParams.set("audience", audience);
    const response = await fetcher(url, { method: "GET", redirect: "error", signal,
      headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
    if (!response.ok) return fail("OIDC_STATUS");
    const { value } = await response.json() as { value: string };
    return value;
  };
}

/** Resolve only the exact approved pair, never dispatch or rerun. On the
 * inspector side RunOnce's assigned id is not known at file seal time. */
export async function firstOpenPeerRun(input: LocalLaunch, signal: AbortSignal, now = Date.now, fetcher: typeof fetch = fetch,
  pause = (ms: number, s: AbortSignal) => delay(ms, undefined, { signal: s })) {
  const { record } = await authorizeFirstOpenLaunch(input, now());
  const r = record.release, { env, role } = input, own = env.GITHUB_RUN_ID!, pair = env.FIRST_OPEN_PAIR!;
  if (!env.GH_TOKEN) return fail("HANDOFF_TOKEN");
  const api = `https://api.github.com/repos/${repo}/actions`;
  const request = async (path: string) => {
    if (now() >= r.claimBefore) return fail("PEER_WINDOW");
    const resp = await fetcher(api + path, { method: "GET", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(8000, r.claimBefore - now())))]),
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json" } });
    if (!resp.ok || !resp.body) return fail("PEER_HTTP");
    const reader = resp.body.getReader(), chunks: Buffer[] = [];
    let length = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.byteLength;
        if (length > 512 * 1024) return fail("PEER_BODY");
        chunks.push(Buffer.from(item.value));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return fail("PEER_BODY"); }
    finally { await reader.cancel().catch(() => {}); }
  };
  const title = (inspector: boolean, inspect: string) => inspector
    ? `first-open-fc41597f-inspect-${pair}` : `first-open-fc41597f-runonce-${pair}-${inspect}`;
  const match = (value: Record<string, unknown>, expectedTitle: string) => {
    const row = value as { id?: unknown; actor?: { id?: unknown }; triggering_actor?: { id?: unknown };
      repository?: { id?: unknown; full_name?: unknown; owner?: { id?: unknown } }; head_repository?: { id?: unknown } };
    return id.test(String(row.id)) && value.run_attempt === 1 && String(value.workflow_id) === r.workflowId &&
      value.event === "workflow_dispatch" && value.path === dispatcher && value.head_branch === "main" && value.head_sha === r.callerCommit &&
      value.display_title === expectedTitle && value.conclusion === null && ["waiting", "pending", "queued", "in_progress", "requested"].includes(String(value.status)) &&
      String(row.repository?.id) === "1323312747" && row.repository?.full_name === repo && String(row.repository?.owner?.id) === "14145707" &&
      String(row.head_repository?.id) === "1323312747" && String(row.actor?.id) === r.actorId && String(row.triggering_actor?.id) === r.actorId;
  };
  const onInspect = role === "inspect", inspector = onInspect ? own : env.FIRST_OPEN_INSPECT_RUN!;
  const current = await request(`/runs/${own}`) as Record<string, unknown>;
  if (!match(current, title(onInspect, inspector)) || String(current.id) !== own || current.status !== "in_progress") return fail("OWN_RUN");
  if (!onInspect) {
    const peer = await request(`/runs/${inspector}`) as Record<string, unknown>;
    if (!match(peer, title(true, inspector)) || String(peer.id) !== inspector) return fail("PEER_RUN");
    return inspector;
  }
  for (let i = 0; i < 6; i++) {
    const page = await request(`/workflows/${r.workflowId}/runs?branch=main&event=workflow_dispatch&per_page=20`) as { workflow_runs?: Record<string, unknown>[] };
    if (!Array.isArray(page.workflow_runs) || page.workflow_runs.length > 20) return fail("PEER_LIST");
    const candidates = page.workflow_runs.filter(item => item.display_title === title(false, own));
    if (candidates.length > 1) return fail("PEER_AMBIGUOUS");
    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (!match(candidate, title(false, own)) || String(candidate.id) === own) return fail("PEER_RUN");
      return String(candidate.id);
    }
    if (i < 5) await pause(Math.max(1, Math.min(5000, r.claimBefore - now())), signal);
  }
  return fail("PEER_UNAVAILABLE");
}

/** No dispatcher, installation or start API here. The same launch gate is
 * used by all three roles, and only the corresponding existing binder runs. */
export async function launchFirstOpenJob(input: LocalLaunch & {
  peerRunId: string;
  readHost?(role: Mode, sha: string): Promise<FirstOpenRolePorts>;
}, upstream: AbortSignal, now = Date.now) {
  const { env, role, peerRunId } = input,
    { record, approval, trustedReleaseSha256, trustedLaunchSha256 } = await authorizeFirstOpenLaunch(input, now());
  const release = record.release, ownRunId = env.GITHUB_RUN_ID!;
  if (!id.test(peerRunId) || peerRunId === ownRunId || (role !== "inspect" && peerRunId !== env.FIRST_OPEN_INSPECT_RUN)) return fail("PEER_RUN");
  const paths = { management: "management", runonce: "run-once", inspect: "inspect" };
  const reuse = { management: release.managementReusableCommit, runonce: release.runOnceReusableCommit, inspect: release.inspectReusableCommit };
  const actual: Actual = {
    role, ownRunId, inspectId: role === "inspect" ? ownRunId : peerRunId, runOnceId: role === "inspect" ? peerRunId : ownRunId,
    attempt: 1, repository: repo, ref: env.GITHUB_REF!, workflowId: release.workflowId, actorId: env.GITHUB_ACTOR_ID!,
    callerCommit: env.GITHUB_SHA!, runtimeCommit: input.actualCheckout, runtimeSourceSha256: release.runtimeSourceSha256,
    reusableRef: `${repo}/.github/workflows/sandbox-first-open-${paths[role]}-job-v1.yml@${reuse[role]}`,
    pairSha256: env.FIRST_OPEN_PAIR!, inspectorSessionArnSha256: await sha256Hex(firstOpenSessionArn("inspector")),
    ...(record.formalApprovalSha256 !== undefined && { approvedLaunchSha256: trustedLaunchSha256 }),
  };
  const { pair } = await bindFirstOpenReleaseEntry(release, trustedReleaseSha256, actual);
  const token = env.GH_TOKEN;
  const { versionAuthoritySourceSha256: sourceSha256, formalApprovalSha256 } = record;
  const formalAckSha256 = record.formalProvisionerGrantAckSha256;
  if (!token) return fail("HANDOFF_TOKEN");
  const authorityArtifacts = (uploadOwn?: HandoffUpload) => sourceSha256 ? firstOpenGitHubAuthorityArtifacts({
    pair, role, ownRunId, token, now, sourceSha256, submitBefore: release.phaseCutoffs[3],
    inspectReusableCommit: release.inspectReusableCommit, runOnceReusableCommit: release.runOnceReusableCommit, uploadOwn,
  }) : undefined;
  const remaining = release.writeBefore - now();
  if (remaining <= 0 || now() >= release.claimBefore) return fail("WINDOW");
  const signal = AbortSignal.any([upstream, AbortSignal.timeout(remaining)]);
  const prepared = await prepareFirstOpenInspectSeed(record.inspectorSeed, release.inspectorSeedSha256, approval, release.approvalSha256, signal);
  const host = await (input.readHost ?? ((m, sha) => sealedFirstOpenHost(env.FIRST_OPEN_PROTECTED_HOST_B64, m, sha)))(role, record.hostSha256[role]);
  signal.throwIfAborted();
  const getToken = firstOpenRunnerOidc(env);
  const hostInput = {
    release, trustedReleaseSha256, actual, approval, formalApprovalSha256,
    scope: { approvalSha256: release.approvalSha256, releaseSha256: trustedReleaseSha256, runId: actual.runOnceId,
      writeBefore: release.writeBefore, applicationLoginBefore: release.applicationLoginBefore, express: approval.express!,
      fence: { fence: prepared.epoch.resourceFence, externalFence: prepared.epoch }, initialVersionId: prepared.versionId },
  };
  if (role === "management") {
    const ports = await host.management({ signal });
    try {
      const artifacts = authorityArtifacts();
      const schedule = firstOpenLifecycleAuthoritySchedule(release);
      if (artifacts && ports.controlledCfnPreclaimProof?.authoritySourceSha256 !== artifacts.sourceSha256) return fail("AUTHORITY_SOURCE_UNBOUND");
      const waitForReceipt = async (stage: "grant" | "relock", upstream: AbortSignal) => {
        if (!schedule) return fail("AUTHORITY_SOURCE_UNBOUND");
        const notBefore = stage === "grant" ? schedule.grantNotBefore : schedule.relockNotBefore;
        const cutoff = stage === "grant" ? release.phaseCutoffs[3] : release.phaseCutoffs[4];
        const left = cutoff - now();
        upstream.throwIfAborted();
        if (left <= 0) return fail("AUTHORITY_RECEIPT_WINDOW");
        const bounded = AbortSignal.any([upstream, AbortSignal.timeout(left)]);
        const wait = notBefore - now();
        if (wait > 0) await delay(wait, undefined, { signal: bounded });
        bounded.throwIfAborted();
        if (now() < notBefore || now() >= cutoff) return fail("AUTHORITY_RECEIPT_WINDOW");
        return bounded;
      };
      let installed: VersionAuthorityScope | undefined;
      const versionAuthorityReader = artifacts && { sourceSha256: artifacts.sourceSha256,
        async readVerified(scope: VersionAuthorityScope, bounded: AbortSignal) {
          const result = await artifacts.readVerified(scope, await waitForReceipt("grant", bounded));
          if (!schedule || typeof result.checkedAt !== "number" || result.checkedAt < schedule.grantNotBefore) return fail("AUTHORITY_RECEIPT_WINDOW");
          installed = structuredClone(scope);
          return result;
        } };
      await runProtectedFirstOpenManagement({ ...hostInput, getToken, management: ports.management, claimReader: ports.claimReader,
        renderStack: prepared.renderStack, controlledCfnPreclaimProof: ports.controlledCfnPreclaimProof,
        versionAuthorityReader: versionAuthorityReader ?? ports.versionAuthorityReader }, signal, now);
      // The broker has already written the existing CreateStack reply; waiting
      // earlier would prevent RunOnce from sending Inspector its runtime check.
      if (artifacts) {
        if (!installed) return fail("AUTHORITY_RELOCK_UNBOUND");
        const result = await artifacts.readRelocked(installed, await waitForReceipt("relock", signal));
        if (!schedule || typeof result.payload.checkedAt !== "number" || result.payload.checkedAt < schedule.relockNotBefore) {
          return fail("AUTHORITY_RECEIPT_WINDOW");
        }
      }
    } finally { await ports.dispose?.(); }
    return;
  }
  const credentialSource = firstOpenGitHubIssuedSession({ release, trustedReleaseSha256, actual, getToken }, now);
  if (role === "inspect") {
    const { uploadOwn, backendDirectory, readOnly, versionAuthorityProof } = await host.inspect({ signal });
    const artifacts = authorityArtifacts(uploadOwn);
    if (artifacts && (!versionAuthorityProof || versionAuthorityProof.sourceSha256 !== artifacts.sourceSha256 ||
      typeof versionAuthorityProof.verifyFormalGrantWithInspector !== "function" ||
      typeof versionAuthorityProof.verifyWithInspector !== "function" ||
      typeof versionAuthorityProof.verifyRelockWithInspector !== "function")) return fail("AUTHORITY_SOURCE_UNBOUND");
    const { wire } = await firstOpenReleaseTransport(release, trustedReleaseSha256, { ...actual, role }, { token, uploadOwn, now });
    await bindFirstOpenExpressInspector({ approval, approvalSha256: release.approvalSha256, formalApprovalSha256, wire,
      expectedSeed: record.inspectorSeed, expectedSeedSha256: release.inspectorSeedSha256,
      inspectorCredentials: credentialSource, backendDirectory, readOnly,
      ...(artifacts && versionAuthorityProof && formalAckSha256 && { versionAuthority: { artifacts, runId: actual.runOnceId, submitBefore: release.phaseCutoffs[3],
        formalProvisionerGrantAckSha256: formalAckSha256, verifyFormalGrantWithInspector: versionAuthorityProof.verifyFormalGrantWithInspector,
        verifyWithInspector: versionAuthorityProof.verifyWithInspector,
        verifyRelockWithInspector: versionAuthorityProof.verifyRelockWithInspector } }) }, now)(signal);
    return;
  }
  const { uploadOwn, loadTenantPaymentMaterial, controlMaterial, dispose, ...ports } = await host.runonce({ credentials: credentialSource,
    approvalSha256: release.approvalSha256, approval, formalApprovalSha256, seed: record.inspectorSeed, initialVersionId: prepared.versionId, signal });
  try {
    if (!controlMaterial) return fail("RUNONCE_CONTROL_UNBOUND");
    const { wire } = await firstOpenReleaseTransport(release, trustedReleaseSha256, { ...actual, role }, { token, uploadOwn, now });
    const management = await bindProtectedFirstOpenManagementClient({ ...hostInput, provisionerCredentials: credentialSource,
      authorityArtifacts: authorityArtifacts(uploadOwn) }, now);
    const { submitStack } = management;
    if (!submitStack) return fail("CONTROLLED_CFN_UNBOUND");
    const aws = { region: ports.aws.region, getCallerIdentity: ports.aws.getCallerIdentity.bind(ports.aws),
      describeTenantStack: ports.aws.describeTenantStack.bind(ports.aws),
      applySupervisedTenantStack: (stack: Parameters<typeof submitStack>[0], x: { signal: AbortSignal }) => submitStack(stack, x.signal) };
    await bindReviewedSandboxFirstOpenWithExpress({ ...ports, aws, approval, approvedSha256: release.approvalSha256, formalApprovalSha256,
      reviewedTaskBinding: prepared.binding,
      applicationLoginBefore: release.applicationLoginBefore, formalProvisionerGrantAckSha256: formalAckSha256,
      sources: { provisionerCredentials: credentialSource, management, loadTenantPaymentMaterial, handoff: wire, controlMaterial } }, now)();
  } finally { await dispose?.(); }
}
