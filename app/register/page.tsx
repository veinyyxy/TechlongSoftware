import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { getInvitationPreview } from "@/lib/auth/credentials";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/auth/validation";

export const metadata: Metadata = { title: "注册" };
export const dynamic = "force-dynamic";

interface RegisterPageProps {
  searchParams: Promise<{ invite?: string; returnTo?: string }>;
}

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const query = await searchParams;
  const token = query.invite?.trim() || null;
  const [user, invitation] = await Promise.all([
    getAuthenticatedUser(),
    token ? getInvitationPreview(token) : Promise.resolve(null),
  ]);
  return (
    <AuthCard
      invitation={invitation}
      invitationToken={token}
      mode="register"
      returnTo={safeReturnTo(query.returnTo)}
      user={user ? { name: user.name, email: user.email } : null}
    />
  );
}
