import { apiError } from "@/lib/api/response";
import { deleteSession } from "@/lib/auth/credentials";
import {
  clearSessionCookie,
  hasTrustedOrigin,
  isSecureRequest,
  readSessionToken,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return Response.json(
      apiError("INVALID_ORIGIN", "请求来源不受信任。"),
      { status: 403 },
    );
  }

  const token = readSessionToken(request);
  if (token) {
    try {
      await deleteSession(token);
    } catch (error) {
      console.error("Failed to delete session during logout", error);
    }
  }

  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": clearSessionCookie(isSecureRequest(request)),
    },
  });
}
