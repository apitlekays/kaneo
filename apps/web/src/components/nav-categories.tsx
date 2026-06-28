import { useNavigate } from "@tanstack/react-router";
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
import { categoryItemPath, SIDEBAR_CATEGORIES } from "@/lib/sidebar-categories";

export function NavCategories() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();

  if (!workspace) return null;

  return (
    <>
      {SIDEBAR_CATEGORIES.map((category) => (
        <Collapsible key={category.titleKey} className="group/collapsible">
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
                  {category.items.map((item) => {
                    const path = categoryItemPath(item.slug);
                    const label = t(item.titleKey);
                    return (
                      <SidebarMenuItem key={item.slug}>
                        <SidebarMenuButton
                          tooltip={label}
                          isActive={window.location.pathname === path}
                          size="default"
                          className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                          onClick={() => navigate({ to: path })}
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
      ))}
    </>
  );
}
