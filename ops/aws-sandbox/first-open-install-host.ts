import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { canonicalJson, sha256Hex } from "../../lib/deployments/execution/hash.ts";
import { bindFirstOpenInstallGitHub, firstOpenInstallGitHubTransport } from "./first-open-install-github.ts";
import { createFirstOpenInstallJournal } from "./first-open-install-journal.ts";
import { firstOpenInstallSourceSessionPolicy, runFirstOpenInstallSequence, type FirstOpenInstallSequencePlan } from "./first-open-install-sequence.ts";
import { bindFirstOpenInstallHostPhaseSource, FIRST_OPEN_HOST_SOURCE_PHASES } from "./first-open-install-host-source.ts";
import { prepareFirstOpenInstallSealer, verifyFirstOpenInstallSealedPublication } from "./first-open-install-host-publication.ts";
import { inspectFirstOpenInstallHostTransport } from "./first-open-install-host-transport.ts";

const schema = "techlong/fc41597f-install-host-approval/v1" as const;
const jobId = FIRST_OPEN_BASELINE_BINDING.jobId;
const profile = "techlong-sandbox-user";
const repository = "veinyyxy/TechlongSoftware";
const sha = /^[a-f0-9]{64}$/, oid = /^[a-f0-9]{40}$/;
const launchLeadMin = 2 * 60_000, launchLeadMax = 10 * 60_000;
const sourceId = "AIDAV3GNMXTZEO7SHLC2X", sourceAccount = "402010193138";
const scope = { sourceProfile: profile, githubCredential: "existing-repository-git-credential-helper",
  repository, ref: "refs/heads/main", environment: "techlong-sandbox-deploy", gitMainReads: 1, gitPublishes: 1,
  githubPrePublicationIdentityReads: 1, githubDispatches: 1,
  sourceSessionPolicy: firstOpenInstallSourceSessionPolicy,
  sourcePhaseOpenings: FIRST_OPEN_HOST_SOURCE_PHASES.length, sourceSigninRefreshes: FIRST_OPEN_HOST_SOURCE_PHASES.length,
  sourceSts: FIRST_OPEN_HOST_SOURCE_PHASES.length + 2, existingSourceLoginCacheWriteback: true,
  sourceTemplatePuts: 3, changeSetCreates: 7, changeSetExecutes: 7, requiresHumanGitHubApproval: true,
  firstOpenAuthorized: false, claims: 0 } as const;

// Pin the local host bindings and dependency lock separately from the sealed
// GitHub runtime (which has its own independently verified closure and tree).
export const firstOpenInstallHostFiles = [
  "package-lock.json",
  "ops/aws-sandbox/first-open-install-host.ts", "ops/aws-sandbox/first-open-install-host-plan.ts",
  "ops/aws-sandbox/first-open-install-host-prepare.ts",
  "ops/aws-sandbox/first-open-install-host-publication.ts", "ops/aws-sandbox/first-open-install-host-source.ts",
  "ops/aws-sandbox/first-open-install-host-transport.ts",
  "ops/aws-sandbox/first-open-install-sequence.ts", "ops/aws-sandbox/first-open-install-owner-executor.ts",
  "ops/aws-sandbox/first-open-install-bucket-executor.ts", "ops/aws-sandbox/first-open-install-staging-writer.ts",
  "ops/aws-sandbox/first-open-install-inspector-scope.ts", "ops/aws-sandbox/first-open-install-independent-bucket.ts",
  "ops/aws-sandbox/first-open-install-terminal-source.ts", "ops/aws-sandbox/first-open-install-journal.ts",
  "ops/aws-sandbox/first-open-install-readback.ts", "ops/aws-sandbox/first-open-install-readback-artifacts.ts",
  "ops/aws-sandbox/first-open-install-github.ts", "ops/aws-sandbox/first-open-install-github-config.ts",
  "ops/aws-sandbox/first-open-install-github-publication.ts", "ops/aws-sandbox/first-open-install-github-run.ts",
  "ops/aws-sandbox/first-open-owner-stage-proof.ts", "ops/aws-sandbox/first-open-provisioner-lanes.ts",
  "ops/aws-sandbox/scripts/cloudformation-template-document.mjs",
] as const;
type Publication = { sealSha256: string; base: string; runtime: string; caller: string; sourceProjectionSha256: string };
export interface FirstOpenInstallHostApproval {
  schema: typeof schema;
  jobId: typeof jobId;
  launchAt: number;
  launchBefore: number;
  publication: Publication;
  facts: { awsCellRawSha256: string; neonRawSha256: string; ownerRawSha256: string; stagingGateRawSha256: string };
  sequence: FirstOpenInstallSequencePlan;
  sequenceSha256: string;
  localhostFiles: Record<(typeof firstOpenInstallHostFiles)[number], string>;
  scope: typeof scope;
}
type CheckInput = Pick<FirstOpenInstallHostApproval, "publication" | "facts" | "sequence">;
const fail = (code: string): never => { throw Error(`FIRST_OPEN_INSTALL_HOST_${code}`); };
function requireExact(ok: unknown, code: string): asserts ok { if (!ok) fail(code); }
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const abortBefore = (at: number, signal: AbortSignal) => {
  signal.throwIfAborted();
  requireExact(Date.now() < at, "WINDOW_CLOSED");
  return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, at - Date.now()))]);
};

