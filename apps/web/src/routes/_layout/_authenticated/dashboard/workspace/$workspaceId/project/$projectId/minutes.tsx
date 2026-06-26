import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import ProjectMinutes from "@/components/project/project-minutes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/minutes",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();

  return (
    <>
      <PageTitle title={t("minutes:pageTitle")} />
      <ProjectLayout
        projectId={projectId}
        workspaceId={workspaceId}
        activeView="minutes"
      >
        <ProjectMinutes projectId={projectId} workspaceId={workspaceId} />
      </ProjectLayout>
    </>
  );
}
