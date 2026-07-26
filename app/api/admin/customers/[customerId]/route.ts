import { apiError, apiSuccess } from "@/lib/api/response";
import {
  getCustomer,
  updateCustomer,
  updateCustomerStatus,
} from "@/lib/admin/management";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import {
  isWorkspaceStatus,
  validateCustomerInput,
} from "@/lib/admin/validation";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

interface RouteContext {
  params: Promise<{ customerId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const { customerId } = await context.params;
  const customer = await getCustomer(customerId);
  if (!customer) {
    return Response.json(
      apiError("CUSTOMER_NOT_FOUND", "没有找到该客户。"),
      { status: 404 },
    );
  }

  return Response.json(apiSuccess(customer), {
    headers: { "cache-control": "no-store" },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const { customerId } = await context.params;
    const body = await readJsonBody(request);

    if (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      Object.keys(body).length === 1
    ) {
      const status = (body as { status?: unknown }).status;
      if (!isWorkspaceStatus(status)) {
        return Response.json(
          apiError("VALIDATION_ERROR", "客户状态不正确。", {
            status: ["状态必须是 active、suspended 或 disabled。"],
          }),
          { status: 400 },
        );
      }
      return Response.json(
        apiSuccess(await updateCustomerStatus(customerId, status)),
      );
    }

    const result = validateCustomerInput(body);
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查客户资料。", result.errors),
        { status: 400 },
      );
    }
    return Response.json(
      apiSuccess(await updateCustomer(customerId, result.data)),
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
