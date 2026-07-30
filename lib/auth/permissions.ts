export type WorkspaceRole = "owner" | "member";

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

export function canAccessPlatformAdmin(isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin;
}
