import { getD1 } from "@/db";
import { managementErrorResponse } from "@/lib/admin/http";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const requestUrl = new URL(request.url);
    if (request.headers.get("origin") !== requestUrl.origin) {
      return Response.json(
        apiError("INVALID_ORIGIN", "清理请求来源不正确。"),
        { status: 403 },
      );
    }

    const formData = await request.formData();
    if (
      formData.get("confirmation") !== "DELETE_ALL_SUBSCRIPTIONS_ONCE" ||
      formData.get("expectedCount") !== "2"
    ) {
      return Response.json(
        apiError(
          "CONFIRMATION_REQUIRED",
          "本次一次性清理需要匹配确认文字和预期记录数。",
        ),
        { status: 400 },
      );
    }

    const d1 = getD1();
    const before = await d1
      .prepare(
        `SELECT id, workspace_id, product_id, plan_id, status,
                current_period_start, current_period_end, cancel_at_period_end,
                created_by_user_id, created_at, updated_at
           FROM subscriptions
          ORDER BY created_at ASC`,
      )
      .all();

    if (before.results.length !== 2) {
      return Response.json(
        apiError(
          "SUBSCRIPTION_COUNT_CHANGED",
          `检测到 ${before.results.length} 条订阅，与已确认的 2 条不一致，未执行删除。`,
        ),
        { status: 409 },
      );
    }

    const deletion = await d1.prepare("DELETE FROM subscriptions").run();
    const remaining = await d1
      .prepare("SELECT COUNT(*) AS count FROM subscriptions")
      .first<{ count: number }>();

    return Response.json(
      apiSuccess({
        deletedCount: deletion.meta.changes,
        remainingCount: Number(remaining?.count ?? 0),
        deletedSubscriptions: before.results,
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
