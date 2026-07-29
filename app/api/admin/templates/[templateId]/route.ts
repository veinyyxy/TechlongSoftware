import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import {
  getAppInstanceTemplate,
  updateAppInstanceTemplate,
  updateAppInstanceTemplateStatus,
} from "@/lib/templates/management";
import {
  isTemplateStatus,
  validateAppInstanceTemplateInput,
} from "@/lib/templates/validation";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  const { templateId } = await context.params;
  const template = await getAppInstanceTemplate(templateId);
  if (!template) {
    return Response.json(
      apiError("TEMPLATE_NOT_FOUND", "没有找到该实例模板。"),
      { status: 404 },
    );
  }
  return Response.json(apiSuccess(template), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  try {
    const { templateId } = await context.params;
    const body = await readJsonBody(request);
    if (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      Object.keys(body).length === 1
    ) {
      const status = (body as { status?: unknown }).status;
      if (!isTemplateStatus(status)) {
        return Response.json(
          apiError("VALIDATION_ERROR", "模板状态不正确。"),
          { status: 400 },
        );
      }
      return Response.json(
        apiSuccess(await updateAppInstanceTemplateStatus(templateId, status)),
      );
    }
    const result = validateAppInstanceTemplateInput(body);
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查实例模板资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(await updateAppInstanceTemplate(templateId, result.data)),
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
