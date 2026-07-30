import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db";
import { hashOpaqueToken, isOpaqueToken } from "./security.ts";
import { safeReturnTo } from "./validation.ts";

export const SESSION_COOKIE_NAME = "saas_session";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  status: "active" | "disabled";
  isPlatformAdmin: boolean;
}

interface AuthenticatedUserRow {
  id: string;
  email: string;
  name: string;
  status: "active" | "disabled";
  is_platform_admin: number;
}

export const getAuthenticatedUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    const requestHeaders = await headers();
    const token = readCookie(
      requestHeaders.get("cookie"),
      SESSION_COOKIE_NAME,
    );
    if (!token || !isOpaqueToken(token)) return null;

    const row = await getDatabase()
      .prepare(
        `SELECT
          users.id,
          users.email,
          users.name,
          users.status,
          users.is_platform_admin
         FROM auth_sessions session
         INNER JOIN users ON users.id = session.user_id
         WHERE session.token_hash = ? AND session.expires_at > ?
         LIMIT 1`,
      )
      .bind(await hashOpaqueToken(token), Date.now())
      .first<AuthenticatedUserRow>();
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      isPlatformAdmin: Boolean(row.is_platform_admin),
    };
  },
);

export async function requireAuthenticatedUser(
  returnTo: string,
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (user) return user;
  redirect(signInPath(returnTo));
}

export function signInPath(returnTo = "/dashboard"): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export function sessionCookie(
  token: string,
  expiresAt: number,
  secure: boolean,
): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function readSessionToken(request: Request): string | null {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  return forwarded
    ? forwarded.split(",")[0]?.trim() === "https"
    : new URL(request.url).protocol === "https:";
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function readCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rawValue] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return null;
    }
  }
  return null;
}
