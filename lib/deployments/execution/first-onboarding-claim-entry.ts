import { CLAIM_FIRST_ONBOARDING, SELECT_FIRST_ONBOARDING } from "../first-onboarding.ts";
import { SANDBOX_FIRST_OPEN as s, type SandboxFirstOpenPorts } from "./first-onboarding-run-once.ts";

const schema = "techlong_first_onboarding_claim";
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
  deployment_environments: "id,expected_account_id,key,kind,status,apply_enabled,region,cell_key",
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
const fixedRelease = `SELECT l.document || jsonb_build_object('status',l.status)
  FROM deployment_release.releases l WHERE l.id=${literal(s.releaseId)} AND l.status='ecr_verified'
    AND l.product_id=${literal(s.productId)} AND l.component='tenant_api'
    AND l.document#>>'{image,repository}'=${literal(s.imageRepository)}
    AND l.document#>>'{image,manifestDigest}'=${literal(s.imageDigest)}
    AND l.document#>>'{image,platformDigest}'=${literal(s.imageDigest)}`;

/** Candidate SQL, never installed by this module. Claim and review logins
 * get only EXECUTE. Bind to the final review, not the historical draft. */
export function sandboxFirstOpenClaimDdl(input: { approvalSha256: string; planHash: string; configurationHash: string; writeBefore: number }) {
  const { approvalSha256, planHash, configurationHash, writeBefore } = input;
  if (![approvalSha256, planHash, configurationHash].every(v => hex.test(v)) ||
    !Number.isSafeInteger(writeBefore) || writeBefore <= 0) throw Error("FIRST_OPEN_CLAIM_DDL_SCOPE");
  const { definer, reader, writer } = FIRST_OPEN_CLAIM_ROLES;
  const predicate = staticPredicate + ` AND d.plan_hash=${literal(planHash)} AND d.configuration_hash=${literal(configurationHash)}
    AND d.artifact_ref=${literal(s.imageRepository + "@" + s.imageDigest)} AND EXISTS (${fixedRelease})`;
  const args = [job, literal("first-onboarding:" + s.jobId), "(p->>0)", String(writeBefore), literal(s.deploymentId),
    "(p->1)", "(p->2)", "(p->3)", "(p->4)", literal(s.instanceId), "(p->>5)", literal(s.subscriptionId),
    literal("pending_" + s.instanceId), literal(s.environmentId), literal(s.account), "(p->>6)", "(p->>7)", literal(s.hostname.split(".")[0])];
  const sql = qualified(CLAIM_FIRST_ONBOARDING)
    .replace(" FOR UPDATE OF j,d,a,s,w,e", predicate + " FOR UPDATE OF j,d,a,s,w,e")
    .replace(/\$(\d+)/g, (_, n: string) => args[Number(n) - 1]!);
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
    AND floor(extract(epoch FROM clock_timestamp())*1000) BETWEEN ${writeBefore - 3600000} AND ${writeBefore - 1}) IS NOT TRUE
  THEN RETURN; END IF;
  RETURN QUERY ${sql};
END $claim$;
${[["review()", reader], ["release()", reader], ["claim(text,jsonb)", writer]].map(([sig, role]) =>
    `ALTER FUNCTION ${schema}.${sig} OWNER TO ${definer};\nREVOKE ALL ON FUNCTION ${schema}.${sig} FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION ${schema}.${sig} TO ${role};`).join("\n")}
COMMIT;`;
}

interface SqlPort {
  query(sql: string, params: string[]): Promise<{ rows: unknown[] }>;
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
