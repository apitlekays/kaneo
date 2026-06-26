import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useProjectMembers } from "@/hooks/queries/project-member/use-project-members";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";
import { authClient } from "@/lib/auth-client";

export type PermissionLevel = "owner" | "admin" | "member";

// Capabilities are named permission bundles checked against the SERVER via
// better-auth's `/organization/has-permission` endpoint. Going through the
// server is what makes custom workspace roles work in the UI — the local
// `checkRolePermission` only knows about the four static roles compiled
// into the auth client, so it would silently return false for any custom
// role that grants the permission.
const CAPABILITIES = {
  manageProjects: { project: ["create", "update", "delete"] },
  createProjects: { project: ["create"] },
  deleteProjects: { project: ["delete"] },
  manageTasks: { task: ["create", "update", "delete"] },
  createTasks: { task: ["create"] },
  editTasks: { task: ["update"] },
  deleteTasks: { task: ["delete"] },
  assignTasks: { task: ["assign"] },
  manageLabels: { label: ["create", "update", "delete"] },
  manageWorkspace: { workspace: ["update", "manage_settings"] },
  deleteWorkspace: { workspace: ["delete"] },
  inviteUsers: { invitation: ["create"] },
  manageTeam: { member: ["update", "delete"] },
  removeMembers: { member: ["delete"] },
} as const satisfies Record<string, Record<string, string[]>>;

type Capability = keyof typeof CAPABILITIES;

type CapabilityMap = Record<Capability, boolean>;

function emptyCapabilityMap(): CapabilityMap {
  const out = {} as CapabilityMap;
  for (const key of Object.keys(CAPABILITIES) as Capability[]) {
    out[key] = false;
  }
  return out;
}

export function useWorkspacePermission() {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useGetActiveWorkspaceUser();
  const workspaceId = activeWorkspace?.id;
  const role = activeMember?.role as string | undefined;

  // Task permissions are project-membership-based: any member of the current
  // project (manager or member) can CRUD tasks, regardless of workspace role.
  // Global admins/owners are covered by the workspace-role checks below.
  const params = useParams({ strict: false });
  const projectId =
    "projectId" in params && typeof params.projectId === "string"
      ? params.projectId
      : undefined;
  const { data: session } = authClient.useSession();
  const { data: currentProjectMembers } = useProjectMembers(projectId ?? "");
  const myProjectRole = projectId
    ? currentProjectMembers?.find((m) => m.userId === session?.user?.id)?.role
    : undefined;
  const isProjectMember = Boolean(myProjectRole);
  const isProjectManager = myProjectRole === "manager";
  const isGlobalAdminRole =
    role === "owner" || role === "admin" || role === "global-admin";

  // One query that fans out to all capability checks in parallel and caches
  // the resulting map by (workspaceId, role). Refetches when either changes
  // — e.g., when the admin edits the role's permissions in the Roles UI and
  // we invalidate this key.
  const {
    data: capabilities,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["workspace-capabilities", workspaceId, role],
    enabled: Boolean(workspaceId && role),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CapabilityMap> => {
      const entries = Object.entries(CAPABILITIES) as Array<
        [Capability, Record<string, string[]>]
      >;
      const results = await Promise.all(
        entries.map(async ([key, permissions]) => {
          try {
            const res = await authClient.organization.hasPermission({
              organizationId: workspaceId,
              permissions,
            });
            return [key, res.data?.success === true] as const;
          } catch (error) {
            console.error(`hasPermission check failed for ${key}:`, error);
            return [key, false] as const;
          }
        }),
      );
      const map = emptyCapabilityMap();
      for (const [key, value] of results) {
        map[key] = value;
      }
      return map;
    },
  });

  const can: CapabilityMap = capabilities ?? emptyCapabilityMap();

  const helpers = useMemo(() => {
    return {
      canManageProjects: () => can.manageProjects,
      canCreateProjects: () => can.createProjects,
      canDeleteProjects: () => can.deleteProjects,
      // Editing a project's settings: global admins/owner OR the project's
      // own manager. Used by the project settings pages.
      canManageCurrentProject: () => isGlobalAdminRole || isProjectManager,
      canManageTasks: () => can.manageTasks || isProjectMember,
      canCreateTasks: () => can.createTasks || isProjectMember,
      canEditTasks: () => can.editTasks || isProjectMember,
      canDeleteTasks: () => can.deleteTasks || isProjectMember,
      canAssignTasks: () => can.assignTasks || isProjectMember,
      canManageLabels: () => can.manageLabels,
      canManageWorkspace: () => can.manageWorkspace,
      canDeleteWorkspace: () => can.deleteWorkspace,
      canInviteUsers: () => can.inviteUsers,
      canManageTeam: () => can.manageTeam,
      canRemoveMembers: () => can.removeMembers,
      // Escape hatch for ad-hoc permission checks (uncached). Prefer adding
      // a capability above.
      hasPermission: async (permissions: Record<string, string[]>) => {
        try {
          const res = await authClient.organization.hasPermission({
            organizationId: workspaceId,
            permissions,
          });
          return res.data?.success === true;
        } catch (error) {
          console.error("hasPermission check failed:", error);
          return false;
        }
      },
    };
  }, [can, workspaceId, isProjectMember, isProjectManager, isGlobalAdminRole]);

  return {
    ...helpers,
    workspace: activeWorkspace,
    member: activeMember,
    role,
    isOwner: role === "owner",
    isAdmin: role === "owner" || role === "admin" || role === "global-admin",
    // True while the first capability fetch is in flight. Useful for hiding
    // action UI during the initial render instead of flashing it on then
    // off when the server check resolves.
    isCheckingPermissions:
      Boolean(workspaceId && role) && (isLoading || !capabilities),
    isRefetchingPermissions: isFetching,
  };
}
