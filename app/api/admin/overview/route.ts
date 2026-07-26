import { apiSuccess } from "@/lib/api/response";
import { getPlatformOverview } from "@/lib/auth/account";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";

export async function GET() {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  return Response.json(apiSuccess(await getPlatformOverview()), {
    headers: { "cache-control": "no-store" },
  });
}
