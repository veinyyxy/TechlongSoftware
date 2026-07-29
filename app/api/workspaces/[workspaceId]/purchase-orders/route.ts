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
  if (!hasStripePaymentConfiguration()) {
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
