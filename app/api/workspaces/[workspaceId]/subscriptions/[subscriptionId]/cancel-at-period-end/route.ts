import { apiError, apiSuccess } from "@/lib/api/response";
import {
  managementErrorResponse,
  readJsonBody,
} from "@/lib/admin/http";
import { getApiAccount } from "@/lib/auth/account";
import { setCustomerSubscriptionCancelAtPeriodEnd } from "@/lib/billing/management";

interface RouteContext {
  params: Promise<{ workspaceId: string; subscriptionId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后管理订阅。"),
      { status: 401 },
    );
  }
  const { workspaceId, subscriptionId } = await context.params;
  if (
    account.workspace.id !== workspaceId ||
    account.membership.role !== "owner"
  ) {
    return Response.json(
      apiError(
        "WORKSPACE_BILLING_FORBIDDEN",
        "只有当前工作区 Owner 可以管理订阅。",
      ),
      { status: 403 },
    );
  }
  try {
    const body = await readJsonBody(request);
    const cancelAtPeriodEnd =
      body &&
      typeof body === "object" &&
      "cancelAtPeriodEnd" in body &&
      (body as { cancelAtPeriodEnd?: unknown }).cancelAtPeriodEnd;
    if (typeof cancelAtPeriodEnd !== "boolean") {
      return Response.json(
        apiError(
          "VALIDATION_ERROR",
          "到期取消设置不正确。",
          { cancelAtPeriodEnd: ["必须提交布尔值。"] },
        ),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(
        await setCustomerSubscriptionCancelAtPeriodEnd(
          workspaceId,
          subscriptionId,
          cancelAtPeriodEnd,
        ),
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
