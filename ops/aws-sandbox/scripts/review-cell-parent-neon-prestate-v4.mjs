import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { sha256Hex, canonicalJson } from "../../../lib/deployments/execution/hash.ts";
import { SEALED_CELL_OWNERSHIP_SQL_V3 } from "../../../lib/deployments/execution/neon-sealed-cell-ownership-source-v3.ts";
import { validateSealedCertificateV3 } from "../../../lib/deployments/execution/sealed-cell-cleanup-authority-v3.ts";
import { REGISTERED_SEALED_CERTIFICATE_SHA256_V3 as certificateSha } from "../../../lib/deployments/execution/sealed-cell-cleanup-lambda-context-v3.ts";
import { CELL_PARENT_BOOTSTRAP_V4 as targets } from "../../../lib/deployments/execution/cell-parent-bootstrap-v4.ts";

// Operator's existing DATABASE_URL, SERIALIZABLE READ ONLY. No Secret values,
// AWS commands, role/DDL/write function, data mutation or runtime proof branding.
const repo = fileURLToPath(new URL("../../../", import.meta.url)), root = await realpath("F:/ChatGPT_workshop"), out = path.resolve(process.argv[2] ?? "");
if (process.argv.length !== 3 || (await realpath(path.dirname(out))).toLowerCase() !== root.toLowerCase() || !/^techlong-f3c9c-neon-prestate-[a-z0-9-]+$/.test(path.basename(out))) throw Error("PARENT_NEON_FRESH_PRIVATE_OUTPUT_REQUIRED");
await mkdir(out); const save = async (name, value) => { const text = JSON.stringify(value, null, 2) + "\n"; await writeFile(path.join(out, name), text, { flag: "wx" }); return sha256Hex(text); };
let stage = "CODE_BINDING", databaseConnections = 0;
try {
  const old = JSON.parse(await readFile(path.join(root, "techlong-f3c9b-parent-prestate-20261012-r1/code-binding.json"), "utf8"));
  if (old.codeSha256 !== targets.code58Sha256 || old.pins.length !== 58 || await sha256Hex(old.pins) !== old.codeSha256) throw Error("PARENT_NEON_OLD58_BINDING_INVALID");
  const files = [...old.pins.map(p => p.file), "lib/deployments/execution/cell-parent-bootstrap-v4.ts", "ops/aws-sandbox/scripts/review-cell-parent-neon-prestate-v4.mjs", "ops/aws-sandbox/sql-candidates/f3c9c-failed-cell-birth-fence.sql"], pins = [];
  for (const file of files) pins.push({ file, sha256: await sha256Hex((await readFile(path.join(repo, file), "utf8")).replace(/\r\n/g, "\n")) });
  if (canonicalJson(pins.slice(0, 58)) !== canonicalJson(old.pins)) throw Error("PARENT_NEON_OLD58_CODE_DRIFT"); const codeSha256 = await sha256Hex(pins); await save("code-binding.json", { pins, codeSha256 });
  const raw = process.env.DATABASE_URL; if (typeof raw !== "string") throw Error("PARENT_NEON_CONFIG_MISSING");
  const url = new URL(raw); if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech") || !url.password || !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) throw Error("PARENT_NEON_TLS_REQUIRED");
  const extra = `SELECT current_setting('server_version_num')::int AS server_version,
    to_regclass('public.deployment_failed_cell_birth_fences_v1') IS NOT NULL AS failure_table_present,
    to_regprocedure('public.begin_failed_cell_birth_fence_v1(text,text)') IS NOT NULL AS failure_entry_present,
    EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.deployment_environments'::pg_catalog.regclass
      AND c.conname='deployment_environments_admission_state_check' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%failed_unadmitted%') AS failure_state_present,
    (SELECT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::pg_catalog.text[] AND p.prorettype='pg_catalog.text'::pg_catalog.regtype
      AND p.pronargs=0 AND l.lanname='plpgsql' FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid='public.sealed_plan_protection_hash_v1()'::pg_catalog.regprocedure) AS fingerprint_definition_safe,
    e.apply_enabled,
    (SELECT count(*) FROM public.deployment_jobs j JOIN public.app_instance_deployments d ON d.id=j.deployment_id WHERE d.environment_id=e.id AND j.status IN ('pending','running','retry_wait')) AS nonterminal_jobs,
    (SELECT count(*) FROM public.deployment_step_runs s JOIN public.app_instance_deployments d ON d.id=s.deployment_id WHERE d.environment_id=e.id AND s.status IN ('pending','running')) AS nonterminal_steps,
    (SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'login',r.rolcanlogin,'superuser',r.rolsuper,'bypassrls',r.rolbypassrls) ORDER BY r.rolname)
      FROM pg_catalog.pg_roles r WHERE r.rolname IN ('techlong_cell_cleanup_reader','techlong_cell_drain')) AS roles,
    (SELECT jsonb_agg(pg_catalog.pg_get_constraintdef(c.oid) ORDER BY c.conname) FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.deployment_jobs'::pg_catalog.regclass AND c.contype='c') AS job_constraints
    FROM public.deployment_environments e WHERE e.id=$1`;
  stage = "NEON_READONLY_SNAPSHOT"; const env = "env_aws_sandbox_ca_central_1", signal = AbortSignal.timeout(30000), sql = neon(raw, { fullResults: true }); databaseConnections = 1;
  const result = await sql.transaction(tx => [...Object.entries(SEALED_CELL_OWNERSHIP_SQL_V3).map(([kind, s]) => tx.query(s, kind === "searchPath" ? [] : [env])), tx.query(extra, [env])],
    { isolationLevel: "Serializable", readOnly: true, deferrable: true, fullResults: true, fetchOptions: { signal } }); signal.throwIfAborted();
  if (!Array.isArray(result) || result.length !== 10 || result[1].rows.length !== 1 || result[2].rows.length !== 1 || result[9].rows.length !== 1) throw Error("PARENT_NEON_PRESTATE_RESPONSE_INVALID");
  const e = result[1].rows[0], c = result[2].rows[0], m = result[9].rows[0], fields = ["deployment_id", "environment_id", "app_instance_id", "original_row_sha256", "original_plan_bytes_sha256", "original_plan_hash", "business_state_sha256", "approved_registration_sha256", "protection_schema_sha256", "sealed_at"],
    cert = validateSealedCertificateV3({ ...Object.fromEntries(fields.map(k => [k, c[k]])), sealed_at: Number(c.sealed_at) });
  if (await sha256Hex(cert) !== certificateSha || c.fence_sealed !== true || Number(c.fence_sealed_at) !== cert.sealed_at || Number(c.fence_revision) < 1 ||
    c.live_row_sha256 !== cert.original_row_sha256 || c.live_plan_bytes_sha256 !== cert.original_plan_bytes_sha256 || c.live_plan_hash !== cert.original_plan_hash ||
    c.live_protection_sha256 !== cert.protection_schema_sha256 || m.fingerprint_definition_safe !== true || c.fingerprint_body_sha256 !== "16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66") throw Error("PARENT_NEON_CURRENT_HISTORICAL_SEAL_DRIFT");
  if (e.environment_id !== env || e.account_id !== targets.account || e.region !== targets.region || e.cell_key !== "cell-sandbox-1" || e.admission_state !== "open" || Number(e.admission_epoch) !== 0 || Number(m.apply_enabled) !== 0) throw Error("PARENT_NEON_CURRENT_ENVIRONMENT_DRIFT");
  for (const p of pins) if (await sha256Hex((await readFile(path.join(repo, p.file), "utf8")).replace(/\r\n/g, "\n")) !== p.sha256) throw Error("PARENT_NEON_FINAL_CODE_DRIFT");
  const report = { schemaVersion: 4, phase: "F3c9c_NEON_PROTECTION_INSTALLATION_PRESTATE", outcome: "READONLY_PRESTATE_VERIFIED_NOT_INSTALLED", observedAt: new Date().toISOString(),
    serverVersionNum: m.server_version, admissionState: e.admission_state, admissionEpoch: Number(e.admission_epoch), applyEnabled: Number(m.apply_enabled),
    historicalCertificateSha256: certificateSha, historicalProtectionSha256: cert.protection_schema_sha256, historicalSealVerified: true,
    failedFenceTablePresent: m.failure_table_present, failedFenceEntryPresent: m.failure_entry_present, failedStatePresent: m.failure_state_present,
    controlRoles: m.roles, jobStatusConstraints: m.job_constraints,
    rawCounts: { activeTenant: result[3].rows.length, association: result[4].rows.length, capacity: result[5].rows.length, deployment: result[6].rows.length,
      resource: result[7].rows.length, schedule: result[8].rows.length, job: Number(m.nonterminal_jobs), step: Number(m.nonterminal_steps) },
    limitedReaderRuntimeProofProduced: false, operatorOwnerIsNotCertifiedRuntimeProof: true, newCandidateInstalledOrPg18AcceptanceProved: false,
    schemaCandidateSha256: pins.at(-1).sha256, roleGrantCandidateSha256: await sha256Hex((await readFile(path.join(repo, "ops/aws-sandbox/sql-candidates/f3c7-failed-cell-birth-role-grants.sql"), "utf8")).replace(/\r\n/g, "\n")),
    old58Unchanged: true, codeSha256, boundFileCount: pins.length, databaseConnections, databaseWrites: 0, awsCalls: 0, secretValueReads: 0, lambdaInvocations: 0,
    runtimeEnabled: false, mutationApprovalManifestCreated: false };
  const reportFileSha256 = await save("neon-prestate-review.json", report); console.log(JSON.stringify({ ...report, reportFileSha256, output: out }, null, 2));
} catch (e) {
  const report = { outcome: "PARENT_NEON_READONLY_PRESTATE_INCOMPLETE", stage, safeCode: /^[A-Z0-9_]{4,120}$/.test(String(e.message)) ? e.message : String(e.name ?? "ProviderError").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
    noRawProviderDiagnosticsPersisted: true, databaseConnections, databaseWrites: 0, awsCalls: 0, secretValueReads: 0, runtimeEnabled: false };
  await save("read-only-failure.json", report); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1;
}
