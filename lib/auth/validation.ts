import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "./security.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginInput {
  email: string;
  password: string;
  returnTo: string;
}

export interface RegistrationInput {
  email: string;
  name: string;
  workspaceName: string;
  password: string;
  invitationToken: string | null;
  returnTo: string;
}

export function normalizeAuthEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function safeReturnTo(
  value: unknown,
  fallback = "/dashboard",
): string {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  try {
    const url = new URL(candidate, "https://app.local");
    if (url.origin !== "https://app.local") return fallback;
    if (
      url.pathname === "/login" ||
      url.pathname === "/register" ||
      url.pathname.startsWith("/api/auth/")
    ) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function validateLoginInput(
  value: unknown,
):
  | { data: LoginInput; errors: null }
  | { data: null; errors: Record<string, string[]> } {
  const source = isRecord(value) ? value : {};
  const email = normalizeAuthEmail(readString(source.email));
  const password = readString(source.password);
  const errors: Record<string, string[]> = {};

  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    errors.email = ["请输入有效的邮箱地址。"];
  }
  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    errors.password = ["请输入密码。"];
  }

  return Object.keys(errors).length
    ? { data: null, errors }
    : {
        data: {
          email,
          password,
          returnTo: safeReturnTo(source.returnTo),
        },
        errors: null,
      };
}

export function validateRegistrationInput(
  value: unknown,
):
  | { data: RegistrationInput; errors: null }
  | { data: null; errors: Record<string, string[]> } {
  const source = isRecord(value) ? value : {};
  const email = normalizeAuthEmail(readString(source.email));
  const name = readString(source.name).trim();
  const workspaceName = readString(source.workspaceName).trim();
  const password = readString(source.password);
  const confirmation = readString(source.passwordConfirmation);
  const invitationToken = readString(source.invitationToken).trim() || null;
  const errors: Record<string, string[]> = {};

  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    errors.email = ["请输入有效的邮箱地址。"];
  }
  if (name.length < 2 || name.length > 100) {
    errors.name = ["姓名需要为 2–100 个字符。"];
  }
  if (!invitationToken && (workspaceName.length < 2 || workspaceName.length > 100)) {
    errors.workspaceName = ["企业名称需要为 2–100 个字符。"];
  }
  const passwordError = validatePassword(password);
  if (passwordError) errors.password = [passwordError];
  if (password !== confirmation) {
    errors.passwordConfirmation = ["两次输入的密码不一致。"];
  }

  return Object.keys(errors).length
    ? { data: null, errors }
    : {
        data: {
          email,
          name,
          workspaceName,
          password,
          invitationToken,
          returnTo: safeReturnTo(source.returnTo),
        },
        errors: null,
      };
}

export const passwordRequirements =
  `至少 ${MIN_PASSWORD_LENGTH} 个字符，最长 ${MAX_PASSWORD_LENGTH} 个字符`;

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
