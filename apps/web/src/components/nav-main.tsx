import { useNavigate } from "@tanstack/react-router";
import { Bell, ChevronRight } from "lucide-react";
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
import { useMyCorrespondence } from "@/hooks/queries/correspondence/use-letters";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";
import { useNotificationFeed } from "@/hooks/queries/notification/use-notification-feed";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export function NavMain() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();
  const { data: invitations = [] } = usePendingInvitations();
  const { data: feed = [] } = useNotificationFeed();
  const { data: mine } = useMyCorrespondence(workspace?.id ?? "");

  if (!workspace) return null;

  const pendingCount = invitations.length;
  const unreadFeedCount = feed.filter((item) => !item.isRead).length;
  const hasPendingAssignments = (mine?.pendingAssignments?.length ?? 0) > 0;

  const navItems = [
    {
      title: t("navigation:sidebar.home"),
      url: "/dashboard/home",
      isActive: window.location.pathname === "/dashboard/home",
      badge: null,
      bellCount: unreadFeedCount,
      hasDot: hasPendingAssignments,
    },
    {
      title: t("navigation:sidebar.projects"),
      url: `/dashboard/workspace/${workspace.id}`,
      isActive:
        window.location.pathname === `/dashboard/workspace/${workspace.id}`,
      badge: null,
      bellCount: 0,
      hasDot: false,
    },
    {
      title: t("navigation:sidebar.members"),
      url: `/dashboard/workspace/${workspace.id}/members`,
      isActive:
        window.location.pathname ===
        `/dashboard/workspace/${workspace.id}/members`,
      badge: null,
      bellCount: 0,
      hasDot: false,
    },
    {
      title: t("navigation:sidebar.invitations"),
      url: "/dashboard/invitations",
      isActive: window.location.pathname === "/dashboard/invitations",
      badge: pendingCount > 0 ? pendingCount : null,
      bellCount: 0,
      hasDot: false,
    },
  ];

  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup className="gap-1 p-2">
        <CollapsibleTrigger
          className="data-panel-open:[&_svg]:rotate-90"
          render={
            <SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 text-sidebar-accent-foreground" />
          }
        >
          <span>{t("navigation:sidebar.overview")}</span>
          <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item.isActive}
                    size="default"
                    className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                    onClick={() => navigate({ to: item.url })}
                  >
                    <span className="flex items-center gap-1.5">
                      {item.title}
                      {item.hasDot && (
                        <span
                          role="status"
                          aria-label="Awaiting your decision"
                          className="h-1.5 w-1.5 rounded-full bg-destructive"
                        />
                      )}
                    </span>
                    {item.bellCount > 0 && (
                      <span className="ml-auto flex items-center gap-1">
                        <Bell className="h-3.5 w-3.5 text-sidebar-foreground/70" />
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                          {item.bellCount}
                        </span>
                      </span>
                    )}
                    {item.badge !== null && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-sm border border-sidebar-border/60 px-1 text-[11px] font-medium text-sidebar-foreground/80">
                        {item.badge}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}
