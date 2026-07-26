import { apiError, apiSuccess } from "@/lib/api/response";
import {
  createCustomer,
  listCustomers,
  type WorkspaceStatus,
} from "@/lib/admin/management";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import {
  isWorkspaceStatus,
  validateCustomerInput,
} from "@/lib/admin/validation";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

export async function GET(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const rawStatus = url.searchParams.get("status") ?? "";
  const status: WorkspaceStatus | "" = isWorkspaceStatus(rawStatus)
    ? rawStatus
    : "";

  return Response.json(
    apiSuccess(await listCustomers({ query, status })),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const result = validateCustomerInput(await readJsonBody(request));
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查客户资料。", result.errors),
        { status: 400 },
      );
    }

    return Response.json(apiSuccess(await createCustomer(result.data)), {
      status: 201,
    });
  } catch (error) {
    return managementErrorResponse(error);
  }
}
