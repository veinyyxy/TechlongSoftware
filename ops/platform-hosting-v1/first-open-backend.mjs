import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";

const backendCommit = "b9ca2138738900afc23a6a2ddce141b37a1f0a31";
const manifestSha256 = "e4b1d2a13741fdbf128e5690bc262128efb567cf947eb059dca3e97452828a01";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const invalid = () => { throw Error("ECS_FIRST_OPEN_BACKEND_INTEGRITY"); };

export async function verifyFirstOpenBackend(directory) {
  if (!isAbsolute(directory) || !(await lstat(directory)).isDirectory()) invalid();
  const manifestFile = join(directory, "manifest.json");
  const manifestStat = await lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.size > 16_384) invalid();
  const manifestBytes = await readFile(manifestFile);
  if (sha256(manifestBytes) !== manifestSha256) invalid();
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schema !== "techlong/first-open-backend/v1" || manifest.source.commit !== backendCommit) invalid();
  const entries = Object.entries(manifest.files);
  const inspected = new Set();
  const expectedDirectories = new Set(entries.map(([path]) => path.slice(0, path.lastIndexOf("/"))).filter(Boolean));
  expectedDirectories.add("services");
  async function inspect(prefix) {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      if (!prefix && entry.name === "node_modules" && entry.isDirectory()) continue;
      if (!prefix && entry.name === "manifest.json" && entry.isFile()) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory() && expectedDirectories.has(path)) {
        await inspect(path);
        continue;
      }
      const expected = Object.hasOwn(manifest.files, path) ? manifest.files[path] : undefined;
      if (!entry.isFile() || !expected) invalid();
      const target = join(directory, path);
      if ((await lstat(target)).size !== expected.bytes || sha256(await readFile(target)) !== expected.sha256) invalid();
      inspected.add(path);
    }
  }
  await inspect("");
  if (inspected.size !== entries.length) invalid();
  return Object.freeze({ commit: backendCommit, manifestSha256, sourceFiles: entries.filter(([, entry]) => entry.gitBlob).length });
}

export async function loadFirstOpenBackend(directory) {
  const provenance = await verifyFirstOpenBackend(directory);
  const packageFile = join(directory, "package.json");
  const load = createRequire(packageFile);
  const dependencies = JSON.parse(await readFile(packageFile, "utf8")).dependencies;
  const modules = join(await realpath(directory), "node_modules");
  for (const [name, version] of Object.entries(dependencies)) {
    const manifest = JSON.parse(await readFile(join(modules, name, "package.json"), "utf8"));
    const fromModule = relative(modules, await realpath(load.resolve(name)));
    if (manifest.name !== name || manifest.version !== version || !fromModule.startsWith(`${name.replaceAll("/", sep)}${sep}`)) invalid();
    load(name);
  }
  load("./db/tenant_lifecycle.js");
  load("./services/saas/aurora_express_bootstrap_provider_v3.js");
  load("./services/saas/aurora_express_restore_v5.js");
  load("./services/saas/aurora_role_directory_v2.js");
  load("./services/saas/tenant_baseline_restore_provider.js");
  load("./services/saas/tenant_baseline_program.js");
  const { loadAtsRoots } = load("./services/saas/aurora_connections_v2.js");
  const { loadSaasPrograms } = load("./services/saas/tenant_saas_transaction_provider.js");
  const { isPgRestore16_14 } = load("./services/saas/tenant_postgres_tools.js");
  const programs = loadSaasPrograms().map(({ name, sha256 }) => ({ name, sha256 }));
  return { ...provenance, atsRootCount: loadAtsRoots().length, programs, isPgRestore16_14 };
}
