import { apiError } from "@/lib/api/response";
import { getApiAccount, type AccountContext } from "./account";
import { canAccessPlatformAdmin } from "./permissions";

type AdminApiAuthorization =
  | { account: AccountContext; response: null }
  | { account: null; response: Response };

export async function requirePlatformAdminApi(): Promise<AdminApiAuthorization> {
  const account = await getApiAccount();

  if (!account) {
    return {
      account: null,
      response: Response.json(
        apiError("UNAUTHORIZED", "请先登录后再访问管理数据。"),
        { status: 401 },
      ),
    };
  }

  if (!canAccessPlatformAdmin(account.user.isPlatformAdmin)) {
    return {
      account: null,
      response: Response.json(
        apiError("PLATFORM_ADMIN_REQUIRED", "当前账号不是平台管理员。"),
        { status: 403 },
      ),
    };
  }

  return { account, response: null };
}
