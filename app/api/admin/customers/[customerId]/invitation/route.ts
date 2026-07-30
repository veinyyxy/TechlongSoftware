import { apiError, apiSuccess } from "@/lib/api/response";
import { getCustomer } from "@/lib/admin/management";
import {
  AuthenticationError,
  createUserInvitation,
} from "@/lib/auth/credentials";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import { hasTrustedOrigin } from "@/lib/auth/session";

interface RouteContext {
  params: Promise<{ customerId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  if (!hasTrustedOrigin(request)) {
    return Response.json(
      apiError("INVALID_ORIGIN", "请求来源不受信任。"),
      { status: 403 },
    );
  }

  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const { customerId } = await context.params;
  const customer = await getCustomer(customerId);
  if (!customer) {
    return Response.json(
      apiError("CUSTOMER_NOT_FOUND", "没有找到该客户。"),
      { status: 404 },
    );
  }

  try {
    const invitation = await createUserInvitation(
      customer.ownerId,
      authorization.account.user.id,
    );
    const invitationUrl = new URL("/register", request.url);
    invitationUrl.searchParams.set("invite", invitation.token);
    return Response.json(
      apiSuccess({
        invitationUrl: invitationUrl.toString(),
        expiresAt: invitation.expiresAt,
      }),
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json(apiError(error.code, error.message), {
        status: error.status,
      });
    }
    console.error("Failed to create customer invitation", error);
    return Response.json(
      apiError("INVITATION_CREATE_FAILED", "邀请链接生成失败。"),
      { status: 500 },
    );
  }
}
