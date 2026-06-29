import { useQuery } from "@tanstack/react-query";
import { getMyPageAccess } from "@/fetchers/workspace-access";

/** Current user's accessible sidebar-category slugs (admins get all). */
export function useMyPageAccess(workspaceId: string) {
  return useQuery({
    queryKey: ["page-access", "me", workspaceId],
    queryFn: () => getMyPageAccess(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}