async function stableRead(path: string, limit: number): Promise<Buffer> {
  const p = await lstat(path);
  requireExact(p.isFile() && !p.isSymbolicLink() && p.size > 0 && p.size <= limit, "LOCAL_FILE");
  const bytes = await readFile(path);
  requireExact(bytes.length === p.size, "LOCAL_FILE_CHANGED");
  return bytes;
}

async function readHostFiles(workspaceRoot: string): Promise<FirstOpenInstallHostApproval["localhostFiles"]> {
  return Object.fromEntries(await Promise.all(firstOpenInstallHostFiles.map(async name =>
    [name, digest(await stableRead(join(workspaceRoot, name), 4 * 1024 * 1024))]))) as FirstOpenInstallHostApproval["localhostFiles"];
}

/** Local-only seal. Approval of this digest is an explicit separate action. */
export async function sealFirstOpenInstallHostApproval(input: CheckInput, workspaceRoot: string) {
  const { sequence } = input;
  const protectiveStart = sequence.bucket.phases.protect.startAt;
  const plan: FirstOpenInstallHostApproval = { schema, jobId, ...structuredClone(input),
    launchAt: protectiveStart - launchLeadMax, launchBefore: protectiveStart - launchLeadMin,
    scope, sequenceSha256: await sha256Hex(sequence), localhostFiles: await readHostFiles(workspaceRoot) };
  const approvedPlanSha256 = await sha256Hex(plan);
  await assertFirstOpenInstallHostApproval(plan, approvedPlanSha256);
  return { plan, approvedPlanSha256 };
}

export async function assertFirstOpenInstallHostApproval(plan: FirstOpenInstallHostApproval, approvedPlanSha256: string) {
  requireExact(sha.test(approvedPlanSha256) && await sha256Hex(plan) === approvedPlanSha256 &&
    plan?.schema === schema && plan.jobId === jobId && canonicalJson(plan.scope) === canonicalJson(scope), "APPROVAL_SHA_OR_SCOPE");
  const { publication: p, sequence: s, facts: f } = plan;
  const protectiveStart = s.bucket.phases.protect.startAt, cutoff = s.bucket.factsExpireAt, r = s.readback.release;
  requireExact(s.schema === "techlong/fc41597f-install-sequence/v1" && s.terminalReadback === "same-source-readonly-subprocess" &&
    s.sourceSessionPolicy === firstOpenInstallSourceSessionPolicy &&
    !s.independentReader && s.bucket.jobId === jobId && r.jobId === jobId && s.owner.jobId === jobId &&
    sha.test(plan.sequenceSha256) && await sha256Hex(s) === plan.sequenceSha256 &&
    plan.launchAt === protectiveStart - launchLeadMax && plan.launchBefore === protectiveStart - launchLeadMin &&
    [plan.launchAt, plan.launchBefore, protectiveStart, cutoff, r.startAt].every(Number.isSafeInteger) &&
    0 < plan.launchAt && plan.launchAt < plan.launchBefore && plan.launchBefore < protectiveStart &&
    protectiveStart < cutoff && cutoff <= r.startAt && cutoff - plan.launchAt <= 2 * 3600_000 &&
    s.owner.approvalSha256 === r.approvalSha256 && s.bucket.installIntentSha256 === r.approvalSha256, "INSTALL_OR_FORMAL_SCOPE");
  requireExact([p.base, p.runtime, p.caller].every(x => oid.test(x)) && new Set([p.base, p.runtime, p.caller]).size === 3 &&
    sha.test(p.sealSha256) && sha.test(p.sourceProjectionSha256) &&
    p.runtime === r.runtimeCommit && p.caller === r.callerCommit && p.sourceProjectionSha256 === r.runtimeSourceSha256, "PUBLICATION_BINDING");
  requireExact(Object.keys(f).sort().join(",") === "awsCellRawSha256,neonRawSha256,ownerRawSha256,stagingGateRawSha256" &&
    Object.values(f).every(value => sha.test(value)) && f.ownerRawSha256 === s.bucket.ownerReadReceiptSha256 &&
    f.ownerRawSha256 === s.readback.factsReceiptSha256, "FACT_RECEIPT_BINDING");
  requireExact(Object.keys(plan.localhostFiles).length === firstOpenInstallHostFiles.length &&
    firstOpenInstallHostFiles.every(path => sha.test(plan.localhostFiles[path])), "HOST_FILE_SCOPE");
}

