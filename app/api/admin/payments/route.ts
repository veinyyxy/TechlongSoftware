import { apiError, apiSuccess } from "@/lib/api/response";
import {
  createPaymentRecord,
  listPaymentRecords,
  type PaymentStatus,
} from "@/lib/billing/management";
import {
  isPaymentStatus,
  validatePaymentInput,
} from "@/lib/billing/validation";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

export async function GET(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const rawStatus = url.searchParams.get("status") ?? "";
  const status: PaymentStatus | "" = isPaymentStatus(rawStatus)
    ? rawStatus
    : "";

  return Response.json(
    apiSuccess(await listPaymentRecords({ query, status })),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const result = validatePaymentInput(await readJsonBody(request));
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查付款记录。", result.errors),
        { status: 400 },
      );
    }

    return Response.json(
      apiSuccess(
        await createPaymentRecord(
          result.data,
          authorization.account.user.id,
        ),
      ),
      { status: 201 },
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
