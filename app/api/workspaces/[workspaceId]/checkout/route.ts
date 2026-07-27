import { apiError, apiSuccess } from "@/lib/api/response";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { getApiAccount } from "@/lib/auth/account";
import { ManagementError } from "@/lib/admin/management";
import { createPaymentCheckout } from "@/lib/payments/management";
import { hasStripePaymentConfiguration, StripeGatewayError } from "@/lib/payments/stripe";
import { validateCheckoutInput } from "@/lib/payments/validation";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(apiError("UNAUTHORIZED", "请先登录后再发起在线付款。"), { status: 401 });
  }

  const { workspaceId } = await context.params;
  if (
    account.workspace.id !== workspaceId ||
    account.membership.role !== "owner"
  ) {
    return Response.json(
      apiError("WORKSPACE_BILLING_FORBIDDEN", "只有当前工作区 Owner 可以发起在线付款。"),
      { status: 403 },
    );
  }
  if (!hasStripePaymentConfiguration()) {
    return Response.json(
      apiError("STRIPE_NOT_CONFIGURED", "在线支付尚未配置，请联系平台管理员。"),
      { status: 503 },
    );
  }

  try {
    const result = validateCheckoutInput(await readJsonBody(request));
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请先选择有效套餐。", result.errors),
        { status: 400 },
      );
    }
    const checkout = await createPaymentCheckout({
      workspaceId,
      planId: result.data.planId,
      initiatedByUserId: account.user.id,
      customerEmail: account.user.email,
      origin: checkoutOrigin(request.url),
    });
    return Response.json(
      apiSuccess({
        checkoutUrl: checkout.checkoutUrl,
        checkoutId: checkout.checkout.id,
        reused: checkout.reused,
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StripeGatewayError) {
      return Response.json(apiError(error.code, error.message), { status: error.status });
    }
    return managementErrorResponse(error);
  }
}

function checkoutOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new ManagementError("INVALID_CHECKOUT_ORIGIN", "在线付款必须通过 HTTPS 发起。", 400);
  }
  return url.origin;
}
