import { apiError, apiSuccess } from "@/lib/api/response";
import {
  AuthenticationError,
  loginWithPassword,
} from "@/lib/auth/credentials";
import {
  hasTrustedOrigin,
  isSecureRequest,
  sessionCookie,
} from "@/lib/auth/session";
import { validateLoginInput } from "@/lib/auth/validation";

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

  const result = validateLoginInput(body);
  if (!result.data) {
    return Response.json(
      apiError("VALIDATION_ERROR", "请检查登录信息。", result.errors),
      { status: 400 },
    );
  }

  try {
    const authenticated = await loginWithPassword(
      result.data.email,
      result.data.password,
    );
    return Response.json(
      apiSuccess({ redirectTo: result.data.returnTo }),
      {
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
    console.error("Login failed", error);
    return Response.json(
      apiError("LOGIN_FAILED", "登录没有完成，请稍后重试。"),
      { status: 500 },
    );
  }
}
