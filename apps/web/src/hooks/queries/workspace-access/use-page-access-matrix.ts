import { useQuery } from "@tanstack/react-query";
import { getPageAccessMatrix } from "@/fetchers/workspace-access";

/** Full access matrix for the workspace (owner/global-admin only). */
export function usePageAccessMatrix(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ["page-access", "matrix", workspaceId],
    queryFn: () => getPageAccessMatrix(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}
