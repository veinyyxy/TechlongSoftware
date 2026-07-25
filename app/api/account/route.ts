import { apiError, apiSuccess } from "@/lib/api/response";
import { getApiAccount } from "@/lib/auth/account";

export async function GET() {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后再访问当前账号信息。"),
      { status: 401 },
    );
  }

  return Response.json(
    apiSuccess({
      user: account.user,
      workspace: account.workspace,
      membership: account.membership,
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
