import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { decodeReservationReviewV5 } from "../../../lib/deployments/execution/cell-reservation-v5.ts";
import { createReservedRetirementAwsV6 } from "./cell-reserved-retirement-aws-v6.mjs";

// Independent diagnostic only. The frozen 119-file Run is not edited or
// replayed. No request capability is supplied to the AWS factory, so its
// deleteOnce guard cannot authorize a deletion; only readBefore is called.
const root = await realpath("F:/ChatGPT_workshop"), repo = fileURLToPath(new URL("../../../", import.meta.url)), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || root.toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() ||
  (await lstat(root)).isSymbolicLink() || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() ||
  !/^techlong-f3c9j-stop-diagnostic-[a-z0-9-]+$/.test(path.basename(out))) throw Error("RETIREMENT_DIAGNOSTIC_FRESH_OUTPUT_REQUIRED");
await mkdir(out);
const hash = b => createHash("sha256").update(b).digest("hex"), save = async (name, data) => {
  const b = JSON.stringify(data, null, 2) + "\n"; await writeFile(path.join(out, name), b, { flag: "wx", flush: true }); return sha256Hex(b);
};
const exact = async (base, relative) => {
  const f = path.resolve(base, relative);
  if (!f.toLowerCase().startsWith((path.resolve(base) + path.sep).toLowerCase()) || (await realpath(f)).toLowerCase() !== f.toLowerCase() || (await lstat(f)).isSymbolicLink()) throw Error("RETIREMENT_DIAGNOSTIC_LOCAL_PATH_INVALID");
  return readFile(f);
};
let aws, stage = "FROZEN_LOCAL_BINDING";
try {
  const old = JSON.parse((await exact(root, "techlong-f3c9j-retirement-20261013-r2/code-binding.json")).toString("utf8"));
  if (old.codeBindingSha256 !== "8368d4a1d35ec7513d4f236341c657f6dda0ef7f27923219ef09478a04b1fd87" || old.pins.length !== 119 || await sha256Hex(old.pins) !== old.codeBindingSha256) throw Error("RETIREMENT_DIAGNOSTIC_OLD119_INVALID");
  const verify = async () => {
    for (const p of old.pins) if (await sha256Hex((await exact(repo, p.file)).toString("utf8").replace(/\r\n/g, "\n")) !== p.sha256) throw Error("RETIREMENT_DIAGNOSTIC_OLD119_DRIFT");
    for (const [file, sha] of old.preservedFiles) if (hash(await exact(root, file)) !== sha) throw Error("RETIREMENT_DIAGNOSTIC_OLD_HISTORY_DRIFT");
    if (hash(await exact(root, "techlong-f3c9j-expired-reserved-retirement.permanent-slot.json")) !== "7b31496eac7f43265faa0043a50b0c9df1af70b61d7076794b2ef0b1534d7898" ||
      hash(await exact(root, "techlong-f3c9j-retirement-20261013-r2-run/retirement-report.json")) !== "161826b45c01e9bf6a5b3c11da1cdf9a25f7e766e537152d45a309017e56db13" ||
      hash(await exact(repo, "package-lock.json")) !== "d2fe3d8e93e04ed696c6dd7d5a44a0861d9c9e61ced0caecea2875a375ee39a5") throw Error("RETIREMENT_DIAGNOSTIC_STOP_RECORD_DRIFT");
  };
  await verify();
  const ownFile = "ops/aws-sandbox/scripts/inspect-cell-reserved-retirement-stop-v6.mjs", pins = [...old.pins,
    { file: ownFile, sha256: await sha256Hex((await exact(repo, ownFile)).toString("utf8").replace(/\r\n/g, "\n")) }].sort((a, b) => a.file.localeCompare(b.file));
  const codeBindingSha256 = await sha256Hex(pins); await save("code-binding.json", { codeBindingSha256, pins, frozen119CodeSha256: old.codeBindingSha256 });
  const original = await decodeReservationReviewV5(JSON.parse((await exact(root, "techlong-f3c9h-reserved-20261012-r1/reserved-manifest.json")).toString("utf8")));
  stage = "CURRENT_READONLY_PRECONDITIONS";
  aws = createReservedRetirementAwsV6(original, undefined);
  let currentPreconditionsPass = false, currentSafeCode = null, evidenceFileSha256 = null;
  try { const current = await aws.readBefore(); currentPreconditionsPass = true; evidenceFileSha256 = await save("current-evidence.json", current); }
  catch (e) {
    currentSafeCode = /^(RETIREMENT|RESERVATION|CELL_PARENT_UPDATE|LOCKED_UPDATE)_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  }
  await verify();
  const report = { mode: "ReadOnlyDiagnostic", observedAt: new Date().toISOString(), currentPreconditionsPass, currentSafeCode,
    evidenceFileSha256, codeBindingSha256, boundFileCount: pins.length, originalStoppedRunCauseUniquelyProved: false,
    frozen119Unchanged: true, consumedRetirementSlotPreserved: true, cloudWriteCalls: 0, lambdaInvocations: 0,
    secretValueReads: 0, neonConnections: 0, retryAuthorized: false, newSlotCreated: false, runtimeEnabled: false };
  const reportFileSha256 = await save("diagnostic-report.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const safeCode = /^RETIREMENT_[A-Z0-9_]{2,100}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
  await save("failure.json", { stage, safeCode, cloudWriteCalls: 0, retryAuthorized: false, runtimeEnabled: false }); console.log(JSON.stringify({ stage, safeCode, cloudWriteCalls: 0 })); process.exitCode = 1;
} finally { aws?.dispose(); }
