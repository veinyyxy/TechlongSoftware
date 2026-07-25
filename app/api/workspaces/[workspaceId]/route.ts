import { apiError, apiSuccess } from "@/lib/api/response";
import {
  assertWorkspaceAccess,
  getApiAccount,
  listWorkspaceMembers,
} from "@/lib/auth/account";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后再访问工作区。"),
      { status: 401 },
    );
  }

  const { workspaceId } = await context.params;
  const allowed = await assertWorkspaceAccess(account, workspaceId);
  if (!allowed) {
    return Response.json(
      apiError("WORKSPACE_FORBIDDEN", "无权访问其他企业工作区。"),
      { status: 403 },
    );
  }

  const members = await listWorkspaceMembers(workspaceId);
  return Response.json(
    apiSuccess({
      workspaceId,
      members,
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
