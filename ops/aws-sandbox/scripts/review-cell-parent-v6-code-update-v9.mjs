import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { CELL_PARENT_V6_CODE_UPDATE_V9 as t, prepareV6CodeReviewV9, decodeV6CodeReviewV9, assertV6CodeApprovalV9,
  inspectLockedV6CodeSnapshotV9, runV6CodeUpdateV9, v6CodeErrorV9 } from "../../../lib/deployments/execution/cell-parent-v6-code-update-v9.ts";
import { createV6CodeUpdateAwsV9 } from "./cell-parent-v6-code-update-aws-v9.mjs";

const options = {}, args = process.argv.slice(2);
for (let n = 0; n < args.length; n += 2) {
  if (!args[n]?.startsWith("--") || !args[n + 1] || options[args[n]]) throw Error("V6_UPDATE_ARGUMENTS_INVALID"); options[args[n]] = args[n + 1];
}
const mode = options["--mode"], allowed = mode === "Review" ? ["--mode", "--out"] : mode === "Inspect" ? ["--mode", "--out", "--manifest"] : ["--mode", "--out", "--manifest", "--approved-sha"];
if (!["Review", "Inspect", "Run"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("V6_UPDATE_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]), fresh = /^techlong-f3c9l-v6-code-[a-z0-9-]+$/;
if ((await lstat(root)).isSymbolicLink() || root.toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() ||
  (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !fresh.test(path.basename(out))) throw Error("V6_UPDATE_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const hash = b => createHash("sha256").update(b).digest("hex"), save = async (name, value) => {
  const b = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx", flush: true }); return sha256Hex(b);
};
const exact = async (base, file) => {
  const f = path.resolve(base, file);
  if (!f.toLowerCase().startsWith((path.resolve(base) + path.sep).toLowerCase()) || (await realpath(f)).toLowerCase() !== f.toLowerCase() || (await lstat(f)).isSymbolicLink()) throw Error("V6_UPDATE_LOCAL_PATH_INVALID");
  return readFile(f);
};
let aws, stage = "LOCAL_BINDING";
try {
  const old = JSON.parse((await exact(root, "techlong-f3c9k-deleted-inspect-20261013-r1/code-binding.json")).toString("utf8"));
  if (old.pins.length !== 128 || old.codeBindingSha256 !== "45c2931e3368981fcd641db7add463d6b5f7ec421d2966c79c80dba762577e91" || await sha256Hex(old.pins) !== old.codeBindingSha256) throw Error("V6_UPDATE_OLD128_INVALID");
  const artifactBytes = await exact(root, `${t.bundleDirectory}/artifact-review.json`), artifact = JSON.parse(artifactBytes.toString("utf8"));
  if (hash(artifactBytes) !== t.artifactReportFileSha256 || artifact.schemaVersion !== 6 || artifact.zipSha256 !== t.zipSha256 || artifact.zipCodeSha256Base64 !== t.zipCodeSha256 ||
    artifact.bundleSha256 !== t.bundleSha256 || artifact.zipBytes !== t.zipBytes || artifact.reproducibleBuildVerified !== true || artifact.dependencyFreeStartupVerified !== true ||
    artifact.bothInvalidEventsRejectedBeforeCredentials !== true || artifact.installationAuthorized !== false || !Array.isArray(artifact.sourcePins)) throw Error("V6_UPDATE_FROZEN_ARTIFACT_INVALID");
  const map = new Map(old.pins.map(p => [p.file, p.sha256]));
  for (const p of artifact.sourcePins) { if (map.has(p.file) && map.get(p.file) !== p.sha256) throw Error("V6_UPDATE_ARTIFACT_SOURCE_OVERLAP_DRIFT"); map.set(p.file, p.sha256); }
  for (const file of ["lib/deployments/execution/cell-parent-v6-code-update-v9.ts", "ops/aws-sandbox/scripts/cell-parent-v6-code-update-aws-v9.mjs",
    "ops/aws-sandbox/scripts/review-cell-parent-v6-code-update-v9.mjs", "tests/cell-parent-v6-code-update-v9.test.ts"])
    map.set(file, await sha256Hex((await exact(repo, file)).toString("utf8").replace(/\r\n/g, "\n")));
  const pins = [...map].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 })), codeBindingSha256 = await sha256Hex(pins);
  const files = [...old.files,
    ["techlong-f3c9k-deleted-inspect-20261013-r1/deleted-report.json", "1f777012837f50ab4a8e46290fe936f3095f4c44af9256aff7b1d35765ea72cc"],
    ["techlong-f3c9k-deleted-inspect-20261013-r1/independent-evidence.json", "bec46d60299d09ec74193020bae08514844bc6be19d98417619ed2977ad1f4c5"]];
  const verifyFiles = async () => {
    for (const p of pins) if (await sha256Hex((await exact(repo, p.file)).toString("utf8").replace(/\r\n/g, "\n")) !== p.sha256) throw Error("V6_UPDATE_PIN_DRIFT");
    for (const [file, digest] of files) if (hash(await exact(root, file)) !== digest) throw Error("V6_UPDATE_OLD_RECORD_OR_SLOT_DRIFT");
    const zip = await exact(root, `${t.bundleDirectory}/${t.zipName}`), bundle = await exact(root, `${t.bundleDirectory}/${t.bundleName}`), contents = unzipSync(zip);
    if (hash(zip) !== t.zipSha256 || zip.length !== t.zipBytes || createHash("sha256").update(zip).digest("base64") !== t.zipCodeSha256 || hash(bundle) !== t.bundleSha256 ||
      Object.keys(contents).join(",") !== t.bundleName || hash(contents[t.bundleName]) !== t.bundleSha256 || hash(await exact(root, `${t.bundleDirectory}/artifact-review.json`)) !== t.artifactReportFileSha256 ||
      hash(await exact(repo, "package-lock.json")) !== artifact.packageLockSha256) throw Error("V6_UPDATE_FROZEN_BYTES_DRIFT");
  };
  await verifyFiles(); await save("code-binding.json", { codeBindingSha256, pins, frozen128CodeSha256: old.codeBindingSha256, artifactReportFileSha256: t.artifactReportFileSha256, files });
  const slotPath = path.join(root, t.permanentSlot); let existing;
  try { existing = JSON.parse((await exact(root, t.permanentSlot)).toString("utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; existing = null; }
  let review, result;
  if (mode !== "Review") {
    const f = path.resolve(options["--manifest"]), d = path.dirname(f);
    if (path.basename(f) !== "v6-code-manifest.json" || path.dirname(d).toLowerCase() !== root.toLowerCase() || !fresh.test(path.basename(d))) throw Error("V6_UPDATE_MANIFEST_PATH_INVALID");
    review = await decodeV6CodeReviewV9(JSON.parse((await exact(root, path.relative(root, f))).toString("utf8")));
    const binding = JSON.parse((await exact(root, path.relative(root, path.join(d, "code-binding.json")))).toString("utf8"));
    if (review.codeBindingSha256 !== codeBindingSha256 || binding.codeBindingSha256 !== codeBindingSha256 || canonicalJson(binding.pins) !== canonicalJson(pins) || canonicalJson(binding.files) !== canonicalJson(files)) throw Error("V6_UPDATE_REVIEWED_CODE_DRIFT");
    if (mode === "Run") assertV6CodeApprovalV9(review, options["--approved-sha"], codeBindingSha256, Date.now());
  }
  const zip = mode === "Run" ? await exact(root, `${t.bundleDirectory}/${t.zipName}`) : undefined;
  aws = createV6CodeUpdateAwsV9(zip, mode === "Run" ? review : undefined, options["--approved-sha"], codeBindingSha256);
  if (mode === "Review") {
    if (existing) throw Error("V6_UPDATE_SLOT_OCCUPIED_INSPECT_ONLY");
    stage = "SOURCE_SIMULATION_AND_FULL_LOCKED_READ"; const simulations = await aws.simulateSource(), before = await aws.readStable(); await verifyFiles();
    review = await prepareV6CodeReviewV9(before, codeBindingSha256, Date.now());
    await save("readonly-before.json", { before, hashes: review.beforeHashes, simulations }); const manifestFileSha256 = await save("v6-code-manifest.json", review);
    result = { outcome: "LOCKED_V6_CODE_REVIEW_READY_NOT_UPDATED", manifestSha256: review.manifestSha256, manifestFileSha256, expiresAt: new Date(review.expiresAt).toISOString(),
      beforeRevisionId: review.beforeHashes.revisionId, sourcePermissionSimulations: simulations, candidateInstalled: false, localSlotPresent: false, cloudWriteCalls: 0 };
  } else if (mode === "Inspect") {
    stage = "INDEPENDENT_FULL_LOCKED_READ"; const live = await aws.readStable(); await verifyFiles();
    const variant = live.function.CodeSha256 === t.beforeCodeSha256 ? "before" : "candidate", hashes = await inspectLockedV6CodeSnapshotV9(live, variant, Date.now());
    const invariantMatches = hashes.invariantSha256 === review.beforeHashes.invariantSha256, slotMatches = existing?.protocol === "locked-v6-code-update-permanent-attempt-v9" &&
      existing.approvedManifestSha256 === review.manifestSha256 && existing.codeBindingSha256 === codeBindingSha256 && existing.zipSha256 === t.zipSha256;
    if (!invariantMatches) throw Error("V6_UPDATE_INDEPENDENT_LOCK_OR_ASYNC_DRIFT"); await save("independent-metadata.json", { live, hashes });
    result = { outcome: variant === "candidate" && slotMatches ? "LOCKED_V6_CODE_INDEPENDENTLY_VERIFIED" : "LOCKED_V6_CODE_BEFORE_OR_UNATTRIBUTED_INSPECT_ONLY",
      observedAt: new Date().toISOString(), variant, hashes, invariantMatches, slotMatches, localSlotPresent: !!existing, candidateInstalled: variant === "candidate", cloudWriteCalls: 0 };
  } else {
    stage = "REVIEWED_CODE_UPDATE_ONCE";
    if (existing) throw Error("V6_UPDATE_SLOT_OCCUPIED_INSPECT_ONLY");
    result = await runV6CodeUpdateV9(review, options["--approved-sha"], codeBindingSha256, {
      verifySourceAndFiles: async () => { await verifyFiles(); await aws.identity(); await aws.simulateSource(); }, readStable: aws.readStable,
      marker: save, updateOnce: aws.updateOnce, waitReady: aws.waitReady,
      claimOnce: async approvedManifestSha256 => {
        try { await writeFile(slotPath, JSON.stringify({ protocol: "locked-v6-code-update-permanent-attempt-v9", approvedManifestSha256, codeBindingSha256,
          zipSha256: t.zipSha256, attemptedAt: new Date().toISOString(), retryAuthorized: false }) + "\n", { flag: "wx", flush: true }); return true; }
        catch (e) { if (e.code === "EEXIST") return false; throw Error("V6_UPDATE_SLOT_SAVE_FAILED"); }
      },
    });
    if (result.outcome !== "V6_CODE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED") process.exitCode = 1;
  }
  const report = { schemaVersion: 9, phase: "F3c9l_LOCKED_V6_CODE_ONLY_UPDATE", mode, ...result, codeBindingSha256, boundFileCount: pins.length, functionArn: t.functionArn,
    candidateZipSha256: t.zipSha256, httpPutEntered: aws.httpPutEntered(), frozen128AndArtifactsUnchanged: true, allOldSlotsAndRetirementRecordsPreserved: true,
    asyncWrites: 0, iamWrites: 0, lambdaInvocations: 0, secretValueReads: 0, neonConnections: 0, tableWrites: 0, identityOrCellCreates: 0,
    parentRegistered: false, runtimeEnabled: false, retryAuthorized: false, actualKmsForwardingVerified: false };
  const reportFileSha256 = await save("v6-code-report.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const failure = { mode, stage, failure: v6CodeErrorV9(e), httpPutEntered: aws?.httpPutEntered() ?? false, rawProviderDiagnosticsWithheld: true, retryAuthorized: false, runtimeEnabled: false };
  await save("failure.json", failure); console.log(JSON.stringify(failure, null, 2)); process.exitCode = 1;
} finally { aws?.dispose(); }
