import { neon } from "@neondatabase/serverless";
import { CELL_TTL_CLEANUP_JOBS_SQL } from "../../../lib/deployments/execution/neon-cell-ttl-cleanup-jobs.ts";
import { createHash } from "node:crypto";

// EXPLAIN WITHOUT ANALYZE inside a READ ONLY transaction. Never executes the
// mutation CTE, drains admission, inserts jobs, or exports rows/credentials.
try {
  const raw = process.env.DATABASE_URL;
  if (!raw || !new URL(raw).hostname.endsWith(".neon.tech")) throw new Error("Neon config missing");
  const sql = neon(raw, { fullResults: true });
  const signal = AbortSignal.timeout(30_000);
  const results = await sql.transaction(transaction => [transaction.query(`EXPLAIN (FORMAT JSON) ${CELL_TTL_CLEANUP_JOBS_SQL}`,
    ["env_aws_sandbox_ca_central_1", "402010193138", "ca-central-1", "cell-sandbox-1", 1, "a".repeat(64),
      "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/12345678-1234-1234-1234-123456789012",
      "b".repeat(64), 1788811100000, 1788811200000]), transaction.query(`SELECT
      (SELECT admission_state FROM deployment_environments WHERE id = $1) AS admission_state,
      (SELECT cell_key FROM deployment_environments WHERE id = $1) AS environment_cell_key,
      (SELECT expected_account_id FROM deployment_environments WHERE id = $1) AS environment_account_id,
      (SELECT region FROM deployment_environments WHERE id = $1) AS environment_region,
      (SELECT count(*) FROM deployment_tenant_resources WHERE environment_id = $1 AND lifecycle_status <> 'destroyed') AS live_resource_count,
      (SELECT count(*) FROM app_instance_deployments WHERE environment_id = $1 AND status NOT IN ('rolled_back','canceled')) AS nonterminal_deployment_count,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'techlong_cell_drain') AS drain_role_present,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'techlong_cell_cleanup_reader') AS reader_role_present`, ["env_aws_sandbox_ca_central_1"])],
    { isolationLevel: "Serializable", readOnly: true, deferrable: true, fullResults: true, fetchOptions: { signal } });
  if (results.length !== 2 || !results[0].rows.length || results[1].rows.length !== 1) throw new Error("No explain result");
  console.log(JSON.stringify({ outcome: "NEON_SQL_EXPLAIN_ONLY_VERIFIED", sqlSha256: createHash("sha256").update(CELL_TTL_CLEANUP_JOBS_SQL).digest("hex"),
    readonlyControlInventory: results[1].rows[0], analysisExecuted: false, cloudMutationPerformed: false, databaseMutationPerformed: false }));
} catch { console.error("NEON_SQL_EXPLAIN_ONLY_NOT_VERIFIED; no mutation submitted; credentials and diagnostics withheld."); process.exitCode = 1; }
