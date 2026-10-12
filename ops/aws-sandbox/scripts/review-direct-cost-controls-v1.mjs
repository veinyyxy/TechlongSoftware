import { readFile, readdir, realpath, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { DIRECT_COST_SCOPE_V1 as s, compileDirectCostManifestV1, validateDirectCostManifestV1, runDirectCostControlsV1 } from "../../../lib/deployments/execution/direct-cost-controls-v1.ts";
import { COST_RECOVERY_SCOPE_V1 as recoveryScope, validateRecoveryManifestV1 } from "../../../lib/deployments/execution/cost-stack-recovery-v1.ts";
import { EXISTING_COST_SCOPE_V1 as previous, validateExistingCostManifestV1 } from "../../../lib/deployments/execution/existing-cost-controls-v1.ts";
import { createDirectCostRuntimeV1 } from "./direct-cost-controls-aws-v1.mjs";
const root = fileURLToPath(new URL("../../../", import.meta.url)), privateRoot = await realpath("F:/ChatGPT_workshop"), o = {}, args = process.argv.slice(2), equal = (a, b) => canonicalJson(a) === canonicalJson(b);
for (let n = 0; n < args.length; n += 2) { if (!["--mode", "--out", "--manifest", "--approved-sha"].includes(args[n]) || !args[n + 1] || o[args[n]]) throw Error("DIRECT_COST_OPTIONS_INVALID"); o[args[n]] = args[n + 1]; }
const mode = o["--mode"], keys = mode === "Review" ? ["--mode", "--out"] : mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] : ["--mode", "--out", "--manifest"];
if (!["Review", "Run", "Inspect"].includes(mode) || !equal(Object.keys(o).sort(), keys.sort())) throw Error("DIRECT_COST_OPTIONS_INVALID");
const bounded = async p => /^techlong-f3c3d-direct-cost-controls-[a-z0-9-]+$/.test(path.basename(p)) && (await realpath(path.dirname(p))).toLowerCase() === privateRoot.toLowerCase();
const out = path.resolve(o["--out"]); if (!await bounded(out)) throw Error("DIRECT_COST_PRIVATE_OUTPUT_REQUIRED"); await mkdir(out);
const save = async (n, v) => { const b = JSON.stringify(v, null, 2) + "\n"; await writeFile(path.join(out, n), b, { flag: "wx" }); return sha256Hex(b); };
const originalSlot = path.join(privateRoot, previous.originalSlot), previousSlot = path.join(privateRoot, previous.permanentSlot), recoverySlot = path.join(privateRoot, recoveryScope.permanentSlot), slot = path.join(privateRoot, s.permanentSlot);
const originalFile = path.join(privateRoot, "techlong-f3c3a-cost-controls-20261012-r2/review-manifest.json"), previousFile = path.join(privateRoot, "techlong-f3c3b-existing-cost-controls-20261012-r2/review-manifest.json"), recoveryFile = path.join(privateRoot, "techlong-f3c3c-cost-stack-recovery-20261012-r1/review-manifest.json");
const receiptFile = path.join(privateRoot, "techlong-f3c3c-cost-stack-recovery-20261012-r1-run/submission-receipt.json"), verifyFile = path.join(privateRoot, "techlong-f3c3c-cost-stack-recovery-20261012-r1-verify/independent-inspect.json");
const originalFiles = ["lib/deployments/execution/sandbox-cost-controls-v1.ts", "lib/deployments/execution/hash.ts", "ops/aws-sandbox/scripts/sandbox-cost-controls-aws-v1.mjs", "ops/aws-sandbox/scripts/review-sandbox-cost-controls-v1.mjs", "ops/aws-sandbox/cloudformation/guardrails.template.json", "package.json", "package-lock.json"];
const previousFiles = [...originalFiles, "lib/deployments/execution/existing-cost-controls-v1.ts", "ops/aws-sandbox/scripts/existing-cost-controls-aws-v1.mjs", "ops/aws-sandbox/scripts/review-existing-cost-controls-v1.mjs"];
const recoveryFiles = [...previousFiles, "lib/deployments/execution/cost-stack-recovery-v1.ts", "ops/aws-sandbox/scripts/cost-stack-recovery-aws-v1.mjs", "ops/aws-sandbox/scripts/review-cost-stack-recovery-v1.mjs"];
const files = [...recoveryFiles, "lib/deployments/execution/direct-cost-controls-v1.ts", "ops/aws-sandbox/scripts/direct-cost-controls-aws-v1.mjs", "ops/aws-sandbox/scripts/review-direct-cost-controls-v1.mjs"];
const pin = async paths => { const pins = []; for (const file of paths) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n")) }); return { pins, codeSha256: await sha256Hex(pins) }; };
let stage = "HISTORICAL_BINDING";
try {
  const code = await pin(files); await save("code-binding.json", code);
  const base = JSON.parse(await readFile(path.join(root, "ops/aws-sandbox/cloudformation/guardrails.template.json"), "utf8")), original = JSON.parse(await readFile(originalFile, "utf8")), prev = JSON.parse(await readFile(previousFile, "utf8")), recovery = JSON.parse(await readFile(recoveryFile, "utf8"));
  const verifyHistory = async () => {
    for (const dir of [originalSlot, previousSlot, recoverySlot, ...[originalFile, previousFile, recoveryFile, receiptFile, verifyFile].map(path.dirname)]) if ((await lstat(dir)).isSymbolicLink()) throw Error("DIRECT_COST_HISTORY_PATH_INVALID");
    for (const [file, hash] of [[originalFile, previous.originalManifestFileSha256], [previousFile, "a94045e0f1c37330d458a786c198bc71398ce1c7f1c6e902358ba7216012fb64"], [recoveryFile, "9aaf2dcc1bb9e865730e74317fc3f522636a86f393ebde0a77cbb02fe038bb02"], [receiptFile, s.recoveryReceiptFileSha256], [verifyFile, s.recoveryVerifyFileSha256]]) {
      if ((await lstat(file)).isSymbolicLink() || await sha256Hex(await readFile(file, "utf8")) !== hash) throw Error("DIRECT_COST_HISTORY_HASH_DRIFT");
    }
    if ((await pin(originalFiles)).codeSha256 !== previous.originalCodeSha256 || (await pin(previousFiles)).codeSha256 !== recoveryScope.previousCodeSha256 || (await pin(recoveryFiles)).codeSha256 !== s.recoveryCodeSha256 || (await pin(files)).codeSha256 !== code.codeSha256) throw Error("DIRECT_COST_CODE_DRIFT");
    await validateExistingCostManifestV1(prev, base, recoveryScope.previousCodeSha256); await validateRecoveryManifestV1(recovery, base, s.recoveryCodeSha256);
    if (!equal(prev.originalManifest, original) || !equal(recovery.originalManifest, original)) throw Error("DIRECT_COST_HISTORY_MANIFEST_DRIFT");
    const groups = [[originalSlot, ["approved-manifest.json", "create-attempt.json", "create-confirmed.json"], original], [previousSlot, ["approved-manifest.json", "execute-attempt.json", "execute-confirmed.json"], prev],
      [recoverySlot, ["approved-manifest.json", "restoration-verified.json", "rollback-attempt.json", "rollback-confirmed.json"], recovery]];
    for (const [dir, names, approved] of groups) {
      if (!equal((await readdir(dir)).sort(), names)) throw Error("DIRECT_COST_OLD_SLOT_DRIFT");
      for (const n of names) if ((await lstat(path.join(dir, n))).isSymbolicLink()) throw Error("DIRECT_COST_HISTORY_PATH_INVALID");
      if (!equal(JSON.parse(await readFile(path.join(dir, "approved-manifest.json"), "utf8")), approved)) throw Error("DIRECT_COST_OLD_SLOT_DRIFT");
    }
    const markers = [
      [originalSlot, "create-attempt.json", { approved: previous.originalManifestSha256 }], [originalSlot, "create-confirmed.json", { changeSetArn: previous.changeSetArn }],
      [previousSlot, "execute-attempt.json", { approved: prev.manifestSha256, changeSetArn: previous.changeSetArn }], [previousSlot, "execute-confirmed.json", { changeSetArn: previous.changeSetArn }],
      [recoverySlot, "rollback-attempt.json", { approved: s.recoveryManifestSha256, stackId: s.stackId }], [recoverySlot, "rollback-confirmed.json", { stackId: s.stackId, operationId: "f68993c6-f7b9-4f06-a16e-e399f18943f9" }],
      [recoverySlot, "restoration-verified.json", { budgetUsd: 10, read: 5, write: 2, stackStatus: s.stackStatus }],
    ];
    for (const [dir, n, expected] of markers) if (!equal(JSON.parse(await readFile(path.join(dir, n), "utf8")), expected)) throw Error("DIRECT_COST_OLD_SLOT_DRIFT");
    const r = JSON.parse(await readFile(receiptFile, "utf8")), v = JSON.parse(await readFile(verifyFile, "utf8"));
    if (r.writeAttempts !== 1 || !r.slotConsumed || r.failureCode !== null || !v.restorationVerified || v.settingsSha256 !== s.recoveredSettingsSha256 || !equal(v.latestStackEvent, s.completedEvent)) throw Error("DIRECT_COST_RECOVERY_PROOF_UNVERIFIED");
  };
  await verifyHistory(); let occupied = true; try { await lstat(slot); } catch (e) { if (e.code === "ENOENT") occupied = false; else throw e; }
  if (mode !== "Inspect" && occupied) throw Error("DIRECT_COST_CONSUMED_SLOT_INSPECT_ONLY");
  const runtime = createDirectCostRuntimeV1(recovery, originalSlot, recoverySlot, slot, verifyHistory); let m;
  if (mode === "Review") {
    stage = "READONLY_DIRECT_COST_REVIEW"; const v = await runtime.snapshot(true), snapshotFileSha256 = await save("read-only-snapshot.json", v);
    m = await compileDirectCostManifestV1(recovery, v, base, code.codeSha256, Date.now());
    const fileSha256 = await save("review-manifest.json", m), budgetRequestFileSha256 = await save("budget-request.json", m.budgetRequest), tableRequestFileSha256 = await save("table-request.json", m.tableRequest);
    console.log(JSON.stringify({ mode, out, fileSha256, snapshotFileSha256, budgetRequestFileSha256, tableRequestFileSha256, manifestSha256: m.manifestSha256, codeSha256: m.codeSha256,
      reviewedAt: new Date(m.reviewedAt).toISOString(), expiresAt: new Date(m.expiresAt).toISOString(), permissionChecks: v.permissionChecks, proposedMaximumDirectWrites: 2,
      cloudWrites: 0, newSlotConsumed: false, cfnAmountDriftAcceptanceRequired: true, approvalRequired: true, executionAuthorized: false, runtimeEnabled: false }));
  } else {
    const file = path.resolve(o["--manifest"]); if (path.basename(file) !== "review-manifest.json" || !await bounded(path.dirname(file)) || (await lstat(file)).isSymbolicLink()) throw Error("DIRECT_COST_PRIVATE_MANIFEST_REQUIRED");
    m = JSON.parse(await readFile(file, "utf8")); await validateDirectCostManifestV1(m, base, code.codeSha256);
    if (occupied && !equal(JSON.parse(await readFile(path.join(slot, "approved-manifest.json"), "utf8")), m)) throw Error("DIRECT_COST_SLOT_MANIFEST_DRIFT");
    if (mode === "Run") {
      stage = "APPROVED_DIRECT_COST_ONCE"; const r = await runDirectCostControlsV1(m, o["--approved-sha"], base, code.codeSha256, { now: Date.now, snapshot: runtime.snapshot,
        claimSlot: () => mkdir(slot), marker: (n, v) => writeFile(path.join(slot, n), JSON.stringify(v, null, 2) + "\n", { flag: "wx" }), updateBudgetOnce: runtime.updateBudgetOnce, waitBudget: runtime.waitBudget, updateTableOnce: runtime.updateTableOnce, waitTable: runtime.waitTable });
      const fileSha256 = await save("submission-receipt.json", r); console.log(JSON.stringify({ mode, out, fileSha256, ...r })); if (r.failureCode) process.exitCode = 1;
    }
    stage = "INDEPENDENT_READONLY_INSPECT"; const r = await runtime.inspect(m), fileSha256 = await save("independent-inspect.json", r); console.log(JSON.stringify({ mode: "Inspect", out, fileSha256, ...r })); if (!r.targetVerified) process.exitCode = 1;
  }
} catch (e) {
  const r = { outcome: "DIRECT_COST_UNVERIFIED", stage, failureCode: /^(DIRECT_COST|COST_RECOVERY|COST_CONTROL|EXISTING_COST)_[A-Z_]+$/.test(e.message ?? "") ? e.message : "DIRECT_COST_OPERATION_UNVERIFIED",
    serviceErrorName: ["CredentialsProviderError", "AccessDenied", "AccessDeniedException", "ExpiredToken", "ExpiredTokenException"].includes(e.name) ? e.name : null,
    rawDiagnosticsWithheld: true, noAutomaticRollbackDeleteFillResetOrWriteRetry: true, runtimeEnabled: false };
  await save("failure-diagnostic.json", r); console.error(JSON.stringify(r)); process.exitCode = 1;
}
