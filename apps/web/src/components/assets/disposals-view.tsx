import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, Loader2, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DISPOSAL_REASONS,
  type DisposalRequest,
  getDisposalRequests,
  getDisposalSettings,
  setDisposalSettings,
} from "@/fetchers/asset-registry";
import { listCommittees, listOfficeHolders } from "@/fetchers/committees";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

const STAGES: {
  key: string;
  title: string;
  statuses: DisposalRequest["status"][];
}[] = [
  {
    key: "committee",
    title: "Awaiting the committee",
    statuses: ["proposed"],
  },
  { key: "ceo", title: "Awaiting the CEO", statuses: ["awaiting_ceo"] },
  {
    key: "approved",
    title: "Approved — to be disposed of",
    statuses: ["approved"],
  },
  {
    key: "closed",
    title: "Decided",
    statuses: [
      "disposed",
      "not_supported",
      "rejected",
      "withdrawn",
      "reverted",
    ],
  },
];

const CLOSED_LABEL: Record<string, string> = {
  disposed: "Disposed",
  not_supported: "Not supported",
  rejected: "Rejected by CEO",
  withdrawn: "Withdrawn",
  reverted: "Reverted",
};

const reasonLabel = (value: string) =>
  DISPOSAL_REASONS.find((r) => r.value === value)?.label ??
  (value === "override" ? "Recorded directly" : value);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Opens the proposals awaiting the committee as a plain printable page —
 * the paper the committee works from at its meeting.
 */
