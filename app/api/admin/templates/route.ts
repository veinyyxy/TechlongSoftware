import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import {
  createAppInstanceTemplate,
  listAppInstanceTemplates,
} from "@/lib/templates/management";
import {
  isTemplateStatus,
  validateAppInstanceTemplateInput,
  type TemplateStatus,
} from "@/lib/templates/validation";

export async function GET(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const rawStatus = url.searchParams.get("status") ?? "";
  const status: TemplateStatus | "" = isTemplateStatus(rawStatus)
    ? rawStatus
    : "";
  const productId = url.searchParams.get("productId")?.slice(0, 128) ?? "";
  return Response.json(
    apiSuccess(
      await listAppInstanceTemplates({ query, status, productId }),
    ),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  try {
    const result = validateAppInstanceTemplateInput(await readJsonBody(request));
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查实例模板资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(await createAppInstanceTemplate(result.data)),
      { status: 201 },
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