/** Existing Git credential helper, exact repo and one call. The bytes are
 * never logged, passed as arguments, or placed in the process environment. */
async function readGitHubCredential(workspaceRoot: string, signal: AbortSignal) {
  const raw = await new Promise<string>((resolvePromise, reject) => {
    const child = execFile("git", ["-c", "credential.interactive=never", "credential", "fill"], {
      cwd: workspaceRoot, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
      windowsHide: true, signal, timeout: 15_000, maxBuffer: 16_384,
    }, (error, stdout) => error ? reject(Error("FIRST_OPEN_INSTALL_HOST_GITHUB_CREDENTIAL")) : resolvePromise(stdout));
    child.stdin?.on("error", () => {});
    child.stdin?.end(`protocol=https\nhost=github.com\npath=${repository}.git\n\n`);
  });
  signal.throwIfAborted();
  const fields = raw.split(/\r?\n/).filter(Boolean);
  const field = (key: string) => fields.filter(x => x.startsWith(`${key}=`)).map(x => x.slice(key.length + 1));
  const [token] = field("password");
  requireExact(field("protocol").join() === "https" && field("host").join() === "github.com" &&
    ["", `${repository}.git`].includes(field("path").join()) && field("password").length === 1 &&
    typeof token === "string" && /^[A-Za-z0-9_]{20,512}$/.test(token), "GITHUB_CREDENTIAL_SCOPE");
  return token;
}

async function privateRoot(workspaceRoot: string) {
  const root = join(workspaceRoot, ".local-secrets");
  const st = await lstat(root);
  requireExact(st.isDirectory() && !st.isSymbolicLink() && await realpath(root) === join(await realpath(workspaceRoot), ".local-secrets"), "PRIVATE_ROOT");
  return root;
}

export async function verifyFirstOpenInstallHostLocal(input: { plan: FirstOpenInstallHostApproval; approvedPlanSha256: string;
  workspaceRoot: string; signal: AbortSignal }) {
  const { plan, approvedPlanSha256, workspaceRoot, signal } = input;
  const { mode: transportConfig, configCount: managedGitEntries } = inspectFirstOpenInstallHostTransport();
  requireExact(isAbsolute(workspaceRoot), "WORKSPACE");
  await assertFirstOpenInstallHostApproval(plan, approvedPlanSha256);
  requireExact(canonicalJson(await readHostFiles(workspaceRoot)) === canonicalJson(plan.localhostFiles), "LOCALHOST_FILES_CHANGED");
  const sealed = await verifyFirstOpenInstallSealedPublication({ workspaceRoot, ...plan.publication }, signal);
  const seal = await prepareFirstOpenInstallSealer();
  signal.throwIfAborted();
  return { sealed, seal, transportConfig, managedGitEntries };
}

