import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/auth/validation";

export const metadata: Metadata = { title: "登录" };
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ returnTo?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [user, query] = await Promise.all([
    getAuthenticatedUser(),
    searchParams,
  ]);
  return (
    <AuthCard
      mode="login"
      returnTo={safeReturnTo(query.returnTo)}
      user={user ? { name: user.name, email: user.email } : null}
    />
  );
}
