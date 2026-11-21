import { COMPLETE_FIRST_ONBOARDING, READ_FIRST_ONBOARDING_COMPLETION, type FirstOnboardingCompletionWriter } from "./first-onboarding-completion.ts";
import { firstOpenVersion, type FirstOpenTaskRelease } from "./first-onboarding-version.ts";
import { firstOpenSqlJson } from "./first-onboarding-sql-value.ts";

interface Scope {
  jobId: string; deploymentId: string; instanceId: string; approvalSha256: string; writeBefore: number;
  buyerOrigin?: string; taskRelease?: FirstOpenTaskRelease;
}
interface Roles { definer: string; writer: string; reader: string }
interface SqlPort { query(sql: string, bindings: string[]): Promise<{ rows: unknown[] }> }
const schema = "techlong_first_onboarding";
export const FIRST_ONBOARDING_COMPLETE_ENTRY = `SELECT * FROM ${schema}.complete($1::text,$2::text,$3::text)`;
export const FIRST_ONBOARDING_READ_ENTRY = `SELECT * FROM ${schema}.inspect($1::text)`;

function checkScope(s: Scope) {
  if (!/^job_[a-f0-9]{24}$/.test(s.jobId) || !/^dep_[a-f0-9]{24}$/.test(s.deploymentId) ||
    !/^app_[a-zA-Z0-9_-]{3,120}$/.test(s.instanceId) || !/^[a-f0-9]{64}$/.test(s.approvalSha256) ||
    !Number.isSafeInteger(s.writeBefore) || s.writeBefore <= 0) throw Error("FIRST_ONBOARDING_COMPLETION_INSTALL_SCOPE_INVALID");
  if (s.buyerOrigin !== undefined && (!/^app_[a-f0-9]{24}$/.test(s.instanceId) ||
    s.buyerOrigin !== `https://${s.instanceId.replace("_", "-")}.sandbox.techlong.cloud`)) {
    throw Error("FIRST_ONBOARDING_COMPLETION_BUYER_ORIGIN_INVALID");
  }
}

/** Pure DDL candidate for one approved job. Never installed by the worker.
 * Use new isolated principals, not the platform owner or D2 logins. */
