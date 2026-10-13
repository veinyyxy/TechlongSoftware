import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { decodeReservationReviewV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { RESERVED_RETIREMENT_RECOVERY_V7 as t, prepareRetirementRecoveryV7, decodeRetirementRecoveryV7,
  assertRecoveryApprovalV7, boundedRecoveryErrorV7, runRetirementRecoveryV7 } from "../../../lib/deployments/execution/cell-reserved-retirement-recovery-v7.ts";
import { createRetirementRecoveryAwsV7 } from "./cell-reserved-retirement-recovery-aws-v7.mjs";

const args = process.argv.slice(2), options = {};
for (let n = 0; n < args.length; n += 2) {
  if (!args[n]?.startsWith("--") || !args[n + 1] || options[args[n]]) throw Error("RECOVERY_ARGUMENTS_INVALID"); options[args[n]] = args[n + 1];
}
const mode = options["--mode"], allowed = mode === "Review" ? ["--mode", "--out"] : mode === "Inspect" ? ["--mode", "--out", "--manifest"] : ["--mode", "--out", "--manifest", "--approved-sha"];
if (!["Review", "Run", "Inspect"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("RECOVERY_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]), fresh = /^techlong-f3c9k-recovery-[a-z0-9-]+$/;
if (root.toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() || (await lstat(root)).isSymbolicLink() ||
  (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !fresh.test(path.basename(out))) throw Error("RECOVERY_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const rawHash = b => createHash("sha256").update(b).digest("hex"), save = async (name, value) => {
  const b = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx", flush: true }); return sha256Hex(b);
};
const exact = async (base, relative) => {
  const filename = path.resolve(base, relative);
  if (!filename.toLowerCase().startsWith((path.resolve(base) + path.sep).toLowerCase()) ||
    (await realpath(filename)).toLowerCase() !== filename.toLowerCase() || (await lstat(filename)).isSymbolicLink()) throw Error("RECOVERY_LOCAL_PATH_INVALID");
  return readFile(filename);
};
let aws, stage = "LOCAL_BINDING";
try {
  const frozen = JSON.parse((await exact(root, "techlong-f3c9j-stop-diagnostic-20261013-r1/code-binding.json")).toString("utf8")),
    prior = JSON.parse((await exact(root, "techlong-f3c9j-retirement-20261013-r2/code-binding.json")).toString("utf8"));
  if (frozen.pins.length !== 120 || frozen.codeBindingSha256 !== "8b5fa0a36bb48634cb959e12dcd57afee4fa74fba78450e1e44e4c1427c401e7" || await sha256Hex(frozen.pins) !== frozen.codeBindingSha256 ||
    prior.pins.length !== 119 || prior.codeBindingSha256 !== "8368d4a1d35ec7513d4f236341c657f6dda0ef7f27923219ef09478a04b1fd87" || await sha256Hex(prior.pins) !== prior.codeBindingSha256) throw Error("RECOVERY_FROZEN_BINDING_INVALID");
  const pinMap = new Map(frozen.pins.map(p => [p.file, p.sha256]));
  for (const file of ["lib/deployments/execution/cell-reserved-retirement-recovery-v7.ts", "ops/aws-sandbox/scripts/cell-reserved-retirement-recovery-aws-v7.mjs",
    "ops/aws-sandbox/scripts/review-cell-reserved-retirement-recovery-v7.mjs", "tests/cell-reserved-retirement-recovery-v7.test.ts"])
    pinMap.set(file, await sha256Hex((await exact(repo, file)).toString("utf8").replace(/\r\n/g, "\n")));
  const pins = [...pinMap].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })), codeBindingSha256 = await sha256Hex(pins);
  const preservedFiles = [...prior.preservedFiles,
    [t.oldRetirementSlot, t.oldRetirementSlotFileSha256],
    ["techlong-f3c9j-retirement-20261013-r2/retirement-manifest.json", "48f50e2261beee904bb5d34383d08fec11c2aad9a3dd1a1d30c96505f5fd72cd"],
    ["techlong-f3c9j-retirement-20261013-r2-run/retirement-report.json", "161826b45c01e9bf6a5b3c11da1cdf9a25f7e766e537152d45a309017e56db13"],
    ["techlong-f3c9j-retirement-20261013-r2-independent-after-run-inspect/retirement-report.json", "969d857c486efa202f3db838bc79942729762d9079979ea04c31041f203eaf26"],
    ["techlong-f3c9j-retirement-20261013-r2-independent-after-run-inspect/independent-evidence.json", "3917a10d561bb243431d095a7a32d80379bea15785c8de225cf2d9cbfdc6848f"],
    ["techlong-f3c9j-stop-diagnostic-20261013-r1/diagnostic-report.json", "139cb51c765330dabcbfb41a3bc3b0f9894a5c861d1b9c98e699b1154b778050"],
    ["techlong-f3c9j-stop-diagnostic-20261013-r1/current-evidence.json", "c7bec23e752f7558d27204fba98abec3ee706e9c6d1557ddde4f4535510a851a"]];
  const verifyFiles = async () => {
    for (const p of pins) if (await sha256Hex((await exact(repo, p.file)).toString("utf8").replace(/\r\n/g, "\n")) !== p.sha256) throw Error("RECOVERY_CODE_DRIFT");
    for (const [file, sha] of preservedFiles) if (rawHash(await exact(root, file)) !== sha) throw Error("RECOVERY_OLD_HISTORY_OR_SLOT_DRIFT");
    if (rawHash(await exact(repo, "package-lock.json")) !== "d2fe3d8e93e04ed696c6dd7d5a44a0861d9c9e61ced0caecea2875a375ee39a5") throw Error("RECOVERY_PACKAGE_LOCK_DRIFT");
  };
  await verifyFiles(); await save("code-binding.json", { codeBindingSha256, pins, frozen120CodeSha256: frozen.codeBindingSha256, preservedFiles });
  const original = await decodeReservationReviewV5(JSON.parse((await exact(root, "techlong-f3c9h-reserved-20261012-r1/reserved-manifest.json")).toString("utf8")));
  const slotPath = path.join(root, t.permanentSlot), readSlot = async () => {
    try { return JSON.parse((await exact(root, t.permanentSlot)).toString("utf8")); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  };
  const existing = await readSlot(); let review, result;
  if (mode !== "Review") {
    const f = path.resolve(options["--manifest"]), d = path.dirname(f);
    if (path.basename(f) !== "recovery-manifest.json" || path.dirname(d).toLowerCase() !== root.toLowerCase() || !fresh.test(path.basename(d))) throw Error("RECOVERY_MANIFEST_PATH_INVALID");
    review = await decodeRetirementRecoveryV7(JSON.parse((await exact(root, path.relative(root, f))).toString("utf8")));
    const bound = JSON.parse((await exact(root, path.relative(root, path.join(d, "code-binding.json")))).toString("utf8"));
    if (review.codeBindingSha256 !== codeBindingSha256 || bound.codeBindingSha256 !== codeBindingSha256 || canonicalJson(bound.pins) !== canonicalJson(pins) || canonicalJson(bound.preservedFiles) !== canonicalJson(preservedFiles)) throw Error("RECOVERY_REVIEWED_SOURCE_DRIFT");
    if (mode === "Run") assertRecoveryApprovalV7(review, options["--approved-sha"], codeBindingSha256, Date.now());
  }
  aws = createRetirementRecoveryAwsV7(original, mode === "Run" ? review : undefined, options["--approved-sha"], codeBindingSha256);
  if (mode === "Review") {
    if (existing) throw Error("RECOVERY_SLOT_OCCUPIED_INSPECT_ONLY"); stage = "COMPLETE_READONLY_REVIEW";
    const live = await aws.readComplete(); await verifyFiles();
    stage = "FINAL_LIGHTWEIGHT_READONLY_REVIEW"; const final = await aws.readFinalStack();
    await save("readonly-complete.json", live); await save("readonly-final-stack.json", final);
    review = await prepareRetirementRecoveryV7(live.complete, codeBindingSha256, Date.now());
    const manifestFileSha256 = await save("recovery-manifest.json", review);
    result = { outcome: "RECOVERY_REVIEW_READY_NOT_DELETED", manifestSha256: review.manifestSha256, manifestFileSha256,
      requestSha256: review.requestSha256, expiresAt: new Date(review.expiresAt).toISOString(), recoverySlotPresent: false, cloudWriteCalls: 0 };
  } else if (mode === "Run") {
    stage = "REVIEWED_SINGLE_RECOVERY_ATTEMPT";
    result = await runRetirementRecoveryV7(review, options["--approved-sha"], codeBindingSha256, {
      verifyFilesAndSource: async () => { await verifyFiles(); await aws.identity(); },
      readComplete: async () => { const live = await aws.readComplete(); await save("complete-live-evidence.json", live); return live.complete; },
      marker: save, readFinalStack: aws.readFinalStack, deleteOnce: aws.deleteOnce,
      claimOnce: async approvedManifestSha256 => {
        try {
          await writeFile(slotPath, JSON.stringify({ protocol: "expired-reserved-identity-retirement-recovery-attempt-v7", approvedManifestSha256, codeBindingSha256,
            requestSha256: review.requestSha256, stackId: t.stackId, token: review.request.ClientRequestToken,
            attemptedAt: new Date().toISOString(), oldRetirementSlotFileSha256: t.oldRetirementSlotFileSha256, retryAuthorized: false }) + "\n", { flag: "wx", flush: true }); return true;
        } catch (e) { if (e.code === "EEXIST") return false; throw Error("RECOVERY_PERMANENT_SLOT_SAVE_FAILED"); }
      },
    });
    if (result.outcome !== "RECOVERY_DELETE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED") process.exitCode = 1;
  } else {
    stage = "INDEPENDENT_READONLY_INSPECT";
    const slotMatches = existing?.protocol === "expired-reserved-identity-retirement-recovery-attempt-v7" && existing.approvedManifestSha256 === review.manifestSha256 && existing.codeBindingSha256 === codeBindingSha256 &&
      existing.requestSha256 === review.requestSha256 && existing.stackId === t.stackId && existing.token === review.request.ClientRequestToken && existing.oldRetirementSlotFileSha256 === t.oldRetirementSlotFileSha256 &&
      Number.isFinite(Date.parse(existing.attemptedAt)) && Date.parse(existing.attemptedAt) >= review.reviewedAt && Date.parse(existing.attemptedAt) < review.expiresAt;
    const live = await aws.inspect(review.request.ClientRequestToken, slotMatches ? Date.parse(existing.attemptedAt) : NaN, slotMatches);
    await verifyFiles(); await save("independent-evidence.json", live);
    result = { outcome: live.outcome, observedAt: new Date().toISOString(), stackStatus: live.history.frame.status, resourceCount: 0,
      manifestSha256: review.manifestSha256, recoverySlotPresent: !!existing, slotMatches, cloudWriteCalls: 0 };
  }
  const report = { schemaVersion: 7, phase: "F3c9k_RESERVED_RETIREMENT_RECOVERY", mode, ...result, stackId: t.stackId,
    codeBindingSha256, boundFileCount: pins.length, frozen120Unchanged: true, oldConsumedRetirementSlotPreserved: true, originalCreationSlotPreserved: true,
    nativeDeleteSdkSendEntered: aws.sdkDeleteSendEntered(), iamWrites: 0, lambdaInvocations: 0, secretValueReads: 0, neonConnections: 0, tableWrites: 0,
    parentRegistered: false, runtimeEnabled: false, retryAuthorized: false, newBirthAuthorized: false, originalStoppedRunCauseUniquelyProved: false, effectivePermissionsProved: false };
  const reportFileSha256 = await save("recovery-report.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const failure = { outcome: "RECOVERY_STOPPED_INSPECT_ONLY", mode, stage, failure: boundedRecoveryErrorV7(e), nativeDeleteSdkSendEntered: aws?.sdkDeleteSendEntered() ?? false,
    rawProviderDiagnosticsWithheld: true, retryAuthorized: false, runtimeEnabled: false };
  await save("failure.json", failure); console.log(JSON.stringify(failure, null, 2)); process.exitCode = 1;
} finally { aws?.dispose(); }
