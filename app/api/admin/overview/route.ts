import { apiError, apiSuccess } from "@/lib/api/response";
import { getApiAccount, getPlatformOverview } from "@/lib/auth/account";

export async function GET() {
  const account = await getApiAccount();
  if (!account) {
    return Response.json(
      apiError("UNAUTHORIZED", "请先登录后再访问管理数据。"),
      { status: 401 },
    );
  }
  if (!account.user.isPlatformAdmin) {
    return Response.json(
      apiError("PLATFORM_ADMIN_REQUIRED", "当前账号不是平台管理员。"),
      { status: 403 },
    );
  }

  return Response.json(apiSuccess(await getPlatformOverview()), {
    headers: { "cache-control": "no-store" },
  });
}
