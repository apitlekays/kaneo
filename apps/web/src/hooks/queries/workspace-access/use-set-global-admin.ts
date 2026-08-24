import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setGlobalAdmin } from "@/fetchers/workspace-access";

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
    },
  });
}
