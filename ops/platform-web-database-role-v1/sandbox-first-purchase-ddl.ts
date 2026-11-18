import { createHash } from "node:crypto";
import { FIRST_ONBOARDING_HOLD_AT, FIRST_ONBOARDING_PREFIX, INSERT_FIRST_ONBOARDING } from "../../lib/deployments/first-onboarding.ts";
import { SANDBOX_PURCHASE_ENVIRONMENT, SANDBOX_PURCHASE_PRODUCT, SANDBOX_PURCHASE_WEBHOOK_ROLE,
  validSandboxPurchaseScope, type SandboxPurchaseScope } from "../../lib/purchases/sandbox-first-purchase-config.ts";

const schema = "sandbox_first_purchase";
const owner = "techlong_sandbox_first_purchase_definer";
const web = "techlong_platform_web_acceptance_v1";
const webhook = SANDBOX_PURCHASE_WEBHOOK_ROLE;
const names = [
  "v_instance", "r.workspace_id", "v_subscription", "v_environment", "r.plan_id", "r.template_version_id",
  "v_tenant", "r.configuration_snapshot", "r.id", "v_deployment", "p_plan", "v_plan_hash", "v_config_hash",
  "v_image", "v_idempotency", "v_job", "v_dedupe", "v_payload", String(FIRST_ONBOARDING_HOLD_AT), "v_account",
];
const heldInsert = INSERT_FIRST_ONBOARDING
  .replace("FROM deployment_tenant_resources r WHERE r.app_instance_id", "FROM deployment_tenant_resources tr WHERE tr.app_instance_id")
  .replace("SELECT i.job_id,r.id", "SELECT i.job_id,registered.id")
  .replace("FROM registered r JOIN input i ON i.deployment_id=r.id", "FROM registered JOIN input i ON i.deployment_id=registered.id")
  .replace(/\$(\d+)/g, (_, n) => { if (!names[Number(n)-1]) throw Error("Unknown held input"); return names[Number(n)-1]; })
  .replace(/\b(JOIN|FROM|INTO) (app_instances|subscriptions|workspaces|deployment_environments|app_instance_deployments|deployment_tenant_resources|deployment_jobs)\b/g, "$1 public.$2");
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const stable = (prefix: string, value: string) => `${prefix}_${hash(`${prefix}:${value}`).slice(0, 24)}`;
const sqlHash = (expr: string) => `encode(sha256(convert_to(${expr}, 'UTF8')), 'hex')`;
const sqlStable = (prefix: string, expr: string) => `'${prefix}_' || left(${sqlHash(`'${prefix}:' || ${expr}`)}, 24)`;
const routineAcl = [
  ["reserve(text,text,text,text,text,text,text,int,text)", web], ["attach(text,text,text,text,bigint)", web], ["read_order(text,text)", web],
  ["webhook_order(text)", webhook], ["complete(text,text,text,text,text,int,text,text,text,text,text)", webhook],
] as const;
const roleOptions = "NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS";

