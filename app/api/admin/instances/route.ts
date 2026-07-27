import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import {
  createAppInstance,
  listAppInstances,
  type AppInstanceStatus,
} from "@/lib/instances/management";
import {
  isAppInstanceStatus,
  validateAppInstanceInput,
} from "@/lib/instances/validation";

export async function GET(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const rawStatus = url.searchParams.get("status") ?? "";
  const status: AppInstanceStatus | "" = isAppInstanceStatus(rawStatus)
    ? rawStatus
    : "";

  return Response.json(
    apiSuccess(await listAppInstances({ query, status })),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const result = validateAppInstanceInput(await readJsonBody(request));
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查应用实例资料。", result.errors),
        { status: 400 },
      );
    }

    return Response.json(
      apiSuccess(
        await createAppInstance(result.data, authorization.account.user.id),
      ),
      { status: 201 },
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
