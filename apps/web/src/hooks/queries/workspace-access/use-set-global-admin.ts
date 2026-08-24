import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setGlobalAdmin } from "@/fetchers/workspace-access";
import { toast } from "@/lib/toast";

type Vars = { userId: string; enabled: boolean };

/** Promote or demote a member to/from global-admin (owner/global-admin only). */
export function useSetGlobalAdmin(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, enabled }: Vars) =>
      setGlobalAdmin(workspaceId, userId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-members-list", workspaceId],
      });
      // A self-promotion/demotion changes what the sidebar shows for the
      // current user, so refresh their own page-access view too.
      queryClient.invalidateQueries({
        queryKey: ["page-access", "me", workspaceId],
      });
      // useGetActiveWorkspaceUser (keyed ["workspace-user", "active", ...])
      // drives useWorkspacePermission's `role`, and useWorkspacePermission's
      // capability cache is keyed ["workspace-capabilities", workspaceId,
      // role]. Without invalidating both, a self-demotion leaves the caller
      // looking privileged (stale `isAdmin`/capabilities) until reload —
      // matching the prefix-invalidation pattern used by
      // useUpdateWorkspaceUserRole and useTransferWorkspaceOwnership.
      queryClient.invalidateQueries({
        queryKey: ["workspace-user", "active"],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", workspaceId],
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update global admin status",
      );
    },
  });
}
