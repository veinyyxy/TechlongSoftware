import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { decodeReservationReviewV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { RESERVED_RETIREMENT_V6 as t, prepareRetirementReviewV6, decodeRetirementReviewV6,
  assertRetirementApprovalV6, runRetirementOnceV6 } from "../../../lib/deployments/execution/cell-reserved-retirement-v6.ts";
import { createReservedRetirementAwsV6 } from "./cell-reserved-retirement-aws-v6.mjs";

const args = process.argv.slice(2), options = {};
for (let n = 0; n < args.length; n += 2) {
  if (!args[n]?.startsWith("--") || !args[n + 1] || options[args[n]]) throw Error("RETIREMENT_ARGUMENTS_INVALID"); options[args[n]] = args[n + 1];
}
const mode = options["--mode"], allowed = mode === "Review" ? ["--mode", "--out"] : mode === "Inspect" ? ["--mode", "--out", "--manifest"] : ["--mode", "--out", "--manifest", "--approved-sha"];
if (!["Review", "Run", "Inspect"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("RETIREMENT_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]);
const freshName = /^techlong-f3c9j-retirement-[a-z0-9-]+$/;
if ((await lstat(root)).isSymbolicLink() || root.toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() ||
  (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !freshName.test(path.basename(out))) throw Error("RETIREMENT_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const b = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx", flush: true }); return sha256Hex(b); };
const rawHash = b => createHash("sha256").update(b).digest("hex");
let aws, stage = "LOCAL_BINDING";
try {
  const readExact = async (base, relative) => {
    const filename = path.resolve(base, relative);
    if (!filename.toLowerCase().startsWith((path.resolve(base) + path.sep).toLowerCase()) ||
      (await realpath(filename)).toLowerCase() !== filename.toLowerCase() || (await lstat(filename)).isSymbolicLink()) throw Error("RETIREMENT_LOCAL_PATH_INVALID");
    return readFile(filename);
  };
  const old = JSON.parse((await readExact(root, "techlong-f3c9i-kms-review-20261013-r2/code-binding.json")).toString("utf8"));
  if (old.pins.length !== 115 || old.codeSha256 !== "381c1726baf7b2d1a93b04351a344d490f972c61763cee5da3b835a3bd801b3f" || await sha256Hex(old.pins) !== old.codeSha256) throw Error("RETIREMENT_OLD115_BINDING_INVALID");
  const map = new Map(old.pins.map(p => [p.file, p.sha256]));
  for (const file of ["lib/deployments/execution/cell-reserved-retirement-v6.ts", "ops/aws-sandbox/scripts/cell-reserved-retirement-aws-v6.mjs",
    "ops/aws-sandbox/scripts/review-cell-reserved-retirement-v6.mjs", "tests/cell-reserved-retirement-v6.test.ts"])
    map.set(file, await sha256Hex((await readExact(repo, file)).toString("utf8").replace(/\r\n/g, "\n")));
  const pins = [...map].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })), codeBindingSha256 = await sha256Hex(pins);
  const preservedFiles = [
    ["techlong-f3c9h-reserved-20261012-r1/reserved-manifest.json", "525fa2722b47d92486c9392e31cb0a4424b96286d9e784a0190693b8e676d7aa"],
    ["techlong-f3c9h-reserved-20261012-r1-independent-created-inspect/independent-evidence.json", "7099c6519a79b8a85a54b53808cc630121c7f980244f353f08b1a0ec19344a37"],
    ["techlong-f3c9h-reserved-20261012-r1-independent-created-inspect/reserved-report.json", "27c4279c29ac97167eeebc73b140abd3784f7666fdeaf4b52bcc4fdb0272faee"],
    ["techlong-f3c9h-reserved-20261012-r1-run-after-refresh/reserved-report.json", "fcaca71cce5afc25a2f5df533782c00567c083dea71961818841f2306745a510"],
    ["techlong-f3c9h-reserved-identity-create.permanent-slot.json", t.creationSlotFileSha256],
    ["techlong-f3c9d-failed-birth-installation.permanent-slot.json", "d113cae152d5eb0a3c4b10e7f16fd07983813bd303c8d0e057d729676f2b7d9e"],
    ["techlong-f3c9e-pg18-reviewed-installation.permanent-slot.json", "f5cb3a943c2751de168afbcf2b71766635a667443a2e22f82fe585e049d6bc39"],
    ["techlong-f3c9g-locked-function-update.permanent-slot.json", "fe99f83387cc8f4ab3449276d2573c04442224dd0c5e3c33f1e07f1d9e5fed58"],
    ["techlong-f3c9f-parent-bundle-20261012-r3/artifact-review.json", "ce8ff76b25b3dae56498c4e453698f423639541bcb45861e2d11de913d531ddb"],
    ["techlong-f3c9f-parent-bundle-20261012-r3/cell-birth-parent-v5.zip", "b53ba821ce2619b90c4d941e5bc4969b131d4e9e777f3498a75320deca136e47"],
    ["techlong-f3c9f-parent-bundle-20261012-r3/cell-birth-coordinator-v4.mjs", "71f31e586f2eeb737c158b917cf799595f76803f8fe725476e0b6ed47a86f25c"],
  ];
  const verifyFiles = async () => {
    for (const p of pins) if (await sha256Hex((await readExact(repo, p.file)).toString("utf8").replace(/\r\n/g, "\n")) !== p.sha256) throw Error("RETIREMENT_CODE_DRIFT");
    for (const [file, sha] of preservedFiles) if (rawHash(await readExact(root, file)) !== sha) throw Error("RETIREMENT_PRESERVED_HISTORY_DRIFT");
    if (rawHash(await readExact(repo, "package-lock.json")) !== "d2fe3d8e93e04ed696c6dd7d5a44a0861d9c9e61ced0caecea2875a375ee39a5") throw Error("RETIREMENT_PACKAGE_LOCK_DRIFT");
  };
  await verifyFiles(); await save("code-binding.json", { codeBindingSha256, pins, old115CodeSha256: old.codeSha256, preservedFiles });
  const original = await decodeReservationReviewV5(JSON.parse((await readExact(root, preservedFiles[0][0])).toString("utf8")));
  const slotPath = path.join(root, t.permanentSlot), readSlot = async () => {
    try { return JSON.parse((await readExact(root, t.permanentSlot)).toString("utf8")); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  };
  const existingSlot = await readSlot(); let manifest, result;
  if (mode !== "Review") {
    const f = path.resolve(options["--manifest"]), d = path.dirname(f);
    if (path.basename(f) !== "retirement-manifest.json" || path.dirname(d).toLowerCase() !== root.toLowerCase() || !freshName.test(path.basename(d))) throw Error("RETIREMENT_MANIFEST_PATH_INVALID");
    manifest = await decodeRetirementReviewV6(JSON.parse((await readExact(root, path.relative(root, f))).toString("utf8")));
    const binding = JSON.parse((await readExact(root, path.relative(root, path.join(d, "code-binding.json")))).toString("utf8"));
    if (manifest.codeBindingSha256 !== codeBindingSha256 || binding.codeBindingSha256 !== codeBindingSha256 || canonicalJson(binding.pins) !== canonicalJson(pins) || canonicalJson(binding.preservedFiles) !== canonicalJson(preservedFiles)) throw Error("RETIREMENT_REVIEWED_SOURCE_DRIFT");
    if (mode === "Run") assertRetirementApprovalV6(manifest, options["--approved-sha"], codeBindingSha256, Date.now());
  }
  aws = createReservedRetirementAwsV6(original, manifest?.request);
  if (mode === "Review") {
    if (existingSlot) throw Error("RETIREMENT_SLOT_OCCUPIED_INSPECT_ONLY");
    stage = "READONLY_REVIEW"; const live = await aws.readBefore(); await verifyFiles();
    await save("readonly-before.json", live); manifest = await prepareRetirementReviewV6(live.before, codeBindingSha256, Date.now());
    const manifestFileSha256 = await save("retirement-manifest.json", manifest);
    result = { outcome: "RETIREMENT_REVIEW_READY_NOT_DELETED", manifestSha256: manifest.manifestSha256, manifestFileSha256,
      requestSha256: manifest.requestSha256, expiresAt: new Date(manifest.expiresAt).toISOString(), cloudWriteCalls: 0, retirementSlotPresent: false };
  } else if (mode === "Run") {
    stage = "REVIEWED_DELETE_ONCE";
    result = await runRetirementOnceV6(manifest, options["--approved-sha"], codeBindingSha256, {
      verifyFilesAndSource: async () => { await verifyFiles(); await aws.identity(); }, readBefore: async () => (await aws.readBefore()).before,
      claimOnce: async approvedManifestSha256 => {
        try {
          await writeFile(slotPath, JSON.stringify({ protocol: "expired-reserved-identity-retirement-attempt-v6", approvedManifestSha256, codeBindingSha256,
            requestSha256: manifest.requestSha256, stackId: t.stackId, token: manifest.request.ClientRequestToken,
            attemptedAt: new Date().toISOString(), retryAuthorized: false }) + "\n", { flag: "wx", flush: true }); return true;
        } catch (e) { if (e.code === "EEXIST") return false; throw Error("RETIREMENT_PERMANENT_SLOT_SAVE_FAILED"); }
      }, marker: save, deleteOnce: aws.deleteOnce,
    });
    if (result.outcome !== "RETIREMENT_DELETE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED") process.exitCode = 1;
  } else {
    stage = "INDEPENDENT_READONLY_INSPECT";
    const slotMatches = existingSlot?.protocol === "expired-reserved-identity-retirement-attempt-v6" && existingSlot.approvedManifestSha256 === manifest.manifestSha256 &&
      existingSlot.codeBindingSha256 === codeBindingSha256 && existingSlot.requestSha256 === manifest.requestSha256 && existingSlot.stackId === t.stackId && existingSlot.token === manifest.request.ClientRequestToken &&
      Number.isFinite(Date.parse(existingSlot.attemptedAt)) && Date.parse(existingSlot.attemptedAt) >= manifest.reviewedAt && Date.parse(existingSlot.attemptedAt) < manifest.expiresAt;
    const live = await aws.inspect(manifest.request.ClientRequestToken, slotMatches ? Date.parse(existingSlot.attemptedAt) : NaN, slotMatches);
    await verifyFiles(); await save("independent-evidence.json", live);
    result = { outcome: live.outcome, observedAt: new Date().toISOString(), stackStatus: live.history.frame.status, resourceCount: 0,
      manifestSha256: manifest.manifestSha256, retirementSlotPresent: !!existingSlot, slotMatches, cloudWriteCalls: 0 };
  }
  const report = { schemaVersion: 6, phase: "F3c9j_EXPIRED_RESERVED_IDENTITY_RETIREMENT", mode, ...result, stackId: t.stackId,
    codeBindingSha256, boundFileCount: pins.length, originalExpiredPlanNotExtended: true, originalCreationSlotPreserved: true, old115Unchanged: true,
    iamWrites: 0, lambdaInvocations: 0, secretValueReads: 0, neonConnections: 0, tableWrites: 0, parentRegistered: false,
    runtimeEnabled: false, retryAuthorized: false, newBirthAuthorized: false, effectivePermissionsProved: false };
  const reportFileSha256 = await save("retirement-report.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const safeCode = /^RETIREMENT_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  const failure = { outcome: "RETIREMENT_STOPPED_INSPECT_ONLY", mode, stage, safeCode, rawProviderDiagnosticsWithheld: true,
    independentInspectRequired: mode === "Run", retryAuthorized: false, runtimeEnabled: false };
  await save("failure.json", failure); console.log(JSON.stringify(failure, null, 2)); process.exitCode = 1;
} finally { aws?.dispose(); }
