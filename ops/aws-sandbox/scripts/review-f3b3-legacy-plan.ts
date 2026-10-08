import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileLegacyPlanIsolationReview, LEGACY_PLAN_TARGET, LEGACY_PLAN_ENVIRONMENT } from "../../../lib/deployments/execution/legacy-plan-isolation-review.ts";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out") throw new Error("READ_ONLY_REVIEW_REQUIRES_FRESH_OUTPUT");
const directory = path.resolve(args[1]);
if (path.dirname(directory).toLowerCase() !== path.resolve("F:/ChatGPT_workshop").toLowerCase() || !/^techlong-f3b3-legacy-[a-z0-9-]+$/.test(path.basename(directory))) throw new Error("REVIEW_OUTPUT_SCOPE_INVALID");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
try {
  const raw = process.env.DATABASE_URL;
  if (!raw || !new URL(raw).hostname.endsWith(".neon.tech")) throw new Error("Neon target missing");
  const sql = neon(raw, { fullResults: true });
  const results = await sql.transaction(tx => [
    tx.query(`SELECT to_jsonb(d)::text AS original_deployment_row,
      jsonb_build_object('instanceId',i.id,'instanceStatus',i.status,'instanceUpdatedAt',i.updated_at,
        'subscriptionId',s.id,'subscriptionStatus',s.status)::text AS business_state,
      d.id,d.environment_id,d.mode,d.status,d.cell_key,d.attempts,d.updated_at,d.app_instance_id,
      i.status AS instance_status,s.status AS subscription_status,
      (SELECT count(*) FROM app_instance_deployments sibling WHERE sibling.app_instance_id=d.app_instance_id) AS instance_deployment_count,
      (SELECT count(*) FROM deployment_jobs j WHERE j.deployment_id=d.id) AS job_count,
      (SELECT count(*) FROM deployment_tenant_resources r WHERE r.owner_deployment_id=d.id OR r.created_by_deployment_id=d.id OR r.app_instance_id=d.app_instance_id) AS resource_count,
      (SELECT count(*) FROM deployment_environment_capacity_reservations c WHERE c.deployment_id=d.id) AS capacity_count,
      (SELECT count(*) FROM deployment_cleanup_schedules c WHERE c.deployment_id=d.id) AS schedule_count,
      (SELECT count(*) FROM deployment_step_runs c WHERE c.deployment_id=d.id) AS step_count,
      (d.desired_plan::jsonb #>> '{safety,applyEnabled}')::boolean AS plan_apply_enabled,
      (d.desired_plan::jsonb #>> '{safety,createsAwsResources}')::boolean AS plan_creates_resources,
      (d.desired_plan::jsonb #>> '{safety,storesSecretValues}')::boolean AS plan_stores_secrets,
      to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
      FROM app_instance_deployments d JOIN app_instances i ON i.id=d.app_instance_id LEFT JOIN subscriptions s ON s.id=d.subscription_id
      WHERE d.id=$1 AND d.environment_id=$2`, [LEGACY_PLAN_TARGET, LEGACY_PLAN_ENVIRONMENT]),
    tx.query(`SELECT pg_get_triggerdef(t.oid) AS trigger_definition, pg_get_functiondef(t.tgfoid) AS function_definition,
      t.tgenabled AS enabled, current_setting('session_replication_role') AS replication_role
      FROM pg_trigger t WHERE t.tgrelid='public.app_instance_deployments'::regclass
        AND t.tgname='app_instance_deployments_admission_reopen_fence' AND NOT t.tgisinternal`),
    tx.query(`SELECT
      (SELECT count(DISTINCT i.id) FROM app_instances i JOIN app_instance_deployments d ON d.app_instance_id=i.id WHERE d.environment_id=$1 AND i.status IN ('pending','active')) AS active_tenant_count,
      (SELECT count(*) FROM app_instance_deployments d WHERE d.environment_id=$1 AND d.status NOT IN ('rolled_back','canceled')) AS nonterminal_deployment_count,
      (SELECT count(*) FROM deployment_environment_capacity_reservations c WHERE c.environment_id=$1) AS capacity_count,
      (SELECT count(*) FROM deployment_tenant_resources r WHERE r.environment_id=$1 AND r.lifecycle_status<>'destroyed') AS live_resource_count,
      (SELECT count(*) FROM deployment_cleanup_schedules c WHERE c.environment_id=$1 AND c.status NOT IN ('succeeded','canceled')) AS nonterminal_schedule_count`, [LEGACY_PLAN_ENVIRONMENT]),
  ], { isolationLevel: "Serializable", readOnly: true, deferrable: true, fullResults: true, fetchOptions: { signal: AbortSignal.timeout(30_000) } });
  if (results.some(value => value.rows.length !== 1)) throw new Error("Exact review rows missing");
  const row = results[0].rows[0], trigger = results[1].rows[0], counts = results[2].rows[0];
  const review = await compileLegacyPlanIsolationReview({
    deploymentId: row.id, environmentId: row.environment_id, mode: row.mode, status: row.status, cellKey: row.cell_key,
    attempts: Number(row.attempts), updatedAt: Number(row.updated_at), appInstanceId: row.app_instance_id,
    instanceStatus: row.instance_status, subscriptionStatus: row.subscription_status,
    deploymentRowSha256: hash(row.original_deployment_row), businessStateSha256: hash(row.business_state),
    immutableEnvironmentTriggerSha256: hash(JSON.stringify(trigger)),
    environmentReferenceImmutable: ["O", "A"].includes(trigger.enabled) && trigger.replication_role === "origin" && trigger.function_definition.includes("NEW.environment_id IS DISTINCT FROM OLD.environment_id") && trigger.function_definition.includes("deployment application instance and environment are immutable"),
    planSafety: { applyEnabled: row.plan_apply_enabled, createsAwsResources: row.plan_creates_resources, storesSecretValues: row.plan_stores_secrets },
    relations: { instanceDeploymentCount: Number(row.instance_deployment_count), jobCount: Number(row.job_count), resourceCount: Number(row.resource_count), capacityCount: Number(row.capacity_count), scheduleCount: Number(row.schedule_count), stepCount: Number(row.step_count) },
    environmentCounts: { activeTenantCount: Number(counts.active_tenant_count), nonterminalDeploymentCount: Number(counts.nonterminal_deployment_count), capacityCount: Number(counts.capacity_count), liveResourceCount: Number(counts.live_resource_count), nonterminalScheduleCount: Number(counts.nonterminal_schedule_count) },
    databaseObservedAt: row.observed_at,
  });
  await mkdir(directory);
  await writeFile(path.join(directory, "private-preimage.json"), JSON.stringify({ originalDeploymentRow: row.original_deployment_row, businessState: row.business_state, trigger }, null, 2) + "\n", { flag: "wx" });
  const bytes = JSON.stringify(review, null, 2) + "\n";
  await writeFile(path.join(directory, "isolation-review.json"), bytes, { flag: "wx" });
  console.log(JSON.stringify({ outcome: review.outcome, reviewSha256: review.reviewSha256, fileSha256: hash(bytes), output: path.join(directory, "isolation-review.json"),
    instanceStatus: review.evidence.instanceStatus, subscriptionStatus: review.evidence.subscriptionStatus, environmentCounts: review.evidence.environmentCounts,
    executionAuthorized: false, databaseMutationPerformed: false }));
} catch { console.error("LEGACY_REVIEW_NOT_VERIFIED; no database mutation; diagnostics and credentials withheld."); process.exitCode = 1; }
