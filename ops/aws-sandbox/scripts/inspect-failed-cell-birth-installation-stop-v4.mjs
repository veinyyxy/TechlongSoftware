// Read-only acceptance of the exact consumed 91a attempt. Not an installer,
// repair entry, schema simulation, new slot, retry or runtime proof.
import { Client } from "pg";
import { readFile, writeFile, mkdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { readFailedBirthInstallationStateV4 } from "../../../lib/deployments/execution/failed-cell-birth-installation-v4.ts";

const approvedSha = "91a63757de532e1189f7c2478401e26d46cd2643965c802172cb9841477c4291", originalCode68 = "cd90d88625ea3c2b25226ea5a326a53bc9b34104ad05e8c628735489290f4486";
const root = await realpath("F:/ChatGPT_workshop"), repo = fileURLToPath(new URL("../../../", import.meta.url)), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await lstat("F:/ChatGPT_workshop")).isSymbolicLink() || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() ||
  !/^techlong-f3c9d-neon-stop-[a-z0-9-]+$/.test(path.basename(out))) throw Error("FAILED_STOP_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out); const save = async (name, v) => { const text = JSON.stringify(v, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx" }); return sha256Hex(text); };
let client, stage = "APPROVED68_AND_ORIGINAL_RECEIPT", databaseConnections = 0;
try {
  const directory = path.join(root, "techlong-f3c9d-neon-install-20261012-r3"), review = JSON.parse(await readFile(path.join(directory, "review-manifest.json"), "utf8")),
    old = JSON.parse(await readFile(path.join(directory, "code-binding.json"), "utf8"));
  if (review.manifestSha256 !== approvedSha || old.pins.length !== 68 || old.codeSha256 !== originalCode68 || await sha256Hex(old.pins) !== originalCode68 || review.binding.codeSha256 !== originalCode68) throw Error("FAILED_STOP_ORIGINAL68_BINDING_INVALID");
  const file = "ops/aws-sandbox/scripts/inspect-failed-cell-birth-installation-stop-v4.mjs", pins = [...old.pins, { file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) }];
  const verifyCode = async () => { for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("FAILED_STOP_CODE_DRIFT"); };
  await verifyCode(); const code69Sha256 = await sha256Hex(pins); await save("code-binding.json", { pins, code69Sha256, originalCode68 });
  const receiptText = await readFile(path.join(root, "techlong-f3c9d-neon-install-20261012-r3-run/submission-receipt.json"), "utf8"), receipt = JSON.parse(receiptText), receiptSha256 = await sha256Hex(receiptText);
  if (receiptSha256 !== "43077c961fd125583102b8209510ab24587ba7fb4d4830d26f79fa6b344a4cee" || receipt.commitAttempted !== false || receipt.commitConfirmed !== false || receipt.ddlAttempted !== true || receipt.slotConsumed !== true || receipt.safeCode !== "FAILED_INSTALL_TABLE_GUARDS_OR_ACL_INVALID") throw Error("FAILED_STOP_ORIGINAL_RECEIPT_DRIFT");
  const slotText = await readFile(path.join(root, review.scope.permanentSlot), "utf8"), slot = JSON.parse(slotText);
  if (slot.protocol !== "failed-birth-installation-permanent-local-attempt-v4" || slot.approvedSha256 !== approvedSha || slot.codeSha256 !== originalCode68 || slot.retryAuthorized !== false) throw Error("FAILED_STOP_PERMANENT_SLOT_DRIFT");
  const raw = process.env.DATABASE_URL, url = raw ? new URL(raw) : null;
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") || !url.username || !url.password ||
    (url.port && url.port !== "5432") || !["require", "verify-full"].includes(url.searchParams.get("sslmode")) || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.hash ||
    [...url.searchParams.keys()].some(k => !["sslmode", "channel_binding"].includes(k))) throw Error("FAILED_STOP_NEON_TLS_REQUIRED");
  const user = decodeURIComponent(url.username), database = decodeURIComponent(url.pathname.slice(1));
  if (await sha256Hex({ protocol: "neon-failed-birth-installation-target-v4", host: url.hostname, port: 5432, database, user }) !== review.binding.targetFingerprintSha256) throw Error("FAILED_STOP_TARGET_DRIFT");
  stage = "NEW_CONNECTION_READONLY_ROLLBACK_ACCEPTANCE";
  client = new Client({ host: url.hostname, port: 5432, user, password: decodeURIComponent(url.password), database,
    ssl: { rejectUnauthorized: true, servername: url.hostname }, enableChannelBinding: true, connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "techlong-failed-birth-stop-inspect-v4" });
  client.on("error", () => undefined); await client.connect(); databaseConnections++;
  const started = Date.now(); await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE"); await client.query("SET LOCAL search_path=pg_catalog");
  const read = await readFailedBirthInstallationStateV4(client), diagnostic = (await client.query(`SELECT c.relname AS relation,
    count(*) FILTER (WHERE k.contype='n')::int AS not_null_catalog_count,
    count(*) FILTER (WHERE k.contype='c')::int AS check_count,
    count(*) FILTER (WHERE k.contype='p')::int AS primary_key_count,
    count(*) FILTER (WHERE k.contype='f')::int AS foreign_key_count
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('deployment_environments','deployment_plan_only_isolation_fences') GROUP BY c.relname ORDER BY c.relname`)).rows;
  await client.query("COMMIT"); await client.end(); client = null; await verifyCode();
  if (Date.now() - started > 30000 || read.state.base.preserved.sealed.identity.role !== user || read.state.base.preserved.sealed.identity.database !== database ||
    read.transaction.readOnly !== "on" || read.transaction.isolation !== "serializable" || read.transaction.deferrable !== "on") throw Error("FAILED_STOP_READ_CONTEXT_INVALID");
  await save("independent-read-only-observation.json", read);
  const exact = read.stateSha256 === review.prestateSha256 && canonicalJson(read.state) === canonicalJson(review.reviewedState), result = {
    schemaVersion: 4, phase: "F3c9d_STOPPED_AT_PRECOMMIT_CATALOG_CHECK", outcome: exact ? "REVIEWED_PRESTATE_RESTORED_INDEPENDENTLY_VERIFIED" : "POSTSTOP_PRESTATE_DRIFT_NO_WRITE",
    observedAt: new Date(read.observedAt).toISOString(), approvedManifestSha256: approvedSha, originalCode68, original68Unchanged: true, code69Sha256,
    originalSubmissionReceiptSha256: receiptSha256, permanentSlotSha256: await sha256Hex(slotText), localSlotConsumed: true,
    originalDdlAttempted: true, originalCommitAttempted: false, originalCommitConfirmed: false,
    reviewedPrestateSha256: review.prestateSha256, currentStateSha256: read.stateSha256, exactReviewedPrestateRestored: exact,
    newFailureFenceTablePresent: read.state.objects.some(x => x.kind === "table"),
    rolePrivilegeCounts: read.state.base.roles.map(r => ({ name: r.name, tableSelectCount: r.table_privileges.length, columnPrivilegeCount: r.column_privileges.length, nontriggerDefinerAccess: r.nontrigger_definer_access })),
    serverVersionNum: read.state.base.preserved.sealed.identity.version, existingTableConstraintTypeDiagnostics: diagnostic,
    pg18NotNullCatalogRowsObserved: diagnostic.some(x => x.not_null_catalog_count > 0), approvedValidatorRequiredExactlySevenTotalConstraints: true,
    causeAssessment: "PG18_NOT_NULL_CATALOG_COUNT_INCOMPATIBILITY_SUPPORTED_NOT_UNIQUE_CAUSE_PROOF",
    stoppedTransactionCatalogNotPersisted: true, noNewDdlOrGrantOrWriteRetry: true, databaseConnections, databaseWritesThisInspector: 0,
    awsCalls: 0, secretValueReads: 0, lambdaInvocations: 0, runtimeEnabled: false, retryAuthorized: false };
  const reportFileSha256 = await save("independent-stop-inspect.json", result); console.log(JSON.stringify({ ...result, reportFileSha256, output: out }, null, 2)); if (!exact) process.exitCode = 1;
} catch (e) {
  const r = { outcome: "FAILED_STOP_READONLY_INSPECT_INCOMPLETE", stage, safeCode: /^FAILED_STOP_[A-Z0-9_]{1,100}$/.test(String(e.message)) ? e.message : "FAILED_STOP_PROVIDER_OR_LOCAL_EVIDENCE_FAILURE",
    noRawDiagnosticsPersisted: true, databaseConnections, databaseWritesThisInspector: 0, awsCalls: 0, retryAuthorized: false, runtimeEnabled: false };
  await save("safe-read-only-failure.json", r); console.log(JSON.stringify(r, null, 2)); process.exitCode = 1;
} finally { await client?.end().catch(() => undefined); }
