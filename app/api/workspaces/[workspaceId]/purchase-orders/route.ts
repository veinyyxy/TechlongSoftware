import { apiError, apiSuccess } from "@/lib/api/response";
import {
  managementErrorResponse,
  readJsonBody,
} from "@/lib/admin/http";
import { ManagementError } from "@/lib/admin/management";
import { getApiAccount } from "@/lib/auth/account";
import {
  createCustomerPurchaseCheckout,
  listPurchaseOrders,
} from "@/lib/purchases/management";
import { validateCustomerPurchaseInput } from "@/lib/purchases/validation";
import { readSandboxPurchaseOrder, sandboxFirstPurchaseConfig, sandboxFirstPurchaseSelected,
  sandboxPurchaseCheckout } from "@/lib/purchases/sandbox-first-purchase-runtime";
import { SANDBOX_PURCHASE_ORIGIN } from "@/lib/purchases/sandbox-first-purchase-config";
import {
  hasStripePaymentConfiguration,
  StripeGatewayError,
} from "@/lib/payments/stripe";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后查看购买订单。"),
      { status: 401 },
    );
  }
  const { workspaceId } = await context.params;
  if (account.workspace.id !== workspaceId) {
    return Response.json(
      apiError("WORKSPACE_FORBIDDEN", "不能查看其他工作区的购买订单。"),
      { status: 403 },
    );
  }
  if (sandboxFirstPurchaseSelected()) {
    const order = await readSandboxPurchaseOrder(workspaceId, account.user.id);
    return Response.json(apiSuccess(order ? [order] : []), { headers: { "cache-control": "no-store" } });
  }
  return Response.json(
    apiSuccess(await listPurchaseOrders({ workspaceId })),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后购买套餐。"),
      { status: 401 },
    );
  }
  const { workspaceId } = await context.params;
  if (
    account.workspace.id !== workspaceId ||
    account.membership.role !== "owner"
  ) {
    return Response.json(
      apiError(
        "WORKSPACE_BILLING_FORBIDDEN",
        "只有当前工作区 Owner 可以购买或续费套餐。",
      ),
      { status: 403 },
    );
  }
  const sandbox = sandboxFirstPurchaseSelected();
  if (sandbox && (sandboxFirstPurchaseConfig()?.workspaceId !== workspaceId ||
      new URL(request.url).origin !== SANDBOX_PURCHASE_ORIGIN)) {
    return Response.json(apiError("SANDBOX_PURCHASE_SCOPE", "不在本次 Sandbox 测试购买范围内。"), { status: 403 });
  }
  if (!sandbox && !hasStripePaymentConfiguration()) {
    return Response.json(
      apiError(
        "STRIPE_NOT_CONFIGURED",
        "在线支付尚未配置，请联系平台管理员。",
      ),
      { status: 503 },
    );
  }

  try {
    const result = validateCustomerPurchaseInput(
      await readJsonBody(request),
    );
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查套餐和实例配置。", result.errors),
        { status: 400 },
      );
    }
    if (sandbox) {
      const checkout = await sandboxPurchaseCheckout({
        workspaceId, actor: account.user.id, customerEmail: account.user.email, purchase: result.data,
      });
      return checkout
        ? Response.json(apiSuccess(checkout), { status: checkout.reused ? 200 : 201, headers: { "cache-control": "no-store" } })
        : Response.json(apiError("SANDBOX_PURCHASE_UNAVAILABLE", "本次 Sandbox 购买不可开始，请先核对原订单。"), { status: 409 });
    }
    const checkout = await createCustomerPurchaseCheckout({
      workspaceId,
      initiatedByUserId: account.user.id,
      customerEmail: account.user.email,
      origin: checkoutOrigin(request.url),
      purchase: result.data,
    });
    return Response.json(
      apiSuccess({
        purchaseOrderId: checkout.order.id,
        checkoutUrl: checkout.checkoutUrl,
        reused: checkout.reused,
      }),
      {
        status: checkout.reused ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof StripeGatewayError) {
      return Response.json(apiError(error.code, error.message), {
        status: error.status,
      });
    }
    return managementErrorResponse(error);
  }
}

function checkoutOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  const local =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new ManagementError(
      "INVALID_CHECKOUT_ORIGIN",
      "在线付款必须通过 HTTPS 发起。",
      400,
    );
  }
  return url.origin;
}
