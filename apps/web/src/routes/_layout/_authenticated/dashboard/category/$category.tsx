import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Construction } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getMyPageAccess } from "@/fetchers/workspace-access";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useMyPageAccess } from "@/hooks/queries/workspace-access/use-my-page-access";
import { authClient } from "@/lib/auth-client";
import { findCategoryItem } from "@/lib/sidebar-categories";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/category/$category",
)({
  // Enforce page access on direct navigation/deep-link: a user without a grant
  // for this slug (and who isn't an admin) is redirected to Home. Shares the
  // sidebar's cached access query so this doesn't double-fetch.
  beforeLoad: async ({ params, context }) => {
    const session = await authClient.getSession();
    const workspaceId = session?.data?.session?.activeOrganizationId;
    if (!workspaceId) return;

    const access = await context.queryClient.ensureQueryData({
      queryKey: ["page-access", "me", workspaceId],
      queryFn: () => getMyPageAccess(workspaceId),
    });

    if (!access.isAdmin && !access.pages.includes(params.category)) {
      throw redirect({ to: "/dashboard/home" });
    }
  },
  component: CategoryComingSoonPage,
});

function CategoryComingSoonPage() {
  const { t } = useTranslation();
  const { category } = Route.useParams();
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const { data: access } = useMyPageAccess(workspace?.id ?? "");

  // Live revocation: if an admin removes this page while the user is on it, the
  // WS invalidation refetches access and this bounces them to Home. Admins (and
  // still-granted users) are never affected.
  useEffect(() => {
    if (!access || access.isAdmin) return;
    if (!access.pages.includes(category)) {
      navigate({ to: "/dashboard/home" });
    }
  }, [access, category, navigate]);

  const match = findCategoryItem(category);
  const title = match ? t(match.item.titleKey) : category;

  return (
    <>
      <PageTitle title={title} />
      <Layout>
        <Layout.Header>
          <div className="flex items-center gap-1 w-full">
            <SidebarTrigger className="-ml-1 h-6 w-6" />
            <Separator
              orientation="vertical"
              className="mx-1.5 data-[orientation=vertical]:h-2.5"
            />
            <h1 className="text-xs text-card-foreground">{title}</h1>
          </div>
        </Layout.Header>
        <Layout.Content>
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Construction className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("comingSoon:description")}
            </p>
          </div>
        </Layout.Content>
      </Layout>
    </>
  );
}