// Offline candidate only. Platform and webhook LOGIN roles must already exist.
// The disposable test installs as its own superuser. A reviewed non-superuser
// installation must account for schema ownership and temporary SET separately.
function ddlParts(s: SandboxPurchaseScope) {
  if (!validSandboxPurchaseScope(s)) throw Error("Invalid sandbox first purchase scope");
  const order = stable("ord", "sandbox-first-purchase:v1:" + s.workspaceId);
  const payment = stable("pay", order);
  const matchedOwner = `EXISTS (
    SELECT 1 FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id
      JOIN public.users u ON u.id=m.user_id
    WHERE w.id='${s.workspaceId}' AND w.status='active' AND w.owner_id=p_actor
      AND m.user_id=p_actor AND m.role='owner' AND u.status='active' AND u.is_platform_admin=0)`;
  const unchangedScope = `r.id='${order}' AND r.workspace_id='${s.workspaceId}' AND r.plan_id='${s.planId}'
    AND r.product_id='${SANDBOX_PURCHASE_PRODUCT}' AND r.order_type='new_subscription'
    AND r.deployment_profile_key='standard-v1' AND r.provider='stripe' AND r.payment_record_id='${payment}'
    AND r.renewal_subscription_id IS NULL`;
  const fn = (declaration: string, body: string) => `CREATE FUNCTION ${schema}.${declaration}
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp
AS $purchase$${body}$purchase$;`;
  const guard = `-- Existing deployment/instance triggers use unqualified public tables.
DO $guard$ BEGIN
  IF has_schema_privilege('${web}', 'public', 'CREATE') OR has_schema_privilege('${webhook}', 'public', 'CREATE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
      LATERAL aclexplode(coalesce(n.nspacl, acldefault('n',n.nspowner))) a
      WHERE n.nspname='public' AND a.privilege_type='CREATE' AND a.grantee=0)
  THEN RAISE EXCEPTION 'Sandbox purchase requires protected public schema'; END IF;
END $guard$;`;
  const tableGrants = `GRANT USAGE ON SCHEMA public TO ${owner};
GRANT SELECT ON public.workspaces, public.workspace_members, public.users, public.products, public.plans,
  public.app_instance_template_versions, public.app_instance_templates, public.subscriptions, public.app_instances,
  public.payment_records, public.subscription_purchase_orders, public.deployment_environments,
  public.deployment_tenant_resources, public.app_instance_deployments,
  public.workspace_product_entitlements TO ${owner};
GRANT INSERT ON public.payment_records, public.subscription_purchase_orders, public.subscriptions, public.app_instances,
  public.workspace_product_entitlements, public.app_instance_deployments, public.deployment_jobs, public.payment_webhook_events TO ${owner};
GRANT SELECT (id) ON public.deployment_jobs TO ${owner};
GRANT UPDATE (provider_session_id, checkout_url, expires_at, subscription_id, provider_payment_id, completed_at, status, updated_at)
  ON public.subscription_purchase_orders TO ${owner};
GRANT UPDATE (reference, subscription_id, status, paid_at, provider_payment_id, provider_event_id, updated_at) ON public.payment_records TO ${owner};
GRANT UPDATE (plan_id, subscription_status, app_instance_status, updated_at) ON public.workspaces TO ${owner};
-- The reused registration CTE locks the two just-created rows.
GRANT UPDATE (updated_at) ON public.app_instances, public.subscriptions, public.deployment_environments TO ${owner};`;

  const functions = [fn("reserve(p_actor text, p_workspace text, p_requested_plan text, p_release text, p_image text, p_template text, p_configuration text, p_amount int, p_currency text) RETURNS jsonb", `
DECLARE r public.subscription_purchase_orders; p public.plans; now_ms bigint;
BEGIN
  IF p_workspace IS DISTINCT FROM '${s.workspaceId}' OR p_requested_plan IS DISTINCT FROM '${s.planId}'
     OR p_release IS DISTINCT FROM '${s.releaseId}' OR p_image IS DISTINCT FROM '${s.imageUri}'
     OR NOT ${matchedOwner} OR p_configuration IS NULL OR octet_length(p_configuration)>16384
     OR jsonb_typeof(p_configuration::jsonb) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('${order}', 0));
  SELECT * INTO r FROM public.subscription_purchase_orders WHERE id='${order}';
  IF FOUND THEN
    IF ${unchangedScope} AND r.created_by_user_id=p_actor AND r.configuration_snapshot=p_configuration
        AND r.template_version_id=p_template AND r.amount=p_amount AND r.currency=p_currency
        AND r.status='checkout_pending' AND r.expires_at>floor(extract(epoch FROM clock_timestamp())*1000) THEN
      RETURN jsonb_build_object('orderId',r.id,'checkoutUrl',r.checkout_url,'created',false);
    END IF;
    RETURN NULL; -- A draft, a paid order, or an ambiguous provider result never creates a second session.
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions WHERE workspace_id='${s.workspaceId}' AND product_id='${SANDBOX_PURCHASE_PRODUCT}')
    OR EXISTS (SELECT 1 FROM public.app_instances WHERE workspace_id='${s.workspaceId}' AND product_id='${SANDBOX_PURCHASE_PRODUCT}')
    OR EXISTS (SELECT 1 FROM public.workspace_product_entitlements WHERE workspace_id='${s.workspaceId}' AND product_id='${SANDBOX_PURCHASE_PRODUCT}')
    OR EXISTS (SELECT 1 FROM public.subscription_purchase_orders WHERE workspace_id='${s.workspaceId}' AND product_id='${SANDBOX_PURCHASE_PRODUCT}')
    OR NOT EXISTS (SELECT 1 FROM public.deployment_environments e WHERE e.id='${SANDBOX_PURCHASE_ENVIRONMENT}'
      AND e.key='aws-sandbox-ca-central-1' AND e.kind='aws_sandbox' AND e.status='active' AND e.apply_enabled=0
      AND e.region='ca-central-1' AND e.cell_key='cell-sandbox-1' AND e.expected_account_id='402010193138'
      AND e.admission_state='open')
  THEN RETURN NULL; END IF;
  SELECT q.* INTO p FROM public.plans q JOIN public.products prod ON prod.id=q.product_id
    JOIN public.app_instance_template_versions v ON v.id=q.template_version_id
    JOIN public.app_instance_templates t ON t.id=v.template_id AND t.product_id=prod.id
  WHERE q.id='${s.planId}' AND prod.id='${SANDBOX_PURCHASE_PRODUCT}' AND prod.status='active'
    AND q.status='active' AND t.status='active' AND v.status='published' AND v.id=p_template
    AND q.price_amount=p_amount AND q.price_amount>0 AND q.currency=p_currency
    AND q.billing_interval IN ('month','year') AND q.deployment_profile_key='standard-v1';
  IF NOT FOUND THEN RETURN NULL; END IF;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  INSERT INTO public.payment_records (id,workspace_id,amount,currency,status,payment_method,provider,recorded_by_user_id,created_at,updated_at)
    VALUES ('${payment}','${s.workspaceId}',p.price_amount,p.currency,'pending','Stripe Checkout (sandbox test)','stripe',p_actor,now_ms,now_ms);
  INSERT INTO public.subscription_purchase_orders (id,workspace_id,product_id,plan_id,template_version_id,payment_record_id,
    configuration_snapshot,amount,currency,billing_interval,deployment_profile_key,created_by_user_id,expires_at,created_at,updated_at)
    VALUES ('${order}','${s.workspaceId}',p.product_id,p.id,p.template_version_id,'${payment}',
      p_configuration,p.price_amount,p.currency,p.billing_interval,'standard-v1',p_actor,now_ms+600000,now_ms,now_ms);
  RETURN jsonb_build_object('orderId','${order}','created',true);
END;`),

fn("attach(p_actor text, p_order text, p_session text, p_url text, p_expiry bigint) RETURNS boolean", `
DECLARE r public.subscription_purchase_orders; now_ms bigint;
BEGIN
  IF NOT ${matchedOwner} OR p_order IS DISTINCT FROM '${order}'
    OR coalesce(p_session,'') !~ '^cs_test_[A-Za-z0-9]{1,200}$'
    OR split_part(coalesce(p_url,''),'#',1) <> 'https://checkout.stripe.com/c/pay/' || p_session
    OR octet_length(p_url)>8192 THEN RETURN false; END IF;
  SELECT * INTO r FROM public.subscription_purchase_orders WHERE id='${order}' FOR UPDATE;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR NOT (${unchangedScope}) OR r.created_by_user_id<>p_actor OR r.status<>'draft'
    OR p_expiry IS NULL OR p_expiry<=now_ms OR p_expiry>now_ms+86400000+60000 THEN RETURN false; END IF;
  UPDATE public.subscription_purchase_orders SET provider_session_id=p_session,checkout_url=p_url,
    expires_at=p_expiry,status='checkout_pending',updated_at=now_ms WHERE id=r.id;
  UPDATE public.payment_records SET reference=p_session,updated_at=now_ms WHERE id=r.payment_record_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sandbox purchase payment changed'; END IF;
  RETURN true;
END;`),

fn("read_order(p_actor text, p_order text) RETURNS jsonb", `
DECLARE r public.subscription_purchase_orders;
BEGIN
  IF NOT ${matchedOwner} OR p_order IS DISTINCT FROM '${order}' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.subscription_purchase_orders WHERE id='${order}';
  IF NOT FOUND OR NOT (${unchangedScope}) OR r.created_by_user_id<>p_actor THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('orderId',r.id,'status',r.status,'amount',r.amount,'currency',r.currency);
END;`),

fn("webhook_order(p_order text) RETURNS jsonb", `
DECLARE r public.subscription_purchase_orders;
BEGIN
  IF p_order IS DISTINCT FROM '${order}' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.subscription_purchase_orders WHERE id='${order}';
  IF NOT FOUND OR NOT (${unchangedScope}) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('configuration',r.configuration_snapshot,'templateId',r.template_version_id,
    'sessionId',r.provider_session_id,'status',r.status);
END;`),

fn("complete(p_event text, p_event_type text, p_order text, p_session text, p_intent text, p_amount int, p_currency text, p_payload_hash text, p_plan text, p_release text, p_image text) RETURNS text", `
DECLARE
  r public.subscription_purchase_orders; v_paid_ms bigint; period_end bigint;
  v_instance text := '${stable("app", order)}'; v_subscription text := '${stable("sub", order)}';
  v_environment text := '${SANDBOX_PURCHASE_ENVIRONMENT}'; v_account text := '402010193138';
  v_image text := '${s.imageUri}'; v_tenant text := 'pending_' || v_instance;
  v_dedupe text := '${FIRST_ONBOARDING_PREFIX}' || v_instance;
  v_idempotency text := ${sqlHash("v_dedupe")};
  v_job text := ${sqlStable("job", "v_dedupe")}; v_deployment text := ${sqlStable("dep", "v_idempotency")};
  v_config_hash text; v_plan_hash text; v_payload text; inserted text;
BEGIN
  IF p_order IS DISTINCT FROM '${order}' THEN RETURN 'ignored'; END IF;
  SELECT * INTO r FROM public.subscription_purchase_orders WHERE id='${order}' FOR UPDATE;
  IF NOT FOUND OR NOT (${unchangedScope}) THEN RETURN 'ignored'; END IF;
  IF p_release IS DISTINCT FROM '${s.releaseId}' OR p_image IS DISTINCT FROM v_image
    OR coalesce(p_event,'') !~ '^evt_[A-Za-z0-9]{1,200}$'
    OR coalesce(p_event_type,'') NOT IN ('checkout.session.completed','checkout.session.async_payment_succeeded')
    OR coalesce(p_session,'') !~ '^cs_test_[A-Za-z0-9]{1,200}$' OR r.provider_session_id IS DISTINCT FROM p_session
    OR coalesce(p_intent,'') !~ '^pi_[A-Za-z0-9]{1,200}$'
    OR coalesce(p_payload_hash,'') !~ '^[a-f0-9]{64}$'
    OR r.amount IS DISTINCT FROM p_amount OR lower(r.currency) IS DISTINCT FROM p_currency THEN
    RAISE EXCEPTION 'Sandbox purchase callback does not match order';
  END IF;
  IF r.status='paid' AND r.provider_payment_id=p_intent AND r.subscription_id=v_subscription THEN RETURN 'duplicate'; END IF;
  IF r.status<>'checkout_pending' OR p_plan IS NULL OR octet_length(p_plan)>32768
    OR NOT ${matchedOwner.replaceAll("p_actor", "r.created_by_user_id")}
    OR p_plan::jsonb #>> '{resources,tenant,costTags,WorkspaceId}' IS DISTINCT FROM r.workspace_id
    OR p_plan::jsonb #>> '{resources,tenant,costTags,AppInstanceId}' IS DISTINCT FROM v_instance
    OR p_plan::jsonb #>> '{resources,tenant,costTags,ProductId}' IS DISTINCT FROM r.product_id
    OR p_plan::jsonb #>> '{resources,tenant,costTags,PlanId}' IS DISTINCT FROM r.plan_id
    OR p_plan::jsonb ->> 'mode' IS DISTINCT FROM 'aws_sandbox'
    OR p_plan::jsonb ->> 'region' IS DISTINCT FROM 'ca-central-1'
    OR p_plan::jsonb ->> 'cellKey' IS DISTINCT FROM 'cell-sandbox-1'
    OR p_plan::jsonb ->> 'deploymentProfileKey' IS DISTINCT FROM 'standard-v1'
    OR (p_plan::jsonb #> '{safety,applyEnabled}') IS DISTINCT FROM 'false'::jsonb
    OR EXISTS (SELECT 1 FROM public.subscriptions WHERE workspace_id=r.workspace_id AND product_id=r.product_id)
    OR EXISTS (SELECT 1 FROM public.app_instances WHERE workspace_id=r.workspace_id AND product_id=r.product_id)
    OR EXISTS (SELECT 1 FROM public.workspace_product_entitlements WHERE workspace_id=r.workspace_id AND product_id=r.product_id)
  THEN RAISE EXCEPTION 'Sandbox purchase completion state changed'; END IF;
  v_paid_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  period_end := (extract(epoch FROM ((to_timestamp(v_paid_ms/1000.0) AT TIME ZONE 'UTC') +
      CASE r.billing_interval WHEN 'year' THEN interval '1 year' ELSE interval '1 month' END)) * 1000)::bigint;
  INSERT INTO public.subscriptions (id,workspace_id,product_id,plan_id,template_version_id,instance_configuration,status,
    current_period_start,current_period_end,creation_source,deployment_profile_key,created_by_user_id,created_at,updated_at)
    VALUES(v_subscription,r.workspace_id,r.product_id,r.plan_id,r.template_version_id,r.configuration_snapshot,'active',
      v_paid_ms,period_end,'customer_checkout','standard-v1',r.created_by_user_id,v_paid_ms,v_paid_ms);
  INSERT INTO public.app_instances (id,workspace_id,product_id,subscription_id,template_version_id,configuration_snapshot,
    name,slug,access_url,tenant_key,provisioning_source,status,created_by_user_id,created_at,updated_at)
    VALUES(v_instance,r.workspace_id,r.product_id,v_subscription,r.template_version_id,r.configuration_snapshot,
      'Sandbox 首开验收 - 餐饮订单系统','pending-'||replace(v_instance,'_','-'),'',v_tenant,'payment_success','pending',r.created_by_user_id,v_paid_ms,v_paid_ms);
  v_plan_hash := ${sqlHash("p_plan")}; v_config_hash := ${sqlHash("r.configuration_snapshot")};
  v_payload := jsonb_build_object('kind','sandbox_first_onboarding_v1','scope',jsonb_build_object(
    'appInstanceId',v_instance,'workspaceId',r.workspace_id,'subscriptionId',v_subscription,'environmentId',v_environment,
    'planId',r.plan_id,'templateVersionId',r.template_version_id,'tenantKey',v_tenant,'planHash',v_plan_hash,
    'configurationHash',v_config_hash,'releaseId','${s.releaseId}','artifactRef',v_image,'generation',1,
    'deploymentId',v_deployment,'productId',r.product_id,'accountId',v_account), 'reviewRequired',true,'cloudExecutionAuthorized',false)::text;
  ${heldInsert} INTO inserted;
  IF inserted IS DISTINCT FROM v_job THEN RAISE EXCEPTION 'Sandbox purchase did not register one held job'; END IF;
  INSERT INTO public.workspace_product_entitlements(id,workspace_id,product_id,current_subscription_id,app_instance_id,status,created_at,updated_at)
    VALUES('${stable("ent", order)}',r.workspace_id,r.product_id,v_subscription,v_instance,'pending',v_paid_ms,v_paid_ms);
  UPDATE public.workspaces SET plan_id=r.plan_id,subscription_status='active',app_instance_status='pending',updated_at=v_paid_ms
    WHERE id=r.workspace_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sandbox purchase workspace changed'; END IF;
  UPDATE public.payment_records SET subscription_id=v_subscription,status='paid',paid_at=v_paid_ms,provider_payment_id=p_intent,
    provider_event_id=p_event,reference=p_session,updated_at=v_paid_ms WHERE id=r.payment_record_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sandbox purchase payment changed'; END IF;
  UPDATE public.subscription_purchase_orders SET subscription_id=v_subscription,provider_payment_id=p_intent,status='paid',
    completed_at=v_paid_ms,updated_at=v_paid_ms WHERE id=r.id;
  INSERT INTO public.payment_webhook_events(id,provider,provider_event_id,event_type,purchase_order_id,payload_hash,processing_status,received_at,processed_at)
    VALUES(${sqlStable("evt","p_event")},'stripe',p_event,p_event_type,r.id,p_payload_hash,'processed',v_paid_ms,v_paid_ms);
  RETURN 'accepted';
END;`)];
  return { guard, tableGrants, functions };
}

