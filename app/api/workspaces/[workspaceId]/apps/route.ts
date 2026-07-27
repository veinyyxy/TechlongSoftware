import { apiError, apiSuccess } from "@/lib/api/response";
import { assertWorkspaceAccess, getApiAccount } from "@/lib/auth/account";
import { listWorkspaceAppInstances } from "@/lib/instances/management";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后再查看应用实例。"),
      { status: 401 },
    );
  }

  const { workspaceId } = await context.params;
  if (!(await assertWorkspaceAccess(account, workspaceId))) {
    return Response.json(
      apiError("WORKSPACE_FORBIDDEN", "你不能查看其他工作区的应用实例。"),
      { status: 403 },
    );
  }

  return Response.json(
    apiSuccess(await listWorkspaceAppInstances(workspaceId)),
    { headers: { "cache-control": "no-store" } },
  );
}
