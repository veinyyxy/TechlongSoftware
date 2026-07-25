export type WorkspaceRole = "owner" | "member";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAdminEmailAllowlist(value: string | undefined): string[] {
  if (!value) return [];

  return [
    ...new Set(
      value
        .split(",")
        .map(normalizeEmail)
        .filter(Boolean),
    ),
  ];
}

export function isPlatformAdminEmail(
  email: string,
  allowlist: readonly string[],
): boolean {
  return allowlist.includes(normalizeEmail(email));
}

export function canAccessWorkspace(input: {
  isPlatformAdmin: boolean;
  membershipWorkspaceIds: readonly string[];
  requestedWorkspaceId: string;
}): boolean {
  if (input.isPlatformAdmin) return true;
  return input.membershipWorkspaceIds.includes(input.requestedWorkspaceId);
}

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return role === "owner";
}
