import { resolveTemplateConfiguration, validateConfigurationSchema, type TemplateConfiguration } from "../../templates/validation.ts";
import { AwsEcsCellPlanOnlyDriver } from "../drivers/aws-ecs-cell.ts";
import { validateDeploymentEnvironment, type DeploymentEnvironment } from "../environment.ts";
import { stableId } from "../../domain/ids.ts";
import { FIRST_ACCEPTANCE_APP_IMAGE, validateSingleDeploymentScope } from "./single-deployment-scope.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";

export const BUSINESS_BOOTSTRAP_TARGET = Object.freeze({
  planId: "pln_5303b097f504453caaca07715d1d7dbe",
  templateVersionId: "tplver_9c175436f0a14d9aa7f5fdfc2b5c139e", productId: "prd_restaurant_order_system",
  environmentId: "env_aws_sandbox_ca_central_1", slug: "first-acceptance",
  storeName: "Techlong Sandbox", firstOwnerUsername: "techlong_sandbox_admin",
});
export const BUSINESS_BOOTSTRAP_RISKS = Object.freeze([
  "Five new sandbox business rows include an active manually assigned subscription without creating payment/order records; no deployment/job/TTL is started.",
  "The new pending app and active subscription affect capacity/customer views and may block historical zero-tenant gates; they are not excluded by the old plan-only certificate.",
  "One shared sandbox environment policy changes only budgetLimitCents from 1000 to 5000; this is not an AWS billing hard cap and may affect future sandbox planning.",
  "Serializable transaction and source row locks can temporarily block concurrent business changes; uniqueness/trigger/serialization failures abort without application retry.",
  "Database provider/server logs may record non-secret business configuration; no password, Stripe/JWT/private key or Secret value is persisted in these rows or review.",
  "A lost COMMIT response is uncertain, not proof of rollback; inspect independently and never replay, down, delete, compensate or reset the permanent attempt slot automatically.",
  "Pending access URL and planned scope are not live endpoints or deployment/activation approval; old isolated customer records, protections and references remain untouched.",
]);
export interface BusinessSeed { ownerId: string; workspaceId: string; memberId: string; subscriptionId: string; appInstanceId: string; entitlementId: string }
export interface BusinessInventory {
  observedAt: number;
  database: { name: string; role: string; roleOid: string; hostSha256: string };
  owner: { id: string; status: string; isPlatformAdmin: number; exactEmailMatched: boolean };
  plan: { id: string; productId: string; productStatus: string; templateVersionId: string; templateStatus: string; templateActive: string;
    status: string; profile: string; schema: unknown; templateDefaults: TemplateConfiguration; planConfiguration: TemplateConfiguration; limits: Record<string, string> };
  environment: DeploymentEnvironment;
  environmentState: { policyBytes: string; updatedAt: number; admissionState: string; admissionEpoch: number; admissionStackId: string | null };
  legacy: { deploymentSha256: string; instanceSha256: string; subscriptionSha256: string; certificateSha256: string; fenceSha256: string;
    originalRegistrationMatches: boolean; sealed: boolean };
  collisions: number;
  sourcePrivileges: boolean[];
  tablesRlsDisabled: boolean;
  protectionSchemaSha256: string;
  businessSchemaSha256: string;
}
function fail(code: string): never { throw Object.assign(Error(code), { code, retryable: false }); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fresh(i: BusinessInventory, now: number) {
  if (!i || !Number.isSafeInteger(i.observedAt) || i.observedAt > now || now - i.observedAt > 30000 || i.collisions !== 0 ||
    !i.tablesRlsDisabled || i.sourcePrivileges.length !== 6 || i.sourcePrivileges.some(v => v !== true) ||
    !i.legacy.sealed || !i.legacy.originalRegistrationMatches ||
    Object.entries(i.legacy).some(([key, v]) => key.endsWith("Sha256") && !/^[a-f0-9]{64}$/.test(String(v))) ||
    !/^[a-f0-9]{64}$/.test(i.protectionSchemaSha256) || !/^[a-f0-9]{64}$/.test(i.businessSchemaSha256) || !/^[a-f0-9]{64}$/.test(i.database.hostSha256) ||
    !/^\d+$/.test(i.database.roleOid) || !i.database.name || !i.database.role) fail("BUSINESS_BOOTSTRAP_FRESH_SOURCE_REQUIRED");
}
export async function prepareBusinessBootstrap(input: { inventory: BusinessInventory; seed: BusinessSeed; codeBindingSha256: string }, now = Date.now()) {
  const i = structuredClone(input.inventory), seed = structuredClone(input.seed), t = BUSINESS_BOOTSTRAP_TARGET;
  fresh(i, now);
  if (!/^[a-f0-9]{64}$/.test(input.codeBindingSha256) || Object.keys(seed).sort().join(",") !== "appInstanceId,entitlementId,memberId,ownerId,subscriptionId,workspaceId" ||
    Object.entries({ workspaceId: "ws", memberId: "wsm", subscriptionId: "sub", appInstanceId: "app", entitlementId: "ent" }).some(([key, prefix]) =>
      !new RegExp(`^${prefix}_[a-f0-9]{32}$`).test(seed[key as keyof BusinessSeed])) ||
    !/^usr_[a-f0-9]{24,32}$/.test(seed.ownerId) || i.owner.id !== seed.ownerId || i.owner.status !== "active" || i.owner.isPlatformAdmin !== 1 || !i.owner.exactEmailMatched ||
    i.plan.id !== t.planId || i.plan.productId !== t.productId || i.plan.productStatus !== "active" || i.plan.templateVersionId !== t.templateVersionId ||
    i.plan.status !== "active" || i.plan.templateStatus !== "published" || i.plan.templateActive !== "active" || i.plan.profile !== "standard-v1" ||
    i.environment.id !== t.environmentId || i.environment.key !== "aws-sandbox-ca-central-1" || i.environment.kind !== "aws_sandbox" ||
    i.environment.status !== "active" || i.environment.applyEnabled !== false || validateDeploymentEnvironment(i.environment).length ||
    i.environment.expectedAccountId !== "402010193138" || i.environment.region !== "ca-central-1" || i.environment.cellKey !== "cell-sandbox-1" ||
    i.environment.baseDomain !== "sandbox.techlong.cloud" || i.environment.policy.budgetLimitCents !== 1000 ||
    canonicalJson(JSON.parse(i.environmentState.policyBytes)) !== canonicalJson(i.environment.policy) ||
    i.environmentState.admissionState !== "open" || i.environmentState.admissionEpoch !== 0 || i.environmentState.admissionStackId !== null) fail("BUSINESS_BOOTSTRAP_SCOPE_INVALID");
  const schema = validateConfigurationSchema(i.plan.schema);
  if (!schema.data || schema.data.schemaVersion !== 2 || schema.data.contract !== "speedfeast-saas-control-v1" ||
    schema.data.fields.some(f => /password|secret|token|privatekey|credential/i.test(f.key) || (f.outputPath && /password|secret|token|privatekey|credential/i.test(f.outputPath)))) fail("BUSINESS_BOOTSTRAP_SCHEMA_INVALID");
  const allowedKeys = new Set(schema.data.fields.map(f => f.key));
  for (const defaults of [i.plan.templateDefaults, i.plan.planConfiguration]) {
    if (Object.entries(defaults).some(([key, value]) => !allowedKeys.has(key) || /__proto__|constructor|prototype/i.test(key) ||
      (typeof value === "string" && /-----BEGIN .*PRIVATE KEY|\bBearer\s|postgres(?:ql)?:\/\/|\b(?:sk|rk)_(?:test|live)_|\bwhsec_/i.test(value)))) fail("BUSINESS_BOOTSTRAP_SECRET_OR_UNKNOWN_DEFAULT_REJECTED");
  }
  const configuration = resolveTemplateConfiguration({ schema: schema.data, defaults: { ...i.plan.templateDefaults, ...i.plan.planConfiguration },
    planLimits: i.plan.limits, requested: { defaultStoreName: t.storeName, firstOwnerUsername: t.firstOwnerUsername } });
  if (!configuration.data) fail("BUSINESS_BOOTSTRAP_CONFIGURATION_INVALID");
  const plan = new AwsEcsCellPlanOnlyDriver({ mode: "aws_sandbox", region: i.environment.region, cellKey: i.environment.cellKey }).buildPlan({
    ...seed, productId: t.productId, planId: t.planId, tenantKey: t.slug, deploymentProfileKey: "standard-v1" });
  const planHash = await sha256Hex(plan), configurationHash = await sha256Hex(configuration.data);
  // Same stable deployment formula as management.ts; no deployment/outbox is
  // inserted now. createdAt and TTL begin only in a later reviewed enqueue.
  const idempotencyKey = await sha256Hex({ appInstanceId: seed.appInstanceId, subscriptionId: seed.subscriptionId, templateVersionId: t.templateVersionId,
    driver: "aws_ecs_cell", workflowVersion: "v1", deploymentProfileKey: "standard-v1", environmentId: t.environmentId,
    configurationHash, artifactRef: FIRST_ACCEPTANCE_APP_IMAGE, planHash });
  const futureScope = validateSingleDeploymentScope({ deploymentId: await stableId("dep", idempotencyKey), appInstanceId: seed.appInstanceId,
    environmentId: t.environmentId, planHash, configurationHash, artifactRef: FIRST_ACCEPTANCE_APP_IMAGE });
  const targetPolicy = { ...i.environment.policy, budgetLimitCents: 5000 };
  const material = { seed, configuration: configuration.data, configurationHash, plan, planHash, idempotencyKey, futureScope,
    targetPolicy, targetPolicyBytes: canonicalJson(targetPolicy), createdAt: now, periodEnd: now + 31 * 86400000,
    ownerId: seed.ownerId, templateVersionId: t.templateVersionId, productId: t.productId, planId: t.planId,
    slug: t.slug, accessUrl: `https://${t.slug}.sandbox.techlong.cloud` };
  const body = { schemaVersion: 1 as const, protocol: "single-tenant-business-bootstrap" as const, reviewedAt: now, expiresAt: now + 3600000,
    codeBindingSha256: input.codeBindingSha256, inventory: i, material,
    scope: { insertedBusinessRows: 5, environmentPolicyUpdates: 1, deploymentRows: 0, jobs: 0, runtimeEnabled: false, startsTtl: false,
      writesPasswords: false, cloudWrites: 0, updatesExistingBusinessRows: false, modifiesOldIsolation: false }, risks: BUSINESS_BOOTSTRAP_RISKS };
  return freeze({ ...body, manifestSha256: await sha256Hex(body) });
}
export type BusinessReview = Awaited<ReturnType<typeof prepareBusinessBootstrap>>;
export async function decodeBusinessBootstrap(raw: unknown): Promise<BusinessReview> {
  const r = raw as BusinessReview;
  if (!r || r.schemaVersion !== 1 || r.protocol !== "single-tenant-business-bootstrap") fail("BUSINESS_BOOTSTRAP_MANIFEST_INVALID");
  const expected = await prepareBusinessBootstrap({ inventory: r.inventory, seed: r.material.seed, codeBindingSha256: r.codeBindingSha256 }, r.reviewedAt);
  if (canonicalJson(expected) !== canonicalJson(r)) fail("BUSINESS_BOOTSTRAP_MANIFEST_SCOPE_OR_HASH_INVALID");
  return expected;
}
export function businessBootstrapStatements(review: BusinessReview) {
  const m = review.material, s = m.seed, config = canonicalJson(m.configuration), at = m.createdAt;
  return [
    { name: "workspace", text: `INSERT INTO public.workspaces (id,name,owner_id,status,plan_id,subscription_status,app_instance_status,created_at,updated_at)
      VALUES ($1,'Techlong Sandbox Acceptance',$2,'active',$3,'active','pending',$4,$4)`, values: [s.workspaceId, m.ownerId, m.planId, at] },
    { name: "membership", text: `INSERT INTO public.workspace_members (id,workspace_id,user_id,role,joined_at) VALUES ($1,$2,$3,'owner',$4)`,
      values: [s.memberId, s.workspaceId, m.ownerId, at] },
    { name: "subscription", text: `INSERT INTO public.subscriptions (id,workspace_id,product_id,plan_id,template_version_id,instance_configuration,status,
      current_period_start,current_period_end,cancel_at_period_end,creation_source,deployment_profile_key,created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,0,'admin_manual','standard-v1',$9,$7,$7)`,
      values: [s.subscriptionId, s.workspaceId, m.productId, m.planId, m.templateVersionId, config, at, m.periodEnd, m.ownerId] },
    { name: "app_instance", text: `INSERT INTO public.app_instances (id,workspace_id,product_id,subscription_id,template_version_id,configuration_snapshot,name,
      slug,domain,access_url,seller_apk_url,tenant_key,provisioning_source,status,created_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'Techlong Sandbox',$7,$8,$9,'',$7,'manual','pending',$10,$11,$11)`,
      values: [s.appInstanceId, s.workspaceId, m.productId, s.subscriptionId, m.templateVersionId, config, m.slug, `${m.slug}.sandbox.techlong.cloud`, m.accessUrl, m.ownerId, at] },
    { name: "entitlement", text: `INSERT INTO public.workspace_product_entitlements (id,workspace_id,product_id,current_subscription_id,app_instance_id,status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,'pending',$6,$6)`, values: [s.entitlementId, s.workspaceId, m.productId, s.subscriptionId, s.appInstanceId, at] },
    { name: "sandbox_policy", text: `UPDATE public.deployment_environments SET policy=$1,updated_at=$2 WHERE id=$3 AND policy=$4 AND updated_at=$5
      AND apply_enabled=0 AND admission_state='open' AND admission_epoch=0 AND admission_stack_id IS NULL`,
      values: [m.targetPolicyBytes, at, BUSINESS_BOOTSTRAP_TARGET.environmentId, review.inventory.environmentState.policyBytes, review.inventory.environmentState.updatedAt] },
  ];
}
export interface BusinessBootstrapPort {
  beginAndLock(): Promise<void>;
  inventory(seed: BusinessSeed): Promise<BusinessInventory>;
  execute(statement: ReturnType<typeof businessBootstrapStatements>[number]): Promise<number>;
  verify(review: BusinessReview): Promise<boolean>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
/** Six DML statements in one transaction. COMMIT uncertainty is never converted
 * into safe-to-retry. No queue/TTL/activation or old business mutation path. */
export async function runBusinessBootstrap(input: { review: BusinessReview; approvedSha256: string; currentCodeBindingSha256: string;
  port: BusinessBootstrapPort; consumeSlot(): Promise<void>; signal: AbortSignal; now?: () => number }) {
  const r = await decodeBusinessBootstrap(input.review), now = input.now ?? Date.now;
  const approve = () => { input.signal.throwIfAborted(); if (input.approvedSha256 !== r.manifestSha256 || input.currentCodeBindingSha256 !== r.codeBindingSha256 ||
    now() < r.reviewedAt || now() >= r.expiresAt) fail("BUSINESS_BOOTSTRAP_FRESH_EXACT_APPROVAL_REQUIRED"); };
  approve(); let transaction = false, slotConsumed = false, dmlInvocations = 0, commitEntered = false;
  try {
    transaction = true; await input.port.beginAndLock(); approve();
    const current = await input.port.inventory(r.material.seed); fresh(current, now()); approve();
    if (canonicalJson({ ...current, observedAt: 0 }) !== canonicalJson({ ...r.inventory, observedAt: 0 })) fail("BUSINESS_BOOTSTRAP_SOURCE_DRIFT_NO_DML");
    await input.consumeSlot(); slotConsumed = true;
    for (const statement of businessBootstrapStatements(r)) { approve(); dmlInvocations++; if (await input.port.execute(statement) !== 1) fail("BUSINESS_BOOTSTRAP_EXACT_ONE_ROW_REQUIRED"); }
    if (!await input.port.verify(r)) fail("BUSINESS_BOOTSTRAP_POSTCONDITION_MISMATCH_ABORT");
    approve(); commitEntered = true; await input.port.commit(); transaction = false;
    return { outcome: "BUSINESS_COMMITTED_REQUIRES_INDEPENDENT_INSPECT", dmlInvocations, commitEntered, slotConsumed, runtimeEnabled: false, startsTtl: false };
  } catch (e) {
    // Before COMMIT this only aborts the uncommitted transaction. Never issue a
    // compensating/down/delete statement, especially after uncertain COMMIT.
    let rollbackConfirmed = false;
    if (transaction && !commitEntered) { try { await input.port.rollback(); rollbackConfirmed = true; } catch { /* independent inspect required */ } }
    const raw = e && typeof e === "object" && "code" in e ? String(e.code) : e instanceof Error ? e.name : "ProviderError";
    return { outcome: commitEntered ? "COMMIT_UNCERTAIN_INSPECT_NO_RETRY" : "STOPPED_INSPECT_NO_RETRY", failureCode: raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100),
      dmlInvocations, commitEntered, slotConsumed, rollbackConfirmed, runtimeEnabled: false, startsTtl: false };
  }
}
