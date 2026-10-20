import { createFileRoute, redirect } from "@tanstack/react-router";
import { ProjectListPage } from "@/components/project/project-list-page";
import { getMyPageAccess } from "@/fetchers/workspace-access";
import { CONSULTATIONS_PAGE } from "@/lib/project-kind";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/consultations",
)({
  beforeLoad: async ({ context, params }) => {
    const access = await context.queryClient.ensureQueryData({
      queryKey: ["page-access", "me", params.workspaceId],
      queryFn: () => getMyPageAccess(params.workspaceId),
    });
    if (!access.isAdmin && !access.pages.includes(CONSULTATIONS_PAGE)) {
      throw redirect({ to: "/dashboard/home" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  return <ProjectListPage workspaceId={workspaceId} kind="consultation" />;
}
