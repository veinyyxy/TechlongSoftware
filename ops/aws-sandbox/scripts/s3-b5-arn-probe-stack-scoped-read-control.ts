import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { sanitizeArnProbeFailure } from "../../../lib/deployments/execution/arn-compatibility-probe-diagnostics.ts";
import { readArnProbeReadComparisonJson } from "../../../lib/deployments/execution/arn-compatibility-probe-read-comparison-evidence.ts";
import { loadStackScopedReadControlEvidence, type StackScopedReadControlFiles } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control-evidence.ts";
import { checkStackScopedReadControlPreparation } from "../../../lib/deployments/execution/arn-probe-stack-scoped-read-control.ts";

const values = new Map<string, string>(), flags = new Set<string>(), args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i]; if (values.has(key) || flags.has(key)) throw new Error("Duplicate J22 local preparation option.");
  if (key === "--acknowledge-local-read-only") flags.add(key);
  else {
    if (!["--mode", "--evidence", "--output"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("J22 exposes only local CheckPreparation, not writes or candidate windows.");
    values.set(key, args[++i]);
  }
}
const mode = values.get("--mode"), evidence = values.get("--evidence"), output = values.get("--output");
if (mode !== "CheckPreparation" || !evidence || !output || !path.isAbsolute(evidence) || !path.isAbsolute(output) || flags.size !== 1 || !flags.has("--acknowledge-local-read-only")) throw new Error("Explicit local CheckPreparation and absolute paths required.");
const repository = await realpath(fileURLToPath(new URL("../../../", import.meta.url))), parent = await realpath(path.dirname(output));
const target = path.join(parent, path.basename(output));
if (path.basename(target).startsWith(".") || target.split(path.sep).some(v => [".git", ".aws", ".codex", ".agents", ".aws-sandbox"].includes(v))) throw new Error("J22 output cannot be a protected record.");
const destination = await open(target, "wx");
try {
  const files = await readArnProbeReadComparisonJson(evidence) as StackScopedReadControlFiles;
  const loaded = await loadStackScopedReadControlEvidence(repository, files);
  const report = await checkStackScopedReadControlPreparation(loaded.predecessor);
  await destination.writeFile(`${JSON.stringify(report, null, 2)}\n`); await destination.sync();
  console.log(JSON.stringify({ mode, output, outcome: report.outcome, receiptSha256: report.receiptSha256, candidateCompiled: false, approvalWindowOpened: false,
    registryCreated: false, executionImplemented: false, mutationPerformed: false, runtimeEnabled: false }, null, 2));
} catch (error) {
  const body = { stage: "B5-J5g-j22", mode, outcome: "LOCAL_PREPARATION_BLOCKED", failure: sanitizeArnProbeFailure(error, "ENTRY"),
    mutationPerformed: false, candidateCompiled: false, approvalWindowOpened: false, registryCreated: false, retryAuthorized: false, runtimeEnabled: false };
  await destination.writeFile(`${JSON.stringify({ ...body, receiptSha256: await sha256Hex(canonicalJson(body)) }, null, 2)}\n`); await destination.sync();
  console.error("J22 local preparation blocked. No cloud capability, new window or successor reservation was created."); process.exitCode = 1;
} finally { await destination.close(); }
