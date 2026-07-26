import { apiError, apiSuccess } from "@/lib/api/response";
import {
  getSubscription,
  updateSubscription,
  updateSubscriptionStatus,
} from "@/lib/billing/management";
import {
  isSubscriptionStatus,
  validateSubscriptionInput,
} from "@/lib/billing/validation";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

interface RouteContext {
  params: Promise<{ subscriptionId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const { subscriptionId } = await context.params;
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    return Response.json(
      apiError("SUBSCRIPTION_NOT_FOUND", "没有找到该订阅。"),
      { status: 404 },
    );
  }

  return Response.json(apiSuccess(subscription), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const { subscriptionId } = await context.params;
    const body = await readJsonBody(request);

    if (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      Object.keys(body).length === 1
    ) {
      const status = (body as { status?: unknown }).status;
      if (!isSubscriptionStatus(status)) {
        return Response.json(
          apiError("VALIDATION_ERROR", "订阅状态不正确。", {
            status: ["请选择有效的订阅状态。"],
          }),
          { status: 400 },
        );
      }
      return Response.json(
        apiSuccess(await updateSubscriptionStatus(subscriptionId, status)),
      );
    }

    const result = validateSubscriptionInput(body);
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查订阅资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(await updateSubscription(subscriptionId, result.data)),
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
