import { createFileRoute, useNavigate } from "@tanstack/react-router";
import Layout from "@/components/common/layout";
import { LetterDetailDialog } from "@/components/general-management/letter-detail-dialog";
import PageTitle from "@/components/page-title";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/correspondence/$letterId",
)({
  component: CorrespondenceDeepLink,
});

function CorrespondenceDeepLink() {
  const { letterId } = Route.useParams();
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";

  return (
    <>
      <PageTitle title="Correspondence" />
      <Layout>
        <Layout.Header>
          <div className="flex w-full items-center gap-1">
            <SidebarTrigger className="-ml-1 h-6 w-6" />
            <Separator
              orientation="vertical"
              className="mx-1.5 data-[orientation=vertical]:h-2.5"
            />
            <h1 className="text-card-foreground text-xs">Correspondence</h1>
          </div>
        </Layout.Header>
        <Layout.Content>
          {workspaceId ? (
            <LetterDetailDialog
              workspaceId={workspaceId}
              letterId={letterId}
              onClose={() => navigate({ to: "/dashboard/home" })}
            />
          ) : null}
        </Layout.Content>
      </Layout>
    </>
  );
}
