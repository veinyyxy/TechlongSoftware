import { apiError, apiSuccess } from "@/lib/api/response";
import { managementErrorResponse, readJsonBody } from "@/lib/admin/http";
import { ManagementError } from "@/lib/admin/management";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import { getD1 } from "@/db";

const CONFIRMATION = "DELETE_SUBSCRIPTIONS_ONLY";

function readField(body: unknown, field: string) {
  if (
    body &&
    typeof body === "object" &&
    field in body &&
    typeof (body as Record<string, unknown>)[field] === "string"
  ) {
    return ((body as Record<string, string>)[field] ?? "").trim();
  }
  return "";
}

async function clearSubscriptions(workspaceId: string, confirmation: string) {
  if (!workspaceId || confirmation !== CONFIRMATION) {
    return Response.json(
      apiError("CONFIRMATION_REQUIRED", "测试清理确认信息不正确。"),
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
    .prepare("SELECT COUNT(*) AS count FROM subscriptions WHERE workspace_id = ?")
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
}

export async function GET() {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  return new Response(
    `<!doctype html>
     <html lang="zh-CN">
       <head><meta charset="utf-8"><title>测试清理订阅</title></head>
       <body style="font-family:sans-serif;max-width:720px;margin:48px auto">
         <h1>测试清理订阅</h1>
         <p>只删除 Xiaoyu Yang 工作区的订阅；不会删除应用实例或付款记录。</p>
         <form method="post">
           <input type="hidden" name="workspaceId" value="wsp_9a9153dcc045074c47129481">
           <input type="hidden" name="confirmation" value="${CONFIRMATION}">
           <button type="submit">确认只删除订阅</button>
         </form>
       </body>
     </html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function DELETE(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const body = await readJsonBody(request);
    return await clearSubscriptions(
      readField(body, "workspaceId"),
      readField(body, "confirmation"),
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const formData = await request.formData();
    return await clearSubscriptions(
      String(formData.get("workspaceId") ?? "").trim(),
      String(formData.get("confirmation") ?? "").trim(),
    );
  } catch (error) {
    return managementErrorResponse(error);
  }
}