function printCommitteePaper(
  requests: DisposalRequest[],
  committeeName: string | null,
) {
  const rows = requests
    .map((r, index) => {
      const proposal = r.steps.find((s) => s.stage === "proposed");
      return `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(r.assetName ?? "")}</strong><br><span>${escapeHtml(r.serialNumber ?? "")}</span></td>
        <td>${escapeHtml(reasonLabel(r.reasonCategory))}</td>
        <td>${escapeHtml(proposal?.justification ?? "")}</td>
        <td>${escapeHtml(r.proposerName ?? "")}<br><span>${escapeHtml(formatDateMedium(r.createdAt))}</span></td>
        <td class="decision">Support / Do not support<br><br>Remarks:</td>
      </tr>`;
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Asset disposal proposals</title>
    <style>
      body{font:12px/1.4 system-ui,sans-serif;margin:24px;color:#111}
      h1{font-size:16px;margin:0 0 4px} p{margin:0 0 16px;color:#555}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #999;padding:6px;vertical-align:top;text-align:left}
      th{background:#eee} td span{color:#666;font-size:11px}
      td.decision{width:22%;color:#666}
    </style></head><body>
    <h1>Asset disposal proposals${committeeName ? ` — ${escapeHtml(committeeName)}` : ""}</h1>
    <p>${requests.length} proposal${requests.length === 1 ? "" : "s"} awaiting the committee · printed ${escapeHtml(formatDateMedium(new Date().toISOString()))}</p>
    <table><thead><tr><th>#</th><th>Asset</th><th>Reason</th><th>Justification</th><th>Proposed by</th><th>Committee decision</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <script>window.onload=function(){window.print()}</script>
    </body></html>`;
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Allow pop-ups to print the committee paper");
    return;
  }
  win.document.write(html);
  win.document.close();
}

export function DisposalsView({
  workspaceId,
  onOpenAsset,
}: {
  workspaceId: string;
  onOpenAsset: (assetId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["disposal-requests", workspaceId],
    queryFn: () => getDisposalRequests(workspaceId),
    enabled: !!workspaceId,
  });
  const { data: settings } = useQuery({
    queryKey: ["disposal-settings", workspaceId],
    queryFn: () => getDisposalSettings(workspaceId),
    enabled: !!workspaceId,
  });
  const { data: committees = [] } = useQuery({
    queryKey: ["committees", workspaceId],
    queryFn: () => listCommittees(workspaceId, false),
    enabled: !!workspaceId,
  });
  const { data: holders = [] } = useQuery({
    queryKey: ["office-holders", workspaceId],
    queryFn: () => listOfficeHolders(workspaceId),
    enabled: !!workspaceId,
  });
  const ceo = holders.find((h) => h.key === "ceo");

  const save = useMutation({
    mutationFn: (committeeBodyId: string | null) =>
      setDisposalSettings(workspaceId, committeeBodyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["disposal-settings", workspaceId] });
      toast.success("Disposal committee updated");
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Not saved"),
  });

  const missing: string[] = [];
  if (!settings?.committeeBodyId) missing.push("choose the disposal committee");
  else if (!settings.chairName)
    missing.push(
      "give the committee a chair (General Management → Committees)",
    );
  if (!ceo?.holderUserId)
    missing.push("set the CEO (General Management → Committees)");

  const awaitingCommittee = requests.filter((r) => r.status === "proposed");

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">Who decides</h3>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Disposal committee</p>
            {settings?.canEdit ? (
              <Select
                value={settings?.committeeBodyId ?? ""}
                onValueChange={(v) => save.mutate(v || null)}
              >
                <SelectTrigger aria-label="Disposal committee">
                  <SelectValue placeholder="Choose a committee" />
                </SelectTrigger>
                <SelectContent>
                  {committees.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p>{settings?.committeeName ?? "Not set"}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              Chair (secretary stands in on the chair's own proposals)
            </p>
            <p>
              {settings?.chairName ?? "—"}
              {settings?.secretaryName && (
                <span className="text-muted-foreground">
                  {" "}
                  · {settings.secretaryName}
                </span>
              )}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              CEO (acting CEO stands in on the CEO's own proposals)
            </p>
            <p>
              {ceo?.holderName ?? "—"}
              {ceo?.actingName && (
                <span className="text-muted-foreground">
                  {" "}
                  · {ceo.actingName}
                </span>
              )}
            </p>
          </div>
        </div>
        {missing.length > 0 && (
          <p className="text-amber-700 text-xs dark:text-amber-300">
            Disposals cannot be proposed until you {missing.join(" and ")}.
            {!settings?.canEdit && " A global admin can do this."}
          </p>
        )}
      </section>

      {isLoading ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      ) : requests.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground text-sm">
          No disposal proposals yet. Custodians propose an asset from its
          Disposal tab.
        </p>
      ) : (
        STAGES.map((stage) => {
          const items = requests.filter((r) =>
            stage.statuses.includes(r.status),
          );
          if (items.length === 0) return null;
          return (
            <section key={stage.key} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-sm">
                  {stage.title}{" "}
                  <span className="text-muted-foreground">
                    ({items.length})
                  </span>
                </h3>
                {stage.key === "committee" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      printCommitteePaper(
                        awaitingCommittee,
                        settings?.committeeName ?? null,
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print committee paper
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-border border-b bg-muted/40 text-left text-muted-foreground text-xs">
                      <th className="px-3 py-2 font-medium">Asset</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                      <th className="px-3 py-2 font-medium">Proposed by</th>
                      <th className="px-3 py-2 font-medium">
                        {stage.key === "closed" ? "Outcome" : "Waiting on"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-border border-b last:border-0 hover:bg-muted/30"
                        onClick={() => onOpenAsset(r.assetId)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.assetName}</div>
                          <div className="font-mono text-muted-foreground text-xs">
                            {r.serialNumber}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {reasonLabel(r.reasonCategory)}
                        </td>
                        <td className="px-3 py-2">
                          {r.proposerName ?? "—"}
                          <div className="text-muted-foreground text-xs">
                            {formatDateMedium(r.createdAt)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {stage.key === "closed" ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                r.status === "disposed" && "text-rose-600",
                              )}
                            >
                              {CLOSED_LABEL[r.status] ?? r.status}
                            </Badge>
                          ) : (
                            (r.pendingDeciderName ?? "—")
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

export default DisposalsView;