export function firstOnboardingCompletionDdl(scope: Scope, roles: Roles) {
  checkScope(scope);
  if (new Set(Object.values(roles)).size !== 3 || Object.values(roles).some(r =>
    !/^first_onboarding_[a-z][a-z0-9_]{2,38}$/.test(r))) throw Error("FIRST_ONBOARDING_COMPLETION_INSTALL_ROLES_INVALID");
  const { definer, writer, reader } = roles;
  const known = rpcScopePredicates(scope);
  let complete = COMPLETE_FIRST_ONBOARDING.replace("  WHERE j.status='running'", `  WHERE ${known} AND j.status='running'`);
  let inspect = READ_FIRST_ONBOARDING_COMPLETION.replace("j.id=$1 AND d.id=$2 AND a.id=$3",
    `j.id='${scope.jobId}' AND d.id='${scope.deploymentId}' AND a.id='${scope.instanceId}'`)
    .replace("s.last_evidence->>'bindingSha256'=$4", `s.last_evidence->>'bindingSha256'=$1 AND s.last_evidence->>'approvalSha256'='${scope.approvalSha256}'`);
  if (complete === COMPLETE_FIRST_ONBOARDING || !complete.includes(known) ||
    inspect === READ_FIRST_ONBOARDING_COMPLETION || inspect.includes("$4")) throw Error("FIRST_ONBOARDING_COMPLETION_CONTRACT_DRIFT");
  if (scope.buyerOrigin !== undefined) {
    // The verifier receipt/D2 binding continues to name the API. Only this
    // job-scoped install publishes the separate, ID-derived customer entry.
    const accessWrite = "access_url='https://' || (e.req#>>'{receipt,hostname}')";
    const hostOutput = "'tenantHostname',e.req#>>'{receipt,hostname}'";
    const accessRead = "a.access_url='https://' || (d.outputs::jsonb->>'tenantHostname')";
    if (!complete.includes(accessWrite) || !complete.includes(hostOutput) || !inspect.includes(accessRead)) {
      throw Error("FIRST_ONBOARDING_COMPLETION_CONTRACT_DRIFT");
    }
    const origin = `'${scope.buyerOrigin}'`; // Exact instance/DNS shape enforced above.
    complete = complete.replace(accessWrite, `access_url=${origin}`)
      .replace(hostOutput, `${hostOutput},'buyerOrigin',${origin}`);
    inspect = inspect.replace(accessRead, `a.access_url=${origin} AND d.outputs::jsonb->>'buyerOrigin'=${origin}
    AND d.outputs::jsonb->>'tenantHostname'=a.slug || '.sandbox.techlong.cloud'`);
  }
  if (scope.taskRelease !== undefined) {
    const v = firstOpenVersion(scope.taskRelease);
    if (scope.taskRelease.firstOpenScope.jobId !== scope.jobId || scope.taskRelease.firstOpenScope.instanceId !== scope.instanceId ||
      scope.deploymentId !== "dep_746535593025bf97a9efeccd") throw Error("FIRST_ONBOARDING_COMPLETION_TASK_RELEASE_SCOPE");
    const releaseDoc = firstOpenSqlJson(scope.taskRelease);
    const catalog = `l.id='${v.releaseId}' AND l.status='candidate' AND l.product_id='${scope.taskRelease.productId}'
      AND l.component='tenant_api' AND l.document=${releaseDoc}`;
    const expectedBinding = `i.binding_text::jsonb#>>'{currentRelease,id}'='${v.releaseId}'
      AND i.binding_text::jsonb#>>'{currentRelease,manifestDigest}'='${v.imageDigest}'
      AND i.binding_text::jsonb#>>'{currentRelease,platformDigest}'='${scope.taskRelease.image.platformDigest}'`;
    const status = "l.status='ecr_verified'";
    const revision = "s.revision=0 AND s.active_request_id IS NULL";
    if (!complete.includes(status) || !inspect.includes(revision)) throw Error("FIRST_ONBOARDING_COMPLETION_CONTRACT_DRIFT");
    complete = complete.replace(status, `(${catalog}) AND (${expectedBinding}) AND d.artifact_ref='${v.artifactRef}'`);
    inspect = inspect.replace(revision, `${revision} AND s.current_release_id='${v.releaseId}' AND d.artifact_ref='${v.artifactRef}'
       AND j.payload::jsonb#>>'{scope,releaseId}'='${v.releaseId}' AND j.payload::jsonb#>>'{scope,artifactRef}'='${v.artifactRef}'
       AND EXISTS (SELECT 1 FROM deployment_release.releases l WHERE ${catalog})`);
  }
  // PostgreSQL row locks also require UPDATE privilege. For lock-only
  // relations that capability stays in the NOLOGIN definer, on one key column.
  const projections = {
    "public.deployment_jobs": "id,deployment_id,lease_expires_at,status,job_type,attempts,max_attempts,dedupe_key,available_at,lease_owner,lease_token,completed_at,payload",
    "public.app_instance_deployments": "id,app_instance_id,subscription_id,environment_id,status,current_step,ready_at,plan_hash,configuration_hash,desired_plan,mode,driver,workflow_version,cell_key,deployment_profile_key,artifact_ref,outputs",
    "public.app_instances": "id,slug,subscription_id,workspace_id,product_id,status,provisioning_source,provisioned_at,access_url,tenant_key,template_version_id,configuration_snapshot",
    "public.subscriptions": "id,workspace_id,product_id,status,plan_id,template_version_id,instance_configuration,deployment_profile_key,current_period_start,current_period_end",
    "public.workspaces": "id,status",
    "public.deployment_environments": "id,key,status,kind,apply_enabled,region,cell_key,expected_account_id",
    "public.deployment_tenant_resources": "app_instance_id,generation,external_operation_epoch,owner_deployment_id,lifecycle_status,ownership_marker,baseline_digest",
    "public.deployment_tenant_external_operations": "app_instance_id,generation,epoch,state,intent,owner_deployment_id,created_by_job_id,created_by_attempt,marker,operation_hash",
    "public.deployment_step_runs": "id,job_id,deployment_id,attempt,step_key,status,input_hash,output,finished_at",
    "deployment_release.releases": "id,product_id,component,status,document",
    "deployment_release.instance_state": "instance_id,revision,active_request_id,last_evidence" +
      (scope.taskRelease === undefined ? "" : ",current_release_id"),
  };
  const updates = {
    "public.deployment_jobs": "status,lease_owner,lease_token,lease_expires_at,completed_at,updated_at",
    "public.app_instance_deployments": "status,current_step,ready_at,updated_at,control_payload_hash,outputs",
    "public.app_instances": "status,access_url,provisioned_at,suspended_at,updated_at",
    "public.subscriptions": "id", "public.workspaces": "id", "public.deployment_environments": "id",
    "public.deployment_tenant_resources": "app_instance_id", "public.deployment_tenant_external_operations": "app_instance_id",
    "public.deployment_step_runs": "id", "deployment_release.releases": "id",
  };
  return `BEGIN;
DO $role$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('${definer}','${writer}','${reader}')
       AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
       AND rolcanlogin = (rolname <> '${definer}')) <> 3 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member
    WHERE r.rolname IN ('${definer}','${writer}','${reader}')
  ) THEN RAISE EXCEPTION 'FIRST_ONBOARDING_ROLE_PRECONDITION'; END IF;
END $role$;
CREATE SCHEMA ${schema} AUTHORIZATION ${definer};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${schema} TO ${writer},${reader};
GRANT USAGE ON SCHEMA public,deployment_release TO ${definer};
${Object.entries(projections).map(([table, cols]) => `GRANT SELECT (${cols}) ON ${table} TO ${definer};`).join("\n")}
${Object.entries(updates).map(([table, cols]) => `GRANT UPDATE (${cols}) ON ${table} TO ${definer};`).join("\n")}
GRANT INSERT (instance_id,component,binding,current_release_id,revision,active_request_id,last_evidence)
  ON deployment_release.instance_state TO ${definer};
CREATE FUNCTION ${schema}.complete(text,text,text) RETURNS TABLE ("instanceId" text, committed integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog AS $body$
${complete}
$body$;
ALTER FUNCTION ${schema}.complete(text,text,text) OWNER TO ${definer};
REVOKE ALL ON FUNCTION ${schema}.complete(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ${schema}.complete(text,text,text) TO ${writer};
CREATE FUNCTION ${schema}.inspect(text) RETURNS TABLE ("instanceId" text, revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog AS $body$
${inspect}
$body$;
ALTER FUNCTION ${schema}.inspect(text) OWNER TO ${definer};
REVOKE ALL ON FUNCTION ${schema}.inspect(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ${schema}.inspect(text) TO ${reader};
COMMIT;`;
}

