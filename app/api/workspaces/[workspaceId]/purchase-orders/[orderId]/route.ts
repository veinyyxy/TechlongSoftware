import { apiError, apiSuccess } from "@/lib/api/response";
import { managementErrorResponse } from "@/lib/admin/http";
import { getApiAccount } from "@/lib/auth/account";
import { StripeGatewayError } from "@/lib/payments/stripe";
import {
  cancelWorkspacePurchaseOrder,
  getWorkspacePurchaseOrder,
} from "@/lib/purchases/management";

interface RouteContext {
  params: Promise<{ workspaceId: string; orderId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后查看购买订单。"),
      { status: 401 },
    );
  }
  const { workspaceId, orderId } = await context.params;
  if (account.workspace.id !== workspaceId) {
    return Response.json(
      apiError("WORKSPACE_FORBIDDEN", "不能查看其他工作区的购买订单。"),
      { status: 403 },
    );
  }
  const order = await getWorkspacePurchaseOrder(workspaceId, orderId);
  if (!order) {
    return Response.json(
      apiError("PURCHASE_ORDER_NOT_FOUND", "没有找到购买订单。"),
      { status: 404 },
    );
  }
  return Response.json(apiSuccess(order), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(_request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后管理购买订单。"),
      { status: 401 },
    );
  }
  const { workspaceId, orderId } = await context.params;
  if (
    account.workspace.id !== workspaceId ||
    account.membership.role !== "owner"
  ) {
    return Response.json(
      apiError(
        "WORKSPACE_BILLING_FORBIDDEN",
        "只有当前工作区 Owner 可以取消待付款订单。",
      ),
      { status: 403 },
    );
  }
  try {
    const order = await cancelWorkspacePurchaseOrder(workspaceId, orderId);
    if (!order) {
      return Response.json(
        apiError("PURCHASE_ORDER_NOT_FOUND", "没有找到购买订单。"),
        { status: 404 },
      );
    }
    return Response.json(apiSuccess(order), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StripeGatewayError) {
      return Response.json(apiError(error.code, error.message), {
        status: error.status,
      });
    }
    return managementErrorResponse(error);
  }
}
