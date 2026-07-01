"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

export type DialogSidebarItem = {
  /** Stable section key, matches a DialogSidebarPanel value. */
  value: string;
  label: string;
  /** Optional leading icon. */
  icon?: LucideIcon;
  /** Optional trailing hint, e.g. a count. */
  badge?: ReactNode;
};

/**
 * Sidebar-navigation layout for dialogs with complex/sectioned content — the
 * default for any modal that would otherwise need many tabs. On large screens
 * it renders a left sidebar + scrollable content; on mobile the sidebar
 * collapses to a section dropdown above the content so nothing gets cramped.
 * Built on the base-ui tabs primitive, so keyboard nav + ARIA come for free.
 *
 * Pair with <DialogSidebarPanel value="..."> children (re-exported TabsContent).
 * Place it as a flex child directly under a DialogHeader; it fills remaining
 * height and manages its own scrolling.
 */
export function DialogSidebar({
  items,
  value,
  onValueChange,
  children,
  className,
}: {
  items: DialogSidebarItem[];
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const active = items.find((item) => item.value === value);

  return (
    <TabsPrimitive.Root
      orientation="vertical"
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      data-slot="dialog-sidebar"
      className={cn("flex min-h-0 flex-1 flex-col sm:flex-row", className)}
    >
      {/* Mobile: section selector */}
      <div className="border-b px-4 py-2.5 sm:hidden">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="w-full">
            <SelectValue>
              <span className="flex items-center gap-2">
                {active?.icon ? <active.icon className="size-4" /> : null}
                {active?.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <span className="flex items-center gap-2">
                  {item.icon ? <item.icon className="size-4" /> : null}
                  {item.label}
                  {item.badge != null && item.badge !== "" ? (
                    <span className="text-muted-foreground">
                      ({item.badge})
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: left sidebar */}
      <TabsList
        variant="underline"
        className="hidden w-52 shrink-0 gap-0.5 self-stretch overflow-y-auto border-r p-2 sm:flex"
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            className="w-full justify-start gap-2"
          >
            {item.icon ? <item.icon className="size-4" /> : null}
            <span className="flex-1 truncate text-left">{item.label}</span>
            {item.badge != null && item.badge !== "" ? (
              <span className="text-muted-foreground text-xs">
                {item.badge}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6 sm:px-6">
        {children}
      </div>
    </TabsPrimitive.Root>
  );
}

export function DialogSidebarPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Panel
      value={value}
      className={cn("outline-none", className)}
      data-slot="dialog-sidebar-panel"
    >
      {children}
    </TabsPrimitive.Panel>
  );
}
