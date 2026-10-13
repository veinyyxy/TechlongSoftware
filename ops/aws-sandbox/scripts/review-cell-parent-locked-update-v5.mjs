import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { CELL_PARENT_LOCKED_UPDATE_V5 as t, prepareCellParentLockedUpdateReviewV5, decodeCellParentLockedUpdateReviewV5,
  inspectCellParentLockedSnapshotV5, runCellParentLockedUpdateV5 } from "../../../lib/deployments/execution/cell-parent-locked-update-v5.ts";
import { assertCellParentAsyncLockedV5 } from "../../../lib/deployments/execution/cell-parent-async-plan-v5.ts";
import { createCellParentLockedUpdateAwsV5 } from "./cell-parent-locked-update-aws-v5.mjs";

// Review/Inspect never call writeOnce. Run needs a fresh exact approval and
// fixed durable slot; two calls ONLY, no IAM/Invoke/DB/CFN/rollback actuator.
const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith("--") || !args[i + 1] || options[args[i]]) throw Error("LOCKED_UPDATE_ARGUMENTS_INVALID"); options[args[i]] = args[i + 1];
}
const mode = options["--mode"], allowed = mode === "Review" ? ["--mode", "--out"] : mode === "Inspect" ? ["--mode", "--out", "--manifest"] : ["--mode", "--out", "--manifest", "--approved-sha"];
if (!["Review", "Run", "Inspect"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("LOCKED_UPDATE_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]);
if ((await lstat(root)).isSymbolicLink() || path.resolve(root).toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() ||
  (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9g-locked-update-[a-z0-9-]+$/.test(path.basename(out))) throw Error("LOCKED_UPDATE_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx", flush: true }); return sha256Hex(text); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex"), directory = path.join(root, t.bundleDirectory), zipPath = path.join(directory, t.zipName);
let stage = "LOCAL_BINDING", aws, result, pins, codeSha256;
try {
  const prior = JSON.parse(await readFile(path.join(root, "techlong-f3c9e-pg18-install-20261012-r1/code-binding.json"), "utf8"));
  if (prior.codeSha256 !== t.old70CodeSha256 || prior.pins.length !== 70 || await sha256Hex(prior.pins) !== t.old70CodeSha256) throw Error("LOCKED_UPDATE_OLD70_BINDING_INVALID");
  const artifactText = await readFile(path.join(directory, "artifact-review.json"), "utf8"), artifact = JSON.parse(artifactText);
  if (await sha256Hex(artifactText) !== t.artifactReportFileSha256 || artifact.sourcePins?.length !== 48 || artifact.schemaVersion !== 5 ||
    artifact.bundleSha256 !== t.bundleSha256 || artifact.zipSha256 !== t.zipSha256 || artifact.zipCodeSha256Base64 !== t.zipCodeSha256Base64 ||
    artifact.reproducibleBuildVerified !== true || artifact.dependencyFreeStartupVerified !== true || artifact.bothInvalidEventsRejectedBeforeCredentials !== true || artifact.installationAuthorized !== false) throw Error("LOCKED_UPDATE_FINAL_ARTIFACT_REPORT_INVALID");
  const map = new Map();
  for (const pin of [...prior.pins, ...artifact.sourcePins]) {
    if (map.has(pin.file) && map.get(pin.file) !== pin.sha256) throw Error("LOCKED_UPDATE_OVERLAPPING_PIN_DRIFT"); map.set(pin.file, pin.sha256);
  }
  for (const file of ["lib/deployments/execution/cell-parent-locked-update-v5.ts", "ops/aws-sandbox/scripts/cell-parent-locked-update-aws-v5.mjs",
    "ops/aws-sandbox/scripts/review-cell-parent-locked-update-v5.mjs", "tests/cell-parent-locked-update-v5.test.ts"])
    map.set(file, await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")));
  pins = [...map].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })); codeSha256 = await sha256Hex(pins);
  const oldSlots = [["techlong-f3c9d-failed-birth-installation.permanent-slot.json", "d113cae152d5eb0a3c4b10e7f16fd07983813bd303c8d0e057d729676f2b7d9e"],
    ["techlong-f3c9e-pg18-reviewed-installation.permanent-slot.json", "f5cb3a943c2751de168afbcf2b71766635a667443a2e22f82fe585e049d6bc39"]];
  const verifyFiles = async () => {
    for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("LOCKED_UPDATE_CODE_BINDING_DRIFT");
    for (const [name, sha] of oldSlots) if (hash(await readFile(path.join(root, name))) !== sha) throw Error("LOCKED_UPDATE_OLD_SLOT_DRIFT");
    if ((await realpath(directory)).toLowerCase() !== directory.toLowerCase() || (await lstat(directory)).isSymbolicLink() || (await lstat(zipPath)).isSymbolicLink()) throw Error("LOCKED_UPDATE_ARTIFACT_PATH_INVALID");
    const zip = await readFile(zipPath), bundle = await readFile(path.join(directory, t.bundleName)), contents = unzipSync(zip);
    if (hash(zip) !== t.zipSha256 || zip.length !== t.zipBytes || createHash("sha256").update(zip).digest("base64") !== t.zipCodeSha256Base64 ||
      hash(bundle) !== t.bundleSha256 || Object.keys(contents).join(",") !== t.bundleName || hash(contents[t.bundleName]) !== t.bundleSha256 ||
      hash(await readFile(path.join(repo, "package-lock.json"))) !== artifact.packageLockSha256 || await sha256Hex(await readFile(path.join(directory, "artifact-review.json"), "utf8")) !== t.artifactReportFileSha256) throw Error("LOCKED_UPDATE_ARTIFACT_BYTES_DRIFT");
  };
  await verifyFiles(); await save("code-binding.json", { pins, codeSha256, old70CodeSha256: prior.codeSha256, artifactReportFileSha256: t.artifactReportFileSha256 });
  const slotPath = path.join(root, t.permanentSlot), slot = async () => {
    try { return JSON.parse(await readFile(slotPath, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  };
  let manifest;
  if (mode !== "Review") {
    const filename = path.resolve(options["--manifest"]), parent = path.dirname(filename);
    if (path.basename(filename) !== "locked-update-manifest.json" || path.dirname(parent).toLowerCase() !== root.toLowerCase() ||
      !/^techlong-f3c9g-locked-update-[a-z0-9-]+$/.test(path.basename(parent)) || (await realpath(parent)).toLowerCase() !== parent.toLowerCase()) throw Error("LOCKED_UPDATE_MANIFEST_PATH_INVALID");
    manifest = await decodeCellParentLockedUpdateReviewV5(JSON.parse(await readFile(filename, "utf8")));
    const binding = JSON.parse(await readFile(path.join(parent, "code-binding.json"), "utf8"));
    if (binding.codeSha256 !== codeSha256 || manifest.codeBindingSha256 !== codeSha256 || canonicalJson(binding.pins) !== canonicalJson(pins)) throw Error("LOCKED_UPDATE_REVIEWED_CODE_DRIFT");
    if (mode === "Run" && (options["--approved-sha"] !== manifest.manifestSha256 || Date.now() < manifest.reviewedAt || Date.now() >= manifest.expiresAt)) throw Error("LOCKED_UPDATE_FRESH_EXACT_APPROVAL_REQUIRED");
  }
  aws = createCellParentLockedUpdateAwsV5(zipPath); stage = "SOURCE_READONLY_REVIEW";
  const existingSlot = await slot();
  if (mode === "Review") {
    if (existingSlot) throw Error("LOCKED_UPDATE_SLOT_OCCUPIED_INSPECT_ONLY");
    const simulations = await aws.simulateSource(), before = await aws.readStable(); await verifyFiles();
    await save("guard-checks.json", { guards: before.guards, failedGuards: Object.keys(before.guards).filter(k => before.guards[k] !== true) });
    manifest = await prepareCellParentLockedUpdateReviewV5(before, codeSha256, Date.now());
    const manifestFileSha256 = await save("locked-update-manifest.json", manifest);
    result = { outcome: "LOCKED_UPDATE_REVIEW_READY_NOT_EXECUTED", manifestSha256: manifest.manifestSha256, manifestFileSha256,
      expiresAt: new Date(manifest.expiresAt).toISOString(), beforeRevisionId: before.function.RevisionId,
      sourcePermissionSimulations: simulations, localSlotPresent: false, candidateInstalled: false, asyncInstalled: false, awsWrites: 0 };
    await save("readonly-before.json", { before, beforeHashes: manifest.beforeHashes });
  } else if (mode === "Inspect") {
    stage = "INDEPENDENT_READONLY_INSPECT"; const live = await aws.readStable(); await verifyFiles();
    const variant = live.function.CodeSha256 === t.beforeZipCodeSha256Base64 ? "before" : "candidate";
    const hashes = await inspectCellParentLockedSnapshotV5(live, variant, Date.now()), invariantMatches = hashes.invariantSha256 === manifest.beforeHashes.invariantSha256;
    let asyncInstalled = false; if (live.async) { try { assertCellParentAsyncLockedV5(live.async, { ReservedConcurrentExecutions: 0 }); asyncInstalled = true; } catch { /* explicit not-ready, never repaired */ } }
    const slotMatches = existingSlot?.protocol === "cell-parent-locked-update-permanent-attempt-v5" && existingSlot.approvedManifestSha256 === manifest.manifestSha256 && existingSlot.codeBindingSha256 === codeSha256;
    result = { outcome: variant === "candidate" && asyncInstalled && invariantMatches && slotMatches ? "LOCKED_CODE_ASYNC_INDEPENDENTLY_VERIFIED" : "LOCKED_UPDATE_BEFORE_PARTIAL_OR_UNATTRIBUTED_INSPECT_ONLY",
      variant, invariantMatches, candidateInstalled: variant === "candidate", asyncInstalled, slotMatchesManifest: slotMatches, localSlotPresent: !!existingSlot,
      functionRevisionId: hashes.revisionId, hashes, awsWrites: 0 };
    await save("independent-metadata.json", { live, hashes });
  } else if (existingSlot) {
    result = { outcome: "LOCKED_UPDATE_SLOT_OCCUPIED_INSPECT_ONLY", writesAttempted: 0, slotConsumed: false, localSlotWasAlreadyPresent: true,
      independentInspectRequired: true, retryAuthorized: false, runtimeEnabled: false }; process.exitCode = 1;
  } else {
    stage = "REVIEWED_TWO_WRITE_RUN";
    await aws.simulateSource();
    result = await runCellParentLockedUpdateV5(manifest, options["--approved-sha"], codeSha256, {
      verifySourceAndFiles: async () => { await verifyFiles(); await aws.identity(); }, readStable: aws.readStable,
      claimPermanentOnce: async approvedManifestSha256 => {
        try { await writeFile(slotPath, JSON.stringify({ protocol: "cell-parent-locked-update-permanent-attempt-v5", approvedManifestSha256, codeBindingSha256: codeSha256,
          attemptedAt: new Date().toISOString(), retryAuthorized: false }) + "\n", { flag: "wx", flush: true }); return true; }
        catch (e) { if (e.code === "EEXIST") return false; throw Error("LOCKED_UPDATE_PERMANENT_SLOT_SAVE_FAILED"); }
      }, marker: save, write: aws.writeOnce, waitCodeReady: aws.waitCodeReady,
    });
    result = { ...result, localSlotWasAlreadyPresent: !!existingSlot };
    if (result.outcome !== "LOCKED_CODE_ASYNC_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT") process.exitCode = 1;
  }
  const summary = { schemaVersion: 5, mode, phase: "F3c9g_LOCKED_CODE_ASYNC", observedAt: new Date().toISOString(), ...result,
    codeBindingSha256: codeSha256, boundFileCount: pins.length, old70AndFinal48PinsUnchanged: true, zipSha256: t.zipSha256,
    iamWrites: 0, lambdaInvocations: 0, secretValueReads: 0, databaseConnections: 0, tableOrCellWrites: 0, retryAuthorized: false, runtimeEnabled: false, effectiveDataPlaneProofProduced: false };
  const reportFileSha256 = await save("locked-update-report.json", summary); console.log(JSON.stringify({ ...summary, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const safeCode = /^(LOCKED_UPDATE|CELL_PARENT_UPDATE)_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  const failure = { outcome: "LOCKED_UPDATE_STOPPED_INSPECT_ONLY", mode, stage, safeCode, noRawProviderDiagnosticsPersisted: true,
    retryAuthorized: false, runtimeEnabled: false, independentInspectRequired: mode === "Run" };
  await save("failure.json", failure); console.log(JSON.stringify(failure, null, 2)); process.exitCode = 1;
} finally { aws?.dispose(); }
