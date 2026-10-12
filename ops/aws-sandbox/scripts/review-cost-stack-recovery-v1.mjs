import { readFile, readdir, realpath, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { COST_RECOVERY_SCOPE_V1 as scope, compileRecoveryManifestV1, validateRecoveryManifestV1, draftDirectCostPayloadV1, runCostRecoveryV1 } from "../../../lib/deployments/execution/cost-stack-recovery-v1.ts";
import { EXISTING_COST_SCOPE_V1 as previous, validateExistingCostManifestV1 } from "../../../lib/deployments/execution/existing-cost-controls-v1.ts";
import { createCostRecoveryRuntimeV1 } from "./cost-stack-recovery-aws-v1.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url)), privateRoot = await realpath("F:/ChatGPT_workshop"), o = {}, args = process.argv.slice(2), equal = (a, b) => canonicalJson(a) === canonicalJson(b);
for (let n = 0; n < args.length; n += 2) { if (!["--mode", "--out", "--manifest", "--approved-sha"].includes(args[n]) || !args[n + 1] || o[args[n]]) throw Error("COST_RECOVERY_OPTIONS_INVALID"); o[args[n]] = args[n + 1]; }
const mode = o["--mode"], keys = mode === "Review" ? ["--mode", "--out"] : mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] : ["--mode", "--out", "--manifest"];
if (!["Review", "Run", "Inspect"].includes(mode) || !equal(Object.keys(o).sort(), keys.sort())) throw Error("COST_RECOVERY_OPTIONS_INVALID");
const bounded = async p => /^techlong-f3c3c-cost-stack-recovery-[a-z0-9-]+$/.test(path.basename(p)) && (await realpath(path.dirname(p))).toLowerCase() === privateRoot.toLowerCase();
const out = path.resolve(o["--out"]); if (!await bounded(out)) throw Error("COST_RECOVERY_PRIVATE_OUTPUT_REQUIRED"); await mkdir(out);
const save = async (n, v) => { const b = JSON.stringify(v, null, 2) + "\n"; await writeFile(path.join(out, n), b, { flag: "wx" }); return sha256Hex(b); };
const originalSlot = path.join(privateRoot, previous.originalSlot), previousSlot = path.join(privateRoot, previous.permanentSlot), slot = path.join(privateRoot, scope.permanentSlot);
const originalFile = path.join(privateRoot, "techlong-f3c3a-cost-controls-20261012-r2/review-manifest.json"), previousFile = path.join(privateRoot, "techlong-f3c3b-existing-cost-controls-20261012-r2/review-manifest.json"), receiptFile = path.join(privateRoot, "techlong-f3c3b-existing-cost-controls-20261012-r2-run/submission-receipt.json");
const originalFiles = ["lib/deployments/execution/sandbox-cost-controls-v1.ts", "lib/deployments/execution/hash.ts", "ops/aws-sandbox/scripts/sandbox-cost-controls-aws-v1.mjs", "ops/aws-sandbox/scripts/review-sandbox-cost-controls-v1.mjs", "ops/aws-sandbox/cloudformation/guardrails.template.json", "package.json", "package-lock.json"];
const previousFiles = [...originalFiles, "lib/deployments/execution/existing-cost-controls-v1.ts", "ops/aws-sandbox/scripts/existing-cost-controls-aws-v1.mjs", "ops/aws-sandbox/scripts/review-existing-cost-controls-v1.mjs"];
const files = [...previousFiles, "lib/deployments/execution/cost-stack-recovery-v1.ts", "ops/aws-sandbox/scripts/cost-stack-recovery-aws-v1.mjs", "ops/aws-sandbox/scripts/review-cost-stack-recovery-v1.mjs"];
const pin = async paths => { const pins = []; for (const file of paths) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n")) }); return { pins, codeSha256: await sha256Hex(pins) }; };
let stage = "HISTORICAL_BINDING";
try {
  const code = await pin(files); await save("code-binding.json", code);
  const base = JSON.parse(await readFile(path.join(root, "ops/aws-sandbox/cloudformation/guardrails.template.json"), "utf8")), original = JSON.parse(await readFile(originalFile, "utf8")), prev = JSON.parse(await readFile(previousFile, "utf8"));
  const verifyHistory = async () => {
    for (const dir of [originalSlot, previousSlot, path.dirname(originalFile), path.dirname(previousFile), path.dirname(receiptFile)]) if ((await lstat(dir)).isSymbolicLink()) throw Error("COST_RECOVERY_HISTORY_PATH_INVALID");
    for (const [file, hash] of [[originalFile, previous.originalManifestFileSha256], [previousFile, "a94045e0f1c37330d458a786c198bc71398ce1c7f1c6e902358ba7216012fb64"], [receiptFile, scope.previousReceiptSha256]]) if ((await lstat(file)).isSymbolicLink() || await sha256Hex(await readFile(file, "utf8")) !== hash) throw Error("COST_RECOVERY_HISTORY_HASH_DRIFT");
    if ((await pin(originalFiles)).codeSha256 !== scope.originalCodeSha256 || (await pin(previousFiles)).codeSha256 !== scope.previousCodeSha256 || (await pin(files)).codeSha256 !== code.codeSha256) throw Error("COST_RECOVERY_CODE_DRIFT");
    await validateExistingCostManifestV1(prev, base, scope.previousCodeSha256);
    if (!equal(prev.originalManifest, original)) throw Error("COST_RECOVERY_HISTORY_MANIFEST_DRIFT");
    for (const [dir, names, approved] of [[originalSlot, ["approved-manifest.json", "create-attempt.json", "create-confirmed.json"], original], [previousSlot, ["approved-manifest.json", "execute-attempt.json", "execute-confirmed.json"], prev]]) {
      if (!equal((await readdir(dir)).sort(), names)) throw Error("COST_RECOVERY_CONSUMED_SLOT_DRIFT");
      for (const n of names) if ((await lstat(path.join(dir, n))).isSymbolicLink()) throw Error("COST_RECOVERY_HISTORY_PATH_INVALID");
      if (!equal(JSON.parse(await readFile(path.join(dir, names[0]), "utf8")), approved)) throw Error("COST_RECOVERY_CONSUMED_SLOT_DRIFT");
    }
    for (const [dir, n, expected] of [[originalSlot, "create-attempt.json", { approved: previous.originalManifestSha256 }], [originalSlot, "create-confirmed.json", { changeSetArn: previous.changeSetArn }], [previousSlot, "execute-attempt.json", { approved: prev.manifestSha256, changeSetArn: previous.changeSetArn }], [previousSlot, "execute-confirmed.json", { changeSetArn: previous.changeSetArn }]]) if (!equal(JSON.parse(await readFile(path.join(dir, n), "utf8")), expected)) throw Error("COST_RECOVERY_CONSUMED_SLOT_DRIFT");
    const r = JSON.parse(await readFile(receiptFile, "utf8")); if (r.writeAttempts !== 1 || !r.slotConsumed || r.failureCode !== "EXISTING_COST_BUDGET_UPDATE_UNVERIFIED" || r.failureStage !== "EXECUTE_EXISTING_CHANGESET") throw Error("COST_RECOVERY_RECEIPT_DRIFT");
  };
  await verifyHistory(); let occupied = true; try { await lstat(slot); } catch (e) { if (e.code === "ENOENT") occupied = false; else throw e; }
  if (mode !== "Inspect" && occupied) throw Error("COST_RECOVERY_CONSUMED_SLOT_INSPECT_ONLY");
  const runtime = createCostRecoveryRuntimeV1(original, originalSlot, slot, verifyHistory); let m;
  if (mode === "Review") {
    stage = "READONLY_RECOVERY_REVIEW"; const v = await runtime.snapshot(true), snapshotFileSha256 = await save("read-only-snapshot.json", v);
    m = await compileRecoveryManifestV1(original, v, base, code.codeSha256, Date.now());
    const fileSha256 = await save("review-manifest.json", m), directDraftFileSha256 = await save("unapproved-direct-cost-draft.json", draftDirectCostPayloadV1(v.inventory.settings));
    console.log(JSON.stringify({ mode, out, fileSha256, snapshotFileSha256, directDraftFileSha256, manifestSha256: m.manifestSha256, codeSha256: m.codeSha256,
      reviewedAt: new Date(m.reviewedAt).toISOString(), expiresAt: new Date(m.expiresAt).toISOString(), stableEvent: v.stableEvent, permissionChecks: v.permissionChecks,
      proposedMaximumDirectWrites: 1, cloudWrites: 0, newSlotConsumed: false, approvalRequired: true, directBudgetUpdateAuthorized: false, tableUpdateAuthorized: false, runtimeEnabled: false }));
  } else {
    const file = path.resolve(o["--manifest"]); if (path.basename(file) !== "review-manifest.json" || !await bounded(path.dirname(file)) || (await lstat(file)).isSymbolicLink()) throw Error("COST_RECOVERY_PRIVATE_MANIFEST_REQUIRED");
    m = JSON.parse(await readFile(file, "utf8")); await validateRecoveryManifestV1(m, base, code.codeSha256);
    if (occupied && !equal(JSON.parse(await readFile(path.join(slot, "approved-manifest.json"), "utf8")), m)) throw Error("COST_RECOVERY_SLOT_MANIFEST_DRIFT");
    if (mode === "Run") {
      stage = "EXPLICIT_ONCE_RECOVERY"; const r = await runCostRecoveryV1(m, o["--approved-sha"], base, code.codeSha256, { now: Date.now, snapshot: runtime.snapshot, rollbackOnce: runtime.rollbackOnce, waitRestored: runtime.waitRestored,
        claimSlot: () => mkdir(slot), marker: (n, v) => writeFile(path.join(slot, n), JSON.stringify(v, null, 2) + "\n", { flag: "wx" }) });
      const fileSha256 = await save("submission-receipt.json", r); console.log(JSON.stringify({ mode, out, fileSha256, ...r })); if (r.failureCode) process.exitCode = 1;
    }
    stage = "INDEPENDENT_READONLY_INSPECT"; const r = await runtime.inspect(m), fileSha256 = await save("independent-inspect.json", r); console.log(JSON.stringify({ mode: "Inspect", out, fileSha256, ...r })); if (!r.restorationVerified) process.exitCode = 1;
  }
} catch (e) {
  const r = { outcome: "COST_RECOVERY_UNVERIFIED", stage, failureCode: /^(COST_RECOVERY|COST_CONTROL|EXISTING_COST)_[A-Z_]+$/.test(e.message ?? "") ? e.message : "COST_RECOVERY_OPERATION_UNVERIFIED",
    serviceErrorName: ["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "ExpiredToken", "ExpiredTokenException"].includes(e.name) ? e.name : null,
    rawDiagnosticsWithheld: true, noAutomaticAdditionalRollbackDeleteFillResetOrWriteRetry: true, runtimeEnabled: false };
  await save("failure-diagnostic.json", r); console.error(JSON.stringify(r)); process.exitCode = 1;
}
