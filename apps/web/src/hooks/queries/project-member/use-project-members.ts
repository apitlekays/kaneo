import { useQuery } from "@tanstack/react-query";
import { getProjectMembers } from "@/fetchers/project-member";

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => getProjectMembers(projectId),
    enabled: !!projectId,
  });
}
