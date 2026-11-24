/**
 * Browser surface used by SpeedFeast at the pinned version A backend.
 * Route admission is not authentication; Origin can be forged outside a
 * browser. The original API still verifies the buyer JWT and applies its
 * store/order/recipient checks, and its rate limits remain in place.
 */
export type BuyerForwardRoute = Readonly<{
  bearer: "required" | "optional";
  queryKeys: readonly string[];
  acceptsQueryValues?: (query: URLSearchParams) => boolean;
}>;

const route = (
  bearer: BuyerForwardRoute["bearer"],
  queryKeys: string[] = [],
  acceptsQueryValues?: BuyerForwardRoute["acceptsQueryValues"],
): BuyerForwardRoute => Object.freeze({ bearer, queryKeys: Object.freeze(queryKeys), acceptsQueryValues });

const publicBuyerRoute = route("optional");
const buyerToken = route("required");
const uuid = "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";
const isUuid = new RegExp(`^${uuid}$`);
const buyerReview = new RegExp(`^/api/reviews/orders/${uuid}$`);
const buyerNoticeMutation = new RegExp(`^/api/buyer/notifications/${uuid}/(?:read|delete)$`);

const config = route("optional", ["app_scope", "country_code", "region_code"], (q) =>
  q.get("app_scope") === "order_client" &&
  (!q.has("country_code") || /^[A-Z]{2}$/.test(q.get("country_code") ?? "")) &&
  (!q.has("region_code") || /^[A-Z]{2}$/.test(q.get("region_code") ?? "")),
);
const verificationTarget = (q: URLSearchParams) => {
  const target = q.get("target") ?? "";
  return q.get("type") === "phone" ? /^\+?[1-9]\d{9,14}$/.test(target) :
    q.get("type") === "email" && target.length <= 254 && /^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(target);
};

// Exact preimages prevent the forwarding layer from exposing a broad
// token/signing path. No caller-supplied route names, origins or API prefixes.
const gets = new Map<string, BuyerForwardRoute>([
  ["/api/buyer/access", publicBuyerRoute],
  ["/api/stores/bootstrap", publicBuyerRoute],
  ["/api/products/get_list", publicBuyerRoute],
  ["/api/config", config],
  ["/api/verification/send_verification", route("optional", ["type", "target"], verificationTarget)],
  ["/api/verification/verify", route("optional", ["type", "target", "code"], (q) =>
    verificationTarget(q) && /^\d{4}$/.test(q.get("code") ?? ""))],
  ["/api/orders/get_list", route("required", ["limit"])],
  ["/api/payments/status", route("required", ["order_id"], (q) => isUuid.test(q.get("order_id") ?? ""))],
  ["/api/rewards/summary", buyerToken],
  ["/api/rewards/transactions", route("required", ["limit", "offset"])],
  ["/api/rewards/redemptions", route("required", ["status"])],
  ["/api/buyer/notifications", route("required", ["limit", "offset", "unread_only"])],
  ["/api/buyer/notifications/unread-count", buyerToken],
]);

const posts = new Map<string, BuyerForwardRoute>([
  ["/api/users/login", publicBuyerRoute],
  ["/api/users/register", buyerToken], // A requires the registration verification JWT here.
  ["/api/user/validate", buyerToken],
  ["/api/users/profile/get", buyerToken],
  ["/api/users/profile/update", buyerToken],
  ["/api/users/address/create", buyerToken],
  ["/api/users/address/update", buyerToken],
  ["/api/users/address/delete", buyerToken],
  ["/api/users/address/default", buyerToken],
  ["/api/dine-in/table/verify", publicBuyerRoute],
  ["/api/orders/create", buyerToken],
  ["/api/orders/cancel", buyerToken],
  ["/api/payments/create", buyerToken], // Hosted Checkout only; relay checks platform=web before signing.
  ["/api/rewards/redeem", buyerToken],
  ["/api/buyer/notifications/device-token", buyerToken],
  ["/api/buyer/notifications/device-token/deactivate", buyerToken],
  ["/api/buyer/notifications/read-all", buyerToken],
  ["/api/buyer/notifications/delete-read", buyerToken],
  // Saved card/PayPal management is deliberately not proxied with Checkout.
]);

export function matchBuyerForwardRoute(method: string, pathname: string): BuyerForwardRoute | null {
  if (/[^a-zA-Z0-9_/-]/.test(pathname)) return null;
  if (method === "GET") return gets.get(pathname) ?? (buyerReview.test(pathname) ? buyerToken : null);
  if (method === "POST") return posts.get(pathname) ?? (buyerReview.test(pathname) || buyerNoticeMutation.test(pathname) ? buyerToken : null);
  return null;
}
