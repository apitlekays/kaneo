import { useQuery } from "@tanstack/react-query";
import { getWorkspaceMembersList } from "@/fetchers/workspace-access";

/** All members of a workspace as { id, name, email, image, role }. */
export function useWorkspaceMembersList(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["workspace-members-list", workspaceId],
    queryFn: () => getWorkspaceMembersList(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}