function rpcScopePredicates(s: Scope) {
  return `j.id='${s.jobId}' AND d.id='${s.deploymentId}' AND a.id='${s.instanceId}'
    AND i.request#>>'{receipt,approvalSha256}'='${s.approvalSha256}' AND i.request->>'writeBefore'='${s.writeBefore}'`;
}

/** No arbitrary SQL, owner session or implicit retry. */
export function firstOnboardingCompletionWriter(client: SqlPort): FirstOnboardingCompletionWriter {
  let submitted = false;
  return async (sql, bindings) => {
    if (sql !== COMPLETE_FIRST_ONBOARDING || submitted) throw Error("FIRST_ONBOARDING_COMPLETION_SINGLE_SUBMISSION_REQUIRED");
    submitted = true;
    const result = await client.query(FIRST_ONBOARDING_COMPLETE_ENTRY, bindings);
    if (result.rows.length > 1) throw Error("FIRST_ONBOARDING_COMPLETION_UNCONFIRMED");
    return (result.rows[0] as Awaited<ReturnType<FirstOnboardingCompletionWriter>>) ?? null;
  };
}

export function readFirstOnboardingCompletion(client: SqlPort, bindingSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(bindingSha256)) throw Error("FIRST_ONBOARDING_BAD_BINDING_SHA");
  return client.query(FIRST_ONBOARDING_READ_ENTRY, [bindingSha256]);
}
