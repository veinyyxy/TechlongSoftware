import { getDatabase } from "@/db";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import { createFirstOpenAdminHandlers } from "@/lib/deployments/first-open-admin-http";
import { createFirstOpenAdminStore } from "@/lib/deployments/first-open-admin-store";

export const dynamic = "force-dynamic";

const handlers = createFirstOpenAdminHandlers({
  authorize: requirePlatformAdminApi,
  store: () => createFirstOpenAdminStore(getDatabase()),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
