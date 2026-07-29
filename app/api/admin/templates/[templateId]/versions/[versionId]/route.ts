import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import {
  archiveAppInstanceTemplateVersion,
  getAppInstanceTemplateVersion,
  updateDraftAppInstanceTemplateVersion,
} from "@/lib/templates/management";
import { validateAppInstanceTemplateVersionInput } from "@/lib/templates/validation";

interface RouteContext {
  params: Promise<{ templateId: string; versionId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  const { templateId, versionId } = await context.params;
  const version = await getAppInstanceTemplateVersion(versionId);
  if (!version || version.templateId !== templateId) {
    return Response.json(
      apiError("TEMPLATE_VERSION_NOT_FOUND", "没有找到该模板版本。"),
      { status: 404 },
    );
  }
  return Response.json(apiSuccess(version), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  try {
    const { templateId, versionId } = await context.params;
    const existing = await getAppInstanceTemplateVersion(versionId);
    if (!existing || existing.templateId !== templateId) {
      return Response.json(
        apiError("TEMPLATE_VERSION_NOT_FOUND", "没有找到该模板版本。"),
        { status: 404 },
      );
    }
    const body = await readJsonBody(request);
    if (
      typeof body === "object" &&
      body !== null &&
      (body as { status?: unknown }).status === "archived" &&
      Object.keys(body).length === 1
    ) {
      return Response.json(
        apiSuccess(await archiveAppInstanceTemplateVersion(versionId)),
      );
    }
    const result = validateAppInstanceTemplateVersionInput(body);
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查模板版本资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(
        await updateDraftAppInstanceTemplateVersion(versionId, result.data),
      ),
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
