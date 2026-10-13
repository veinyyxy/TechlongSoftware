import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromLoginCredentials } from "@aws-sdk/credential-provider-login";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CloudFormationClient, DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand, DescribeStackEventsCommand, ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { decodeReservationReviewV5, reservationParentCommonHashV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { decodeRetirementRecoveryV7, RESERVED_RETIREMENT_RECOVERY_V7 as t, boundedRecoveryErrorV7 } from "../../../lib/deployments/execution/cell-reserved-retirement-recovery-v7.ts";
import { inspectDeletedIdentityFrameV8 } from "../../../lib/deployments/execution/cell-deleted-identity-inspection-v8.ts";
import { createReservationAwsV5 } from "./cell-reservation-aws-v5.mjs";

// ONLY post-delete inspection. No Run, claim, mutation constructor or writer.
// Never edits/normalizes the frozen execution or first failed Inspect records.
const root = await realpath("F:/ChatGPT_workshop"), repo = fileURLToPath(new URL("../../../", import.meta.url)), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || root.toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() || (await lstat(root)).isSymbolicLink() ||
  (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9k-deleted-inspect-[a-z0-9-]+$/.test(path.basename(out))) throw Error("DELETED_INSPECT_FRESH_OUTPUT_REQUIRED");
await mkdir(out);
const hash = b => createHash("sha256").update(b).digest("hex"), save = async (name, value) => {
  const b = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx", flush: true }); return sha256Hex(b);
};
const exact = async (base, relative) => {
  const f = path.resolve(base, relative);
  if (!f.toLowerCase().startsWith((path.resolve(base) + path.sep).toLowerCase()) || (await realpath(f)).toLowerCase() !== f.toLowerCase() || (await lstat(f)).isSymbolicLink()) throw Error("DELETED_INSPECT_LOCAL_PATH_INVALID");
  return readFile(f);
};
const cfg = { region: "ca-central-1", maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
let sts, cfn, reservation, stage = "FROZEN_EXECUTION_BINDING";
try {
  const old = JSON.parse((await exact(root, "techlong-f3c9k-recovery-20261013-r1/code-binding.json")).toString("utf8"));
  if (old.pins.length !== 124 || old.codeBindingSha256 !== "2f679e7712679e1e3d9fb3278f086f024f8a1289329b64e80abb122f2f61db36" || await sha256Hex(old.pins) !== old.codeBindingSha256) throw Error("DELETED_INSPECT_OLD124_INVALID");
  const files = [...old.preservedFiles,
    ["techlong-f3c9k-recovery-20261013-r1/recovery-manifest.json", "d46e006330077fe7e2bf209c99db9b19ce730f03886dd63f2f41eade7d6aed29"],
    [t.permanentSlot, "12246428417e28e97b59ab50029641a2fa331d136c083b1ffd9d929a15c15e10"],
    ["techlong-f3c9k-recovery-20261013-r1-run/recovery-report.json", "4bc2cdb89b2578857f135141ef039329f4eab0758154a088a1f908e0be1d918c"],
    ["techlong-f3c9k-recovery-20261013-r1-run/complete-live-evidence.json", "e52a44a55d26e481189da99bb7a883d7a892c946fa114e63a01158d7a1a76aa4"],
    ["techlong-f3c9k-recovery-20261013-r1-run/final-stack-guard.json", "788cd745054ae610ba4b3e5d78e3e8714e2bb601b766cd5a1f9a5c69f77d4845"],
    ["techlong-f3c9k-recovery-20261013-r1-independent-after-inspect/failure.json", "9a9f96910b599a88ce43e606da053fb0c2921b6f64aaaff0dca4ff33ea367cd1"]];
  const additions = ["lib/deployments/execution/cell-deleted-identity-inspection-v8.ts", "ops/aws-sandbox/scripts/inspect-cell-deleted-identity-v8.mjs",
    "tests/cell-deleted-identity-inspection-v8.test.ts", "tests/fixtures/deleted-reserved-identity-v8.ts"], pins = [...old.pins];
  for (const file of additions) pins.push({ file, sha256: await sha256Hex((await exact(repo, file)).toString("utf8").replace(/\r\n/g, "\n")) });
  pins.sort((a, b) => a.file.localeCompare(b.file)); const codeBindingSha256 = await sha256Hex(pins);
  const verify = async () => {
    for (const p of pins) if (await sha256Hex((await exact(repo, p.file)).toString("utf8").replace(/\r\n/g, "\n")) !== p.sha256) throw Error("DELETED_INSPECT_SOURCE_DRIFT");
    for (const [file, sha] of files) if (hash(await exact(root, file)) !== sha) throw Error("DELETED_INSPECT_OLD_RECORD_DRIFT");
    if (hash(await exact(repo, "package-lock.json")) !== "d2fe3d8e93e04ed696c6dd7d5a44a0861d9c9e61ced0caecea2875a375ee39a5") throw Error("DELETED_INSPECT_PACKAGE_LOCK_DRIFT");
  };
  await verify(); await save("code-binding.json", { codeBindingSha256, pins, frozen124CodeSha256: old.codeBindingSha256, files });
  const original = await decodeReservationReviewV5(JSON.parse((await exact(root, "techlong-f3c9h-reserved-20261012-r1/reserved-manifest.json")).toString("utf8"))),
    review = await decodeRetirementRecoveryV7(JSON.parse((await exact(root, "techlong-f3c9k-recovery-20261013-r1/recovery-manifest.json")).toString("utf8"))),
    slot = JSON.parse((await exact(root, t.permanentSlot)).toString("utf8")), before = JSON.parse((await exact(root, "techlong-f3c9k-recovery-20261013-r1-run/complete-live-evidence.json")).toString("utf8"));
  const attemptedAt = Date.parse(slot.attemptedAt);
  if (review.manifestSha256 !== "508a21f8df2212d9df1c0cab6d52375ee445b8b2ea243d17c303a1a8a51af46a" || slot.approvedManifestSha256 !== review.manifestSha256 ||
    slot.protocol !== "expired-reserved-identity-retirement-recovery-attempt-v7" || slot.codeBindingSha256 !== old.codeBindingSha256 || slot.requestSha256 !== review.requestSha256 ||
    slot.token !== review.request.ClientRequestToken || slot.stackId !== t.stackId || slot.oldRetirementSlotFileSha256 !== t.oldRetirementSlotFileSha256 || !Number.isFinite(attemptedAt) ||
    attemptedAt < review.reviewedAt || attemptedAt >= review.expiresAt) throw Error("DELETED_INSPECT_APPROVED_SLOT_BINDING_INVALID");
  const credentials = fromLoginCredentials({ profile: "techlong-sandbox-user", ignoreCache: true, clientConfig: cfg });
  sts = new STSClient({ ...cfg, credentials }); cfn = new CloudFormationClient({ ...cfg, credentials }); reservation = createReservationAwsV5(original.plan);
  const identity = async () => {
    const r = await sts.send(new GetCallerIdentityCommand({}), { abortSignal: AbortSignal.timeout(15000) });
    if (r.Account !== "402010193138" || r.UserId !== "AIDAV3GNMXTZEO7SHLC2X" || r.Arn !== "arn:aws:iam::402010193138:user/techlong-sandbox-dev") throw Error("DELETED_INSPECT_SOURCE_IDENTITY_INVALID");
  };
  const call = (Command, input) => cfn.send(new Command(input), { abortSignal: AbortSignal.timeout(15000) });
  const pages = async (Command, input, field) => {
    const all = [], seen = new Set(); let token;
    do {
      const r = await call(Command, { ...input, ...(token ? { NextToken: token } : {}) });
      if (!Array.isArray(r[field])) throw Error("DELETED_INSPECT_PAGE_INVALID"); all.push(...r[field]);
      if (r.NextToken === undefined) token = undefined;
      else if (typeof r.NextToken !== "string" || !r.NextToken || seen.has(r.NextToken) || seen.size >= 99) throw Error("DELETED_INSPECT_PAGINATION_INVALID");
      else { token = r.NextToken; seen.add(token); }
    } while (token);
    return all;
  };
  const frame = async () => {
    const [s, template, resources, events, names] = await Promise.all([call(DescribeStacksCommand, { StackName: t.stackId }),
      call(GetTemplateCommand, { StackName: t.stackId, TemplateStage: "Original" }), pages(ListStackResourcesCommand, { StackName: t.stackId }, "StackResourceSummaries"),
      pages(DescribeStackEventsCommand, { StackName: t.stackId }, "StackEvents"), pages(ListStacksCommand, {}, "StackSummaries")]);
    if (s.Stacks?.length !== 1 || names.some(n => typeof n.StackName !== "string" || typeof n.StackStatus !== "string" || typeof n.StackId !== "string") ||
      names.some(n => n.StackStatus !== "DELETE_COMPLETE" && n.StackName.startsWith("techlong-sandbox-cell-"))) throw Error("DELETED_INSPECT_STACK_OR_OTHER_CELL_INVALID");
    const summary = await inspectDeletedIdentityFrameV8(original.plan, before.live.history.stack, s.Stacks[0], template.TemplateBody, resources, events, slot.token, attemptedAt, Date.now());
    return { summary, stack: JSON.parse(JSON.stringify(s.Stacks[0])), events: JSON.parse(JSON.stringify(events)).sort((a, b) => a.EventId.localeCompare(b.EventId)), resources, noOtherLiveCell: true };
  };
  stage = "EXACT_DELETED_HISTORY_DOUBLE_READ"; await identity(); const startedAt = Date.now(), a = await frame(), b = await frame(); await identity();
  if (canonicalJson(a) !== canonicalJson(b) || Date.now() - startedAt > 30000) throw Error("DELETED_INSPECT_DOUBLE_READ_DRIFT");
  stage = "INDEPENDENT_LOCKS_AND_ROLE"; const locks = await reservation.readBefore();
  if (!locks.absence || await reservationParentCommonHashV5(locks.parent, true, Date.now()) !== t.parentCommonSha256 || await sha256Hex(locks.foundation) !== t.foundationSha256) throw Error("DELETED_INSPECT_LOCK_OR_FOUNDATION_DRIFT");
  await identity(); await verify(); const evidenceFileSha256 = await save("independent-evidence.json", { deleted: b, locks });
  const report = { outcome: "ZERO_RESOURCE_IDENTITY_DELETION_INDEPENDENTLY_VERIFIED_V8", observedAt: new Date().toISOString(), ...b.summary,
    approvedManifestSha256: review.manifestSha256, matchingApprovedSlotAndToken: true, noOtherLiveCell: true, parentAndFoundationUnchanged: true,
    codeBindingSha256, boundFileCount: pins.length, frozen124Unchanged: true, firstFailedInspectPreserved: true, allConsumedSlotsPreserved: true,
    evidenceFileSha256, cloudWriteCalls: 0, iamWrites: 0, lambdaInvocations: 0, secretValueReads: 0, neonConnections: 0, tableWrites: 0, retryAuthorized: false, runtimeEnabled: false };
  const reportFileSha256 = await save("deleted-report.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const failure = { stage, ...boundedRecoveryErrorV7(e), safeReadCode: /^DELETED_INSPECT_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? e.message : null,
    cloudWriteCalls: 0, retryAuthorized: false, runtimeEnabled: false };
  await save("failure.json", failure); console.log(JSON.stringify(failure, null, 2)); process.exitCode = 1;
} finally { sts?.destroy(); cfn?.destroy(); reservation?.dispose(); }
