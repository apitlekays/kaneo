import { AlertTriangle, Boxes, CalendarClock, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import type { AssetSummary as Summary } from "@/fetchers/asset-registry";
import {
  ASSET_CATEGORIES,
  labelOf,
  RENEWAL_TYPES,
} from "@/lib/asset-constants";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { formatMoney } from "@/lib/format-currency";

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "rose";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className={cn(tone === "rose" && "text-rose-500")}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold",
          tone === "rose" && "text-rose-500",
        )}
      >
        {value}
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AssetSummary({
  summary,
  currency = "MYR",
}: {
  summary: Summary;
  currency?: string;
}) {
  const due = [...summary.overdueRenewals, ...summary.upcomingRenewals].slice(
    0,
    8,
  );
  const now = Date.now();
  const categoryHint = ASSET_CATEGORIES.filter(
    (c) => summary.byCategory[c.value],
  )
    .map((c) => `${summary.byCategory[c.value]} ${c.label}`)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Boxes className="h-4 w-4" />}
          label="Total assets"
          value={summary.totalAssets}
          hint={categoryHint || undefined}
        />
        <Stat
          icon={<Wallet className="h-4 w-4" />}
          label="Total value"
          value={formatMoney(summary.totalValue, currency)}
          hint={`Purchase ${formatMoney(summary.purchaseTotal, currency)} + spend ${formatMoney(summary.spendTotal, currency)}`}
        />
        <Stat
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Overdue renewals"
          value={summary.overdueCount}
          tone={summary.overdueCount > 0 ? "rose" : undefined}
        />
        <Stat
          icon={<CalendarClock className="h-4 w-4" />}
          label="Upcoming renewals"
          value={summary.upcomingCount}
        />
      </div>

      {due.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
            Renewals due
          </div>
          <ul className="divide-y divide-border">
            {due.map((r) => {
              const overdue = new Date(r.dueDate).getTime() < now;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{r.assetName}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      — {r.label || labelOf(RENEWAL_TYPES, r.type)}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      overdue
                        ? "font-medium text-rose-500"
                        : "text-muted-foreground",
                    )}
                  >
                    {overdue ? "Overdue · " : ""}
                    {formatDateMedium(r.dueDate)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
