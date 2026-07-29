import { apiSuccess } from "@/lib/api/response";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import {
  listPurchaseOrders,
  type PurchaseOrderStatus,
} from "@/lib/purchases/management";

const statuses = new Set<PurchaseOrderStatus>([
  "draft",
  "checkout_pending",
  "paid",
  "failed",
  "canceled",
  "expired",
]);

export async function GET(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const rawStatus = url.searchParams.get("status") ?? "";
  const status = statuses.has(rawStatus as PurchaseOrderStatus)
    ? (rawStatus as PurchaseOrderStatus)
    : "";
  return Response.json(
    apiSuccess(await listPurchaseOrders({ query, status })),
    { headers: { "cache-control": "no-store" } },
  );
}
