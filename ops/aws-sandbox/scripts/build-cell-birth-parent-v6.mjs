import { build, version } from "esbuild";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { cellParentIamDocumentsV6 } from "../../../lib/deployments/execution/cell-parent-iam-compatibility-v6.ts";
import { canonicalJson } from "../../../lib/deployments/execution/hash.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9i-kms-parent-bundle-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_PARENT_V6_FRESH_PRIVATE_OUTPUT_REQUIRED");
const hash = b => createHash("sha256").update(b).digest("hex"), lock = await readFile(path.join(repo, "package-lock.json")), packages = JSON.parse(lock).packages;
if (hash(lock) !== "d2fe3d8e93e04ed696c6dd7d5a44a0861d9c9e61ced0caecea2875a375ee39a5" || version !== "0.28.0" || packages["node_modules/esbuild"]?.version !== version ||
  packages["node_modules/fflate"]?.version !== "0.7.4" || JSON.parse(await readFile(path.join(repo, "node_modules/fflate/package.json"), "utf8")).version !== "0.7.4") throw Error("CELL_PARENT_V6_BUILD_TOOLCHAIN_DRIFT");
await mkdir(out);
const name = "cell-birth-coordinator-v4.mjs", builtins = new Set(builtinModules.flatMap(x => [x, `node:${x}`]));
const options = { absWorkingDir: repo, entryPoints: ["ops/aws-sandbox/lambda/cell-birth-coordinator-v6.ts"], outfile: name,
  platform: "node", target: "node22", format: "esm", bundle: true, write: false, metafile: true, sourcemap: false, legalComments: "eof", logLevel: "silent",
  banner: { js: 'import { createRequire as __cellParentCreateRequire } from "node:module"; const require = __cellParentCreateRequire(import.meta.url);' } };
const first = await build(options), second = await build(options), bytes = first.outputFiles[0].contents;
if (hash(bytes) !== hash(second.outputFiles[0].contents)) throw Error("CELL_PARENT_V6_BUILD_NOT_REPRODUCIBLE");
for (const o of Object.values(first.metafile.outputs)) for (const i of o.imports) if (i.external && !builtins.has(i.path)) throw Error("CELL_PARENT_V6_UNBUNDLED_DEPENDENCY");
const bundle = path.join(out, name); await writeFile(bundle, bytes, { flag: "wx", flush: true });
const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", `const m=await import(process.argv[1]);if(typeof m.handler!=="function")process.exit(2);
for(const [e,c] of [[{},"TICK_EVENT_INVALID"],[{action:"inspect_fixed_cell_parent_gates_v5"},"GATE_EVENT_INVALID"]]){
try{await m.handler(e,{});process.exit(3)}catch(x){if(!String(x.message).includes(c))process.exit(4)}}`, pathToFileURL(bundle).href],
  { cwd: out, timeout: 15000, windowsHide: true, encoding: "utf8", env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP } });
if (smoke.status !== 0) throw Error("CELL_PARENT_V6_DEPENDENCY_FREE_SMOKE_FAILED");
const contents = { [name]: [bytes, { mtime: new Date(1980, 0, 1), level: 9 }] }, zip = zipSync(contents), extracted = unzipSync(zip);
if (hash(zip) !== hash(zipSync(contents)) || Object.keys(extracted).join(",") !== name || hash(extracted[name]) !== hash(bytes)) throw Error("CELL_PARENT_V6_ZIP_BYTES_INVALID");
await writeFile(path.join(out, "cell-birth-parent-v6.zip"), zip, { flag: "wx", flush: true });
const sourcePins = [];
for (const file of [...new Set([...Object.keys(first.metafile.inputs).filter(f => !f.startsWith("node_modules/")), "ops/aws-sandbox/scripts/build-cell-birth-parent-v6.mjs"])].sort())
  sourcePins.push({ file, sha256: hash(Buffer.from((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n"))) });
const realStackId = "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/01a06ca0-c6bf-11f1-898a-0e285576029b",
  permission = canonicalJson(cellParentIamDocumentsV6(realStackId).boundary);
const report = { schemaVersion: 6, protocol: "cell-birth-parent-kms-compatible-bundle-preparation-v6", bundleSha256: hash(bytes), zipSha256: hash(zip),
  zipCodeSha256Base64: createHash("sha256").update(zip).digest("base64"), bundleBytes: bytes.length, zipBytes: zip.length,
  handler: "cell-birth-coordinator-v4.handler", runtime: "nodejs22.x", architecture: "x86_64", timeoutSeconds: 120, memoryMb: 256,
  packageLockSha256: hash(lock), sourcePins, reproducibleBuildVerified: true, dependencyFreeStartupVerified: true,
  bothInvalidEventsRejectedBeforeCredentials: true, actualBundleSelfHash: true, originalV5GateAndRootExecutableBodyRetained: true,
  permissionDocumentSha256ForHistoricalStack: hash(Buffer.from(permission)), permissionBytesForHistoricalStack: Buffer.byteLength(permission),
  historicalStackId: realStackId, historicalPlanExpiryNotExtended: true, normalizedLegacyPermissionMetadataHashIsNotActualV6PolicyDigest: true,
  installationAuthorized: false, iamInstalled: false, actualForwardedKmsAllowPathVerified: false,
  cloudMutationPerformed: false, databaseConnected: false, lambdaInvocationPerformed: false, tenantRuntimeEnabled: false };
const text = JSON.stringify(report, null, 2) + "\n"; await writeFile(path.join(out, "artifact-review.json"), text, { flag: "wx", flush: true });
console.log(JSON.stringify({ ...report, sourcePins: undefined, reportFileSha256: hash(text), output: await realpath(out) }, null, 2));
