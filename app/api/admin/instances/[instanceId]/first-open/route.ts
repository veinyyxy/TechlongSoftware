import { getDatabase } from "@/db";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import { createFirstOpenAdminHandlers } from "@/lib/deployments/first-open-admin-http";
import { createFirstOpenAdminStore } from "@/lib/deployments/first-open-admin-store";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const handlers = createFirstOpenAdminHandlers({
  authorize: requirePlatformAdminApi,
  store: () => createFirstOpenAdminStore(getDatabase()),
  approvalOptions: () => {
    const afterCommit = env.TECHLONG_FIRST_OPEN_WEB_NOTIFY;
    if (typeof afterCommit === "function") return {
      databaseProfile: "full_password",
      async afterCommit(executionId) { await afterCommit(executionId); },
    };
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
