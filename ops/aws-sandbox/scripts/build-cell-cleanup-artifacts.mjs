import { build, version as esbuildVersion } from "esbuild";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const dedicatedV2 = args.length === 3 && args[2] === "--dedicated-executor-v2";
const sealedV3 = args.length === 3 && args[2] === "--sealed-executor-v3";
if ((!dedicatedV2 && !sealedV3 && args.length !== 2) || args[0] !== "--out") throw new Error("Use --out with a fresh private directory and an exact optional protocol selector.");
const out = path.resolve(args[1]);
if (path.resolve(path.dirname(out)).toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() ||
  !(dedicatedV2 || sealedV3 ? /^techlong-f3b3-[a-z0-9-]+$/ : /^techlong-f3b2-[a-z0-9-]+$/).test(path.basename(out))) throw new Error("Artifact output outside exact private workspace.");
await mkdir(out); // no overwrite/reuse/reset
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const lockBytes = await readFile(path.join(root, "package-lock.json"));
const lock = JSON.parse(lockBytes);
if (esbuildVersion !== "0.28.0" || lock.packages["node_modules/esbuild"].version !== esbuildVersion ||
  lock.packages["node_modules/fflate"].version !== "0.7.4" ||
  JSON.parse(await readFile(path.join(root, "node_modules/fflate/package.json"), "utf8")).version !== "0.7.4") throw new Error("Builder version differs from reviewed lock.");
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const artifacts = [];
const projectInputs = new Set();
const entries = sealedV3 ? [["ttl-executor-v3", "cell-ttl-executor-v3.ts"]] : dedicatedV2 ? [["ttl-executor-v2", "cell-ttl-executor-v2.ts"]] : [["drain-coordinator", "cell-drain-coordinator.ts"], ["ttl-executor", "cell-ttl-executor.ts"]];
for (const [kind, entry] of entries) {
  const options = { absWorkingDir: root, entryPoints: [`ops/aws-sandbox/lambda/${entry}`], outfile: "index.js", platform: "node",
    target: "node22", format: "cjs", bundle: true, write: false, metafile: true, sourcemap: false, legalComments: "eof", logLevel: "silent" };
  const first = await build(options); const second = await build(options);
  for(const file of Object.keys(first.metafile.inputs))if(!file.startsWith("node_modules/"))projectInputs.add(file);
  const bytes = first.outputFiles[0].contents;
  if (sha(bytes) !== sha(second.outputFiles[0].contents)) throw new Error("Bundle not reproducible.");
  for (const output of Object.values(first.metafile.outputs)) for (const item of output.imports)
    if (item.external && !builtins.has(item.path)) throw new Error("Unbundled non-builtin dependency.");
  if (kind === "drain-coordinator" && Object.keys(first.metafile.inputs).some(name => name.includes("client-cloudformation") || name.endsWith("prepared-cell-ttl-janitor.ts")))
    throw new Error("Drain package links a cloud deletion runtime.");
  const child = path.join(out, kind); await mkdir(child);
  const bundleFile = path.join(child, "index.js"); await writeFile(bundleFile, bytes, { flag: "wx" });
  const smoke = spawnSync(process.execPath, ["--input-type=commonjs", "-e",
    "const m=require(process.argv[1]); if(typeof m.handler!=='function') process.exit(2); m.handler({},{}).then(()=>process.exit(3),e=>{if(!String(e.message).includes('EVENT_INVALID'))process.exit(4)});", bundleFile],
    { cwd: child, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP } });
  if (smoke.status !== 0) throw new Error("Dependency-free bundle startup/event rejection failed; diagnostics withheld.");
  const contents = { "index.js": [bytes, { mtime: new Date(1980, 0, 1), level: 9 }] };
  const archive = zipSync(contents); const again = zipSync(contents);
  if (sha(archive) !== sha(again)) throw new Error("ZIP not reproducible.");
  const decoded = unzipSync(archive);
  if (Object.keys(decoded).join(",") !== "index.js" || sha(decoded["index.js"]) !== sha(bytes)) throw new Error("ZIP inventory/readback mismatch.");
  const zipFile = path.join(out, `${kind}.zip`); await writeFile(zipFile, archive, { flag: "wx" });
  artifacts.push({ kind, handler: "index.handler", runtime: "nodejs22.x", architecture: "x86_64", bundleBytes: bytes.length,
    bundleSha256: sha(bytes), zipBytes: archive.length, zipSha256: sha(archive), reproducibleBuildVerified: true,
    dependencyFreeStartupVerified: true, invalidEventRejectedWithoutCredentials: true });
}
const sourcePaths = sealedV3 ? [...projectInputs].sort() : dedicatedV2 ? ["ops/aws-sandbox/lambda/cell-ttl-executor-v2.ts", "lib/deployments/execution/shared-cell-cleanup-deletion.ts",
  "lib/deployments/execution/prepared-cell-ttl-janitor.ts", "lib/deployments/execution/aws-sdk-prepared-cell-ttl-janitor.ts", "lib/deployments/execution/cell-cleanup-lambda-context.ts"] : [...new Set(artifacts.flatMap(artifact => artifact.kind === "drain-coordinator" ?
  ["ops/aws-sandbox/lambda/cell-drain-coordinator.ts", "lib/deployments/execution/prepared-cell-drain-coordinator.ts", "lib/deployments/execution/neon-cell-ttl-cleanup-jobs.ts"] :
  ["ops/aws-sandbox/lambda/cell-ttl-executor.ts", "lib/deployments/execution/prepared-cell-ttl-janitor.ts"]))];
const sourcePins = [];
for (const file of sourcePaths) sourcePins.push({ path: file, textSha256: sha(Buffer.from((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n"))) });
const report = { schemaVersion: sealedV3 ? 3 : dedicatedV2 ? 2 : 1, outcome: "CELL_CLEANUP_ARTIFACTS_BUILT_NOT_INSTALLED", esbuildVersion, zipBuilderVersion: "0.7.4",
  ...(dedicatedV2 || sealedV3 ? { executorIdentityProtocol: sealedV3 ? "dedicated-cell-ttl-v3" : "dedicated-cell-ttl-v2", executorRoleArn: "arn:aws:iam::402010193138:role/TechlongSandboxCellTtlExecutorRole" } : {}),
  packageLockSha256: sha(lockBytes), sourcePins, artifacts, cloudMutationPerformed: false, databaseMutationPerformed: false,
  installationAuthorized: false, authorityCasCapabilityExposed: false, workerEnabled: false };
const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
await writeFile(path.join(out, "artifact-review.json"), reportBytes, { flag: "wx" });
console.log(JSON.stringify({ outcome: report.outcome, output: await realpath(out), reportSha256: sha(reportBytes), artifacts, installationAuthorized: false }, null, 2));
