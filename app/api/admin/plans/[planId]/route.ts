import { apiError, apiSuccess } from "@/lib/api/response";
import {
  getPlan,
  updatePlan,
  updatePlanStatus,
} from "@/lib/admin/management";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { isPlanStatus, validatePlanInput } from "@/lib/admin/validation";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

interface RouteContext {
  params: Promise<{ planId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const { planId } = await context.params;
  const plan = await getPlan(planId);
  if (!plan) {
    return Response.json(apiError("PLAN_NOT_FOUND", "没有找到该套餐。"), {
      status: 404,
    });
  }

  return Response.json(apiSuccess(plan), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const { planId } = await context.params;
    const body = await readJsonBody(request);

    if (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      Object.keys(body).length === 1
    ) {
      const status = (body as { status?: unknown }).status;
      if (!isPlanStatus(status)) {
        return Response.json(
          apiError("VALIDATION_ERROR", "套餐状态不正确。", {
            status: ["状态必须是 active 或 inactive。"],
          }),
          { status: 400 },
        );
      }
      return Response.json(apiSuccess(await updatePlanStatus(planId, status)));
    }

    const result = validatePlanInput(body);
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查套餐资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(apiSuccess(await updatePlan(planId, result.data)));
  } catch (error) {
    return managementErrorResponse(error);
  }
}
