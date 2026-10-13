import { createRequire } from "node:module";
import { BUSINESS_BOOTSTRAP_TARGET as t, type BusinessInventory, type BusinessSeed, type BusinessReview } from "../../../lib/deployments/execution/single-tenant-business-bootstrap.ts";
import { canonicalJson, sha256Hex } from "../../../lib/deployments/execution/hash.ts";
import { parseDeploymentEnvironmentPolicy, type DeploymentEnvironment } from "../../../lib/deployments/environment.ts";

// Use the already installed pg runtime, without adding a dependency or a
// global ambient declaration. This is the small API used by this script.
export interface BusinessPgClient {
  connect(): Promise<void>; end(): Promise<void>;
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}
const pg = createRequire(import.meta.url)("pg") as { Client: new (config: Record<string, unknown>) => BusinessPgClient };
type EnvironmentRow = Record<"id" | "key" | "name" | "expected_account_id" | "region" | "cell_key" | "base_domain" | "policy" | "admission_state", string> & {
  kind: DeploymentEnvironment["kind"]; driver: "aws_ecs_cell"; status: DeploymentEnvironment["status"]; apply_enabled: number;
  updated_at: string; admission_epoch: string; admission_stack_id: string | null;
};

const tables = ["workspaces", "workspace_members", "subscriptions", "app_instances", "workspace_product_entitlements", "deployment_environments"];
const json = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== "string") throw Error("BUSINESS_BOOTSTRAP_JSON_OBJECT_REQUIRED");
  const v = JSON.parse(raw); if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("BUSINESS_BOOTSTRAP_JSON_OBJECT_REQUIRED"); return v;
};
export async function createBusinessNeonClient() {
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(u.protocol) || !u.hostname.endsWith(".neon.tech") || !u.username || !u.password) throw Error("BUSINESS_BOOTSTRAP_NEON_TLS_SOURCE_REQUIRED");
  u.searchParams.set("sslmode", "verify-full");
  const client = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 12000, query_timeout: 15000, application_name: "techlong-d001-business-reviewed" });
  await client.connect(); return { client, hostSha256: await sha256Hex(`${u.hostname.toLowerCase()}:${u.port || "5432"}`) };
}
export async function lockBusinessSources(client: BusinessPgClient, ownerId: string) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
  // Locks only the fixed source rows, never all business tables or old rows.
  for (const [table, id] of [["users", ownerId], ["products", t.productId], ["plans", t.planId],
    ["app_instance_template_versions", t.templateVersionId]]) await client.query(`SELECT id FROM public.${table} WHERE id=$1 FOR SHARE`, [id]);
  await client.query("SELECT id FROM public.deployment_environments WHERE id=$1 FOR UPDATE", [t.environmentId]);
}
export async function readBusinessInventory(client: BusinessPgClient, hostSha256: string, seed: BusinessSeed, ownerEmail: string): Promise<BusinessInventory> {
  const db = await client.query<Record<string, string>>("SELECT current_database() AS name,current_user AS role,(SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS role_oid");
  const owner = await client.query<{ id: string; status: string; is_platform_admin: number }>("SELECT id,status,is_platform_admin FROM public.users WHERE id=$1 AND lower(email)=lower($2)", [seed.ownerId, ownerEmail]);
  const plan = await client.query<Record<string, string>>(`SELECT p.id,p.product_id,p.template_version_id,p.status,p.deployment_profile_key,p.limits,p.template_configuration,
    pr.status AS product_status,v.status AS template_status,v.configuration_schema,v.default_configuration,vt.status AS template_active
    FROM public.plans p JOIN public.products pr ON pr.id=p.product_id JOIN public.app_instance_template_versions v ON v.id=p.template_version_id
    JOIN public.app_instance_templates vt ON vt.id=v.template_id WHERE p.id=$1`, [t.planId]);
  const env = await client.query<EnvironmentRow>("SELECT * FROM public.deployment_environments WHERE id=$1", [t.environmentId]);
  if (db.rowCount !== 1 || owner.rowCount !== 1 || plan.rowCount !== 1 || env.rowCount !== 1) throw Error("BUSINESS_BOOTSTRAP_EXACT_SOURCE_ROWS_REQUIRED");
  const p = plan.rows[0], e = env.rows[0], o = owner.rows[0], policy = parseDeploymentEnvironmentPolicy(json(e.policy));
  if (!policy) throw Error("BUSINESS_BOOTSTRAP_ENVIRONMENT_POLICY_INVALID");
  const legacy = await client.query<{ deployment_sha: string; instance_sha: string; subscription_sha: string; certificate_sha: string; fence_sha: string; sealed: boolean; registration_matches: boolean }>(`SELECT
    encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') AS deployment_sha,
    encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') AS instance_sha,
    encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') AS subscription_sha,
    encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') AS certificate_sha,
    encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') AS fence_sha,f.sealed,
    (c.original_row_sha256=encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') AND
      c.business_state_sha256=encode(sha256(convert_to(jsonb_build_object('instanceId',a.id,'instanceStatus',a.status,
      'instanceUpdatedAt',a.updated_at,'subscriptionId',s.id,'subscriptionStatus',s.status)::text,'UTF8')),'hex')) AS registration_matches
    FROM public.app_instance_deployments d JOIN public.app_instances a ON a.id=d.app_instance_id JOIN public.subscriptions s ON s.id=d.subscription_id
    JOIN public.deployment_plan_only_isolations c ON c.deployment_id=d.id JOIN public.deployment_plan_only_isolation_fences f ON f.deployment_id=d.id
    WHERE d.id='dep_d00144511731f1c20991aa56'`);
  if (legacy.rowCount !== 1) throw Error("BUSINESS_BOOTSTRAP_OLD_ISOLATION_PROOF_REQUIRED");
  const collision = await client.query<{ n: number }>(`SELECT (
    (SELECT count(*) FROM public.workspaces WHERE id=$1)+
    (SELECT count(*) FROM public.workspace_members WHERE id=$2 OR workspace_id=$1)+
    (SELECT count(*) FROM public.subscriptions WHERE id=$3 OR workspace_id=$1)+
    (SELECT count(*) FROM public.app_instances WHERE id=$4 OR workspace_id=$1 OR slug=$6 OR tenant_key=$6)+
    (SELECT count(*) FROM public.workspace_product_entitlements WHERE id=$5 OR workspace_id=$1 OR app_instance_id=$4))::int AS n`,
  [seed.workspaceId, seed.memberId, seed.subscriptionId, seed.appInstanceId, seed.entitlementId, t.slug]);
  const privilege = await client.query<{ permissions: boolean[]; rls_disabled: boolean; protection_sha: string }>(`SELECT ARRAY[
    has_table_privilege(current_user,'public.workspaces','INSERT'),has_table_privilege(current_user,'public.workspace_members','INSERT'),
    has_table_privilege(current_user,'public.subscriptions','INSERT'),has_table_privilege(current_user,'public.app_instances','INSERT'),
    has_table_privilege(current_user,'public.workspace_product_entitlements','INSERT'),
    has_column_privilege(current_user,'public.deployment_environments','policy','UPDATE') AND
    has_column_privilege(current_user,'public.deployment_environments','updated_at','UPDATE')] AS permissions,
    (SELECT count(*)=6 AND bool_and(NOT c.relrowsecurity AND NOT c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])) AS rls_disabled,
    public.sealed_plan_protection_hash_v1() AS protection_sha`, [tables]);
  const l = legacy.rows[0];
  const schema = await client.query<{ hash: string }>(`SELECT encode(sha256(convert_to(jsonb_build_object(
    'columns',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.ordinal_position) FROM
      (SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default FROM information_schema.columns
        WHERE table_schema='public' AND table_name=ANY($1::text[])) x),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',g.tgname,'enabled',g.tgenabled,
      'definition',pg_get_triggerdef(g.oid),'function',pg_get_functiondef(g.tgfoid)) ORDER BY c.relname,g.tgname)
      FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT g.tgisinternal))::text,'UTF8')),'hex') AS hash`, [tables]);
  return { observedAt: Date.now(), database: { name: db.rows[0].name, role: db.rows[0].role, roleOid: db.rows[0].role_oid, hostSha256 },
    owner: { id: o.id, status: o.status, isPlatformAdmin: Number(o.is_platform_admin), exactEmailMatched: true },
    plan: { id: p.id, productId: p.product_id, productStatus: p.product_status, templateVersionId: p.template_version_id, templateStatus: p.template_status,
      templateActive: p.template_active, status: p.status, profile: p.deployment_profile_key, schema: json(p.configuration_schema),
      templateDefaults: json(p.default_configuration) as BusinessInventory["plan"]["templateDefaults"],
      planConfiguration: json(p.template_configuration) as BusinessInventory["plan"]["planConfiguration"], limits: json(p.limits) as Record<string, string> },
    environment: { id: e.id, key: e.key, name: e.name, kind: e.kind, driver: e.driver, expectedAccountId: e.expected_account_id,
      region: e.region, cellKey: e.cell_key, baseDomain: e.base_domain, status: e.status, applyEnabled: e.apply_enabled === 1, policy },
    environmentState: { policyBytes: e.policy, updatedAt: Number(e.updated_at), admissionState: e.admission_state, admissionEpoch: Number(e.admission_epoch), admissionStackId: e.admission_stack_id },
    legacy: { deploymentSha256: l.deployment_sha, instanceSha256: l.instance_sha, subscriptionSha256: l.subscription_sha,
      certificateSha256: l.certificate_sha, fenceSha256: l.fence_sha, originalRegistrationMatches: l.registration_matches, sealed: l.sealed },
    collisions: collision.rows[0].n, sourcePrivileges: privilege.rows[0].permissions, tablesRlsDisabled: privilege.rows[0].rls_disabled,
    protectionSchemaSha256: privilege.rows[0].protection_sha, businessSchemaSha256: schema.rows[0].hash };
}
export async function inspectBusinessBootstrap(client: BusinessPgClient, hostSha256: string, r: BusinessReview, ownerEmail: string) {
  const m = r.material, s = m.seed, after = await readBusinessInventory(client, hostSha256, s, ownerEmail);
  const rows = await Promise.all([["workspaces", s.workspaceId], ["workspace_members", s.memberId], ["subscriptions", s.subscriptionId],
    ["app_instances", s.appInstanceId], ["workspace_product_entitlements", s.entitlementId]].map(async ([table, id]) => {
    const result = await client.query(`SELECT * FROM public.${table} WHERE id=$1`, [id]); return result.rowCount === 1 ? result.rows[0] : null;
  }));
  const [w, member, sub, app, ent] = rows, count = await client.query<{ deployments: number; jobs: number }>(`SELECT
    (SELECT count(*) FROM public.app_instance_deployments WHERE app_instance_id=$1)::int AS deployments,
    (SELECT count(*) FROM public.deployment_jobs WHERE deployment_id=$2)::int AS jobs`, [s.appInstanceId, m.futureScope.deploymentId]);
  const checks = {
    databaseIdentity: canonicalJson(after.database) === canonicalJson(r.inventory.database),
    ownerAndPlanUnchanged: canonicalJson(after.owner) === canonicalJson(r.inventory.owner) && canonicalJson(after.plan) === canonicalJson(r.inventory.plan),
    fiveExactRows: rows.every(Boolean) && after.collisions === 5,
    workspace: !!w && w.owner_id === m.ownerId && w.plan_id === m.planId && w.status === "active" && w.subscription_status === "active" && w.app_instance_status === "pending" &&
      w.name === "Techlong Sandbox Acceptance" && w.contact_name === null && w.contact_email === null,
    member: !!member && member.workspace_id === s.workspaceId && member.user_id === m.ownerId && member.role === "owner",
    subscription: !!sub && sub.workspace_id === s.workspaceId && sub.product_id === m.productId && sub.plan_id === m.planId && sub.template_version_id === m.templateVersionId &&
      sub.status === "active" && sub.creation_source === "admin_manual" && sub.deployment_profile_key === "standard-v1" && sub.created_by_user_id === m.ownerId &&
      Number(sub.current_period_start) === m.createdAt && Number(sub.current_period_end) === m.periodEnd && sub.cancel_at_period_end === 0 &&
      canonicalJson(json(sub.instance_configuration)) === canonicalJson(m.configuration),
    app: !!app && app.workspace_id === s.workspaceId && app.product_id === m.productId && app.subscription_id === s.subscriptionId &&
      app.template_version_id === m.templateVersionId && app.slug === m.slug && app.tenant_key === m.slug && app.status === "pending" &&
      app.access_url === m.accessUrl && app.domain === `${m.slug}.sandbox.techlong.cloud` && app.provisioning_source === "manual" && app.created_by_user_id === m.ownerId &&
      app.name === "Techlong Sandbox" && app.seller_apk_url === "" && app.provisioned_at === null && app.suspended_at === null && canonicalJson(json(app.configuration_snapshot)) === canonicalJson(m.configuration),
    entitlement: !!ent && ent.workspace_id === s.workspaceId && ent.product_id === m.productId && ent.current_subscription_id === s.subscriptionId && ent.app_instance_id === s.appInstanceId && ent.status === "pending",
    createdTimestamps: rows.every((row, n) => !!row && Number(n === 1 ? row.joined_at : row.created_at) === m.createdAt && (n === 1 || Number(row.updated_at) === m.createdAt)),
    environmentOnlyBudgetChanged: canonicalJson({ ...after.environment, policy: r.inventory.environment.policy }) === canonicalJson(r.inventory.environment) &&
      canonicalJson(after.environment.policy) === canonicalJson(m.targetPolicy) && after.environmentState.policyBytes === m.targetPolicyBytes && after.environmentState.updatedAt === m.createdAt &&
      after.environmentState.admissionState === "open" && after.environmentState.admissionEpoch === 0 && after.environmentState.admissionStackId === null,
    isolationUnchanged: canonicalJson(after.legacy) === canonicalJson(r.inventory.legacy) && after.protectionSchemaSha256 === r.inventory.protectionSchemaSha256,
    businessSchemaUnchanged: after.businessSchemaSha256 === r.inventory.businessSchemaSha256,
    noDeploymentOrJob: count.rows[0].deployments === 0 && count.rows[0].jobs === 0,
  };
  return { observedAt: new Date().toISOString(), manifestSha256: r.manifestSha256, checks,
    outcome: Object.values(checks).every(Boolean) ? "BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL" : "BUSINESS_BOOTSTRAP_INSPECT_MISMATCH",
    databaseWrites: 0, runtimeEnabled: false, startsTtl: false };
}
