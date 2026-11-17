import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sha256Hex, canonicalJson } from "../lib/deployments/execution/hash.ts";
import { catalogSourceReaders, sourceGitHubCredential, collectCatalogSource,
  type CatalogSourceScope, type CatalogSourceEvidence } from "../ops/releases/import-source.ts";
import { importCodeFiles, prepareCatalogRegistration, type CatalogRegistrationReview } from "../ops/releases/import-review.ts";
import { writeCatalogRelease, inspectCatalogRelease } from "../ops/releases/catalog-transaction.ts";
import type { ReleaseBuildPolicy } from "../lib/deployments/releases/production.ts";
import type { ReleaseSqlClient } from "../lib/deployments/releases/repository.ts";
import { bootstrapCodeFiles, validateBootstrapReview, prepareBootstrapRegistration, registerBootstrapCatalog, type BootstrapCatalogInput } from "../ops/releases/bootstrap.ts";
import { installationConnectionOptions } from "../ops/releases/installation-connection.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const privateRoot = path.join(workspace, ".local-secrets");
const rawHash = (s: string) => createHash("sha256").update(s).digest("hex");
const must = (ok: unknown, code: string) => { if (!ok) throw new Error(code); };
function privatePath(file: string) {
  const absolute = path.resolve(file), relative = path.relative(privateRoot, absolute);
  must(relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative), "RELEASE_IMPORT_PRIVATE_PATH_REQUIRED");
  return absolute;
}
async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T; }
async function codeArtifacts(files = importCodeFiles) {
  return Promise.all(files.map(async file => ({ path: file, sha256: rawHash((await readFile(path.join(workspace, file), "utf8")).replaceAll("\r\n", "\n")) })));
}

