import { CLAIM_FIRST_ONBOARDING, SELECT_FIRST_ONBOARDING } from "../first-onboarding.ts";
import { SANDBOX_FIRST_OPEN as s, type SandboxFirstOpenPorts } from "./first-onboarding-run-once.ts";
import { firstOpenSqlJson } from "./first-onboarding-sql-value.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "./first-onboarding-version.ts";
import { FIRST_OPEN_TTL_SECONDS, firstOpenExecutionWindow, type FirstOpenControlledWindow } from "./first-onboarding-window.ts";

const schema = "techlong_first_onboarding_claim";
export const FIRST_OPEN_MANAGEMENT_CLAIM_READ = `SELECT ${schema}.management_ready($1::text) AS ready`;
export const FIRST_OPEN_CLAIM_ROLES = Object.freeze({
  definer: "first_onboarding_fc41597f_claim_owner",
  reader: "first_onboarding_fc41597f_review",
  writer: "first_onboarding_fc41597f_claim",
});
const hex = /^[a-f0-9]{64}$/;
const projections = {
  deployment_jobs: "id,deployment_id,dedupe_key,job_type,status,payload,attempts,max_attempts,available_at,lease_owner,lease_token,lease_expires_at,completed_at",
  app_instance_deployments: "id,app_instance_id,subscription_id,environment_id,deployment_profile_key,mode,driver,workflow_version,cell_key,desired_plan,plan_hash,configuration_hash,artifact_ref,status",
  app_instances: "id,workspace_id,product_id,subscription_id,tenant_key,configuration_snapshot,slug,status,provisioned_at,provisioning_source,access_url,template_version_id",
  workspaces: "id,status",
  subscriptions: "id,workspace_id,product_id,status,plan_id,template_version_id,current_period_start,current_period_end,instance_configuration,deployment_profile_key",
  deployment_environments: "id,expected_account_id,key,kind,status,apply_enabled,region,cell_key,policy",
  deployment_tenant_resources: "app_instance_id",
  deployment_tenant_external_operations: "app_instance_id",
};
const lockTables = ["app_instance_deployments", "app_instances", "workspaces", "subscriptions", "deployment_environments"];
const qualified = (sql: string) => sql.replace(/\b(FROM|JOIN|UPDATE) (deployment_jobs|app_instance_deployments|app_instances|workspaces|subscriptions|deployment_environments|deployment_tenant_resources)\b/g, "$1 public.$2");
const literal = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const job = literal(s.jobId);
const workspacePredicate = (expr: string) =>
  `encode(sha256(convert_to(${expr},'UTF8')),'hex')=${literal(s.workspaceSha256)}`;
const staticPredicate = ` AND d.id=${literal(s.deploymentId)} AND a.id=${literal(s.instanceId)} AND s.id=${literal(s.subscriptionId)}
  AND e.id=${literal(s.environmentId)} AND ${workspacePredicate("a.workspace_id")}
  AND NOT EXISTS (SELECT 1 FROM deployment_release.instance_state st WHERE st.instance_id=a.id)
  AND NOT EXISTS (SELECT 1 FROM public.deployment_tenant_external_operations x WHERE x.app_instance_id=a.id)`;
/** Candidate SQL, never installed by this module. Claim and review logins
 * get only EXECUTE. Bind to the final review, not the historical draft. */
