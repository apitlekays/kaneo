import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAllRenewals } from "@/fetchers/asset-registry";
import { labelOf, RENEWAL_TYPES } from "@/lib/asset-constants";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { formatMoney } from "@/lib/format-currency";

export function RenewalsView({
  workspaceId,
  onOpenAsset,
}: {
  workspaceId: string;
  onOpenAsset: (assetId: string) => void;
}) {
  const { data: renewals = [] } = useQuery({
    queryKey: ["all-renewals", workspaceId],
    queryFn: () => listAllRenewals(workspaceId),
    enabled: !!workspaceId,
  });
  const [filter, setFilter] = useState("all");
  const now = Date.now();
  const filtered =
    filter === "all" ? renewals : renewals.filter((r) => r.type === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Renewals, licences & warranties
          </h2>
          <p className="text-sm text-muted-foreground">
            Every renewable item across all assets, by due date.
          </p>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48">
            <SelectValue>
              {filter === "all" ? "All types" : labelOf(RENEWAL_TYPES, filter)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {RENEWAL_TYPES.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Asset</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const overdue = new Date(r.dueDate).getTime() < now;
              return (
                <tr
                  key={r.id}
                  onClick={() => onOpenAsset(r.assetId)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">{r.assetName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {labelOf(RENEWAL_TYPES, r.type)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.label || "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2",
                      overdue
                        ? "font-medium text-rose-500"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatDateMedium(r.dueDate)}
                    {overdue ? " (overdue)" : ""}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.cost != null ? formatMoney(r.cost, r.currency) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No renewals.
          </div>
        )}
      </div>
    </div>
  );
}
