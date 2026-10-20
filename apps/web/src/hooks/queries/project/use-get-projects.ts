import { useQuery } from "@tanstack/react-query";
import getProjects from "@/fetchers/project/get-projects";
import type { ProjectKind } from "@/lib/project-kind";

/**
 * The workspace's projects of one kind. The API returns every project and
 * consultation the caller may open; filtering here keeps a single cache
 * entry, so every existing `["projects"]` invalidation covers both.
 */
function useGetProjects({
  workspaceId,
  kind = "project",
}: {
  workspaceId: string;
  kind?: ProjectKind | "all";
}) {
  return useQuery({
    queryFn: () => getProjects({ workspaceId }),
    queryKey: ["projects", workspaceId],
    enabled: !!workspaceId,
    select: (projects) =>
      kind === "all"
        ? projects
        : projects?.filter((project) =>
            kind === "consultation"
              ? project.kind === "consultation"
              : project.kind !== "consultation",
          ),
  });
}

export default useGetProjects;
