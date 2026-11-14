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
async function codeArtifacts() {
  return Promise.all(importCodeFiles.map(async file => ({ path: file, sha256: rawHash((await readFile(path.join(workspace, file), "utf8")).replaceAll("\r\n", "\n")) })));
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