async function bootstrapInput(file: string) {
  const sourcePath = privatePath(file), raw = await readFile(sourcePath, "utf8"), input = JSON.parse(raw) as BootstrapCatalogInput;
  await validateBootstrapReview(input.review, input.reviewSha256, await codeArtifacts(bootstrapCodeFiles), Date.now());
  return prepareBootstrapRegistration(input, { path: sourcePath, rawSha256: rawHash(raw) }, Date.now());
}
async function registerBootstrap(file: string, sha: string) {
  const review = await approved<Awaited<ReturnType<typeof prepareBootstrapRegistration>>>(file, sha);
  must(review.schema === "techlong/bootstrap-catalog-review/v1" && review.status === "AWAITING_APPROVAL" &&
    /^release_[a-f0-9]{32}$/.test(review.id) && Date.now() < review.writeBefore, "RELEASE_BOOTSTRAP_CATALOG_REVIEW_REJECTED");
  const rebuilt = await bootstrapInput(review.sourceInput.path);
  must(canonicalJson(rebuilt) === canonicalJson(review), "RELEASE_BOOTSTRAP_CATALOG_DERIVATION_CHANGED");
  const root = privatePath(path.join(path.dirname(path.resolve(file)), "bootstrap-registration-" + review.id));
  await mkdir(root, { mode: 0o700 });
  const startedAt = Date.now(), deadline = Math.min(review.writeBefore, startedAt + review.limits.maxExecutionMs);
  const counts = { configReads: 0, connections: 0, sqlSubmissions: 0 }, clients: ImportPgClient[] = [];
  const save = (name: string, value: unknown) => writeFile(path.join(root, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const closed = new WeakSet<ImportPgClient>();
  const close = async (c: ImportPgClient) => { if (!closed.has(c)) { closed.add(c); await c.end().catch(() => {}); } };
  await save("attempt.json", { startedAt, approvedSha256: sha, requestId: review.id, retryAllowed: false });
  let outcome: unknown = null, code: string | null = null;
  try {
    must(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && !process.env.PGOPTIONS, "RELEASE_IMPORT_TLS_OR_OPTIONS_REJECTED");
    counts.configReads++;
    let values: ReturnType<typeof parseEnv> | undefined = parseEnv(await readFile(path.join(workspace, review.target.configPath), "utf8"));
    const connectionString = values[review.target.configKey]; values = undefined;
    must(connectionString, "RELEASE_IMPORT_DATABASE_CONFIG_MISSING");
    const url = new URL(connectionString!);
    must(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname.endsWith(".neon.tech") &&
      decodeURIComponent(url.username) === review.target.installer && decodeURIComponent(url.pathname.slice(1)) === review.target.database && url.password, "RELEASE_IMPORT_DATABASE_TARGET_REJECTED");
    const driver = createRequire(import.meta.url)("pg") as { Client: new (c: unknown) => ImportPgClient };
    const connect = async (label: string) => {
      must(Date.now() < deadline && ++counts.connections <= review.limits.connections, "RELEASE_IMPORT_CONNECTION_BUDGET");
      const client = new driver.Client(installationConnectionOptions(url.toString(), "techlong-bootstrap-" + label));
      clients.push(client); await client.connect();
      must(client.connection.stream.encrypted && client.connection.stream.authorized, "RELEASE_IMPORT_TLS_NOT_VERIFIED");
      return { sql: { query: async (statement: string, parameters: unknown[] = []) => {
        must(Date.now() < deadline && ++counts.sqlSubmissions <= review.limits.sqlSubmissions, "RELEASE_IMPORT_SQL_BUDGET");
        return client.query(statement, parameters);
      } }, close: () => close(client) };
    };
    const result = await registerBootstrapCatalog(review.a, review.b, review.target, connect, Date.now, save);
    outcome = result; code = result.code;
  } catch (e) { code = e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "RELEASE_BOOTSTRAP_CATALOG_UNKNOWN"; }
  finally {
    await Promise.all(clients.map(close));
    await save("result.json", { startedAt, completedAt: Date.now(), approvedSha256: sha, counts, outcome, code, automaticRetry: false, runtimeEnabled: false });
  }
  console.log(JSON.stringify({ status: code ? "STOPPED_REQUIRES_INSPECTION" : "A_AND_B_CATALOG_INDEPENDENTLY_VERIFIED", code, counts, result: path.join(root, "result.json") }));
  if (code) process.exitCode = 1;
}
async function approved<T>(file: string, sha: string) {
  const value = await json<T>(privatePath(file)); must(/^[a-f0-9]{64}$/.test(sha) && await sha256Hex(value) === sha, "RELEASE_IMPORT_EXPLICIT_SHA_REQUIRED"); return value;
}
interface ImportPgClient extends ReleaseSqlClient {
  connect(): Promise<void>; end(): Promise<void>;
  connection: { stream: { encrypted?: boolean; authorized?: boolean } };
}

async function register(file: string, sha: string) {
  const review = await approved<CatalogRegistrationReview>(file, sha);
  must(review.schema === "techlong/catalog-registration-review/v1" && review.status === "AWAITING_APPROVAL" &&
    /^[a-f0-9-]{36}$/.test(review.id) && Date.now() < review.validUntil &&
    canonicalJson(await codeArtifacts()) === canonicalJson(review.codeArtifacts), "RELEASE_IMPORT_REVIEW_OR_CODE_REJECTED");
  must(path.basename(review.sourceEvidence.path) === "source-evidence.json", "RELEASE_IMPORT_SOURCE_PATH_REJECTED");
  const rawSource = await readFile(privatePath(review.sourceEvidence.path), "utf8");
  must(rawHash(rawSource) === review.sourceEvidence.rawSha256, "RELEASE_IMPORT_SOURCE_BYTES_CHANGED");
  const source = JSON.parse(rawSource) as CatalogSourceEvidence;
  const rebuilt = await prepareCatalogRegistration(source, review.policy, review.sourceEvidence.path, review.sourceEvidence.rawSha256, review.codeArtifacts, Date.now());
  must(rebuilt.releaseSha256 === review.releaseSha256 && canonicalJson(rebuilt.release) === canonicalJson(review.release) &&
    canonicalJson(rebuilt.target) === canonicalJson(review.target) && canonicalJson(rebuilt.limits) === canonicalJson(review.limits), "RELEASE_IMPORT_DERIVATION_CHANGED");
  const root = privatePath(path.join(path.dirname(path.resolve(file)), "registration-" + review.id));
  await mkdir(root, { mode: 0o700 });
  const startedAt = Date.now(), deadline = Math.min(review.validUntil, startedAt + review.limits.maxExecutionMs);
  const counts = { configReads: 0, connections: 0, sqlSubmissions: 0 }, clients: ImportPgClient[] = [];
  const closed = new WeakSet<ImportPgClient>();
  const close = async (client: ImportPgClient) => { if (!closed.has(client)) { closed.add(client); await client.end().catch(() => {}); } };
  let write: unknown = null, inspection: unknown = null, code: string | null = null;
  const save = (name: string, value: unknown) => writeFile(path.join(root, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await save("attempt.json", { startedAt, approvedSha256: sha, releaseSha256: review.releaseSha256, retryAllowed: false });
  try {
    must(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && !process.env.PGOPTIONS, "RELEASE_IMPORT_TLS_OR_OPTIONS_REJECTED");
    counts.configReads++;
    let values: ReturnType<typeof parseEnv> | undefined = parseEnv(await readFile(path.join(workspace, review.target.configPath), "utf8"));
    const connectionString = values[review.target.configKey]; values = undefined;
    must(connectionString, "RELEASE_IMPORT_DATABASE_CONFIG_MISSING");
    const url = new URL(connectionString!);
    must(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname.endsWith(".neon.tech") &&
      decodeURIComponent(url.username) === review.target.installer && decodeURIComponent(url.pathname.slice(1)) === review.target.database && url.password, "RELEASE_IMPORT_DATABASE_TARGET_REJECTED");
    for (const k of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl", "channel_binding", "options"]) url.searchParams.delete(k);
    const driver = createRequire(import.meta.url)("pg") as { Client: new (c: unknown) => ImportPgClient };
    const connect = async (label: string) => {
      must(Date.now() < deadline && ++counts.connections <= 2, "RELEASE_IMPORT_CONNECTION_BUDGET");
      const client = new driver.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: true },
        application_name: "techlong-release-catalog-" + label, connectionTimeoutMillis: 10000, query_timeout: 20000 });
      clients.push(client); await client.connect();
      must(client.connection.stream.encrypted && client.connection.stream.authorized, "RELEASE_IMPORT_TLS_NOT_VERIFIED");
      const sql: ReleaseSqlClient = { query: async (statement, parameters) => {
        must(Date.now() < deadline && ++counts.sqlSubmissions <= 64, "RELEASE_IMPORT_SQL_BUDGET"); return client.query(statement, parameters);
      } };
      return { client, sql };
    };
    const writer = await connect("writer");
    try { write = await writeCatalogRelease(writer.sql, review.release, review.target); await save("write.json", write); }
    catch (e) { code = e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "RELEASE_IMPORT_WRITE_REQUIRES_INSPECTION"; }
    finally { await close(writer.client); }
    // Even an unknown ACK may use this one separately approved inspection; never a second INSERT.
    const reader = await connect("inspection");
    inspection = await inspectCatalogRelease(reader.sql, review.release, review.target); await save("inspection.json", inspection);
  } catch (e) { code ??= e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "RELEASE_IMPORT_STOPPED_REQUIRES_INSPECTION"; }
  finally {
    await Promise.all(clients.map(close));
    const result = { status: write && inspection && !code ? "CATALOG_REGISTERED_AND_INDEPENDENTLY_VERIFIED" : "STOPPED_REQUIRES_INSPECTION",
      startedAt, completedAt: Date.now(), approvedSha256: sha, releaseSha256: review.releaseSha256, counts, write, inspection, code,
      runtimeEnabled: false, awsWrites: 0, automaticRetry: false };
    await save("result.json", result); console.log(JSON.stringify({ status: result.status, code, counts, result: path.join(root, "result.json") }));
    if (result.status !== "CATALOG_REGISTERED_AND_INDEPENDENTLY_VERIFIED") process.exitCode = 1;
  }
}

async function main() {
  const [mode = "check", file, shaOrPolicy, output] = process.argv.slice(2);
  if (mode === "check") { console.log(JSON.stringify({ status: "CATALOG_IMPORT_DISABLED", credentialsUsed: false, productionCalls: 0 })); return; }
  if (mode === "prepare-bootstrap") {
    must(file && shaOrPolicy && !output, "RELEASE_IMPORT_ARGUMENTS_REQUIRED");
    const review = await bootstrapInput(file);
    await writeFile(privatePath(shaOrPolicy), JSON.stringify(review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "AWAITING_BOOTSTRAP_REGISTRATION_APPROVAL", manifestSha256: await sha256Hex(review), productionCalls: 0 })); return;
  }
  if (mode === "register-bootstrap") { must(file && shaOrPolicy && !output, "RELEASE_IMPORT_ARGUMENTS_REQUIRED"); await registerBootstrap(file, shaOrPolicy); return; }
  if (mode === "collect") {
    must(file && shaOrPolicy && output, "RELEASE_IMPORT_ARGUMENTS_REQUIRED");
    const scope = await approved<CatalogSourceScope>(file, shaOrPolicy), root = privatePath(output);
    const result = await collectCatalogSource(scope, root, catalogSourceReaders(scope, sourceGitHubCredential));
    console.log(JSON.stringify({ status: result.status, source: path.join(root, "source-evidence.json"), counts: result.counts, catalogWritten: false })); return;
  }
  if (mode === "prepare") {
    must(file && shaOrPolicy && output, "RELEASE_IMPORT_ARGUMENTS_REQUIRED");
    const sourceFile = privatePath(file), raw = await readFile(sourceFile, "utf8"), policy = await json<ReleaseBuildPolicy>(privatePath(shaOrPolicy));
    const review = await prepareCatalogRegistration(JSON.parse(raw) as CatalogSourceEvidence, policy, sourceFile, rawHash(raw), await codeArtifacts(), Date.now());
    await writeFile(privatePath(output), JSON.stringify(review, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "AWAITING_REGISTRATION_APPROVAL", manifestSha256: await sha256Hex(review), releaseId: review.release.id, productionCalls: 0 })); return;
  }
  if (mode === "register") { must(file && shaOrPolicy && !output, "RELEASE_IMPORT_ARGUMENTS_REQUIRED"); await register(file, shaOrPolicy); return; }
  throw new Error("RELEASE_IMPORT_MODE_REJECTED");
}
main().catch(error => {
  console.error(JSON.stringify({ status: "CATALOG_IMPORT_STOPPED", code: error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "RELEASE_IMPORT_UNRESOLVED", automaticRetry: false })); process.exitCode = 1;
});
