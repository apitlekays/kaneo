import { createFileRoute } from "@tanstack/react-router";
import { ProjectListPage } from "@/components/project/project-list-page";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  return <ProjectListPage workspaceId={workspaceId} kind="project" />;
}
