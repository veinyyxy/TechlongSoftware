import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import {
  createAppInstanceTemplateVersion,
  listAppInstanceTemplateVersions,
} from "@/lib/templates/management";
import { validateAppInstanceTemplateVersionInput } from "@/lib/templates/validation";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  const { templateId } = await context.params;
  return Response.json(
    apiSuccess(await listAppInstanceTemplateVersions({ templateId })),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  try {
    const { templateId } = await context.params;
    const result = validateAppInstanceTemplateVersionInput(
      await readJsonBody(request),
    );
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查模板版本资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(
        await createAppInstanceTemplateVersion(templateId, result.data),
      ),
      { status: 201 },
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
