import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Mail,
  NotepadText,
  Settings as SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { verifyAuditChain } from "@/fetchers/correspondence";
import {
  reportAuditUrl,
  reportDispositionUrl,
  reportRegisterUrl,
} from "@/fetchers/correspondence/letters";
import { useCorrespondenceSummary } from "@/hooks/queries/correspondence/use-letters";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { Correspondence } from "./correspondence";
import { MinutesManager } from "./minutes-manager";
import { GeneralManagementSettings } from "./settings";

// `adminOnly` drives visibility below. Keeping it on the section itself means
// adding a tab is a one-line change here, rather than also remembering to
// amend a separate list of which keys are gated.
const SECTIONS = [
  {
    key: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    adminOnly: true,
  },
  {
    key: "correspondence",
    label: "Correspondence",
    icon: Mail,
    adminOnly: false,
  },
  {
    key: "minutes-manager",
    label: "Minutes Manager",
    icon: NotepadText,
    adminOnly: false,
  },
  {
    key: "settings",
    label: "Settings",
    icon: SettingsIcon,
    adminOnly: true,
  },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

// Display-side convenience only: it decides which tab renders, nothing more.
// The actual gate lives on the server (GET /config/*, GET /summary), so a
// wrong value here can only show or hide a tab — never grant data access.
function visibleSections(isAdmin: boolean) {
  return isAdmin ? SECTIONS : SECTIONS.filter((s) => !s.adminOnly);
}

function Overview({
  workspaceId,
  onGoSettings,
}: {
  workspaceId: string;
  onGoSettings: () => void;
}) {
  const { data: audit } = useQuery({
    queryKey: ["gm-audit-verify", workspaceId],
    queryFn: () => verifyAuditChain(workspaceId),
    enabled: !!workspaceId,
  });
  const { data: summary } = useCorrespondenceSummary(workspaceId);

  const kpis = [
    { label: "Incoming", value: summary?.incoming ?? 0 },
    { label: "Outgoing", value: summary?.outgoing ?? 0 },
    { label: "Pending registration", value: summary?.pendingRegistration ?? 0 },
    { label: "Unassigned", value: summary?.unassigned ?? 0 },
    { label: "Overdue", value: summary?.overdue ?? 0 },
    { label: "On hold", value: summary?.onHold ?? 0 },
    { label: "Due for disposition", value: summary?.dueForDisposition ?? 0 },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-semibold text-lg">General Management</h2>
        <p className="text-muted-foreground text-sm">
          Correspondence records management — Surat Masuk &amp; Surat Keluar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border p-3">
            <div className="font-semibold text-2xl">{k.value}</div>
            <div className="text-muted-foreground text-xs">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-border p-5">
        <h3 className="font-medium">Get started</h3>
        <p className="text-muted-foreground text-sm">
          Configure numbering, classification, approval chains, and distribution
          lists in Settings before registering letters. Every configuration
          change is recorded in the tamper-evident audit log.
        </p>
        <Button size="sm" onClick={onGoSettings}>
          Open Settings
        </Button>
      </div>

      <div className="space-y-1 rounded-xl border border-border p-5">
        <h3 className="font-medium">Audit log integrity</h3>
        {audit ? (
          audit.ok ? (
            <p className="text-emerald-600 text-sm dark:text-emerald-400">
              ✓ Verified — {audit.count} event{audit.count === 1 ? "" : "s"},
              hash chain intact.
            </p>
          ) : (
            <p className="text-rose-600 text-sm dark:text-rose-400">
              ⚠ Chain integrity check failed at #{audit.brokenAtSeq}.
            </p>
          )
        ) : (
          <p className="text-muted-foreground text-sm">Checking…</p>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-border p-5">
        <h3 className="font-medium">Reports (CSV)</h3>
        <div className="flex flex-wrap gap-2">
          {[
            {
              label: "Register — In",
              href: reportRegisterUrl(workspaceId, "in"),
            },
            {
              label: "Register — Out",
              href: reportRegisterUrl(workspaceId, "out"),
            },
            {
              label: "Disposition log",
              href: reportDispositionUrl(workspaceId),
            },
            { label: "Audit trail", href: reportAuditUrl(workspaceId) },
          ].map((r) => (
            <a key={r.label} href={r.href}>
              <Button size="sm" variant="outline">
                {r.label}
              </Button>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GeneralManagementShell({
  workspaceId,
  initialSection = "overview",
}: {
  workspaceId: string;
  /**
   * Test seam only: lets tests render the shell starting on a given tab
   * without driving the Select control. Production never passes this — the
   * real starting tab (and the redirect for a hidden/invalid one) is
   * decided by `currentKey` below, not by this prop.
   */
  initialSection?: SectionKey;
}) {
  const { isAdmin } = useWorkspacePermission();
  const [section, setSection] = useState<SectionKey>(initialSection);
  const sections = visibleSections(isAdmin);
  const currentKey = sections.some((s) => s.key === section)
    ? section
    : "correspondence";
  const active =
    sections.find((s) => s.key === currentKey) ?? sections[0] ?? SECTIONS[1];

  return (
    <div className="flex h-full min-h-0 flex-col sm:flex-row">
      {/* Mobile: section selector */}
      <div className="border-border border-b p-3 sm:hidden">
        <Select
          value={currentKey}
          onValueChange={(value) => {
            if (value) setSection(value);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              <span className="flex items-center gap-2">
                <active.icon className="h-4 w-4" />
                {active.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: left function-nav rail */}
      <nav className="hidden w-52 shrink-0 flex-col gap-0.5 border-border border-r p-3 sm:flex">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
              currentKey === s.key
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            <s.icon className="h-4 w-4" /> {s.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {currentKey === "overview" && (
          <Overview
            workspaceId={workspaceId}
            onGoSettings={() => setSection("settings")}
          />
        )}
        {currentKey === "correspondence" && (
          <Correspondence workspaceId={workspaceId} />
        )}
        {currentKey === "minutes-manager" && (
          <MinutesManager workspaceId={workspaceId} />
        )}
        {currentKey === "settings" && (
          <GeneralManagementSettings workspaceId={workspaceId} />
        )}
      </div>
    </div>
  );
}
