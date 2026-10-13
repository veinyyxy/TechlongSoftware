// Standalone human-reviewed installation. Never called by migrations/runtime.
import { Client } from "pg";
import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readFailedBirthInstallationStateV4, compileFailedBirthInstallReviewV4, validateFailedBirthInstallReviewV4,
  runReviewedFailedBirthInstallationV4, verifyFailedBirthInstallPoststateV4, FAILED_BIRTH_INSTALL_SCOPE_V4 } from "../../../lib/deployments/execution/failed-cell-birth-installation-v4.ts";

const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) { if (!args[i]?.startsWith("--") || !args[i+1] || options[args[i]]) throw Error("FAILED_INSTALL_ARGUMENTS_INVALID"); options[args[i]] = args[i+1]; }
const mode = options["--mode"], allowed = mode === "Review" ? ["--mode", "--out"] : mode === "Run" ? ["--mode", "--out", "--manifest", "--approved-sha"] : ["--mode", "--out", "--manifest"];
if (!["Review", "Run", "Inspect"].includes(mode) || canonicalJson(Object.keys(options).sort()) !== canonicalJson(allowed.sort())) throw Error("FAILED_INSTALL_ARGUMENTS_INVALID");
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(options["--out"]);
const bounded = async p => (await realpath(path.dirname(p))).toLowerCase() === root.toLowerCase() && /^techlong-f3c9d-neon-install-[a-z0-9-]+$/.test(path.basename(p));
if ((await lstat("F:/ChatGPT_workshop")).isSymbolicLink() || !(await bounded(out))) throw Error("FAILED_INSTALL_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out); const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx" }); return sha256Hex(text); };
let active, stage = "CODE_BINDING", databaseConnections = 0, result;
try {
  const original = JSON.parse(await readFile(path.join(root, "techlong-f3c9c-bootstrap-20261012-r3/code-binding.json"), "utf8"));
  if (original.pins.length !== 63 || original.codeSha256 !== "3fbde58c8f9a60a85f3174a3c36d1ab33e93da5b52100c124093892706757d34" || await sha256Hex(original.pins) !== original.codeSha256) throw Error("FAILED_INSTALL_ORIGINAL63_BINDING_INVALID");
  const files = [...new Set([...original.pins.map(p => p.file),
    "ops/aws-sandbox/scripts/review-failed-cell-birth-installation-v4.mjs", "lib/deployments/execution/failed-cell-birth-installation-v4.ts",
    "lib/deployments/execution/sealed-control-role-management-v1.ts", "lib/deployments/execution/sealed-plan-management-v1.ts",
    "lib/deployments/execution/sealed-plan-catalog-read-v1.ts", "ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql",
    "ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql"])], pins = [];
  const text = async f => (await readFile(path.join(repo, f), "utf8")).replace(/\r\n/g, "\n");
  for (const file of files) pins.push({ file, sha256: await sha256Hex(await text(file)) });
  if (canonicalJson(pins.slice(0, 63)) !== canonicalJson(original.pins)) throw Error("FAILED_INSTALL_ORIGINAL63_CODE_DRIFT");
  const verifyCode = async () => { for (const p of pins) if (await sha256Hex(await text(p.file)) !== p.sha256) throw Error("FAILED_INSTALL_CODE_DRIFT"); };
  const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256, original63Sha256: original.codeSha256 });
  const schema = await text("ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql"), grants = await text("ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql");
  const raw = process.env.DATABASE_URL, url = raw ? new URL(raw) : null;
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") || !url.username || !url.password ||
    (url.port && url.port !== "5432") || !["require", "verify-full"].includes(url.searchParams.get("sslmode")) || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
    url.hash || [...url.searchParams.keys()].some(k => !["sslmode", "channel_binding"].includes(k))) throw Error("FAILED_INSTALL_NEON_TLS_REQUIRED");
  const user = decodeURIComponent(url.username), database = decodeURIComponent(url.pathname.slice(1)), binding = {
    targetFingerprintSha256: await sha256Hex({ protocol: "neon-failed-birth-installation-target-v4", host: url.hostname, port: 5432, database, user }), codeSha256 };
  const slot = path.join(root, FAILED_BIRTH_INSTALL_SCOPE_V4.permanentSlot);
  const slotOccupied = async () => { try { await lstat(slot); return true; } catch (e) { if (e.code === "ENOENT") return false; throw Error("FAILED_INSTALL_LOCAL_SLOT_READ_FAILED"); } };
  if (mode !== "Inspect" && await slotOccupied()) throw Error("FAILED_INSTALL_SLOT_OCCUPIED_INSPECT_ONLY");
  const connect = async () => {
    const c = new Client({ host: url.hostname, port: 5432, user, password: decodeURIComponent(url.password), database,
      ssl: { rejectUnauthorized: true, servername: url.hostname }, enableChannelBinding: true, connectionTimeoutMillis: 10000,
      statement_timeout: 30000, query_timeout: 35000, application_name: "techlong-failed-birth-installation-v4" });
    c.on("error", () => undefined); await c.connect(); databaseConnections++; return c;
  };
  const readState = async () => { const r = await readFailedBirthInstallationStateV4(active);
    if (r.state.base.preserved.sealed.identity.role !== user || r.state.base.preserved.sealed.identity.database !== database) throw Error("FAILED_INSTALL_CURRENT_SQL_TARGET_DRIFT"); return r; };
  const readonly = async () => { active = await connect(); try {
    await active.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE"); await active.query("SET LOCAL search_path=pg_catalog");
    const r = await readState(); await active.query("COMMIT"); return r;
  } finally { await active.end().catch(() => undefined); active = null; } };
  if (mode === "Review") {
    stage = "NEON_READONLY_REVIEW"; const started = Date.now(), read = await readonly(); await verifyCode();
    const review = await compileFailedBirthInstallReviewV4(read, binding, started, Date.now());
    await validateFailedBirthInstallReviewV4(review, binding, schema, grants);
    await save("read-only-preflight.json", { ...read, binding, databaseWrites: 0, runtimeEnabled: false });
    const fileSha256 = await save("review-manifest.json", review);
    console.log(JSON.stringify({ mode, outcome: "FRESH_NEON_SCHEMA_GRANTS_REVIEW_REQUIRES_HUMAN_APPROVAL", manifestSha256: review.manifestSha256,
      expiresAt: new Date(review.expiresAt).toISOString(), fileSha256, prestateSha256: review.prestateSha256, codeSha256, boundFileCount: pins.length,
      original63Unchanged: true, localSlotConsumed: false, databaseConnections, databaseWrites: 0, awsCalls: 0, secretValueReads: 0, runtimeEnabled: false, output: out }, null, 2));
  } else {
    const manifest = path.resolve(options["--manifest"]);
    if (path.basename(manifest) !== "review-manifest.json" || !(await bounded(path.dirname(manifest)))) throw Error("FAILED_INSTALL_PRIVATE_MANIFEST_REQUIRED");
    const review = JSON.parse(await readFile(manifest, "utf8")); await validateFailedBirthInstallReviewV4(review, binding, schema, grants); await verifyCode();
    if (mode === "Run") {
      stage = "APPROVED_NEON_INSTALLATION"; active = await connect();
      result = await runReviewedFailedBirthInstallationV4({ client: active, review, approvedSha: options["--approved-sha"], binding, schema, grants, now: Date.now, readState, verifyCode,
        claimPermanentSlot: async () => { await writeFile(slot, JSON.stringify({ protocol: "failed-birth-installation-permanent-local-attempt-v4", approvedSha256: review.manifestSha256,
          codeSha256, attemptedAt: new Date().toISOString(), retryAuthorized: false }) + "\n", { flag: "wx", flush: true }); } });
      await active.end().catch(() => undefined); active = null; await save("submission-receipt.json", result);
      console.log(JSON.stringify({ mode, ...result, output: out }, null, 2)); if (!result.commitConfirmed) process.exitCode = 1;
    }
    stage = "INDEPENDENT_READONLY_INSPECT"; const started = Date.now(), read = await readonly(); await verifyCode();
    await save("read-only-observation.json", { ...read, binding, databaseWritesThisRead: 0, runtimeEnabled: false });
    if (Date.now() - started > 30000) throw Error("FAILED_INSTALL_INDEPENDENT_READ_STALE");
    const verified = await verifyFailedBirthInstallPoststateV4(read, review.reviewedState, schema), fileSha256 = await save("independent-inspect.json", {
      ...verified, approvedManifestSha256: review.manifestSha256, codeSha256, observedAt: new Date(read.observedAt).toISOString(),
      independentNewTlsConnection: true, readOnly: true, deferrable: true, slotConsumed: await slotOccupied(), awsCalls: 0, secretValueReads: 0 });
    console.log(JSON.stringify({ mode: "IndependentInspect", ...verified, fileSha256, output: out }, null, 2));
  }
} catch (e) {
  const report = { outcome: "FAILED_INSTALL_NOT_VERIFIED_READONLY_RECOVERY_ONLY", stage,
    safeCode: /^[A-Z0-9_]{4,120}$/.test(String(e.message)) ? e.message : "FAILED_INSTALL_PROVIDER_OR_CONFIGURATION_FAILURE",
    noRawDiagnosticsOrConnectionStringsPersisted: true, databaseConnections, submissionResult: result ?? null,
    awsCalls: 0, secretValueReads: 0, retryAuthorized: false, runtimeEnabled: false };
  await save("safe-failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
} finally { await active?.end().catch(() => undefined); }
