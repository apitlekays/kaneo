import { Volume2, VolumeX } from "lucide-react";
import type * as React from "react";

import { NavCategories } from "@/components/nav-categories";
import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import NotificationDropdown from "@/components/notification/notification-dropdown";
import { ThemeToggleDropdown } from "@/components/theme-toggle-dropdown";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { VersionDisplay } from "@/components/version-display";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { shortcuts } from "@/constants/shortcuts";
import { useChimePreference } from "@/hooks/use-chime-preference";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import Search from "./search";

function ChimeMuteButton() {
  const { muted, setMuted } = useChimePreference();
  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label={
        muted ? "Unmute notification chime" : "Mute notification chime"
      }
      title={muted ? "Chime muted" : "Chime on"}
      onClick={() => setMuted(!muted)}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-accent-foreground"
    >
      {muted ? (
        <VolumeX className="h-4 w-4" />
      ) : (
        <Volume2 className="h-4 w-4" />
      )}
    </button>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { toggleSidebar } = useSidebar();

  useRegisterShortcuts({
    modifierShortcuts: {
      [shortcuts.sidebar.prefix]: {
        [shortcuts.sidebar.toggle]: toggleSidebar,
      },
    },
  });

  return (
    <Sidebar
      collapsible="offcanvas"
      variant="inset"
      className="border-none pt-1.5"
      {...props}
    >
      <SidebarHeader className="pt-1 pb-1.5">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher />
          </div>
          <NotificationDropdown />
          <ChimeMuteButton />
        </div>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden gap-1 py-1">
        <Search />
        <NavMain />
        <NavCategories />
        <NavProjects />
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between">
          <VersionDisplay />
          <ThemeToggleDropdown />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
