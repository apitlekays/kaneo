import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspaceWebSocket } from "@/hooks/use-workspace-websocket";

export const Route = createFileRoute("/_layout/_authenticated/dashboard")({
  component: DashboardLayoutComponent,
});

function DashboardLayoutComponent() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();

  useWorkspaceWebSocket(workspace?.id ?? "");

  return (
    <>
      <PageTitle
        title={t("navigation:page.projectsTitle")}
        hideAppName={!workspace?.name}
      />
      <Outlet />
    </>
  );
}