function functionAcl(sig: string, role: string) {
  return `REVOKE ALL ON FUNCTION ${schema}.${sig} FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ${schema}.${sig} TO ${role};`;
}

// Preserve the old isolated superuser fixture; never use it as the live installer.
export function sandboxFirstPurchaseDdl(s: SandboxPurchaseScope): string {
  const { guard, tableGrants, functions } = ddlParts(s);
  return `BEGIN;
${guard}
CREATE ROLE ${owner} NOLOGIN ${roleOptions};
CREATE SCHEMA ${schema} AUTHORIZATION ${owner};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
${tableGrants}

${functions.join("\n\n")}

GRANT USAGE ON SCHEMA ${schema} TO ${web}, ${webhook};
${routineAcl.map(([sig, role]) => `ALTER FUNCTION ${schema}.${sig} OWNER TO ${owner};\n${functionAcl(sig, role)}`).join("\n")}
COMMIT;`;
}

// A pure PG18 transaction body. The caller must bind the installer identity,
// begin a transaction, verify the resulting ownership and ACL before committing,
// and perform independent readback. No COMMIT or I/O is performed here.
export function sandboxFirstPurchaseInstallStatements(s: SandboxPurchaseScope, generatedPassword: string): readonly string[] {
  if (!/^[A-Za-z0-9_-]{64}$/.test(generatedPassword)) throw Error("Invalid generated sandbox webhook password");
  const { guard, tableGrants, functions } = ddlParts(s);
  return [
    "SET LOCAL search_path=pg_catalog", "SET LOCAL createrole_self_grant=''", "SET LOCAL password_encryption='scram-sha-256'",
    `CREATE ROLE ${webhook} LOGIN ${roleOptions} PASSWORD '${generatedPassword}'`,
    guard, `CREATE ROLE ${owner} NOLOGIN ${roleOptions}`,
    `GRANT ${owner} TO SESSION_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER`,
    `CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`, tableGrants,
    `SET LOCAL ROLE ${owner}`, `REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`,
    ...functions, `GRANT USAGE ON SCHEMA ${schema} TO ${web}, ${webhook}`,
    ...routineAcl.map(([sig, role]) => functionAcl(sig, role)),
    "SET LOCAL ROLE NONE", `REVOKE ${owner} FROM SESSION_USER GRANTED BY CURRENT_USER RESTRICT`,
  ];
}
