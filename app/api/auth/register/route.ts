import { apiError, apiSuccess } from "@/lib/api/response";
import {
  acceptInvitation,
  AuthenticationError,
  registerAccount,
} from "@/lib/auth/credentials";
import {
  hasTrustedOrigin,
  isSecureRequest,
  sessionCookie,
} from "@/lib/auth/session";
import { validateRegistrationInput } from "@/lib/auth/validation";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return Response.json(
      apiError("INVALID_ORIGIN", "请求来源不受信任。"),
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(apiError("INVALID_JSON", "请求格式不正确。"), {
      status: 400,
    });
  }

  const result = validateRegistrationInput(body);
  if (!result.data) {
    return Response.json(
      apiError("VALIDATION_ERROR", "请检查注册信息。", result.errors),
      { status: 400 },
    );
  }

  try {
    const authenticated = result.data.invitationToken
      ? await acceptInvitation({
          token: result.data.invitationToken,
          email: result.data.email,
          name: result.data.name,
          password: result.data.password,
        })
      : await registerAccount({
          email: result.data.email,
          name: result.data.name,
          workspaceName: result.data.workspaceName,
          password: result.data.password,
        });

    return Response.json(
      apiSuccess({ redirectTo: result.data.returnTo }),
      {
        status: 201,
        headers: {
          "cache-control": "no-store",
          "set-cookie": sessionCookie(
            authenticated.session.token,
            authenticated.session.expiresAt,
            isSecureRequest(request),
          ),
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return Response.json(apiError(error.code, error.message), {
        status: error.status,
        headers: { "cache-control": "no-store" },
      });
    }
    console.error("Registration failed", error);
    return Response.json(
      apiError("REGISTRATION_FAILED", "注册没有完成，请稍后重试。"),
      { status: 500 },
    );
  }
}
