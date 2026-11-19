import { env } from "cloudflare:workers";
import { neon } from "@neondatabase/serverless";
import { getDatabase } from "@/db";
import { getPlan, ManagementError } from "@/lib/admin/management";
import { resolveTemplateConfiguration } from "@/lib/templates/validation";
import type { CustomerPurchaseInput } from "./validation";
import { readSandboxPurchaseConfiguration, sandboxCheckoutSessionIdFromUrl, SANDBOX_PURCHASE_PRODUCT } from "./sandbox-first-purchase-config";
import { authenticateSharedStripeWebhook, finishVerifiedSandboxFirstCheckout, sandboxPurchaseOrderId, SANDBOX_PURCHASE_SQL, startSandboxFirstCheckout,
  type SandboxPurchaseOrder } from "./sandbox-first-purchase";

const bindings = env as unknown as Record<string, unknown>;
export const sandboxFirstPurchaseSelected = () => bindings.TECHLONG_SANDBOX_FIRST_PURCHASE === "true";
export const sandboxFirstPurchaseConfig = () => readSandboxPurchaseConfiguration(bindings);

async function web<T>(statement: string, args: (string | number)[]): Promise<T | null> {
  const r = await getDatabase().prepare(statement).bind(...args).first<{ value: T | null }>();
  return r?.value ?? null;
}

export async function sandboxPurchaseCheckout(input: {
  workspaceId: string; actor: string; customerEmail: string; purchase: CustomerPurchaseInput;
}) {
  const config = sandboxFirstPurchaseConfig();
  if (!config || input.workspaceId !== config.workspaceId ||
      input.purchase.planId !== config.planId || input.purchase.renewalSubscriptionId) return null;
  const plan = await getPlan(config.planId);
  if (!plan || plan.productId !== SANDBOX_PURCHASE_PRODUCT || plan.deploymentProfileKey !== "standard-v1" ||
      plan.status !== "active" || plan.productStatus !== "active" ||
      plan.templateStatus !== "active" || plan.templateVersionStatus !== "published" ||
      !Number.isSafeInteger(plan.priceAmount) || plan.priceAmount <= 0) return null;
  const resolved = resolveTemplateConfiguration({
    schema: plan.templateConfigurationSchema,
    defaults: { ...plan.templateDefaultConfiguration, ...plan.templateConfiguration },
    planLimits: plan.limits,
    requested: input.purchase.instanceConfiguration,
  });
  if (!resolved.data) throw new ManagementError("INSTANCE_CONFIGURATION_INVALID",
    Object.values(resolved.errors)[0]?.[0] ?? "实例配置不符合套餐要求。", 400);
  return startSandboxFirstCheckout({
    scope: config, workspaceId: input.workspaceId, actor: input.actor, customerEmail: input.customerEmail,
    planId: plan.id, templateId: plan.templateVersionId, planName: `${plan.productName} · ${plan.name}`,
    planDescription: plan.description, configuration: resolved.data, amount: plan.priceAmount, currency: plan.currency,
    testKey: config.stripeKey, web,
  });
}

export async function readSandboxPurchaseOrder(workspaceId: string, actor: string, orderId?: string) {
  const config = sandboxFirstPurchaseConfig();
  if (!config || workspaceId !== config.workspaceId) return null;
  const id = await sandboxPurchaseOrderId(workspaceId);
  return orderId === undefined || orderId === id
    ? web<SandboxPurchaseOrder>(SANDBOX_PURCHASE_SQL.read, [actor, id]) : null;
}

export async function readSandboxPurchaseBillingOrder(workspaceId: string, actor: string) {
  const config = sandboxFirstPurchaseConfig();
  if (!config || workspaceId !== config.workspaceId) return null;
  const id = await sandboxPurchaseOrderId(workspaceId);
  const row = await web<SandboxPurchaseOrder & { checkoutUrl?: unknown }>(
    "SELECT sandbox_first_purchase.read_billing_order(?, ?) AS value", [actor, id],
  );
  if (row?.orderId !== id) return null;
  const url = row.checkoutUrl;
  return {
    amount: row.amount, currency: row.currency, status: row.status,
    checkoutUrl: row.status === "checkout_pending" && typeof url === "string" && sandboxCheckoutSessionIdFromUrl(url) ? url : null,
  };
}

export async function sandboxPurchaseWebhook(payload: string, signature: string | null, existingSecret: string | null) {
  const config = sandboxFirstPurchaseConfig();
  if (!config) return null;
  const delivery = await authenticateSharedStripeWebhook({
    workspaceId: config.workspaceId, payload, signature, sandboxSecret: config.signingSecret, existingSecret,
  });
  if (delivery.kind !== "first-purchase") return delivery;
  const sql = neon(config.webhookDatabase);
  const outcome = await finishVerifiedSandboxFirstCheckout({
    scope: config, payload, event: delivery.event,
    webhook: async <T,>(statement: string, args: (string | number)[]) => {
      const rows = await sql.query(statement, args);
      return (rows[0]?.value as T | undefined) ?? null;
    },
  });
  return { kind: "first-purchase", outcome } as const;
}
