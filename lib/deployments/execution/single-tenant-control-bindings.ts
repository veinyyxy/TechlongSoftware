import { neon } from "@neondatabase/serverless";
import type { AppInstanceTemplateBindingSource, ImmutableTemplateVersionSource } from "./control-payload.ts";
import { validateConfigurationSchema, validateResolvedTemplateConfiguration, type TemplateConfiguration } from "../../templates/validation.ts";
import type { TenantResourceFence } from "./contracts.ts";
import { validateAcceptanceCredentialBinding, assertAcceptanceResourceFence, type AcceptanceCredentialBinding } from "./single-tenant-private-sources.ts";
import { sha256Hex } from "./hash.ts";

export interface AcceptanceReadonlySql {
  query(text: string, values: unknown[], signal: AbortSignal): Promise<Record<string, unknown>[]>;
}
export interface FirstOwnerRuntimeSecretBinding {
  fence: TenantResourceFence; secretArn: string;
}
export interface FirstOwnerRuntimeBindingSource {
  load(input: { appInstanceId: string; templateVersionId: string; signal: AbortSignal }): Promise<FirstOwnerRuntimeSecretBinding>;
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function object(raw: unknown) { if (typeof raw !== "string") fail("ACCEPTANCE_CONTROL_BINDING_JSON_INVALID");
  try { const v = JSON.parse(raw); if (!v || typeof v !== "object" || Array.isArray(v)) fail("ACCEPTANCE_CONTROL_BINDING_JSON_INVALID"); return v as Record<string, unknown>; }
  catch { fail("ACCEPTANCE_CONTROL_BINDING_JSON_INVALID"); } }

/** Independent parameterized SELECTs, never a context snapshot re-labeled as
 * live proof. Only one approved app/template/configuration/scope is exposed.
 */
export async function createAcceptanceControlBindingSources(raw: AcceptanceCredentialBinding, sql: AcceptanceReadonlySql) {
  const b = await validateAcceptanceCredentialBinding(raw), s = b.scope;
  const exactApp = (id: string) => { if (id !== s.appInstanceId) fail("ACCEPTANCE_CONTROL_FOREIGN_APP_REJECTED"); };
  const bindings = Object.freeze<AppInstanceTemplateBindingSource>({ async loadForAppInstance(input) {
    input.signal.throwIfAborted(); exactApp(input.appInstanceId);
    const rows = await sql.query(`SELECT a.id,a.template_version_id,a.configuration_snapshot FROM public.app_instances a
      WHERE a.id=$1 AND a.workspace_id=$2 AND a.product_id=$3 AND a.template_version_id=$4`,
    [s.appInstanceId, b.workspaceId, b.productId, b.templateVersionId], input.signal);
    input.signal.throwIfAborted(); if (rows.length !== 1) fail("ACCEPTANCE_CONTROL_APP_BINDING_MISSING");
    const configuration = object(rows[0].configuration_snapshot);
    if (Object.values(configuration).some(v => v !== null && !["string", "number", "boolean"].includes(typeof v))) fail("ACCEPTANCE_CONTROL_CONFIGURATION_INVALID");
    if (await sha256Hex(configuration) !== s.configurationHash) fail("ACCEPTANCE_CONTROL_CONFIGURATION_DRIFT");
    return { appInstanceId: s.appInstanceId, templateVersionId: b.templateVersionId,
      resolvedConfiguration: configuration as TemplateConfiguration };
  } });
  const templateVersions = Object.freeze<ImmutableTemplateVersionSource>({ async loadById(input) {
    input.signal.throwIfAborted(); if (input.templateVersionId !== b.templateVersionId) fail("ACCEPTANCE_CONTROL_FOREIGN_TEMPLATE_REJECTED");
    const rows = await sql.query("SELECT id,status,configuration_schema FROM public.app_instance_template_versions WHERE id=$1", [b.templateVersionId], input.signal);
    input.signal.throwIfAborted(); if (rows.length !== 1 || !["published", "archived"].includes(String(rows[0].status))) fail("ACCEPTANCE_CONTROL_IMMUTABLE_TEMPLATE_REQUIRED");
    const schema = validateConfigurationSchema(object(rows[0].configuration_schema));
    if (!schema.data || schema.data.schemaVersion !== 2 || schema.data.contract !== "speedfeast-saas-control-v1") fail("ACCEPTANCE_CONTROL_SCHEMA_INVALID");
    // Validate the independent configuration against this actual published
    // schema, not merely against its hash.
    const app = await bindings.loadForAppInstance({ appInstanceId: s.appInstanceId, signal: input.signal });
    if (!app || !validateResolvedTemplateConfiguration({ schema: schema.data, configuration: app.resolvedConfiguration }).data) fail("ACCEPTANCE_CONTROL_RESOLVED_SCHEMA_INVALID");
    return { id: b.templateVersionId, status: rows[0].status as "published" | "archived", configurationSchema: schema.data };
  } });
  const runtimeBindings = Object.freeze<FirstOwnerRuntimeBindingSource>({ async load(input) {
    input.signal.throwIfAborted(); exactApp(input.appInstanceId);
    if (input.templateVersionId !== b.templateVersionId) fail("ACCEPTANCE_CONTROL_FOREIGN_TEMPLATE_REJECTED");
    const rows = await sql.query(`SELECT r.* FROM public.deployment_tenant_resources r
      JOIN public.app_instance_deployments d ON d.id=r.owner_deployment_id AND d.app_instance_id=r.app_instance_id
      JOIN public.app_instances a ON a.id=r.app_instance_id
      JOIN public.deployment_tenant_external_operations o ON o.app_instance_id=r.app_instance_id AND o.generation=r.generation AND o.epoch=r.external_operation_epoch
      WHERE d.id=$1 AND d.app_instance_id=$2 AND d.environment_id=$3 AND d.plan_hash=$4 AND d.configuration_hash=$5 AND d.artifact_ref=$6
        AND a.template_version_id=$7 AND r.created_by_deployment_id=$1 AND r.owner_deployment_id=$1
        AND r.lifecycle_status='verified' AND r.destroyed_at IS NULL AND r.runtime_secret_ref IS NOT NULL
        AND o.owner_deployment_id=$1 AND o.intent='provision' AND o.state='active'
        AND o.stable_identity_hash=r.stable_identity_hash
        AND o.marker='tl_epoch_' || substring(r.stable_identity_hash FROM 1 FOR 24) || '_g' || r.generation::text || '_e' || r.external_operation_epoch::text`,
    [s.deploymentId, s.appInstanceId, s.environmentId, s.planHash, s.configurationHash, s.artifactRef, b.templateVersionId], input.signal);
    input.signal.throwIfAborted(); if (rows.length !== 1) fail("ACCEPTANCE_FIRST_OWNER_VERIFIED_GENERATION_REQUIRED");
    const r = rows[0], fence: TenantResourceFence = { schemaVersion: 1, generation: Number(r.generation), ownerDeploymentId: String(r.owner_deployment_id), ownershipMarker: String(r.ownership_marker),
      identity: { schemaVersion: 1, appInstanceId: String(r.app_instance_id), workspaceId: String(r.workspace_id), productId: String(r.product_id),
        environmentId: String(r.environment_id), cellKey: String(r.cell_key), databaseName: String(r.database_name), roleName: String(r.role_name),
        secretName: String(r.secret_name), stableIdentityHash: String(r.stable_identity_hash) } };
    await assertAcceptanceResourceFence(b, fence);
    return { fence, secretArn: String(r.runtime_secret_ref) };
  } });
  return Object.freeze({ bindings, templateVersions, runtimeBindings });
}

/** Lazy HTTPS Neon adapter. Construction does not query the database. */
export function createAcceptanceReadonlyNeonSql(databaseUrl: string): AcceptanceReadonlySql {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech")) fail("ACCEPTANCE_CONTROL_NEON_SOURCE_REQUIRED");
  const sql = neon(databaseUrl, { fullResults: true });
  return Object.freeze<AcceptanceReadonlySql>({ async query(text, values, signal) { signal.throwIfAborted();
    try {
      const [result] = await sql.transaction([sql.query(text, values)], { readOnly: true, fullResults: true, fetchOptions: { signal } }); signal.throwIfAborted();
      return result.rows as Record<string, unknown>[];
    } catch { signal.throwIfAborted(); fail("ACCEPTANCE_CONTROL_SOURCE_READ_FAILED"); }
  } });
}
