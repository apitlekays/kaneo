import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useMyPageAccess } from "@/hooks/queries/workspace-access/use-my-page-access";
import { categoryItemPath, SIDEBAR_CATEGORIES } from "@/lib/sidebar-categories";

export function NavCategories() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();
  // Reactive pathname: window.location is not reactive, so reading it directly
  // leaves the active highlight stuck on the first-clicked item when moving
  // between sub-categories (same `$category` route → no remount).
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: access } = useMyPageAccess(workspace?.id ?? "");

  // Render nothing until access is known — hiding-until-known prevents briefly
  // flashing pages the user isn't allowed to see.
  if (!workspace || !access) return null;

  const accessible = new Set(access.pages);

  return (
    <>
      {SIDEBAR_CATEGORIES.map((category) => {
        const items = category.items.filter((item) =>
          accessible.has(item.slug),
        );
        // Hide a whole group when the user can access none of its pages.
        if (items.length === 0) return null;

        const containsActive = items.some(
          (item) => pathname === categoryItemPath(item.slug),
        );

        return (
          <Collapsible
            key={category.titleKey}
            // Keep the active category expanded after navigation remounts the
            // sidebar, so clicking a sub-item doesn't snap its group shut.
            defaultOpen={containsActive}
            className="group/collapsible"
          >
            <SidebarGroup className="gap-1 p-2">
              <CollapsibleTrigger
                className="data-panel-open:[&_svg]:rotate-90"
                render={
                  <SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 text-sidebar-accent-foreground" />
                }
              >
                <span>{t(category.titleKey)}</span>
                <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {items.map((item) => {
                      const label = t(item.titleKey);
                      return (
                        <SidebarMenuItem key={item.slug}>
                          <SidebarMenuButton
                            tooltip={label}
                            isActive={pathname === categoryItemPath(item.slug)}
                            size="default"
                            className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                            onClick={() =>
                              navigate({
                                to: "/dashboard/category/$category",
                                params: { category: item.slug },
                              })
                            }
                          >
                            <span>{label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsiblePanel>
            </SidebarGroup>
          </Collapsible>
        );
      })}
    </>
  );
}