export async function runFirstOpenInstallHost(input: { plan: FirstOpenInstallHostApproval; approvedPlanSha256: string; workspaceRoot: string;
  signal: AbortSignal; onApprovalRequired(url: string): void }) {
  const { approvedPlanSha256, workspaceRoot, signal, onApprovalRequired } = input;
  const plan = structuredClone(input.plan), now = Date.now();
  requireExact(now >= plan.launchAt && now < plan.launchBefore, "LAUNCH_WINDOW");
  const launch = abortBefore(plan.launchBefore, signal);
  const { sealed, seal } = await verifyFirstOpenInstallHostLocal({ plan, approvedPlanSha256, workspaceRoot, signal: launch });
  const root = await privateRoot(workspaceRoot), hostRoot = join(root, "first-open-install-host-journals");
  await mkdir(hostRoot, { recursive: true, mode: 0o700 });
  requireExact(await realpath(hostRoot) === hostRoot, "JOURNAL_ROOT");
  launch.throwIfAborted();
  const intent = plan.sequence.bucket.installIntentSha256;
  // The host slot is durable before credentials, publication, or any cloud
  // mutation. The sequence journal is separate and remains unchanged.
  const hostJournal = await createFirstOpenInstallJournal(hostRoot, intent, approvedPlanSha256);
  const attemptRoot = join(hostRoot, `first-open-install-${intent}`);
  const hostSlot = `${jobId}:host`;
  await hostJournal.consume(hostSlot, { approvedPlanSha256, sequenceSha256: plan.sequenceSha256 });
  let stage = "source";
  let source: Awaited<ReturnType<typeof bindFirstOpenInstallHostPhaseSource>> | undefined;
  let events = 0, published = false;
  try {
    launch.throwIfAborted();
    const factsEnd = plan.sequence.bucket.factsExpireAt;
    const laneSignal = abortBefore(factsEnd, signal);
    source = await bindFirstOpenInstallHostPhaseSource({ factsExpireAt: factsEnd, signal: laneSignal });
    await source.openPhase("launch", plan.launchBefore, launch);
    const verified = await source.source.identify(launch);
    requireExact(verified.Account === sourceAccount && verified.UserId === sourceId &&
      verified.Arn === `arn:aws:iam::${sourceAccount}:user/techlong-sandbox-dev`, "SOURCE_IDENTITY");
    await hostJournal.receipt("source-launch", Buffer.from(canonicalJson({ phase: "launch", before: plan.launchBefore, sameIamSource: true })));
    stage = "github-credential";
    const token = await readGitHubCredential(workspaceRoot, launch);
    const release = plan.sequence.readback.release;
    const actorRequest = firstOpenInstallGitHubTransport({ token, release });
    const actor = await actorRequest("GET", "/user", launch);
    const account = actor.value as { id?: number; login?: string } | null;
    requireExact(actor.status === 200 && account?.id === 14145707 && account?.login === "veinyyxy", "GITHUB_OPERATOR_IDENTITY");
    const github = bindFirstOpenInstallGitHub({ release, operatorToken: token, artifactReadToken: token, seal,
      record: async event => { requireExact(++events <= 30, "GITHUB_JOURNAL_BUDGET");
        await hostJournal.receipt(`github-${events}`, Buffer.from(canonicalJson(event))); },
      onApprovalRequired: async ({ url }, gateSignal) => { gateSignal.throwIfAborted(); onApprovalRequired(url); } });
    stage = "sequence";
    return await runFirstOpenInstallSequence({ plan: plan.sequence, approvedPlanSha256: plan.sequenceSha256,
      privateDir: attemptRoot, signal: laneSignal, source: source.source, sourceSessions: { openPhase: source.openPhase },
      github: { ...github, async verifyPublication(release, pubSignal) {
        requireExact(!published, "PUBLICATION_ALREADY_ATTEMPTED");
        published = true;
        stage = "publication";
        const first = AbortSignal.any([pubSignal, launch]);
        first.throwIfAborted();
        await sealed.publishOnce(token, first, event => hostJournal.record(hostSlot, event));
        const result = await github.verifyPublication(release, pubSignal);
        stage = "sequence";
        return result;
      } } });
  } catch {
    await hostJournal.record(hostSlot, { kind: "stopped-no-retry", stage, publicationAttempted: published }).catch(() => {});
    return fail(`STOPPED_${stage.toUpperCase().replaceAll("-", "_")}_NO_RETRY`);
  } finally { source?.close(); }
}

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
async function cli() {
  const [mode, from, approvedPlanSha256] = process.argv.slice(2);
  requireExact(process.argv.length === 5 && ["--check", "--execute"].includes(mode) && sha.test(approvedPlanSha256), "USAGE");
  const root = await privateRoot(workspaceRoot), path = await realpath(resolve(workspaceRoot, from));
  const tail = relative(root, path);
  requireExact(tail && !isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`) && path.endsWith(".json"), "PRIVATE_APPROVAL_PATH");
  const plan = JSON.parse((await stableRead(path, 2_000_000)).toString()) as FirstOpenInstallHostApproval;
  if (mode === "--check") {
    const { transportConfig, managedGitEntries } = await verifyFirstOpenInstallHostLocal({ plan, approvedPlanSha256, workspaceRoot,
      signal: AbortSignal.timeout(30_000) });
    console.log(JSON.stringify({ status: "OFFLINE_BINDINGS_MATCHED", jobId, providerCalls: 0, credentialReads: 0,
      transportConfig, managedGitEntries, launchWindowOpen: Date.now() >= plan.launchAt && Date.now() < plan.launchBefore, executionAuthorized: false }));
    return;
  }
  const result = await runFirstOpenInstallHost({ plan, approvedPlanSha256, workspaceRoot,
    signal: AbortSignal.timeout(2 * 3600_000),
    onApprovalRequired(url) { console.log(JSON.stringify({ status: "GITHUB_OWNER_APPROVAL_REQUIRED", url })); } });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await cli(); } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    console.log(JSON.stringify({ status: "STOPPED_NO_RETRY", code: /^FIRST_OPEN_INSTALL_HOST_[A-Z_]{1,70}$/.test(msg) ? msg : "LOCAL_OR_PROVIDER_BINDING" }));
    process.exitCode = 1;
  }
}