export function sandboxFirstOpenClaimDdl(input: { approvalSha256: string; planHash: string; configurationHash: string;
  writeBefore: number; window: FirstOpenControlledWindow; managementOperationSha256?: string; taskRelease?: FirstOpenTaskRelease }) {
  const { approvalSha256, planHash, configurationHash, writeBefore } = input;
  const window = firstOpenExecutionWindow(s.jobId, writeBefore, input.window)!;
  if (![approvalSha256, planHash, configurationHash].every(v => hex.test(v)) ||
    !Number.isSafeInteger(writeBefore) || writeBefore <= 0 ||
    (input.managementOperationSha256 !== undefined && !hex.test(input.managementOperationSha256))) throw Error("FIRST_OPEN_CLAIM_DDL_SCOPE");
  const { definer, reader, writer } = FIRST_OPEN_CLAIM_ROLES;
  const version = firstOpenVersion(input.taskRelease);
  const heldVersion = input.taskRelease === undefined ? "" : `
    AND j.payload::jsonb#>>'{scope,releaseId}'=${literal(version.releaseId)}
    AND j.payload::jsonb#>>'{scope,artifactRef}'=${literal(version.artifactRef)}`;
  const fixedRelease = `SELECT l.document || jsonb_build_object('status',l.status)
  FROM deployment_release.releases l WHERE l.id=${literal(version.releaseId)} AND l.status=${literal(version.status)}
    AND l.product_id=${literal(s.productId)} AND l.component='tenant_api'
    AND l.document#>>'{image,repository}'=${literal(version.imageRepository)}
    AND l.document#>>'{image,manifestDigest}'=${literal(version.imageDigest)}
    AND l.document#>>'{image,platformDigest}'=${literal(version.imageDigest)}${input.taskRelease === undefined ? "" :
    ` AND l.document=${firstOpenSqlJson(input.taskRelease)}`}`;
  const predicate = staticPredicate + ` AND d.plan_hash=${literal(planHash)} AND d.configuration_hash=${literal(configurationHash)}
    AND e.policy::jsonb->'ttlSeconds'='${FIRST_OPEN_TTL_SECONDS}'::jsonb
    AND d.artifact_ref=${literal(version.artifactRef)} AND EXISTS (${fixedRelease})${heldVersion}`;
  const args = [job, literal("first-onboarding:" + s.jobId), "(p->>0)", String(writeBefore), literal(s.deploymentId),
    "(p->1)", "(p->2)", "(p->3)", "(p->4)", literal(s.instanceId), "(p->>5)", literal(s.subscriptionId),
    literal("pending_" + s.instanceId), literal(s.environmentId), literal(s.account), "(p->>6)", "(p->>7)", literal(s.hostname.split(".")[0])];
  const cutoff = `t.now_ms>=${window.startAt} AND t.now_ms<${window.claimBefore}`;
  const sql = qualified(CLAIM_FIRST_ONBOARDING)
    .replace(" FOR UPDATE OF j,d,a,s,w,e", predicate + " FOR UPDATE OF j,d,a,s,w,e")
    .replace("(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms\n  FROM eligible", "floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now_ms\n  FROM eligible")
    .replace("AND t.now_ms<$4::bigint", `AND ${cutoff} AND t.now_ms<$4::bigint`)
    .replace(/\$(\d+)/g, (_, n: string) => args[Number(n) - 1]!);
  if (!sql.includes(`AND ${cutoff}`) || !sql.includes("floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now_ms\n  FROM eligible")) {
    throw Error("FIRST_OPEN_CLAIM_WINDOW_CONTRACT_DRIFT");
  }
  const operation = input.managementOperationSha256;
  // The isolated manager independently proves an active g1/e1 before SQL.
  // It neither receives the lease token nor uses the Neon claim/write login.
  const managementRead = operation === undefined ? "" : `
GRANT SELECT (generation,epoch,intent,state,operation_hash,created_by_job_id,created_by_attempt,owner_deployment_id)
  ON public.deployment_tenant_external_operations TO ${definer};
CREATE FUNCTION ${schema}.management_ready(p_sha text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog AS $management$
  WITH t AS (SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms)
  SELECT p_sha=${literal(approvalSha256)} AND EXISTS (
    SELECT 1 FROM public.deployment_jobs j
    JOIN public.app_instance_deployments d ON d.id=j.deployment_id
    JOIN public.deployment_tenant_external_operations x ON x.app_instance_id=d.app_instance_id
    CROSS JOIN t
    WHERE j.id=${job} AND d.id=${literal(s.deploymentId)} AND d.app_instance_id=${literal(s.instanceId)}
      AND d.subscription_id=${literal(s.subscriptionId)} AND d.environment_id=${literal(s.environmentId)}
      AND d.plan_hash=${literal(planHash)} AND d.configuration_hash=${literal(configurationHash)}
      ${input.taskRelease === undefined ? "" : `AND d.artifact_ref=${literal(version.artifactRef)}${heldVersion} AND EXISTS (${fixedRelease})`}
      AND j.status='running' AND j.job_type='apply' AND j.attempts=1 AND j.max_attempts=1
      AND j.lease_owner=${literal("first-onboarding:" + s.jobId)} AND j.lease_token IS NOT NULL
      AND t.ms>=${window.startAt} AND t.ms<${writeBefore} AND j.lease_expires_at>t.ms
      AND x.generation=1 AND x.epoch=1 AND x.intent='provision' AND x.state='active'
      AND x.operation_hash=${literal(operation)} AND x.created_by_job_id=${job}
      AND x.created_by_attempt=1 AND x.owner_deployment_id=d.id
  )
$management$;
ALTER FUNCTION ${schema}.management_ready(text) OWNER TO ${definer};
REVOKE ALL ON FUNCTION ${schema}.management_ready(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ${schema}.management_ready(text) TO ${reader};`;
  return `BEGIN;
DO $precondition$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('${definer}','${reader}','${writer}')
        AND rolcanlogin=(rolname<>'${definer}') AND NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))<>3
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
        WHERE r.rolname IN ('${definer}','${reader}','${writer}'))
  THEN RAISE EXCEPTION 'FIRST_OPEN_CLAIM_ROLE_PRECONDITION'; END IF;
END $precondition$;
CREATE SCHEMA ${schema} AUTHORIZATION ${definer};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${schema} TO ${reader},${writer};
GRANT USAGE ON SCHEMA public,deployment_release TO ${definer};
${Object.entries(projections).map(([table, cols]) => `GRANT SELECT (${cols}) ON public.${table} TO ${definer};`).join("\n")}
${lockTables.map(table => `GRANT UPDATE (id) ON public.${table} TO ${definer};`).join("\n")}
GRANT UPDATE (status,attempts,lease_owner,lease_token,lease_expires_at,updated_at) ON public.deployment_jobs TO ${definer};
GRANT SELECT (id,product_id,component,status,document) ON deployment_release.releases TO ${definer};
GRANT SELECT (instance_id) ON deployment_release.instance_state TO ${definer};
CREATE FUNCTION ${schema}.review() RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog AS $review$
  SELECT to_jsonb(held) FROM (${qualified(SELECT_FIRST_ONBOARDING).replace("$1", job)}${predicate}) held
$review$;
CREATE FUNCTION ${schema}.release() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $release$
  ${fixedRelease}
$release$;
CREATE FUNCTION ${schema}.claim(p_sha text,p jsonb) RETURNS TABLE ("jobId" text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog AS $claim$
BEGIN
  IF (p_sha=${literal(approvalSha256)} AND jsonb_typeof(p)='array' AND octet_length(p::text)<=131072) IS NOT TRUE
  THEN RETURN; END IF;
  IF (jsonb_array_length(p)=8 AND p->>0 ~ '^lease_[a-f0-9]{32}$' AND ${workspacePredicate("(p->>5)")}
    AND p#>>'{3,planHash}'=${literal(planHash)} AND p#>>'{3,configurationHash}'=${literal(configurationHash)}
    AND floor(extract(epoch FROM clock_timestamp())*1000) BETWEEN ${window.startAt} AND ${window.claimBefore - 1}) IS NOT TRUE
  THEN RETURN; END IF;
  RETURN QUERY ${sql};
END $claim$;
${[["review()", reader], ["release()", reader], ["claim(text,jsonb)", writer]].map(([sig, role]) =>
    `ALTER FUNCTION ${schema}.${sig} OWNER TO ${definer};\nREVOKE ALL ON FUNCTION ${schema}.${sig} FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION ${schema}.${sig} TO ${role};`).join("\n")}
${managementRead}
COMMIT;`;
}

