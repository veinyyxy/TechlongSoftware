import { apiError, apiSuccess } from "@/lib/api/response";
import { getWorkspaceBillingSummary } from "@/lib/billing/management";
import {
  assertWorkspaceAccess,
  getApiAccount,
} from "@/lib/auth/account";

interface RouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后再查看订阅与账单。"),
      { status: 401 },
    );
  }

  const { workspaceId } = await context.params;
  if (!(await assertWorkspaceAccess(account, workspaceId))) {
    return Response.json(
      apiError("WORKSPACE_FORBIDDEN", "你不能查看其他工作区的账单。"),
      { status: 403 },
    );
  }

  return Response.json(
    apiSuccess(await getWorkspaceBillingSummary(workspaceId)),
    { headers: { "cache-control": "no-store" } },
  );
}
