import { AppShell } from "@/components/shell/AppShell";
import { getDashboardAccount } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = await getDashboardAccount();

  return (
    <AppShell
      mode="customer"
      user={{
        name: account.user.name,
        email: account.user.email,
        isPlatformAdmin: account.user.isPlatformAdmin,
      }}
      workspace={{
        name: account.workspace.name,
        role: account.membership.role,
        status: account.workspace.status,
      }}
    >
      {children}
    </AppShell>
  );
}