interface SqlPort {
  query(sql: string, params: string[]): Promise<{ rows: unknown[] }>;
}

export function firstOpenManagementClaimProof(read: SqlPort, approvalSha256: string) {
  if (!hex.test(approvalSha256)) throw Error("FIRST_OPEN_MANAGEMENT_CLAIM_SCOPE");
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    const { rows } = await read.query(FIRST_OPEN_MANAGEMENT_CLAIM_READ, [approvalSha256]);
    signal.throwIfAborted();
    if (rows.length !== 1 || (rows[0] as { ready?: unknown })?.ready !== true) throw Error("FIRST_OPEN_MANAGEMENT_CLAIM_UNPROVED");
  };
}

/** Connection identities / effective grants are independently verified by
 * the approved operator. Driver retries must be disabled. No owner fallback. */
export function sandboxFirstOpenClaimPorts(read: SqlPort, write: SqlPort, approvalSha256: string):
  Pick<SandboxFirstOpenPorts, "readHeldJob" | "readFixedRelease" | "claimHeldJob"> {
  if (read === write || !hex.test(approvalSha256)) throw Error("FIRST_OPEN_CLAIM_PORT_SCOPE");
  let submitted = false;
  async function one<T>(sql: string): Promise<T | null> {
    const { rows } = await read.query(sql, []);
    if (rows.length !== 1) throw Error("FIRST_OPEN_CLAIM_READ_UNPROVED");
    return (rows[0] as { result: T | null }).result;
  }
  return {
    readHeldJob: () => one(`SELECT ${schema}.review() AS result`),
    readFixedRelease: () => one(`SELECT ${schema}.release() AS result`),
    async claimHeldJob(b) {
      if (submitted) throw Error("FIRST_OPEN_CLAIM_ALREADY_SUBMITTED");
      submitted = true;
      const { rows } = await write.query(`SELECT * FROM ${schema}.claim($1::text,$2::jsonb)`,
        [approvalSha256, JSON.stringify([b[2], ...b.slice(5, 9).map(v => JSON.parse(String(v))), b[10], b[15], b[16]])]);
      if (rows.length > 1 || (rows.length === 1 && (rows[0] as { jobId: string }).jobId !== s.jobId)) {
        throw Error("FIRST_OPEN_CLAIM_RESULT_UNPROVED");
      }
      return rows.length ? { jobId: s.jobId } : null;
    },
  };
}
