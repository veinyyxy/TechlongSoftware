import { build, version } from "esbuild";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9-parent-bundle-[a-z0-9-]+$/.test(path.basename(out))) throw Error("CELL_PARENT_BUILD_FRESH_PRIVATE_OUTPUT_REQUIRED");
const hash = b => createHash("sha256").update(b).digest("hex"), lock = await readFile(path.join(repo, "package-lock.json")), packages = JSON.parse(lock).packages;
if (version !== "0.28.0" || packages["node_modules/esbuild"]?.version !== version || packages["node_modules/fflate"]?.version !== "0.7.4" || JSON.parse(await readFile(path.join(repo, "node_modules/fflate/package.json"), "utf8")).version !== "0.7.4") throw Error("CELL_PARENT_BUILD_TOOLCHAIN_DRIFT");
await mkdir(out); const name = "cell-birth-coordinator-v4.mjs", builtins = new Set(builtinModules.flatMap(x => [x, `node:${x}`]));
const options = { absWorkingDir: repo, entryPoints: ["ops/aws-sandbox/lambda/cell-birth-coordinator-v4.ts"], outfile: name,
  platform: "node", target: "node22", format: "esm", bundle: true, write: false, metafile: true, sourcemap: false, legalComments: "eof", logLevel: "silent",
  banner: { js: 'import { createRequire as __cellParentCreateRequire } from "node:module"; const require = __cellParentCreateRequire(import.meta.url);' } };
const first = await build(options), second = await build(options), bytes = first.outputFiles[0].contents;
if (hash(bytes) !== hash(second.outputFiles[0].contents)) throw Error("CELL_PARENT_BUILD_NOT_REPRODUCIBLE");
for (const o of Object.values(first.metafile.outputs)) for (const i of o.imports) if (i.external && !builtins.has(i.path)) throw Error("CELL_PARENT_BUILD_UNBUNDLED_DEPENDENCY");
const bundle = path.join(out, name); await writeFile(bundle, bytes, { flag: "wx" });
const smoke = spawnSync(process.execPath, ["--input-type=module", "-e",
  'const m=await import(process.argv[1]); if(typeof m.handler!=="function")process.exit(2); try{await m.handler({},{});process.exit(3)}catch(e){if(!String(e.message).includes("TICK_EVENT_INVALID"))process.exit(4)}',
  new URL(`file:///${bundle.replaceAll("\\", "/")}`).href], { cwd: out, timeout: 15000, windowsHide: true, encoding: "utf8",
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP } });
if (smoke.status !== 0) { const e = new Error("CELL_PARENT_BUILD_DEPENDENCY_FREE_SMOKE_FAILED"); e.code = smoke.status; throw e; }
const contents = { [name]: [bytes, { mtime: new Date(1980, 0, 1), level: 9 }] }, zip = zipSync(contents), extracted = unzipSync(zip);
if (hash(zip) !== hash(zipSync(contents)) || Object.keys(extracted).join(",") !== name || hash(extracted[name]) !== hash(bytes)) throw Error("CELL_PARENT_BUILD_ZIP_BYTES_INVALID");
await writeFile(path.join(out, "cell-birth-parent-v4.zip"), zip, { flag: "wx" });
const sourcePins = []; for (const file of [...new Set([...Object.keys(first.metafile.inputs).filter(f => !f.startsWith("node_modules/")), "ops/aws-sandbox/scripts/build-cell-birth-parent-v4.mjs"])].sort())
  sourcePins.push({ file, sha256: hash(Buffer.from((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n"))) });
const report = { schemaVersion: 4, protocol: "cell-birth-parent-bundle-preparation-v4", bundleSha256: hash(bytes), zipSha256: hash(zip), zipCodeSha256Base64: createHash("sha256").update(zip).digest("base64"),
  bundleBytes: bytes.length, zipBytes: zip.length, handler: "cell-birth-coordinator-v4.handler", runtime: "nodejs22.x", architecture: "x86_64", timeoutSeconds: 120, memoryMb: 256,
  packageLockSha256: hash(lock), sourcePins, reproducibleBuildVerified: true, dependencyFreeStartupVerified: true, invalidEventRejectedBeforeCredentials: true,
  bundleSelfHashFromActualImportMetaBytes: true, guardedProvisionRuntimeComposed: true, fullCleanupRootCompleted: false, installationAuthorized: false,
  cloudMutationPerformed: false, databaseConnected: false, lambdaInvocationPerformed: false, tenantRuntimeEnabled: false };
const text = JSON.stringify(report, null, 2) + "\n"; await writeFile(path.join(out, "artifact-review.json"), text, { flag: "wx" });
console.log(JSON.stringify({ ...report, sourcePins: undefined, reportFileSha256: hash(text), output: await realpath(out) }, null, 2));
