import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { GeneralManagementShell } from "@/components/general-management/gm-shell";
import PageTitle from "@/components/page-title";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getMyPageAccess } from "@/fetchers/workspace-access";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { authClient } from "@/lib/auth-client";

const SLUG = "general-management";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/category/general-management",
)({
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    const workspaceId = session?.data?.session?.activeOrganizationId;
    if (!workspaceId) return;
    const access = await context.queryClient.ensureQueryData({
      queryKey: ["page-access", "me", workspaceId],
      queryFn: () => getMyPageAccess(workspaceId),
    });
    if (!access.isAdmin && !access.pages.includes(SLUG)) {
      throw redirect({ to: "/dashboard/home" });
    }
  },
  component: GeneralManagementPage,
});

function GeneralManagementPage() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const title = t("navigation:sidebar.categories.generalManagement", {
    defaultValue: "General Management",
  });

  return (
    <>
      <PageTitle title={title} />
      <Layout>
        <Layout.Header>
          <div className="flex w-full items-center gap-1">
            <SidebarTrigger className="-ml-1 h-6 w-6" />
            <Separator
              orientation="vertical"
              className="mx-1.5 data-[orientation=vertical]:h-2.5"
            />
            <h1 className="text-card-foreground text-xs">{title}</h1>
          </div>
        </Layout.Header>
        <Layout.Content>
          {workspaceId ? (
            <GeneralManagementShell workspaceId={workspaceId} />
          ) : null}
        </Layout.Content>
      </Layout>
    </>
  );
}
