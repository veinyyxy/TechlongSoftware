import { apiError, apiSuccess } from "@/lib/api/response";
import {
  createSubscription,
  listSubscriptions,
  type SubscriptionStatus,
} from "@/lib/billing/management";
import {
  isSubscriptionStatus,
  validateSubscriptionInput,
} from "@/lib/billing/validation";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

export async function GET(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const rawStatus = url.searchParams.get("status") ?? "";
  const status: SubscriptionStatus | "" = isSubscriptionStatus(rawStatus)
    ? rawStatus
    : "";

  return Response.json(
    apiSuccess(await listSubscriptions({ query, status })),
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const result = validateSubscriptionInput(await readJsonBody(request));
    if (!result.data) {
      return Response.json(
        apiError("VALIDATION_ERROR", "请检查订阅资料。", result.errors),
        { status: 400 },
      );
    }

    return Response.json(
      apiSuccess(
        await createSubscription(
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
