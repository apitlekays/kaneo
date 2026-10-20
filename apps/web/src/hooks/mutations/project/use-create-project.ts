import { useMutation } from "@tanstack/react-query";
import createProject from "@/fetchers/project/create-project";
import type { ProjectKind } from "@/lib/project-kind";

function useCreateProject({
  name,
  slug,
  workspaceId,
  icon,
  kind = "project",
}: {
  name: string;
  slug: string;
  workspaceId: string;
  icon: string;
  kind?: ProjectKind;
}) {
  return useMutation({
    mutationFn: () => createProject({ name, slug, workspaceId, icon, kind }),
  });
}

export default useCreateProject;
