import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import {
  getAppInstance,
  updateAppInstance,
  updateAppInstanceStatus,
} from "@/lib/instances/management";
import {
  isAppInstanceStatus,
  validateAppInstanceInput,
} from "@/lib/instances/validation";

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const { instanceId } = await context.params;
  const instance = await getAppInstance(instanceId);
  if (!instance) {
    return Response.json(
      apiError("APP_INSTANCE_NOT_FOUND", "没有找到该应用实例。"),
      { status: 404 },
    );
  }

  return Response.json(apiSuccess(instance), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const { instanceId } = await context.params;
    const body = await readJsonBody(request);

    if (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      Object.keys(body).length === 1
    ) {
      const status = (body as { status?: unknown }).status;
      if (!isAppInstanceStatus(status)) {
        return Response.json(
          apiError("VALIDATION_ERROR", "实例状态不正确。", {
            status: ["请选择有效的实例状态。"],
          }),
          { status: 400 },
        );
      }
      return Response.json(
        apiSuccess(await updateAppInstanceStatus(instanceId, status)),
      );
    }

    const result = validateAppInstanceInput(body);
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查应用实例资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(await updateAppInstance(instanceId, result.data)),
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
