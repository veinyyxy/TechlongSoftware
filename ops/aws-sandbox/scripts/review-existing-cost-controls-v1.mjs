import { readFile, readdir, mkdir, writeFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { EXISTING_COST_SCOPE_V1 as scope, compileExistingCostManifestV1, validateExistingCostManifestV1, runExistingCostControlsV1 } from "../../../lib/deployments/execution/existing-cost-controls-v1.ts";
import { createExistingCostRuntimeV1 } from "./existing-cost-controls-aws-v1.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url)), privateRoot = await realpath("F:/ChatGPT_workshop");
const args = process.argv.slice(2), o = {}, equal = (a, b) => canonicalJson(a) === canonicalJson(b);
for (let i = 0; i < args.length; i += 2) {
  if (!["--mode", "--out", "--manifest", "--approved-sha"].includes(args[i]) || !args[i + 1] || o[args[i]]) throw Error("EXISTING_COST_OPTIONS_INVALID");
  o[args[i]] = args[i + 1];
}
const mode = o["--mode"], keys = mode === "Review" ? ["--mode", "--out"] : mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] : ["--mode", "--out", "--manifest"];
if (!["Review", "Run", "Inspect"].includes(mode) || !equal(Object.keys(o).sort(), keys.sort())) throw Error("EXISTING_COST_OPTIONS_INVALID");
const bounded = async p => /^techlong-f3c3b-existing-cost-controls-[a-z0-9-]+$/.test(path.basename(p)) && (await realpath(path.dirname(p))).toLowerCase() === privateRoot.toLowerCase();
const out = path.resolve(o["--out"]);
if (!await bounded(out)) throw Error("EXISTING_COST_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out);
const save = async (n, v) => { const b = JSON.stringify(v, null, 2) + "\n"; await writeFile(path.join(out, n), b, { flag: "wx" }); return sha256Hex(b); };
const originalSlot = path.join(privateRoot, scope.originalSlot), slot = path.join(privateRoot, scope.permanentSlot);
const originalFile = path.join(privateRoot, "techlong-f3c3a-cost-controls-20261012-r2/review-manifest.json");
const receiptFile = path.join(privateRoot, "techlong-f3c3a-cost-controls-20261012-r2-run/submission-receipt.json");
const originalFiles = ["lib/deployments/execution/sandbox-cost-controls-v1.ts", "lib/deployments/execution/hash.ts", "ops/aws-sandbox/scripts/sandbox-cost-controls-aws-v1.mjs", "ops/aws-sandbox/scripts/review-sandbox-cost-controls-v1.mjs", "ops/aws-sandbox/cloudformation/guardrails.template.json", "package.json", "package-lock.json"];
const codeFiles = [...originalFiles, "lib/deployments/execution/existing-cost-controls-v1.ts", "ops/aws-sandbox/scripts/existing-cost-controls-aws-v1.mjs", "ops/aws-sandbox/scripts/review-existing-cost-controls-v1.mjs"];
const pin = async files => { const pins = []; for (const file of files) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n")) }); return { pins, codeSha256: await sha256Hex(pins) }; };
let stage = "HISTORICAL_BINDING";
try {
  const code = await pin(codeFiles); await save("code-binding.json", code);
  const base = JSON.parse(await readFile(path.join(root, "ops/aws-sandbox/cloudformation/guardrails.template.json"), "utf8"));
  const original = JSON.parse(await readFile(originalFile, "utf8"));
  const verifyHistory = async () => {
    for (const dir of [originalSlot, path.dirname(originalFile), path.dirname(receiptFile)]) if ((await lstat(dir)).isSymbolicLink()) throw Error("EXISTING_COST_HISTORY_PATH_INVALID");
    for (const [file, hash] of [[originalFile, scope.originalManifestFileSha256], [receiptFile, scope.originalReceiptFileSha256]]) {
      if ((await lstat(file)).isSymbolicLink() || await sha256Hex(await readFile(file, "utf8")) !== hash) throw Error("EXISTING_COST_HISTORY_HASH_DRIFT");
    }
    if ((await pin(originalFiles)).codeSha256 !== scope.originalCodeSha256 || (await pin(codeFiles)).codeSha256 !== code.codeSha256) throw Error("EXISTING_COST_CODE_BINDING_DRIFT");
    if (!equal((await readdir(originalSlot)).sort(), ["approved-manifest.json", "create-attempt.json", "create-confirmed.json"])) throw Error("EXISTING_COST_ORIGINAL_SLOT_DRIFT");
    for (const n of await readdir(originalSlot)) if ((await lstat(path.join(originalSlot, n))).isSymbolicLink()) throw Error("EXISTING_COST_HISTORY_PATH_INVALID");
    if (!equal(JSON.parse(await readFile(path.join(originalSlot, "approved-manifest.json"), "utf8")), original) ||
      !equal(JSON.parse(await readFile(path.join(originalSlot, "create-attempt.json"), "utf8")), { approved: scope.originalManifestSha256 }) ||
      !equal(JSON.parse(await readFile(path.join(originalSlot, "create-confirmed.json"), "utf8")), { changeSetArn: scope.changeSetArn })) throw Error("EXISTING_COST_ORIGINAL_SLOT_DRIFT");
    const r = JSON.parse(await readFile(receiptFile, "utf8"));
    if (r.writeAttempts !== 1 || !r.slotConsumed || r.changeSetArn !== scope.changeSetArn || r.failureCode !== "COST_CONTROL_CHANGESET_SCOPE_UNREVIEWED" ||
      r.failureStage !== "REVIEW_CREATED_CHANGESET" || !equal(r.completed, ["CREATE_CHANGESET"])) throw Error("EXISTING_COST_RECEIPT_DRIFT");
  };
  await verifyHistory();
  let occupied = true; try { await lstat(slot); } catch (e) { if (e.code === "ENOENT") occupied = false; else throw e; }
  if (mode !== "Inspect" && occupied) throw Error("EXISTING_COST_CONSUMED_SLOT_INSPECT_ONLY");
  const runtime = createExistingCostRuntimeV1(original, originalSlot, slot, verifyHistory); let m;
  if (mode === "Review") {
    stage = "READONLY_EXISTING_PLAN_REVIEW";
    const snapshot = await runtime.snapshot(); const inventoryFileSha256 = await save("read-only-snapshot.json", snapshot);
    m = await compileExistingCostManifestV1(snapshot, original, base, code.codeSha256, Date.now());
    const fileSha256 = await save("review-manifest.json", m);
    console.log(JSON.stringify({ mode, out, fileSha256, inventoryFileSha256, manifestSha256: m.manifestSha256, codeSha256: m.codeSha256,
      reviewedAt: new Date(m.reviewedAt).toISOString(), expiresAt: new Date(m.expiresAt).toISOString(), planSha256: m.planSha256,
      beforeContextSha256: m.beforeContextSha256, afterContextSha256: m.afterContextSha256, permissionChecks: snapshot.permissionChecks,
      preservedFailedChangeSets: snapshot.preservedFailedChangeSets.length, originalSlotPreserved: true, proposedMaximumDirectWrites: 2, cloudWrites: 0,
      conditionalRiskApprovalRequired: true, executionAuthorized: false, runtimeEnabled: false }));
  } else {
    const file = path.resolve(o["--manifest"]);
    if (path.basename(file) !== "review-manifest.json" || !await bounded(path.dirname(file)) || (await lstat(file)).isSymbolicLink()) throw Error("EXISTING_COST_PRIVATE_MANIFEST_REQUIRED");
    m = JSON.parse(await readFile(file, "utf8")); await validateExistingCostManifestV1(m, base, code.codeSha256);
    if (occupied && !equal(JSON.parse(await readFile(path.join(slot, "approved-manifest.json"), "utf8")), m)) throw Error("EXISTING_COST_SLOT_MANIFEST_DRIFT");
    if (mode === "Run") {
      stage = "APPROVED_EXISTING_PLAN_ONCE_RUN";
      const r = await runExistingCostControlsV1(m, o["--approved-sha"], base, code.codeSha256, { now: Date.now, snapshot: runtime.snapshot, inventory: runtime.inventory,
        claimSlot: () => mkdir(slot), marker: (n, v) => writeFile(path.join(slot, n), JSON.stringify(v, null, 2) + "\n", { flag: "wx" }),
        executeOnce: runtime.executeOnce, waitBudget: runtime.waitBudget, updateReadOnce: runtime.updateReadOnce });
      const fileSha256 = await save("submission-receipt.json", r); console.log(JSON.stringify({ mode, out, fileSha256, ...r })); if (r.failureCode) process.exitCode = 1;
    }
    stage = "INDEPENDENT_READONLY_INSPECT";
    const r = await runtime.inspect(), fileSha256 = await save("independent-inspect.json", r);
    console.log(JSON.stringify({ mode: "Inspect", out, fileSha256, ...r })); if (!r.costControlsVerified) process.exitCode = 1;
  }
} catch (e) {
  const r = { outcome: "EXISTING_COST_UNVERIFIED", stage, failureCode: /^(EXISTING_COST|COST_CONTROL)_[A-Z_]+$/.test(e.message ?? "") ? e.message : "EXISTING_COST_OPERATION_UNVERIFIED",
    serviceErrorName: ["CredentialsProviderError", "ExpiredToken", "ExpiredTokenException", "AccessDenied", "AccessDeniedException"].includes(e.name) ? e.name : null,
    rawDiagnosticsWithheld: true, noAutomaticRollbackDeleteFillResetOrWriteRetry: true, runtimeEnabled: false };
  await save("failure-diagnostic.json", r); console.error(JSON.stringify(r)); process.exitCode = 1;
}
