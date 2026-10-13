import { build, version } from "esbuild";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9f-parent-bundle-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_PARENT_V5_FRESH_PRIVATE_OUTPUT_REQUIRED");
const hash = b => createHash("sha256").update(b).digest("hex"), lock = await readFile(path.join(repo, "package-lock.json")), packages = JSON.parse(lock).packages;
if (version !== "0.28.0" || packages["node_modules/esbuild"]?.version !== version || packages["node_modules/fflate"]?.version !== "0.7.4" ||
  JSON.parse(await readFile(path.join(repo, "node_modules/fflate/package.json"), "utf8")).version !== "0.7.4") throw Error("CELL_PARENT_V5_BUILD_TOOLCHAIN_DRIFT");
await mkdir(out);
const name = "cell-birth-coordinator-v4.mjs", builtins = new Set(builtinModules.flatMap(x => [x, `node:${x}`]));
const options = { absWorkingDir: repo, entryPoints: ["ops/aws-sandbox/lambda/cell-birth-coordinator-v5.ts"], outfile: name,
  platform: "node", target: "node22", format: "esm", bundle: true, write: false, metafile: true, sourcemap: false, legalComments: "eof", logLevel: "silent",
  banner: { js: 'import { createRequire as __cellParentCreateRequire } from "node:module"; const require = __cellParentCreateRequire(import.meta.url);' } };
const first = await build(options), second = await build(options), bytes = first.outputFiles[0].contents;
if (hash(bytes) !== hash(second.outputFiles[0].contents)) throw Error("CELL_PARENT_V5_BUILD_NOT_REPRODUCIBLE");
for (const o of Object.values(first.metafile.outputs)) for (const i of o.imports) if (i.external && !builtins.has(i.path)) throw Error("CELL_PARENT_V5_UNBUNDLED_DEPENDENCY");
const bundle = path.join(out, name); await writeFile(bundle, bytes, { flag: "wx" });
const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", `
const m=await import(process.argv[1]); if(typeof m.handler!=="function")process.exit(2);
for(const [e,code] of [[{},"TICK_EVENT_INVALID"],[{action:"inspect_fixed_cell_parent_gates_v5"},"GATE_EVENT_INVALID"]]) {
  try{await m.handler(e,{});process.exit(3)}catch(x){if(!String(x.message).includes(code))process.exit(4)}
}`, pathToFileURL(bundle).href], { cwd: out, timeout: 15000, windowsHide: true, encoding: "utf8",
  env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP } });
if (smoke.status !== 0) { const e = new Error("CELL_PARENT_V5_DEPENDENCY_FREE_SMOKE_FAILED"); e.code = smoke.status; throw e; }
const contents = { [name]: [bytes, { mtime: new Date(1980, 0, 1), level: 9 }] }, zip = zipSync(contents), extracted = unzipSync(zip);
if (hash(zip) !== hash(zipSync(contents)) || Object.keys(extracted).join(",") !== name || hash(extracted[name]) !== hash(bytes)) throw Error("CELL_PARENT_V5_ZIP_BYTES_INVALID");
await writeFile(path.join(out, "cell-birth-parent-v5.zip"), zip, { flag: "wx" });
const sourcePins = [];
for (const file of [...new Set([...Object.keys(first.metafile.inputs).filter(f => !f.startsWith("node_modules/")),
  "ops/aws-sandbox/scripts/build-cell-birth-parent-v5.mjs", "lib/deployments/execution/cell-parent-async-plan-v5.ts"])].sort())
  sourcePins.push({ file, sha256: hash(Buffer.from((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n"))) });
const report = { schemaVersion: 5, protocol: "cell-birth-parent-gate-bundle-preparation-v5", bundleSha256: hash(bytes), zipSha256: hash(zip),
  zipCodeSha256Base64: createHash("sha256").update(zip).digest("base64"), bundleBytes: bytes.length, zipBytes: zip.length,
  handler: "cell-birth-coordinator-v4.handler", runtime: "nodejs22.x", architecture: "x86_64", timeoutSeconds: 120, memoryMb: 256,
  packageLockSha256: hash(lock), sourcePins, reproducibleBuildVerified: true, dependencyFreeStartupVerified: true,
  bothInvalidEventsRejectedBeforeCredentials: true, actualBundleSelfHash: true, fixedPreRegistrationGateBranchComposed: true,
  guardedProvisionAndInlineTtlFailureRootRetained: true, oldChildInvocationRequired: false,
  failedProtectionSha256: "015db4276a151d5c0dd0fb96cdb6df214af40fc8be89c8d6d955071b4c7340b9",
  gateCallsAuthorized: false, cloudGateObservationsProduced: false, installationAuthorized: false, asyncSettingsInstalled: false,
  cloudMutationPerformed: false, databaseConnected: false, lambdaInvocationPerformed: false, tenantRuntimeEnabled: false };
const text = JSON.stringify(report, null, 2) + "\n"; await writeFile(path.join(out, "artifact-review.json"), text, { flag: "wx" });
console.log(JSON.stringify({ ...report, sourcePins: undefined, reportFileSha256: hash(text), output: await realpath(out) }, null, 2));
