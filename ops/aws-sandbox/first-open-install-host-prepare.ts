import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_OPEN_BASELINE_BINDING } from "../../lib/deployments/execution/first-onboarding-baseline-versions.ts";
import { firstOpenInstallBucketStack, firstOpenInstallBucketTargets } from "./first-open-install-bucket-executor.ts";
import { assembleFirstOpenInstallHostPlan, firstOpenInstallHostSchedule, type FirstOpenInstallHostCandidate,
  type FirstOpenInstallHostOwnerReceipt, type FirstOpenInstallHostPlanInput } from "./first-open-install-host-plan.ts";
import { sealFirstOpenInstallHostApproval, verifyFirstOpenInstallHostLocal } from "./first-open-install-host.ts";
import { canonicalJson } from "../../lib/deployments/execution/hash.ts";
import { hash as templateHash } from "../temporary-idle/environment-cfn.mjs";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const privateRoot = join(workspace, ".local-secrets"), jobId = FIRST_OPEN_BASELINE_BINDING.jobId;
const sourceDir = join(privateRoot, "fc41597f-slot2-readback-policy-seal-v1");
const inspectorStack = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-first-open-fc41597f-identities/483fa2e0-e42c-11f1-b49f-02ffcd94927f";
const identitiesOriginal = join(privateRoot, "first-open-fc41597f-iam-originals-woNyuO", "identity-original.template");
const mailboxOriginal = join(privateRoot, "first-open-buyer-candidate", "merged-prep-20261121", "mailbox-owner-original.template");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const iso = (value: string) => Date.parse(value);
function need(match: unknown, code: string): asserts match { if (!match) throw Error(`FIRST_OPEN_INSTALL_HOST_PREPARE_${code}`); }
async function readExact<T>(path: string, cap: number, pin?: string): Promise<{ value: T; sha256: string }> {
  const f = await lstat(path);
  need(f.isFile() && !f.isSymbolicLink() && f.size > 0 && f.size <= cap && await realpath(path) === path, "INPUT_PATH");
  const b = await readFile(path), sha256 = hash(b);
  need(b.length === f.size && (pin === undefined || pin === sha256), "INPUT_DIGEST");
  return { value: JSON.parse(b.toString()) as T, sha256 };
}
type FreshResult = { status: string; sourceSts: number; awsMetadata: number; configReads: number; tlsReadonlyConnections: number; sql: number;
  awsWrites: number; noExecutionAuthority: boolean; cellReceiptSha256: string; neonReceiptSha256: string; ownerReceiptSha256: string;
  gateSha256: string; protectionDeltaSha256: string };
type Gate = { schema: string; jobId: string; installIntentSha256: string; neonProjectionSha256: string;
  startInstallUtc: string; hardStopUtc: string; executionAuthorized: boolean; providerCalls: number;
  targets: FirstOpenInstallHostOwnerReceipt["stagingTargets"] };
type Owner = { jobId: string; status: string; code: string; stagingKeyGateSha256: string; neonReceiptSha256: string; counts: { sts: number; metadata: number };
  startedAtUtc: string; finishedAtUtc: string; newFactsCutoffUtc: string; startInstallUtc: string; awsWrites: number; secretValueReads: number; claims: number;
  observations: { sourceIdentityMatched: boolean; bucket: { versioning: string; stagingRetention: { configurationRetainsVersions: boolean } } } };
type Neon = { jobId: string; status: string; cellReceiptSha256: string; projectionSha256: string; startedAtUtc: string; completedAtUtc: string;
  configReads: number; verifiedTlsReadOnlyConnections: number; sql: number; sqlWrites: number; claims: number };
type Cell = { jobId: string; status: string; awsWrites: number; claims: number; sts: number; metadata: number; startedAtUtc: string; completedAtUtc: string;
  checkedSourceIdentity: boolean };
type Protection = { jobId: string; gateSha256: string; ownerReadSha256: string; executionAuthorized: boolean; protectedKeyCount: number;
  protectTemplateSha256: string; restoreTemplateSha256: string };

/** One exact refresh directory in, one private plan out. Never opens
 * credentials, forges refreshed facts, picks a new start, or reads providers. */
