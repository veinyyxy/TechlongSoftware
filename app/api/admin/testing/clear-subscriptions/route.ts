import { apiError, apiSuccess } from "@/lib/api/response";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { ManagementError } from "@/lib/admin/management";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import { getD1 } from "@/db";

const CONFIRMATION = "DELETE_SUBSCRIPTIONS_ONLY";

export async function DELETE(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const body = await readJsonBody(request);
    const workspaceId =
      body &&
      typeof body === "object" &&
      "workspaceId" in body &&
      typeof (body as { workspaceId?: unknown }).workspaceId === "string"
        ? (body as { workspaceId: string }).workspaceId.trim()
        : "";
    const confirmation =
      body &&
      typeof body === "object" &&
      "confirmation" in body &&
      typeof (body as { confirmation?: unknown }).confirmation === "string"
        ? (body as { confirmation: string }).confirmation
        : "";
    if (!workspaceId || confirmation !== CONFIRMATION) {
      return Response.json(
        apiError(
          "CONFIRMATION_REQUIRED",
          "测试清理确认信息不正确。",
        ),
        { status: 400 },
      );
    }

    const workspace = await getD1()
      .prepare("SELECT id, name FROM workspaces WHERE id = ? LIMIT 1")
      .bind(workspaceId)
      .first<{ id: string; name: string }>();
    if (!workspace) {
      throw new ManagementError(
        "WORKSPACE_NOT_FOUND",
        "没有找到需要测试清理的工作区。",
        404,
      );
    }

    const before = await getD1()
      .prepare(
        "SELECT COUNT(*) AS count FROM subscriptions WHERE workspace_id = ?",
      )
      .bind(workspaceId)
      .first<{ count: number }>();
    const deleted = await getD1()
      .prepare("DELETE FROM subscriptions WHERE workspace_id = ?")
      .bind(workspaceId)
      .run();
    const now = Date.now();
    await getD1().batch([
      getD1()
        .prepare(
          `UPDATE workspace_product_entitlements
           SET current_subscription_id = NULL, status = 'ended',
               updated_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(now, workspaceId),
      getD1()
        .prepare(
          `UPDATE workspaces
           SET plan_id = NULL, subscription_status = 'not_configured',
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(now, workspaceId),
    ]);

    return Response.json(
      apiSuccess({
        workspaceId,
        workspaceName: workspace.name,
        subscriptionsBefore: Number(before?.count ?? 0),
        subscriptionsDeleted: Number(deleted.meta.changes ?? 0),
      }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
