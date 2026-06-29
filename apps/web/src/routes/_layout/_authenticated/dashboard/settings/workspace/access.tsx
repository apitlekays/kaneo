import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Checkbox } from "@/components/ui/checkbox";
import { ColoredAvatar } from "@/components/ui/colored-avatar";
import { usePageAccessMatrix } from "@/hooks/queries/workspace-access/use-page-access-matrix";
import { useSetPageAccess } from "@/hooks/queries/workspace-access/use-set-page-access";
import { useWorkspaceMembersList } from "@/hooks/queries/workspace-access/use-workspace-members-list";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { SIDEBAR_CATEGORIES } from "@/lib/sidebar-categories";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/access",
)({
  component: RouteComponent,
});

// Workspace roles that bypass the access matrix entirely (always see all pages).
const ADMIN_ROLES = new Set(["owner", "admin", "global-admin"]);

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, isAdmin } = useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";

  const { data: members = [] } = useWorkspaceMembersList(
    workspaceId,
    Boolean(isAdmin),
  );
  const { data: matrix } = usePageAccessMatrix(workspaceId, Boolean(isAdmin));
  const setAccess = useSetPageAccess(workspaceId);

  if (!isAdmin) {
    return (
      <>
        <PageTitle title={t("settings:workspaceAccess.title")} />
        <div className="max-w-4xl mx-auto space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceAccess.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceAccess.noAccessBody")}
          </p>
        </div>
      </>
    );
  }

  const granted = new Set(
    (matrix?.grants ?? []).map((grant) => `${grant.userId}|${grant.pageSlug}`),
  );

  return (
    <>
      <PageTitle title={t("settings:workspaceAccess.title")} />
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceAccess.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceAccess.description")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("settings:workspaceAccess.alwaysAvailable")}
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium align-bottom min-w-56"
                >
                  {t("settings:workspaceAccess.member")}
                </th>
                {SIDEBAR_CATEGORIES.map((category) => (
                  <th
                    key={category.titleKey}
                    colSpan={category.items.length}
                    className="border-l border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground"
                  >
                    {t(category.titleKey)}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border bg-muted/20">
                {SIDEBAR_CATEGORIES.flatMap((category) =>
                  category.items.map((item, index) => (
                    <th
                      key={item.slug}
                      className={cn(
                        "px-2 py-2 text-center align-bottom font-normal text-muted-foreground",
                        index === 0 && "border-l border-border",
                      )}
                    >
                      <span className="block max-w-24 mx-auto text-[11px] leading-tight">
                        {t(item.titleKey)}
                      </span>
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isAdminRow = ADMIN_ROLES.has(member.role);
                return (
                  <tr
                    key={member.id}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="sticky left-0 z-10 bg-background px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ColoredAvatar
                          name={member.name}
                          image={member.image}
                          seed={member.id}
                          className="h-7 w-7"
                          fallbackClassName="text-[11px]"
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {member.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    {SIDEBAR_CATEGORIES.flatMap((category) =>
                      category.items.map((item, index) => {
                        const checked = isAdminRow
                          ? true
                          : granted.has(`${member.id}|${item.slug}`);
                        return (
                          <td
                            key={item.slug}
                            className={cn(
                              "px-2 py-2 text-center",
                              index === 0 && "border-l border-border",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={isAdminRow || setAccess.isPending}
                              onCheckedChange={(value) =>
                                setAccess.mutate({
                                  userId: member.id,
                                  pageSlug: item.slug,
                                  allowed: value === true,
                                })
                              }
                              aria-label={`${member.name} – ${t(item.titleKey)}`}
                            />
                          </td>
                        );
                      }),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
