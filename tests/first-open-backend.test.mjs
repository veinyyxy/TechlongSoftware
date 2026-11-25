import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyFirstOpenBackend } from "../ops/platform-hosting-v1/first-open-backend.mjs";

const source = fileURLToPath(new URL("../ops/platform-hosting-v1/first-open-backend/", import.meta.url));
const legacy = new URL("./fixtures/first-open-baseline-python/", import.meta.url);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("platform first open uses the exact pinned lifecycle and fixed SQL source closure", async () => {
  assert.deepEqual(await verifyFirstOpenBackend(source), {
    commit: "b9ca2138738900afc23a6a2ddce141b37a1f0a31",
    manifestSha256: sha256(await readFile(join(source, "manifest.json"))),
    sourceFiles: 24,
  });
});

test("the JavaScript baseline package retains provenance for the original bytes and the adapted files", async () => {
  const originalBytes = await readFile(new URL("manifest.json", legacy));
  const original = JSON.parse(originalBytes);
  const current = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  assert.equal(sha256(originalBytes), "e4b1d2a13741fdbf128e5690bc262128efb567cf947eb059dca3e97452828a01");
  assert.deepEqual(current.source, { ...original.source, previousManifestSha256: sha256(originalBytes) });
  for (const [name, entry] of Object.entries(current.files)) {
    assert.ok(!name.endsWith(".py"));
    if (entry.derivedFrom) {
      assert.equal(entry.gitBlob, undefined);
      for (const previous of entry.derivedFrom) assert.ok(original.files[previous]?.gitBlob);
    } else {
      assert.deepEqual(entry, original.files[name]);
    }
  }
  for (const name of ["render_tenant_baseline_verification.py", "tenant_baseline_schema_profile.py"]) {
    const bytes = await readFile(new URL(name, legacy));
    const entry = original.files[`scripts/${name}`];
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.deepEqual({ bytes: bytes.length, sha256: sha256(bytes), gitBlob: blob }, entry);
  }
});

test("the independent verifier parses its pinned inputs without an interpreter path", () => {
  const require = createRequire(import.meta.url);
  const { parseArguments } = require(join(source, "scripts/verify-empty-tenant-baseline-pg16.js"));
  const args = parseArguments(["--candidate-dir", "candidate", "--pg-bin", "pg16", "--output", "output",
    "--archive-sha", "a".repeat(64), "--manifest-sha", "b".repeat(64)]);
  assert.equal(args["--pg-bin"], "pg16");
  assert.equal(args["--python"], undefined);
});

test("the runtime compiler renders the synthetic baseline with only the pg_restore tool calls", async t => {
  const require = createRequire(import.meta.url);
  const tools = require(join(source, "scripts/verify-empty-tenant-baseline-pg16.js"));
  const { PROFILE, PROGRAMS, REQUIRED_TABLES } = require(join(source, "scripts/tenant_baseline_schema_profile.js"));
  const compilerFile = join(source, "services/saas/tenant_baseline_program.js");
  const directory = await mkdtemp(join(tmpdir(), "first-open-compiler-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, "baseline");
  const pgRestorePath = join(directory, "pg_restore");
  const template = (await readFile(new URL("./fixtures/first-open-baseline-verification/schema-profile.sql", import.meta.url),
    "utf8")).replaceAll("\r\n", "\n");
  const objects = Object.keys(PROGRAMS);
  const tocEntries = [
    ...REQUIRED_TABLES.map(name => `TABLE public ${name} fixture_owner`),
    ...objects.map(name => name === "EXTENSION uuid-ossp"
      ? "EXTENSION - uuid-ossp"
      : name.replaceAll(".", " ") + " fixture_owner"),
  ];
  const phases = [];
  const run = t.mock.method(tools, "run", async (binary, args, _environment, phase) => {
    assert.equal(binary, pgRestorePath);
    phases.push(phase);
    if (phase === "baseline-compiler-version") return { output: "pg_restore (PostgreSQL) 16.14\n" };
    if (phase === "baseline-compiler-toc") {
      return { output: tocEntries.map((entry, index) => `${index + 1}; 0 0 ${entry}\n`).join("") };
    }
    assert.equal(phase, "baseline-compiler-render");
    const key = args.find(arg => arg.startsWith("--restrict-key=")).split("=")[1];
    const schema = template.slice(template.indexOf("--\n-- Name: "));
    return { output: `\\restrict ${key}\n${PROLOGUE.join("\n")}\n${schema}\n--\n-- Name: cart; Type: TABLE; Schema: public; Owner: -\n--\n\\unrestrict ${key}\n` };
  });
  const { compileTenantBaselineProgram, PROLOGUE } = require(compilerFile);
  t.after(() => { delete require.cache[compilerFile]; });
  const archiveBytes = Buffer.from("PGDMP synthetic baseline");
  const archiveSha256 = sha256(archiveBytes);
  const manifestBytes = Buffer.from(JSON.stringify({ format: "speedfeast-database-migration-manifest/v1",
    purpose: "tenant_bootstrap", dataPolicy: "schema_only", schemaProfile: PROFILE, sourceDatabase: "synthetic",
    archiveSha256, schemaObjectAllowlist: objects, tables: REQUIRED_TABLES.map(table => ({ schema: "public", table, rows: 0 })) }));
  const result = await compileTenantBaselineProgram({
    archiveBytes, manifestBytes, archiveSha256, manifestSha256: sha256(manifestBytes), pgRestorePath, workspace,
  });
  assert.deepEqual(phases, ["baseline-compiler-version", "baseline-compiler-toc", "baseline-compiler-render"]);
  assert.equal(run.mock.callCount(), 3);
  assert.match(result.restoreSql, /CREATE EXTENSION IF NOT EXISTS "uuid-ossp"/);
  assert.match(result.verificationSql, /Schema profile trigger mismatch/);
  assert.equal(result.verificationSql, await readFile(join(workspace, "baseline.verification.sql"), "utf8"));
});

test("platform first open rejects added or modified files and a rewritten closure manifest", async t => {
  const directory = await mkdtemp(join(tmpdir(), "first-open-source-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(source, directory, { recursive: true });
  const unexpected = join(directory, "unreviewed.txt");
  await writeFile(unexpected, "synthetic extra source");
  await assert.rejects(verifyFirstOpenBackend(directory), /ECS_FIRST_OPEN_BACKEND_INTEGRITY/);
  await rm(unexpected);

  const sql = join(directory, "db/saas_control.sql");
  const approved = await readFile(sql);
  const altered = Buffer.from(approved);
  altered[0] ^= 1;
  await writeFile(sql, altered);
  await assert.rejects(verifyFirstOpenBackend(directory), /ECS_FIRST_OPEN_BACKEND_INTEGRITY/);
  await writeFile(sql, approved);

  const manifest = join(directory, "manifest.json");
  await writeFile(manifest, `${await readFile(manifest, "utf8")}\n`);
  await assert.rejects(verifyFirstOpenBackend(directory), /ECS_FIRST_OPEN_BACKEND_INTEGRITY/);
});