async function main() {
  const [arg] = process.argv.slice(2);
  need(process.argv.length === 3 && arg, "USAGE");
  const dir = resolve(workspace, arg), tail = relative(privateRoot, dir);
  need(/^fc41597f-refresh-\d{8}-[a-z0-9-]{1,32}$/.test(tail) && await realpath(dir) === dir, "EXACT_REFRESH_DIR");
  const rd = <T>(file: string, cap: number, pin?: string) => readExact<T>(join(dir, file), cap, pin);
  const [{ value: result }, { value: attempt }, { value: gate, sha256: gateSha }] = await Promise.all([
    rd<FreshResult>("refresh-result.json", 4_096), rd<{ installEnd: string; formalStart: string; formalEnd: string;
      cutoffBeforeInstall: string }>("refresh-attempt.json", 4_096), rd<Gate>("slot2-owner-staging-key-gate.json", 8_192),
  ]);
  need(result.status === "APPROVED_READS_COMPLETED_NO_WRITES" && result.sourceSts === 2 && result.awsMetadata === 30 &&
    result.configReads === 1 && result.tlsReadonlyConnections === 1 && result.sql === 7 && result.awsWrites === 0 &&
    result.noExecutionAuthority === true && gate.schema === "techlong/fc41597f-slot2-owner-staging-key-gate/v1" && gate.jobId === jobId &&
    gateSha === result.gateSha256 && gate.executionAuthorized === false && gate.providerCalls === 0 &&
    gate.startInstallUtc === attempt.cutoffBeforeInstall && gate.hardStopUtc === attempt.installEnd, "REFRESH_BINDING");
  const installStartAt = iso(gate.startInstallUtc), cutoff = iso(gate.hardStopUtc), formalStartAt = iso(attempt.formalStart);
  // Reject the archived slot before reading the candidate or loading a host
  // execution plan. No command-line option can move its cutoff.
  firstOpenInstallHostSchedule({ installStartAt, factsExpireAt: cutoff, formalStartAt, operatorAvailableUntil: iso(attempt.installEnd) });
  const [owner, neon, cell, protection, candidate, source, mailbox, identities] = await Promise.all([
    rd<Owner>("owner-read.result.json", 32_768, result.ownerReceiptSha256),
    rd<Neon>("neon-inspect-slot2-result.json", 8_192, result.neonReceiptSha256),
    rd<Cell>("cell-diagnostic-result.json", 8_192, result.cellReceiptSha256),
    rd<Protection>("protection-delta.prepared.json", 8_192, result.protectionDeltaSha256),
    rd<FirstOpenInstallHostCandidate & { neonProjectionSha256: string; executionAuthorized: false; providerCalls: number }>(
      "slot2-install-private-mailbox.candidate.json", 1_048_576),
    readExact<{ base: string; runtime: string; caller: string; sourceProjectionSha256Utf8Lf: string }>(join(sourceDir, "source-projection.json"), 128 * 1024),
    readExact<FirstOpenInstallHostPlanInput["mailboxOriginal"]["template"]>(mailboxOriginal, 51_200,
      "b9678df8bfb2fcfde9b4b97bac9e4e6b44624488dee7bb410a99cf5379f41624"),
    readExact<FirstOpenInstallHostPlanInput["identitiesOriginal"]["template"]>(identitiesOriginal, 51_200,
      "b4ce63ed463f156670ed10a06aaad68a884c2b9c007b82f7dbf33518a6c3a709"),
  ]);
  const o = owner.value, n = neon.value, c = cell.value, p = protection.value, b = candidate.value, s = source.value;
  need([o, n, c, p, b].every(r => r.jobId === jobId) && o.status === "SCOPED_OWNER_PREIMAGES_MATCHED_STAGING_RETENTION_UNPROVED" &&
    o.code === "STAGING_VERSION_DELETION_PROTECTION_UNPROVED" && o.counts.sts === 1 && o.counts.metadata === 22 &&
    o.observations.sourceIdentityMatched && o.observations.bucket.versioning === "Enabled" &&
    o.observations.bucket.stagingRetention.configurationRetainsVersions === false && o.awsWrites === 0 && o.secretValueReads === 0 && o.claims === 0 &&
    o.startInstallUtc === gate.startInstallUtc && o.newFactsCutoffUtc === gate.hardStopUtc && o.stagingKeyGateSha256 === gateSha &&
    o.neonReceiptSha256 === neon.sha256 && n.cellReceiptSha256 === cell.sha256 && n.projectionSha256 === gate.neonProjectionSha256 &&
    c.status === "AWS_SECOND_SLOT_READY" && c.checkedSourceIdentity && c.sts === 1 && c.metadata === 8 && c.awsWrites === 0 && c.claims === 0 &&
    n.status === "NEON_INSPECT_PROJECTION_VERIFIED" && n.configReads === 1 && n.verifiedTlsReadOnlyConnections === 1 &&
    n.sql === 7 && n.sqlWrites === 0 && n.claims === 0 &&
    p.gateSha256 === gateSha && p.ownerReadSha256 === owner.sha256 && p.protectedKeyCount === 3 && p.executionAuthorized === false &&
    b.neonProjectionSha256 === gate.neonProjectionSha256 && b.installIntentSha256 === gate.installIntentSha256 &&
    b.release.startAt === formalStartAt && b.release.writeBefore === iso(attempt.formalEnd) && b.executionAuthorized === false && b.providerCalls === 0,
    "EVIDENCE_CHAIN");
  const actualStart = [c.startedAtUtc, n.startedAtUtc, o.startedAtUtc].map(iso);
  need(actualStart.every(at => Number.isSafeInteger(at) && at + 5 * 3_600_000 >= cutoff) &&
    iso(c.completedAtUtc) <= iso(n.startedAtUtc) && iso(n.completedAtUtc) <= iso(o.startedAtUtc), "OBSERVATION_TIMES");
  const sequence = await assembleFirstOpenInstallHostPlan({ candidate: b,
    mailboxOriginal: { stackId: firstOpenInstallBucketStack, template: mailbox.value },
    identitiesOriginal: { stackId: inspectorStack, template: identities.value },
    ownerReceipt: { sha256: owner.sha256, capturedAt: iso(o.startedAtUtc), completedAt: iso(o.finishedAtUtc), expiresAt: cutoff,
      stagingTargets: gate.targets }, installStartAt, operatorAvailableUntil: iso(attempt.installEnd) });
  const targets = firstOpenInstallBucketTargets(sequence.bucket);
  need(templateHash(targets.protected.template) === p.protectTemplateSha256 &&
    templateHash(targets.original.template) === p.restoreTemplateSha256, "BUCKET_DIFF");
  const { plan, approvedPlanSha256 } = await sealFirstOpenInstallHostApproval({ sequence,
    publication: { sealSha256: source.sha256, base: s.base, runtime: s.runtime, caller: s.caller, sourceProjectionSha256: s.sourceProjectionSha256Utf8Lf },
    facts: { awsCellRawSha256: cell.sha256, neonRawSha256: neon.sha256, ownerRawSha256: owner.sha256, stagingGateRawSha256: gateSha } }, workspace);
  await verifyFirstOpenInstallHostLocal({ plan, approvedPlanSha256, workspaceRoot: workspace, signal: AbortSignal.timeout(30_000) });
  need(Date.now() < plan.launchBefore, "LAUNCH_WINDOW_PASSED");
  const approval = join(dir, "host-install-approval.json"), fd = await open(approval, "wx", 0o600);
  try { await fd.writeFile(canonicalJson(plan) + "\n"); await fd.sync(); } finally { await fd.close(); }
  console.log(JSON.stringify({ status: "REVIEW_REQUIRED_NOT_EXECUTED", jobId, approvedPlanSha256, approval,
    launchAtUtc: new Date(plan.launchAt).toISOString(), launchBeforeUtc: new Date(plan.launchBefore).toISOString(),
    installEndUtc: new Date(sequence.bucket.factsExpireAt).toISOString(), providerCalls: 0, executionAuthorized: false }));
}

try { await main(); } catch (error) {
  const msg = error instanceof Error ? error.message : "";
  console.log(JSON.stringify({ status: "OFFLINE_PREPARATION_STOPPED", code: /^FIRST_OPEN_INSTALL_HOST_[A-Z_]{1,100}$/.test(msg) ? msg : "LOCAL_BINDING_FAILED",
    providerCalls: 0, executionAuthorized: false }));
  process.exitCode = 1;
}
