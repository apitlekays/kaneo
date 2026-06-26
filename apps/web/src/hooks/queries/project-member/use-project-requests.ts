import { useQuery } from "@tanstack/react-query";
import { getProjectRequests } from "@/fetchers/project-member";

/**
 * Pending access requests for a project. Only managers/global admins are
 * authorized, so this is enabled conditionally (e.g. `enabled: canManage`).
 */
export function useProjectRequests(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["project-requests", projectId],
    queryFn: () => getProjectRequests(projectId),
    enabled: enabled && !!projectId,
  });
}
